/**
 * Route-level integration tests for `neuralMapsRouter`.
 *
 * Covers: list, create, update (with remote-root removal triggering the
 * MemoryArchitectService mock), delete (collection drop mock), migrate
 * (bulk upsert, skips existing), and per-user isolation.
 *
 * MemoryArchitectService is mocked so tests never touch ChromaDB.
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

const mockMemory = {
  deleteRemoteSource: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../phase2/services/MemoryArchitectService.js", () => ({
  MemoryArchitectService: {
    getInstance: () => mockMemory,
  },
}));

import { appRouter } from "../routers.js";
import { savedScripts, designProjects, curatedPosts } from "../../drizzle/schema.js";
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

const defaultSettings = {
  autoWatch: true,
  realtimeSync: true,
  indexingEnabled: true,
  graphPhysics: true,
  maxDepth: 6,
  isolateMemory: false,
  enableAIContext: true,
  enableSemanticLinks: true,
  collapsedFolderIds: [],
};

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  mockMemory.deleteRemoteSource.mockClear();
  mockMemory.deleteCollection.mockClear();
});

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers on list", async () => {
    const ctx = makeContext(null, db);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.neuralMaps.list()).rejects.toThrow(TRPCError);
  });
});

// ─── neuralMaps.list ─────────────────────────────────────────────────────────

describe("neuralMaps.list", () => {
  it("returns empty array when user has no maps", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.neuralMaps.list();
    expect(result).toEqual([]);
  });

  it("returns only the calling user's maps", async () => {
    const alice = await seedUser(db, { openId: "alice-nm" });
    const bob = await seedUser(db, { openId: "bob-nm" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));

    const aliceId = randomUUID();
    const bobId = randomUUID();
    await aliceCaller.neuralMaps.create({ id: aliceId, name: "Alice Map", rootDirectories: [], settings: defaultSettings });
    await bobCaller.neuralMaps.create({ id: bobId, name: "Bob Map", rootDirectories: [], settings: defaultSettings });

    const aliceMaps = await aliceCaller.neuralMaps.list();
    expect(aliceMaps).toHaveLength(1);
    expect(aliceMaps[0].name).toBe("Alice Map");

    const bobMaps = await bobCaller.neuralMaps.list();
    expect(bobMaps).toHaveLength(1);
    expect(bobMaps[0].name).toBe("Bob Map");
  });
});

// ─── neuralMaps.create ───────────────────────────────────────────────────────

describe("neuralMaps.create", () => {
  it("creates a map and returns success with the client-supplied id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    const result = await caller.neuralMaps.create({
      id,
      name: "My Map",
      mode: "research",
      rootDirectories: ["/home/user/project"],
      settings: defaultSettings,
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe(id);

    const list = await caller.neuralMaps.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe("My Map");
    expect(list[0].mode).toBe("research");
  });

  it("upserts on duplicate id (create is idempotent)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({ id, name: "First", rootDirectories: [], settings: defaultSettings });
    await caller.neuralMaps.create({ id, name: "Second", rootDirectories: [], settings: defaultSettings });

    const list = await caller.neuralMaps.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Second");
  });

  it("persists labelOverrides JSON field correctly", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({
      id,
      name: "Labelled",
      rootDirectories: [],
      labelOverrides: { "node-1": "Custom Label" },
      settings: defaultSettings,
    });

    const list = await caller.neuralMaps.list();
    expect(list[0].labelOverrides).toEqual({ "node-1": "Custom Label" });
  });
});

// ─── neuralMaps.update ───────────────────────────────────────────────────────

describe("neuralMaps.update", () => {
  it("updates map fields and persists them", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({ id, name: "Original", rootDirectories: [], settings: defaultSettings });
    await caller.neuralMaps.update({ id, name: "Updated", mode: "coding" });

    const list = await caller.neuralMaps.list();
    expect(list[0].name).toBe("Updated");
    expect(list[0].mode).toBe("coding");
  });

  it("calls MemoryArchitectService.deleteRemoteSource when a remote root is removed", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({
      id,
      name: "WithRemote",
      rootDirectories: ["/local", "github://owner/repo"],
      settings: defaultSettings,
    });

    await caller.neuralMaps.update({
      id,
      rootDirectories: ["/local"],
    });

    expect(mockMemory.deleteRemoteSource).toHaveBeenCalledWith(id, "github://owner/repo");
  });

  it("does not call deleteRemoteSource when only local roots are changed", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({
      id,
      name: "LocalOnly",
      rootDirectories: ["/old-path"],
      settings: defaultSettings,
    });

    await caller.neuralMaps.update({ id, rootDirectories: ["/new-path"] });

    expect(mockMemory.deleteRemoteSource).not.toHaveBeenCalled();
  });

  it("does not modify another user's map (silently no-ops)", async () => {
    const alice = await seedUser(db, { openId: "alice-upd-nm" });
    const bob = await seedUser(db, { openId: "bob-upd-nm" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));
    const id = randomUUID();

    await aliceCaller.neuralMaps.create({ id, name: "Alice's Map", rootDirectories: [], settings: defaultSettings });
    await bobCaller.neuralMaps.update({ id, name: "Stolen Name" });

    const list = await aliceCaller.neuralMaps.list();
    expect(list[0].name).toBe("Alice's Map");
  });
});

// ─── neuralMaps.delete ───────────────────────────────────────────────────────

describe("neuralMaps.delete", () => {
  it("deletes the map row and calls deleteCollection", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({ id, name: "ToDelete", rootDirectories: [], settings: defaultSettings });
    await caller.neuralMaps.delete({ id });

    const list = await caller.neuralMaps.list();
    expect(list).toHaveLength(0);
    expect(mockMemory.deleteCollection).toHaveBeenCalledWith(id);
  });

  it("does not delete another user's map", async () => {
    const alice = await seedUser(db, { openId: "alice-del-nm" });
    const bob = await seedUser(db, { openId: "bob-del-nm" });
    const aliceCaller: Caller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller: Caller = appRouter.createCaller(makeContext(bob, db));
    const id = randomUUID();

    await aliceCaller.neuralMaps.create({ id, name: "Alice's", rootDirectories: [], settings: defaultSettings });
    await bobCaller.neuralMaps.delete({ id });

    const list = await aliceCaller.neuralMaps.list();
    expect(list).toHaveLength(1);
  });

  it("does not touch the vector collection for a non-owned id (IDOR guard)", async () => {
    const alice = await seedUser(db, { openId: "alice-idor-nm" });
    const bob = await seedUser(db, { openId: "bob-idor-nm" });
    const id = randomUUID();
    await appRouter.createCaller(makeContext(alice, db))
      .neuralMaps.create({ id, name: "Alice's", rootDirectories: [], settings: defaultSettings });

    await appRouter.createCaller(makeContext(bob, db)).neuralMaps.delete({ id });
    // Bob never owned the map → no collection wipe is triggered on Alice's data.
    expect(mockMemory.deleteCollection).not.toHaveBeenCalled();
  });

  it("cascades to child rows (scripts, design projects, curated posts) on delete", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();
    await caller.neuralMaps.create({ id, name: "WithChildren", rootDirectories: [], settings: defaultSettings });

    // Attach a row in three different child tables (mapId + projectId FKs).
    await db.insert(savedScripts).values({ userId: user.id, mapId: id, name: "s", code: "x=1" });
    await db.insert(designProjects).values({ userId: user.id, mapId: id, name: "board" });
    await db.insert(curatedPosts).values({ projectId: id, createdByUserId: user.id, platform: "twitter" });

    await caller.neuralMaps.delete({ id });

    expect(await db.select().from(savedScripts).where(eq(savedScripts.mapId, id))).toHaveLength(0);
    expect(await db.select().from(designProjects).where(eq(designProjects.mapId, id))).toHaveLength(0);
    expect(await db.select().from(curatedPosts).where(eq(curatedPosts.projectId, id))).toHaveLength(0);
    expect(mockMemory.deleteCollection).toHaveBeenCalledWith(id);
  });
});

// ─── neuralMaps.migrate ──────────────────────────────────────────────────────

describe("neuralMaps.migrate", () => {
  it("inserts new maps and returns migrated count", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id1 = randomUUID();
    const id2 = randomUUID();

    const result = await caller.neuralMaps.migrate([
      { id: id1, name: "Map A", rootDirectories: [], settings: defaultSettings },
      { id: id2, name: "Map B", rootDirectories: [], settings: defaultSettings },
    ]);

    expect(result.success).toBe(true);
    expect(result.migrated).toBe(2);

    const list = await caller.neuralMaps.list();
    expect(list).toHaveLength(2);
  });

  it("preserves the existing map name on id collision (onConflictDoUpdate only updates updatedAt)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const id = randomUUID();

    await caller.neuralMaps.create({ id, name: "Existing", rootDirectories: [], settings: defaultSettings });

    const result = await caller.neuralMaps.migrate([
      { id, name: "Collision Attempt", rootDirectories: [], settings: defaultSettings },
    ]);

    // migrate increments the counter even on conflict (onConflictDoUpdate succeeds)
    expect(result.migrated).toBe(1);
    const list = await caller.neuralMaps.list();
    // name is NOT overwritten — only updatedAt is updated on conflict
    expect(list[0].name).toBe("Existing");
  });

  it("returns migrated=0 for empty input", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.neuralMaps.migrate([]);
    expect(result.migrated).toBe(0);
  });
});
