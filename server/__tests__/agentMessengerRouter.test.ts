/**
 * Route-level integration tests for `agentMessengerRouter`.
 *
 * AgentMessengerStore uses getDb() directly so the vi.mock("../db.factory.js")
 * intercept covers both the persona lookup in the router AND all store
 * operations — no need to separately mock AgentMessengerStore. The AI provider
 * is injected via makeContext services so no real inference is made.
 *
 * Covers: listConversations (empty / with persona + messages), getMessages
 * (per-user isolation via userId filter), markRead (unread count drops),
 * send (unknown persona fallback, known persona + AI mock, sovereign block
 * when cloud provider is configured).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// NotificationService is in-memory; stub it so agent replies don't emit
// events that could interfere across tests.
vi.mock("../_core/NotificationService.js", () => ({
  NotificationService: {
    getInstance: () => ({ notify: vi.fn() }),
  },
}));

import { appRouter } from "../routers.js";
import { personas, messengerMessages } from "../../drizzle/schema.js";
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

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

/** Insert a persona row directly so we control all fields. */
async function seedPersona(dbInst: Db, userId: number, overrides: Partial<{
  id: string; name: string; type: string; alwaysOn: number; data: Record<string, unknown>;
}> = {}) {
  const id = overrides.id ?? randomUUID();
  await dbInst.insert(personas).values({
    id,
    userId,
    name: overrides.name ?? "Test Agent",
    type: overrides.type ?? "assistant",
    alwaysOn: overrides.alwaysOn ?? 0,
    data: overrides.data ?? {},
  });
  return id;
}

/** Build a caller with a mock AI provider injected. */
function makeCaller(
  user: Awaited<ReturnType<typeof seedUser>>,
  mockChat: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue("Mock reply.")
): Caller {
  const ctx = makeContext(user, db, { aiProvider: { chat: mockChat } });
  return appRouter.createCaller(ctx);
}

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers on listConversations", async () => {
    const ctx = makeContext(null, db);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.agentMessenger.listConversations()).rejects.toThrow(TRPCError);
  });
});

// ─── agentMessenger.listConversations ────────────────────────────────────────

describe("agentMessenger.listConversations", () => {
  it("returns empty conversations when user has no personas", async () => {
    const user = await seedUser(db);
    const caller = makeCaller(user);
    const result = await caller.agentMessenger.listConversations();
    expect(result.conversations).toEqual([]);
  });

  it("returns one conversation per persona with unread=0 when no messages exist", async () => {
    const user = await seedUser(db);
    const personaId = await seedPersona(db, user.id, { name: "Aria" });
    const caller = makeCaller(user);

    const result = await caller.agentMessenger.listConversations();
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].personaId).toBe(personaId);
    expect(result.conversations[0].name).toBe("Aria");
    expect(result.conversations[0].unread).toBe(0);
    expect(result.conversations[0].lastMessage).toBeUndefined();
  });

  it("reflects last message content in the conversation summary", async () => {
    const user = await seedUser(db);
    const personaId = await seedPersona(db, user.id, { name: "Echo" });
    const caller = makeCaller(user);

    await caller.agentMessenger.send({ personaId, content: "Hello Echo" });

    const result = await caller.agentMessenger.listConversations();
    expect(result.conversations[0].lastMessage).toBeTruthy();
  });

  it("does not show another user's personas", async () => {
    const alice = await seedUser(db, { openId: "alice-am" });
    const bob = await seedUser(db, { openId: "bob-am" });
    await seedPersona(db, alice.id, { name: "Alice Bot" });

    const bobCaller = makeCaller(bob);
    const result = await bobCaller.agentMessenger.listConversations();
    expect(result.conversations).toHaveLength(0);
  });
});

// ─── agentMessenger.getMessages ──────────────────────────────────────────────

describe("agentMessenger.getMessages", () => {
  it("returns empty messages for a thread with no messages", async () => {
    const user = await seedUser(db);
    const personaId = await seedPersona(db, user.id);
    const caller = makeCaller(user);

    const result = await caller.agentMessenger.getMessages({ personaId });
    expect(result.messages).toEqual([]);
  });

  it("returns messages in chronological order after a send", async () => {
    const user = await seedUser(db);
    const personaId = await seedPersona(db, user.id, { name: "Orion" });
    const caller = makeCaller(user);

    await caller.agentMessenger.send({ personaId, content: "First message" });
    const result = await caller.agentMessenger.getMessages({ personaId });

    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe("First message");
    expect(result.messages[1].role).toBe("agent");
  });

  it("does not return messages from another user's thread", async () => {
    const alice = await seedUser(db, { openId: "alice-gm" });
    const bob = await seedUser(db, { openId: "bob-gm" });
    const personaId = await seedPersona(db, alice.id, { name: "Shared ID" });

    const aliceCaller = makeCaller(alice);
    await aliceCaller.agentMessenger.send({ personaId, content: "Alice's message" });

    // Insert a message as bob with the same personaId to confirm scoping
    const bobCaller = makeCaller(bob);
    const result = await bobCaller.agentMessenger.getMessages({ personaId });
    // Bob has no messages in this thread (different userId scoping)
    expect(result.messages.every(m => m.content !== "Alice's message")).toBe(true);
  });
});

// ─── agentMessenger.markRead ─────────────────────────────────────────────────

describe("agentMessenger.markRead", () => {
  it("marks agent messages read so unread count drops to zero", async () => {
    const user = await seedUser(db);
    const personaId = await seedPersona(db, user.id, { name: "Rex" });
    const caller = makeCaller(user);

    // Sending will generate an agent reply (unread)
    await caller.agentMessenger.send({ personaId, content: "Hey" });

    // Insert an unread agent message directly
    await db.insert(messengerMessages).values({
      userId: user.id,
      personaId,
      sender: "agent",
      content: "Direct insert",
      read: false,
    });

    await caller.agentMessenger.markRead({ personaId });

    const conversations = await caller.agentMessenger.listConversations();
    const thread = conversations.conversations.find(c => c.personaId === personaId);
    expect(thread!.unread).toBe(0);
  });
});

// ─── agentMessenger.send ─────────────────────────────────────────────────────

describe("agentMessenger.send", () => {
  it("returns an error-message reply when persona does not exist", async () => {
    const user = await seedUser(db);
    const caller = makeCaller(user);

    const result = await caller.agentMessenger.send({
      personaId: randomUUID(),
      content: "Hello?",
    });

    expect(result.reply.role).toBe("agent");
    expect(result.reply.content).toContain("no longer exists");
  });

  it("calls the AI provider and stores both user and agent messages", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const personaId = await seedPersona(db, user.id, { name: "Nova" });
    const mockChat = vi.fn().mockResolvedValue("I am Nova, ready to help.");
    const caller = makeCaller(user, mockChat);

    const result = await caller.agentMessenger.send({ personaId, content: "Hello Nova" });

    expect(mockChat).toHaveBeenCalledOnce();
    expect(result.reply.content).toBe("I am Nova, ready to help.");
    expect(result.reply.role).toBe("agent");

    const { messages } = await caller.agentMessenger.getMessages({ personaId });
    expect(messages.some(m => m.role === "user" && m.content === "Hello Nova")).toBe(true);
    expect(messages.some(m => m.role === "agent" && m.content === "I am Nova, ready to help.")).toBe(true);
  });

  it("blocks cloud providers when user is in sovereign mode", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const personaId = await seedPersona(db, user.id, {
      name: "CloudBot",
      data: { modelConfig: { backend: "api", apiProviderId: "openai", apiModelId: "gpt-4o" } },
    });
    const caller = makeCaller(user);

    await expect(
      caller.agentMessenger.send({ personaId, content: "Use OpenAI" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows local (ollama) providers in sovereign mode", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const personaId = await seedPersona(db, user.id, {
      name: "LocalBot",
      data: { modelConfig: { backend: "ollama", ollamaModel: "llama3.2" } },
    });
    const mockChat = vi.fn().mockResolvedValue("Local reply.");
    const caller = makeCaller(user, mockChat);

    const result = await caller.agentMessenger.send({ personaId, content: "Local only please" });
    expect(result.reply.content).toBe("Local reply.");
  });

  it("returns a graceful offline message when AI provider throws a non-TRPC error", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const personaId = await seedPersona(db, user.id, { name: "FlickyBot" });
    const mockChat = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const caller = makeCaller(user, mockChat);

    const result = await caller.agentMessenger.send({ personaId, content: "You there?" });
    expect(result.reply.content).toContain("offline");
  });
});
