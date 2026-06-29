import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

// Route the router's getDb() at the shared in-memory test DB.
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

// Stub the audit log service to stay hermetic.
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { discoveredDatasetItems, curatedTrainingExamples, neuralMaps } from "../../drizzle/schema.js";
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
let asAlice: Caller;

const mockDatasetDiscovery = {
  discoverLocal: vi.fn(),
  discoverOnline: vi.fn(),
};

const mockDatasetCuration = {
  curateItem: vi.fn(),
  compileDataset: vi.fn(),
};

beforeAll(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

beforeEach(async () => {
  // Clear tables
  await db.delete(curatedTrainingExamples);
  await db.delete(discoveredDatasetItems);
  await db.delete(neuralMaps);

  alice = await seedUser(db, {
    openId: `alice-${randomUUID()}`,
    name: "Alice",
    executionMode: "scrapper",
  });

  asAlice = appRouter.createCaller(
    makeContext(alice, db, {
      datasetDiscovery: mockDatasetDiscovery,
      datasetCuration: mockDatasetCuration,
    })
  );

  vi.clearAllMocks();
});

describe("datasetRouter — auth boundary", () => {
  it("rejects an unauthenticated caller with UNAUTHORIZED", async () => {
    const anon = appRouter.createCaller(makeContext(null, db));
    await expect(
      anon.dataset.listUnprocessedSources({ projectId: null })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("datasetRouter — discoverSources", () => {
  it("calls discoverLocal when sourceType is local", async () => {
    mockDatasetDiscovery.discoverLocal.mockResolvedValue(10);
    const res = await asAlice.dataset.discoverSources({
      projectId: null,
      sourceType: "local",
      queryOrPath: "/my/project/folder",
      limit: 20,
    });

    expect(res).toEqual({ success: true, count: 10 });
    expect(mockDatasetDiscovery.discoverLocal).toHaveBeenCalledWith(
      null,
      "/my/project/folder",
      20
    );
  });

  it("calls discoverOnline when sourceType is online_search", async () => {
    mockDatasetDiscovery.discoverOnline.mockResolvedValue(5);
    const res = await asAlice.dataset.discoverSources({
      projectId: null,
      sourceType: "online_search",
      queryOrPath: "react hooks",
      limit: 10,
    });

    expect(res).toEqual({ success: true, count: 5 });
    expect(mockDatasetDiscovery.discoverOnline).toHaveBeenCalledWith(
      null,
      "react" + " hooks",
      10
    );
  });

  it("blocks online search in sovereign mode", async () => {
    const sovereignAlice = await seedUser(db, {
      openId: `sovereign-${randomUUID()}`,
      executionMode: "sovereign",
    });
    const asSovereign = appRouter.createCaller(
      makeContext(sovereignAlice, db, {
        datasetDiscovery: mockDatasetDiscovery,
      })
    );

    await expect(
      asSovereign.dataset.discoverSources({
        projectId: null,
        sourceType: "online_search",
        queryOrPath: "react hooks",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("Sovereign mode: online search discovery is disabled"),
    });
  });
});

describe("datasetRouter — listUnprocessedSources", () => {
  it("lists unprocessed items filtered by project", async () => {
    const mapId1 = randomUUID();
    const mapId2 = randomUUID();

    // Create neural maps
    await db.insert(neuralMaps).values([
      { id: mapId1, userId: alice.id, name: "Map 1", rootDirectories: ["/1"], settings: {} },
      { id: mapId2, userId: alice.id, name: "Map 2", rootDirectories: ["/2"], settings: {} },
    ]);

    // Insert items
    await db.insert(discoveredDatasetItems).values([
      { projectId: mapId1, sourceType: "local", sourceName: "f1", content: "c1", isProcessed: 0 },
      { projectId: mapId1, sourceType: "local", sourceName: "f2", content: "c2", isProcessed: 1 },
      { projectId: mapId2, sourceType: "local", sourceName: "f3", content: "c3", isProcessed: 0 },
      { projectId: null, sourceType: "local", sourceName: "f4", content: "c4", isProcessed: 0 },
    ]);

    const forMap1 = await asAlice.dataset.listUnprocessedSources({ projectId: mapId1 });
    expect(forMap1.length).toBe(1);
    expect(forMap1[0].sourceName).toBe("f1");

    const forGlobal = await asAlice.dataset.listUnprocessedSources({ projectId: null });
    expect(forGlobal.length).toBe(1);
    expect(forGlobal[0].sourceName).toBe("f4");
  });
});

describe("datasetRouter — curateSourceItem", () => {
  it("triggers curation successfully", async () => {
    mockDatasetCuration.curateItem.mockResolvedValue(true);

    const res = await asAlice.dataset.curateSourceItem({ itemId: 42 });
    expect(res).toEqual({ success: true });
    expect(mockDatasetCuration.curateItem).toHaveBeenCalledWith(42, alice.id, alice.executionMode);
  });

  it("throws INTERNAL_SERVER_ERROR if curation fails", async () => {
    mockDatasetCuration.curateItem.mockResolvedValue(false);

    await expect(
      asAlice.dataset.curateSourceItem({ itemId: 42 })
    ).rejects.toThrow("Failed to curate source item");
  });
});

describe("datasetRouter — listCuratedExamples", () => {
  it("lists curated examples", async () => {
    const mapId = randomUUID();
    await db.insert(neuralMaps).values({ id: mapId, userId: alice.id, name: "Map", rootDirectories: ["/"], settings: {} });

    const [item] = await db
      .insert(discoveredDatasetItems)
      .values({ projectId: mapId, sourceType: "local", sourceName: "f1", content: "c1" })
      .returning();

    await db.insert(curatedTrainingExamples).values([
      {
        projectId: mapId,
        datasetItemId: item.id,
        createdByUserId: alice.id,
        instruction: "i1",
        output: "o1",
        status: "pending_review",
      },
      {
        projectId: null,
        datasetItemId: null,
        createdByUserId: alice.id,
        instruction: "i2",
        output: "o2",
        status: "approved",
      },
    ]);

    const forMap = await asAlice.dataset.listCuratedExamples({ projectId: mapId });
    expect(forMap.length).toBe(1);
    expect(forMap[0].instruction).toBe("i1");

    const all = await asAlice.dataset.listCuratedExamples({});
    expect(all.length).toBe(2);
  });
});

describe("datasetRouter — updateCuratedExample", () => {
  it("updates fields of curated example", async () => {
    const [example] = await db
      .insert(curatedTrainingExamples)
      .values({
        projectId: null,
        datasetItemId: null,
        createdByUserId: alice.id,
        instruction: "original instruction",
        output: "original output",
        status: "pending_review",
      })
      .returning();

    const updated = await asAlice.dataset.updateCuratedExample({
      id: example.id,
      instruction: "new instruction",
      output: "new output",
      status: "approved",
    });

    expect(updated.instruction).toBe("new instruction");
    expect(updated.output).toBe("new output");
    expect(updated.status).toBe("approved");
  });

  it("throws NOT_FOUND if the example does not exist", async () => {
    await expect(
      asAlice.dataset.updateCuratedExample({
        id: 9999,
        instruction: "new instruction",
      })
    ).rejects.toThrow("Curated example not found");
  });
});

describe("datasetRouter — compileDataset", () => {
  it("compiles curated dataset items", async () => {
    mockDatasetCuration.compileDataset.mockResolvedValue("/compiled/file.jsonl");

    const res = await asAlice.dataset.compileDataset({ projectId: "my-project" });
    expect(res).toEqual({ success: true, filePath: "/compiled/file.jsonl" });
    expect(mockDatasetCuration.compileDataset).toHaveBeenCalledWith("my-project");
  });
});
