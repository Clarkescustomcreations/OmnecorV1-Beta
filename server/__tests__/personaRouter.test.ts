/**
 * Route-level integration tests for `personaRouter`.
 *
 * Covers: list (per-user isolation), upsert (create + update path via the
 * ownership AND condition), delete (ownership check), and migrate (bulk
 * insert skipping existing ids). Backed by a real in-memory libSQL DB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { brains } from "../../drizzle/schema.js";
import {
  createTestDb,
  seedUser,
  makeContext,
  type TestDb,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

/** Insert a minimal owned brain row so attach's ownership gate passes. */
async function seedBrainRow(database: Db, userId: number, id: string) {
  await database.insert(brains).values({
    id, userId, name: id, version: "1.0.0", domain: id,
    charter: "c", charterSha256: "x".repeat(64),
    embedderId: "all-MiniLM-L6-v2", embedderDim: 384, embedderMatch: 1,
    status: "ready", collectionName: `brain_${id}`, chunkCount: 0,
  });
}

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers on list", async () => {
    const ctx = makeContext(null, db);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.personas.list()).rejects.toThrow(TRPCError);
  });
});

// ─── personas.list ───────────────────────────────────────────────────────────

describe("personas.list", () => {
  it("returns empty array when user has no personas", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.personas.list();
    expect(result).toEqual([]);
  });

  it("returns shaped records with id, name, type, alwaysOn, createdAt", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.personas.upsert({
      id,
      name: "Aria",
      type: "assistant",
      alwaysOn: true,
      data: { bio: "Creative assistant" },
    });

    const list = await caller.personas.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe("Aria");
    expect(list[0].type).toBe("assistant");
    expect(list[0].alwaysOn).toBe(true);
    expect(typeof list[0].createdAt).toBe("string");
  });

  it("returns only the calling user's personas", async () => {
    const alice = await seedUser(db, { openId: "alice-p" });
    const bob = await seedUser(db, { openId: "bob-p" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));

    await aliceCaller.personas.upsert({ id: randomUUID(), name: "Alice Bot", type: "self_clone", alwaysOn: false, data: {} });
    await bobCaller.personas.upsert({ id: randomUUID(), name: "Bob Bot", type: "self_clone", alwaysOn: false, data: {} });

    const alicePersonas = await aliceCaller.personas.list();
    expect(alicePersonas).toHaveLength(1);
    expect(alicePersonas[0].name).toBe("Alice Bot");

    const bobPersonas = await bobCaller.personas.list();
    expect(bobPersonas).toHaveLength(1);
    expect(bobPersonas[0].name).toBe("Bob Bot");
  });
});

// ─── personas.upsert ─────────────────────────────────────────────────────────

describe("personas.upsert", () => {
  it("creates a new persona on first call", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    const result = await caller.personas.upsert({
      id,
      name: "Nexus",
      type: "planner",
      alwaysOn: false,
      data: { tone: "concise" },
    });
    expect(result.success).toBe(true);

    const list = await caller.personas.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Nexus");
  });

  it("updates an existing persona on subsequent call with same id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.personas.upsert({ id, name: "Old Name", type: "self_clone", alwaysOn: false, data: {} });
    await caller.personas.upsert({ id, name: "New Name", type: "assistant", alwaysOn: true, data: { updated: true } });

    const list = await caller.personas.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("New Name");
    expect(list[0].type).toBe("assistant");
    expect(list[0].alwaysOn).toBe(true);
  });

  it("user B cannot hijack user A's persona id — PK collision throws and Alice's data is unchanged", async () => {
    const alice = await seedUser(db, { openId: "alice-upsert" });
    const bob = await seedUser(db, { openId: "bob-upsert" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));
    const id = randomUUID();

    await aliceCaller.personas.upsert({ id, name: "Alice's Bot", type: "self_clone", alwaysOn: false, data: {} });

    // Bob tries to upsert with Alice's persona id. The router checks ownership
    // (AND eq(id, userId)) and doesn't find Bob's row, so it tries to INSERT —
    // which hits the PRIMARY KEY constraint and throws.
    await expect(
      bobCaller.personas.upsert({ id, name: "Hijacked Bot", type: "self_clone", alwaysOn: false, data: {} })
    ).rejects.toThrow(TRPCError);

    // Alice's persona is completely unchanged
    const aliceList = await aliceCaller.personas.list();
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0].name).toBe("Alice's Bot");
  });

  it("merges extra data fields through the data JSON column", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.personas.upsert({
      id,
      name: "Fixer",
      type: "self_clone",
      alwaysOn: false,
      data: { tone: "direct", language: "en", skills: ["coding", "research"] },
    });

    const list = await caller.personas.list();
    expect((list[0] as Record<string, unknown>).tone).toBe("direct");
    expect((list[0] as Record<string, unknown>).language).toBe("en");
  });
});

// ─── personas.delete ─────────────────────────────────────────────────────────

describe("personas.delete", () => {
  it("deletes the calling user's persona", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.personas.upsert({ id, name: "ToDelete", type: "self_clone", alwaysOn: false, data: {} });
    await caller.personas.delete({ id });

    const list = await caller.personas.list();
    expect(list).toHaveLength(0);
  });

  it("does not delete another user's persona (silent no-op)", async () => {
    const alice = await seedUser(db, { openId: "alice-del-p" });
    const bob = await seedUser(db, { openId: "bob-del-p" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));
    const id = randomUUID();

    await aliceCaller.personas.upsert({ id, name: "Alice Bot", type: "self_clone", alwaysOn: false, data: {} });
    await bobCaller.personas.delete({ id });

    const aliceList = await aliceCaller.personas.list();
    expect(aliceList).toHaveLength(1);
  });
});

// ─── personas.attachBrain / detachBrain (Brains-Upgrade Phase 4) ──────────────

describe("personas.attachBrain / detachBrain", () => {
  it("attaches an owned brain into the persona's data.brains (idempotent)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();
    await caller.personas.upsert({ id, name: "P", type: "self_clone", alwaysOn: false, data: {} });
    await seedBrainRow(db, user.id, "coding");

    const first = await caller.personas.attachBrain({ personaId: id, brainId: "coding" });
    expect(first.brains).toEqual(["coding"]);
    // Idempotent — attaching again doesn't duplicate.
    const again = await caller.personas.attachBrain({ personaId: id, brainId: "coding" });
    expect(again.brains).toEqual(["coding"]);

    const list = await caller.personas.list();
    expect((list[0] as Record<string, unknown>).brains).toEqual(["coding"]);
  });

  it("refuses to attach a brain the caller does not own", async () => {
    const alice = await seedUser(db, { openId: "alice-attach" });
    const bob = await seedUser(db, { openId: "bob-attach" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const id = randomUUID();
    await aliceCaller.personas.upsert({ id, name: "P", type: "self_clone", alwaysOn: false, data: {} });
    await seedBrainRow(db, bob.id, "bobs-brain");

    await expect(aliceCaller.personas.attachBrain({ personaId: id, brainId: "bobs-brain" }))
      .rejects.toThrow(/Brain not found/i);
  });

  it("refuses to attach to a persona the caller does not own", async () => {
    const alice = await seedUser(db, { openId: "alice-ap" });
    const bob = await seedUser(db, { openId: "bob-ap" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));
    const id = randomUUID();
    await aliceCaller.personas.upsert({ id, name: "P", type: "self_clone", alwaysOn: false, data: {} });
    await seedBrainRow(db, bob.id, "coding");

    await expect(bobCaller.personas.attachBrain({ personaId: id, brainId: "coding" }))
      .rejects.toThrow(/Persona not found/i);
  });

  it("detaches a brain and preserves other data fields", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();
    await caller.personas.upsert({ id, name: "P", type: "self_clone", alwaysOn: false, data: { tone: "direct" } });
    await seedBrainRow(db, user.id, "a");
    await seedBrainRow(db, user.id, "b");
    await caller.personas.attachBrain({ personaId: id, brainId: "a" });
    await caller.personas.attachBrain({ personaId: id, brainId: "b" });

    const res = await caller.personas.detachBrain({ personaId: id, brainId: "a" });
    expect(res.brains).toEqual(["b"]);
    const list = await caller.personas.list();
    expect((list[0] as Record<string, unknown>).tone).toBe("direct");
    expect((list[0] as Record<string, unknown>).brains).toEqual(["b"]);
  });
});

// ─── personas.migrate ────────────────────────────────────────────────────────

describe("personas.migrate", () => {
  it("inserts new personas and returns migrated count", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const ids = [randomUUID(), randomUUID()];

    const result = await caller.personas.migrate([
      { id: ids[0], name: "Bot A", type: "self_clone", alwaysOn: false, data: {} },
      { id: ids[1], name: "Bot B", type: "assistant", alwaysOn: true, data: {} },
    ]);

    expect(result.migrated).toBe(2);
    const list = await caller.personas.list();
    expect(list).toHaveLength(2);
  });

  it("skips personas whose ids already exist for this user", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.personas.upsert({ id, name: "Existing", type: "self_clone", alwaysOn: false, data: {} });

    const result = await caller.personas.migrate([
      { id, name: "Should Not Overwrite", type: "self_clone", alwaysOn: false, data: {} },
    ]);

    expect(result.migrated).toBe(0);
    const list = await caller.personas.list();
    expect(list[0].name).toBe("Existing");
  });

  it("returns migrated=0 for empty input", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.personas.migrate([]);
    expect(result.migrated).toBe(0);
  });
});
