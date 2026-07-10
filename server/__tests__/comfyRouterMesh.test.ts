/**
 * Route-level tests for the ComfyUI → 3D-library mesh pipeline:
 * `comfy.getHistory` and `comfy.saveMeshToLibrary`.
 *
 * The ComfyService is stubbed (no running ComfyUI), but the DB is the real
 * in-memory schema so the map/PCB association written by saveMeshToLibrary
 * genuinely lands in model_assets and is queryable.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import { listModelAssets } from "../db-models.js";
import { neuralMaps } from "../../drizzle/schema.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function makeComfyStub(overrides: Record<string, unknown> = {}) {
  return {
    getHistory: vi.fn().mockResolvedValue({}),
    listMeshOutputs: vi.fn().mockResolvedValue([]),
    saveMeshesToLibrary: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function makeCaller(comfy = makeComfyStub()) {
  const user = await seedUser(db);
  const caller: Caller = appRouter.createCaller(makeContext(user, db, { comfy }));
  return { caller, comfy, user };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("comfy.getHistory", () => {
  it("reports job completion and mesh outputs", async () => {
    const comfy = makeComfyStub({
      getHistory: vi.fn().mockResolvedValue({ "p-1": { outputs: { "9": { gltfs: [] } } } }),
      listMeshOutputs: vi
        .fn()
        .mockResolvedValue([{ filename: "mesh_00001_.glb", subfolder: "", type: "output" }]),
    });
    const { caller } = await makeCaller(comfy);
    const res = await caller.comfy.getHistory({ promptId: "p-1" });
    expect(res.done).toBe(true);
    expect(res.meshCount).toBe(1);
    expect(res.meshOutputs[0].filename).toBe("mesh_00001_.glb");
  });

  it("reports not-done while the job is still running", async () => {
    const { caller } = await makeCaller();
    const res = await caller.comfy.getHistory({ promptId: "p-1" });
    expect(res.done).toBe(false);
    expect(res.meshCount).toBe(0);
  });
});

describe("comfy.saveMeshToLibrary", () => {
  it("persists generated meshes and registers their map/PCB association", async () => {
    const saved = [{ name: "mesh_00001_.glb", url: "/media/model/mesh_00001_.glb", size: 1234 }];
    const comfy = makeComfyStub({ saveMeshesToLibrary: vi.fn().mockResolvedValue(saved) });
    const { caller, user } = await makeCaller(comfy);
    // Need a real map row for the FK.
    await db.insert(neuralMaps).values({
      id: "map-1",
      userId: user.id,
      name: "Enclosure",
      mode: "standard",
      rootDirectories: [],
      settings: {},
    });

    const res = await caller.comfy.saveMeshToLibrary({ promptId: "p-1", mapId: "map-1" });
    expect(res.count).toBe(1);
    expect(comfy.saveMeshesToLibrary).toHaveBeenCalledWith("p-1");

    // The association row landed in model_assets, scoped to the map + source.
    const assets = await listModelAssets(user.id);
    expect(assets).toHaveLength(1);
    expect(assets[0].fileName).toBe("mesh_00001_.glb");
    expect(assets[0].mapId).toBe("map-1");
    expect(assets[0].source).toBe("comfy");
    expect(assets[0].format).toBe("glb");
  });

  it("throws NOT_FOUND when the job produced no mesh", async () => {
    const { caller } = await makeCaller(); // saveMeshesToLibrary → []
    await expect(caller.comfy.saveMeshToLibrary({ promptId: "p-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeContext(null, db, { comfy: makeComfyStub() }));
    await expect(caller.comfy.saveMeshToLibrary({ promptId: "p-1" })).rejects.toThrow(TRPCError);
  });
});
