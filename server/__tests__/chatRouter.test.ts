/**
 * Route-level integration tests for `chatRouter`.
 *
 * These exercise the real tRPC route layer through `appRouter.createCaller`:
 * the `protectedProcedure` auth middleware, Zod input validation, and the
 * actual Drizzle queries against a real in-memory libSQL database. The focus is
 * the parts a service-only test cannot reach — per-user ownership isolation,
 * upsert semantics, and FK cascade — which are security- and correctness-
 * sensitive at the API boundary.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

// Route the router's getDb() at the shared in-memory test DB. Other db.factory
// exports are preserved so nothing else breaks at import time.
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

// The audit middleware on every protectedProcedure persists through the real
// file DB; stub it so these tests stay hermetic (audit logging is tested
// elsewhere).
vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { chatSessions } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  seedUser,
  makeContext,
  type TestDb,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;
let alice: Awaited<ReturnType<typeof seedUser>>;
let bob: Awaited<ReturnType<typeof seedUser>>;
let asAlice: Caller;
let asBob: Caller;

function newSessionInput(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    title: "My chat",
    providerId: "anthropic",
    modelId: "claude-opus-4-8",
    ...overrides,
  };
}

beforeAll(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

beforeEach(async () => {
  // Clean slate between tests — cascade clears messages with their sessions.
  await db.delete(chatSessions);
  alice = await seedUser(db, {
    openId: `alice-${randomUUID()}`,
    name: "Alice",
  });
  bob = await seedUser(db, { openId: `bob-${randomUUID()}`, name: "Bob" });
  asAlice = appRouter.createCaller(makeContext(alice, db));
  asBob = appRouter.createCaller(makeContext(bob, db));
});

describe("chatRouter — auth boundary", () => {
  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    const anon = appRouter.createCaller(makeContext(null, db));
    await expect(anon.chat.listSessions()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("chatRouter — sessions", () => {
  it("creates a session and reads it back with no messages", async () => {
    const input = newSessionInput({ metadata: { pinned: true } });
    const created = await asAlice.chat.createSession(input);
    expect(created.id).toBe(input.id);
    expect(created.userId).toBe(alice.id);

    const fetched = await asAlice.chat.getSession({ id: input.id });
    expect(fetched.title).toBe("My chat");
    expect(fetched.metadata).toEqual({ pinned: true }); // JSON round-trip
    expect(fetched.messages).toEqual([]);
  });

  it("createSession upserts by id (same id updates title, keeps owner)", async () => {
    const input = newSessionInput({ title: "First" });
    await asAlice.chat.createSession(input);
    const updated = await asAlice.chat.createSession({
      ...input,
      title: "Second",
    });
    expect(updated.title).toBe("Second");

    const all = await asAlice.chat.listSessions();
    expect(all).toHaveLength(1); // upsert, not a second row
    expect(all[0]?.userId).toBe(alice.id);
  });

  it("listSessions returns only the caller's own sessions", async () => {
    await asAlice.chat.createSession(newSessionInput({ title: "alice-a" }));
    await asAlice.chat.createSession(newSessionInput({ title: "alice-b" }));
    await asBob.chat.createSession(newSessionInput({ title: "bob-a" }));

    const aliceSessions = await asAlice.chat.listSessions();
    const bobSessions = await asBob.chat.listSessions();
    expect(aliceSessions).toHaveLength(2);
    expect(bobSessions).toHaveLength(1);
    expect(aliceSessions.every(s => s.userId === alice.id)).toBe(true);
    expect(bobSessions[0]?.title).toBe("bob-a");
  });

  it("listSessions orders by updatedAt descending", async () => {
    const older = newSessionInput({ title: "older" });
    const newer = newSessionInput({ title: "newer" });
    await asAlice.chat.createSession(older);
    await asAlice.chat.createSession(newer);
    // Pin deterministic timestamps so ordering can't tie on a same-second insert.
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(chatSessions.id, older.id));
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date("2024-01-01T00:00:00Z") })
      .where(eq(chatSessions.id, newer.id));

    const list = await asAlice.chat.listSessions();
    expect(list.map(s => s.title)).toEqual(["newer", "older"]);
  });

  it("updateSession patches fields for the owner", async () => {
    const input = newSessionInput({ title: "old", modelId: "m1" });
    await asAlice.chat.createSession(input);
    const updated = await asAlice.chat.updateSession({
      id: input.id,
      title: "new title",
      modelId: "m2",
      systemPrompt: "be terse",
    });
    expect(updated.title).toBe("new title");
    expect(updated.modelId).toBe("m2");
    expect(updated.systemPrompt).toBe("be terse");
  });

  it("getSession on a non-owned session throws NOT_FOUND (no cross-user read)", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    await expect(asBob.chat.getSession({ id: input.id })).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      }
    );
  });

  it("updateSession on a non-owned session throws NOT_FOUND", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    await expect(
      asBob.chat.updateSession({ id: input.id, title: "hijacked" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Alice's title is untouched.
    const fetched = await asAlice.chat.getSession({ id: input.id });
    expect(fetched.title).toBe("My chat");
  });

  it("deleteSession cascades messages and rejects non-owners", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    await asAlice.chat.addMessage({
      id: randomUUID(),
      sessionId: input.id,
      role: "user",
      content: "hello",
    });

    // Bob cannot delete Alice's session.
    await expect(
      asBob.chat.deleteSession({ id: input.id })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const res = await asAlice.chat.deleteSession({ id: input.id });
    expect(res).toEqual({ id: input.id, success: true });

    // Session is gone and its messages cascade-deleted (no orphans).
    await expect(
      asAlice.chat.getSession({ id: input.id })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const orphans = await db.query.chatMessages.findMany({
      where: (m, { eq: e }) => e(m.sessionId, input.id),
    });
    expect(orphans).toEqual([]);
  });
});

describe("chatRouter — messages", () => {
  it("adds a message to an owned session and reads it back", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    const msgId = randomUUID();
    const row = await asAlice.chat.addMessage({
      id: msgId,
      sessionId: input.id,
      role: "user",
      content: "what is 2+2?",
      tokenCount: 5,
    });
    expect(row.id).toBe(msgId);
    expect(row.role).toBe("user");

    const fetched = await asAlice.chat.getSession({ id: input.id });
    expect(fetched.messages).toHaveLength(1);
    expect(fetched.messages[0]?.content).toBe("what is 2+2?");
  });

  it("addMessage upserts by id (edits content, no duplicate row)", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    const msgId = randomUUID();
    await asAlice.chat.addMessage({
      id: msgId,
      sessionId: input.id,
      role: "user",
      content: "v1",
    });
    await asAlice.chat.addMessage({
      id: msgId,
      sessionId: input.id,
      role: "user",
      content: "v2",
    });

    const fetched = await asAlice.chat.getSession({ id: input.id });
    expect(fetched.messages).toHaveLength(1);
    expect(fetched.messages[0]?.content).toBe("v2");
  });

  it("addMessage to a non-owned session throws NOT_FOUND (ownership enforced)", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    await expect(
      asBob.chat.addMessage({
        id: randomUUID(),
        sessionId: input.id,
        role: "user",
        content: "injected",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deleteMessage enforces session ownership", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    const msgId = randomUUID();
    await asAlice.chat.addMessage({
      id: msgId,
      sessionId: input.id,
      role: "user",
      content: "x",
    });

    await expect(
      asBob.chat.deleteMessage({ id: msgId, sessionId: input.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const res = await asAlice.chat.deleteMessage({
      id: msgId,
      sessionId: input.id,
    });
    expect(res).toEqual({ id: msgId, success: true });
    const fetched = await asAlice.chat.getSession({ id: input.id });
    expect(fetched.messages).toEqual([]);
  });

  it("rejects an invalid message role at the input boundary", async () => {
    const input = newSessionInput();
    await asAlice.chat.createSession(input);
    await expect(
      asAlice.chat.addMessage({
        id: randomUUID(),
        sessionId: input.id,
        // @ts-expect-error — deliberately invalid enum value
        role: "robot",
        content: "x",
      })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("chatRouter — bulkImport", () => {
  it("imports new sessions with messages and skips existing ids", async () => {
    const existing = newSessionInput({ title: "already here" });
    await asAlice.chat.createSession(existing);

    const fresh = newSessionInput({ title: "fresh" });
    const result = await asAlice.chat.bulkImport({
      sessions: [
        {
          id: existing.id, // duplicate — must be skipped
          title: "dup",
          providerId: "anthropic",
          modelId: "m",
          messages: [],
        },
        {
          id: fresh.id,
          title: "fresh",
          providerId: "anthropic",
          modelId: "m",
          messages: [
            { id: randomUUID(), role: "user", content: "hi" },
            { id: randomUUID(), role: "assistant", content: "hello" },
          ],
        },
      ],
    });

    expect(result).toEqual({ imported: 1 });
    const sessions = await asAlice.chat.listSessions();
    expect(sessions).toHaveLength(2);
    const freshFetched = await asAlice.chat.getSession({ id: fresh.id });
    expect(freshFetched.messages).toHaveLength(2);
    // The pre-existing session kept its original title (not overwritten).
    const existingFetched = await asAlice.chat.getSession({ id: existing.id });
    expect(existingFetched.title).toBe("already here");
  });
});
