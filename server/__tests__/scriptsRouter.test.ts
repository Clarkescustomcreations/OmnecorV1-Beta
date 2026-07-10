/**
 * Route-level integration tests for `scriptsRouter`.
 *
 * Covers: list (with/without mapId filter), listProjects, create, update
 * (ownership check), delete (ownership check), and per-user isolation. Backed
 * by a real in-memory libSQL DB so Drizzle queries, FK constraints, and the
 * per-user `AND` filter all execute for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

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
import { neuralMaps, savedScripts } from "../../drizzle/schema.js";
import {
  createTestDb,
  seedUser,
  makeContext,
  type TestDb,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

const defaultMapSettings = {
  autoWatch: true, realtimeSync: true, indexingEnabled: true,
  graphPhysics: true, maxDepth: 6, isolateMemory: false,
  enableAIContext: true, enableSemanticLinks: true, collapsedFolderIds: [],
};

/** Seed a neural_maps row so mapId FK constraints are satisfied. */
async function seedMap(dbInst: Db, userId: number, mapId: string) {
  await dbInst.insert(neuralMaps).values({
    id: mapId, userId, name: "Test Map",
    rootDirectories: [], settings: defaultMapSettings,
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
  it("rejects unauthenticated callers", async () => {
    const ctx = makeContext(null, db);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.scripts.list()).rejects.toThrow(TRPCError);
  });
});

// ─── scripts.list ────────────────────────────────────────────────────────────

describe("scripts.list", () => {
  it("returns empty array when user has no scripts", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.scripts.list();
    expect(result).toEqual([]);
  });

  it("returns only the calling user's scripts", async () => {
    const alice = await seedUser(db, { openId: "alice" });
    const bob = await seedUser(db, { openId: "bob" });

    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));

    await aliceCaller.scripts.create({ name: "alice-script", code: "print('hi')" });
    await bobCaller.scripts.create({ name: "bob-script", code: "print('bob')" });

    const aliceScripts = await aliceCaller.scripts.list();
    expect(aliceScripts).toHaveLength(1);
    expect(aliceScripts[0].name).toBe("alice-script");

    const bobScripts = await bobCaller.scripts.list();
    expect(bobScripts).toHaveLength(1);
    expect(bobScripts[0].name).toBe("bob-script");
  });

  it("filters by mapId when provided", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const mapId = "11111111-1111-4111-8111-111111111111";
    await seedMap(db, user.id, mapId);
    await caller.scripts.create({ name: "mapped", code: "x=1", mapId });
    await caller.scripts.create({ name: "global", code: "y=2" });

    const mapped = await caller.scripts.list({ mapId });
    expect(mapped).toHaveLength(1);
    expect(mapped[0].name).toBe("mapped");

    const all = await caller.scripts.list();
    expect(all).toHaveLength(2);
  });

  it("returns all scripts for the user (orderBy updatedAt desc)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.scripts.create({ name: "first", code: "a=1" });
    await caller.scripts.create({ name: "second", code: "b=2" });
    const list = await caller.scripts.list();
    expect(list).toHaveLength(2);
    // Both scripts present; order may tie at same-second timestamp
    const names = list.map(s => s.name);
    expect(names).toContain("first");
    expect(names).toContain("second");
  });

  it("most-recently-updated script appears first", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const now = Math.floor(Date.now() / 1000);
    // Insert directly with explicit timestamps 10 s apart so the ordering is
    // deterministic regardless of how fast the test executes.
    await db.insert(savedScripts).values([
      { userId: user.id, name: "older-script", code: "a=1", updatedAt: new Date((now - 10) * 1000), createdAt: new Date((now - 10) * 1000) },
      { userId: user.id, name: "newer-script", code: "b=2", updatedAt: new Date(now * 1000), createdAt: new Date(now * 1000) },
    ]);
    const list = await caller.scripts.list();
    expect(list[0].name).toBe("newer-script");
    expect(list[1].name).toBe("older-script");
  });
});

// ─── scripts.listProjects ────────────────────────────────────────────────────

describe("scripts.listProjects", () => {
  it("returns distinct sorted project names for the user", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.scripts.create({ name: "s1", code: "x", project: "Zeta" });
    await caller.scripts.create({ name: "s2", code: "x", project: "Alpha" });
    await caller.scripts.create({ name: "s3", code: "x", project: "Alpha" });

    const projects = await caller.scripts.listProjects();
    expect(projects).toEqual(["Alpha", "Zeta"]);
  });

  it("scopes project list to mapId", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const mapId = "22222222-2222-4222-8222-222222222222";

    await seedMap(db, user.id, mapId);
    await caller.scripts.create({ name: "mapped", code: "x", project: "MapProject", mapId });
    await caller.scripts.create({ name: "global", code: "x", project: "GlobalProject" });

    const mapProjects = await caller.scripts.listProjects({ mapId });
    expect(mapProjects).toEqual(["MapProject"]);
  });

  it("does not leak another user's project names", async () => {
    const alice = await seedUser(db, { openId: "alice-lp" });
    const bob = await seedUser(db, { openId: "bob-lp" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));

    await aliceCaller.scripts.create({ name: "s", code: "x", project: "AliceOnly" });

    const bobProjects = await bobCaller.scripts.listProjects();
    expect(bobProjects).not.toContain("AliceOnly");
  });
});

// ─── scripts.create ──────────────────────────────────────────────────────────

describe("scripts.create", () => {
  it("returns the created row with correct fields", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const row = await caller.scripts.create({
      name: "My Tool",
      code: "print('hello')",
      description: "A test tool",
      language: "python",
      project: "Research",
    });

    expect(row.id).toBeTypeOf("number");
    expect(row.name).toBe("My Tool");
    expect(row.code).toBe("print('hello')");
    expect(row.description).toBe("A test tool");
    expect(row.language).toBe("python");
    expect(row.project).toBe("Research");
    expect(row.userId).toBe(user.id);
  });

  it("defaults project to 'Default' when not supplied", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const row = await caller.scripts.create({ name: "s", code: "x" });
    expect(row.project).toBe("Default");
  });
});

// ─── scripts.update ──────────────────────────────────────────────────────────

describe("scripts.update", () => {
  it("updates owned script fields", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const created = await caller.scripts.create({ name: "original", code: "v=1" });

    const updated = await caller.scripts.update({
      id: created.id,
      name: "renamed",
      code: "v=2",
      project: "NewProject",
    });

    expect(updated.name).toBe("renamed");
    expect(updated.code).toBe("v=2");
    expect(updated.project).toBe("NewProject");
  });

  it("throws NOT_FOUND when updating another user's script", async () => {
    const alice = await seedUser(db, { openId: "alice-upd" });
    const bob = await seedUser(db, { openId: "bob-upd" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));

    const aliceScript = await aliceCaller.scripts.create({ name: "alice-s", code: "x" });

    await expect(
      bobCaller.scripts.update({ id: aliceScript.id, name: "stolen" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for a non-existent script id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.scripts.update({ id: 999999, name: "ghost" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── scripts.delete ──────────────────────────────────────────────────────────

describe("scripts.delete", () => {
  it("deletes an owned script and returns the id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const created = await caller.scripts.create({ name: "to-delete", code: "x" });

    const result = await caller.scripts.delete({ id: created.id });
    expect(result.success).toBe(true);
    expect(result.id).toBe(created.id);

    const list = await caller.scripts.list();
    expect(list).toHaveLength(0);
  });

  it("throws NOT_FOUND when deleting another user's script", async () => {
    const alice = await seedUser(db, { openId: "alice-del" });
    const bob = await seedUser(db, { openId: "bob-del" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));

    const aliceScript = await aliceCaller.scripts.create({ name: "alice-del", code: "x" });

    await expect(
      bobCaller.scripts.delete({ id: aliceScript.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const aliceList = await aliceCaller.scripts.list();
    expect(aliceList).toHaveLength(1);
  });
});
