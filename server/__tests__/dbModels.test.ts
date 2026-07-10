/**
 * Unit tests for the 3D model-library association layer (server/db-models.ts).
 *
 * These exercise the real schema + migrations via the in-memory test DB (getDb
 * is redirected to it), so the FK links between model_assets → neural_maps and
 * model_assets → design_projects, the per-user (userId, fileName) upsert, and
 * the combined design-context assembly all genuinely execute.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

import {
  registerModelAsset,
  listModelAssets,
  assignModelAsset,
  deleteModelAsset,
  getMapDesignContext,
} from "../db-models.js";
import { createTestDb, seedUser, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import { neuralMaps, designProjects, designSaves } from "../../drizzle/schema.js";

let store: TestDb;
let db: Db;

async function seedMap(userId: number, id = "map-1", name = "Sensor Project") {
  await db.insert(neuralMaps).values({
    id,
    userId,
    name,
    mode: "standard",
    rootDirectories: [],
    settings: {},
  });
  return id;
}

async function seedDesign(userId: number, mapId: string) {
  const [proj] = await db
    .insert(designProjects)
    .values({ userId, mapId, name: "Controller Board", mode: "pcb" })
    .returning();
  await db.insert(designSaves).values({
    projectId: proj.id,
    userId,
    mapId,
    name: "rev-A",
    canvasData: {
      nodes: [
        { id: "n1", data: { reference: "U1", value: "ESP32" } },
        { id: "n2", data: { reference: "R1", value: "10k" } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    },
    componentCount: 2,
    connectionCount: 1,
    isLatest: 1,
  });
  return proj.id;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("registerModelAsset", () => {
  it("inserts a new library row and upserts on (userId, fileName)", async () => {
    const user = await seedUser(db);
    const first = await registerModelAsset({
      userId: user.id,
      fileName: "housing.glb",
      name: "housing",
      format: "glb",
      source: "blender",
    });
    expect(first.fileName).toBe("housing.glb");
    expect(first.source).toBe("blender");
    expect(first.mapId).toBeNull();

    // Re-registering the same file updates rather than duplicating.
    const second = await registerModelAsset({
      userId: user.id,
      fileName: "housing.glb",
      name: "housing v2",
      format: "glb",
      source: "comfy",
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("housing v2");
    expect(second.source).toBe("comfy");

    const all = await listModelAssets(user.id);
    expect(all).toHaveLength(1);
  });

  it("keeps each user's association independent for a shared library file", async () => {
    // The library is a shared file namespace; two users must each be able to
    // register the SAME fileName without clobbering the other's row. Under a
    // global unique on fileName, user B's upsert overwrote user A's row and the
    // post-insert select (scoped by userId) returned undefined. Regression guard.
    const mapId = "map-shared";
    const userA = await seedUser(db, { openId: "ua", email: "a@x.com" });
    const userB = await seedUser(db, { openId: "ub", email: "b@x.com" });
    await db.insert(neuralMaps).values({
      id: mapId, userId: userB.id, name: "B's map", mode: "standard", rootDirectories: [], settings: {},
    });

    const aRow = await registerModelAsset({
      userId: userA.id, fileName: "shared.glb", name: "A's housing", format: "glb", source: "blender",
    });
    const bRow = await registerModelAsset({
      userId: userB.id, fileName: "shared.glb", name: "B's housing", format: "glb", source: "comfy", mapId,
    });

    // Both writers get their own defined row (never undefined) — distinct ids.
    expect(bRow).toBeDefined();
    expect(bRow.userId).toBe(userB.id);
    expect(bRow.id).not.toBe(aRow.id);

    // A's row is untouched by B's registration.
    const aRows = await listModelAssets(userA.id);
    expect(aRows).toHaveLength(1);
    expect(aRows[0].name).toBe("A's housing");
    expect(aRows[0].source).toBe("blender");
    expect(aRows[0].mapId).toBeNull();

    // B's row carries B's own metadata.
    const bRows = await listModelAssets(userB.id);
    expect(bRows).toHaveLength(1);
    expect(bRows[0].name).toBe("B's housing");
    expect(bRows[0].mapId).toBe(mapId);
  });
});

describe("assignModelAsset", () => {
  it("binds a model to a map and PCB project, and can clear them", async () => {
    const user = await seedUser(db);
    const mapId = await seedMap(user.id);
    const projectId = await seedDesign(user.id, mapId);
    await registerModelAsset({ userId: user.id, fileName: "housing.glb", name: "housing", format: "glb" });

    const linked = await assignModelAsset(user.id, "housing.glb", { mapId, designProjectId: projectId });
    expect(linked?.mapId).toBe(mapId);
    expect(linked?.designProjectId).toBe(projectId);

    const cleared = await assignModelAsset(user.id, "housing.glb", { mapId: null, designProjectId: null });
    expect(cleared?.mapId).toBeNull();
    expect(cleared?.designProjectId).toBeNull();
  });

  it("does not touch another user's row (ownership scoped)", async () => {
    const owner = await seedUser(db, { openId: "owner", email: "o@x.com" });
    const other = await seedUser(db, { openId: "other", email: "b@x.com" });
    await registerModelAsset({ userId: owner.id, fileName: "housing.glb", name: "housing", format: "glb" });
    const res = await assignModelAsset(other.id, "housing.glb", { name: "hijacked" });
    expect(res).toBeNull();
    const ownerRows = await listModelAssets(owner.id);
    expect(ownerRows[0].name).toBe("housing");
  });
});

describe("deleteModelAsset", () => {
  it("removes only the owner's row", async () => {
    const user = await seedUser(db);
    await registerModelAsset({ userId: user.id, fileName: "a.glb", name: "a", format: "glb" });
    await deleteModelAsset(user.id, "a.glb");
    expect(await listModelAssets(user.id)).toHaveLength(0);
  });
});

describe("getMapDesignContext", () => {
  it("combines a map's 3D models and its latest PCB design into one context", async () => {
    const user = await seedUser(db);
    const mapId = await seedMap(user.id);
    const projectId = await seedDesign(user.id, mapId);
    await registerModelAsset({
      userId: user.id,
      fileName: "housing.glb",
      name: "housing",
      format: "glb",
      source: "blender",
      mapId,
      designProjectId: projectId,
    });

    const ctx = await getMapDesignContext(user.id, mapId);
    expect(ctx.models).toHaveLength(1);
    expect(ctx.models[0].designProjectId).toBe(projectId);
    expect(ctx.designs).toHaveLength(1);
    expect(ctx.designs[0].componentCount).toBe(2);
    expect(ctx.designs[0].references).toEqual(expect.arrayContaining(["U1", "R1"]));
    // The natural-language summary names both the housing and the board.
    expect(ctx.contextText).toContain("housing");
    expect(ctx.contextText).toContain("Controller Board");
    expect(ctx.contextText).toContain("linked to PCB project");
  });

  it("includes global (mapId null) models in every map's context", async () => {
    const user = await seedUser(db);
    const mapId = await seedMap(user.id);
    await registerModelAsset({ userId: user.id, fileName: "global.glb", name: "global", format: "glb" });
    const ctx = await getMapDesignContext(user.id, mapId);
    expect(ctx.models.map((m) => m.fileName)).toContain("global.glb");
    expect(ctx.contextText).toContain("(global)");
  });

  it("does not leak another map's models", async () => {
    const user = await seedUser(db);
    const mapA = await seedMap(user.id, "map-a", "A");
    const mapB = await seedMap(user.id, "map-b", "B");
    await registerModelAsset({ userId: user.id, fileName: "a.glb", name: "a", format: "glb", mapId: mapA });
    await registerModelAsset({ userId: user.id, fileName: "b.glb", name: "b", format: "glb", mapId: mapB });
    const ctx = await getMapDesignContext(user.id, mapA);
    const files = ctx.models.map((m) => m.fileName);
    expect(files).toContain("a.glb");
    expect(files).not.toContain("b.glb");
  });
});
