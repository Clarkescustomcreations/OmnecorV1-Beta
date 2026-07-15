/**
 * brainRouter — route-level tests driving the real `appRouter.createCaller(ctx)`
 * against the real in-memory DB (so ownership scoping + cascade genuinely run).
 * The vector store is a fake (packs carry prebuilt embeddings), and the audit
 * middleware is stubbed so it doesn't touch the real file DB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

const fakeStore = vi.hoisted(() => {
  const collections = new Map<string, Map<string, unknown>>();
  // Scripted semanticSearch results per collection (for suggest tests).
  const searchResults = new Map<string, unknown[]>();
  return {
    collections,
    searchResults,
    init: vi.fn(async () => {}),
    getOrCreateCollection: vi.fn(async (name: string) => {
      if (!collections.has(name)) collections.set(name, new Map());
      return name;
    }),
    addDocumentsWithEmbeddings: vi.fn(async (name: string, docs: Array<{ id: string }>) => {
      const c = collections.get(name) ?? new Map();
      for (const d of docs) c.set(d.id, d);
      collections.set(name, c);
    }),
    semanticSearch: vi.fn(async (name: string) => (searchResults.get(name) ?? []) as unknown[]),
    deleteCollection: vi.fn(async (name: string) => void collections.delete(name)),
  };
});
vi.mock("../core_services/services/VectorStore.js", () => ({
  getVectorStore: () => fakeStore,
}));

// Deterministic Valet classification (no network): offline fallback returns a
// fixed category so suggest ranking is driven by the (scripted) corpus relevance.
const fakeValet = vi.hoisted(() => ({
  isAvailable: vi.fn(async () => false),
  route: vi.fn(async () => ({
    category: "code_generation",
    mode: "main_api",
    primaryProvider: "ollama",
    primaryModel: "",
    secondaryProviders: [],
    costTier: "free",
    localCapable: true,
    reasoning: "test classification",
    confidence: 0.9,
    requiresTodoMd: false,
    requiresStatusMd: false,
  })),
}));
vi.mock("../core_services/services/ValetRouterService.js", () => ({
  ValetRouterService: { getInstance: () => fakeValet },
}));

// Authoring pipeline is mocked here (its heavy externals — embedder/scraper/
// distiller — are exercised in BrainAuthoringService.test.ts); this file only
// verifies the router wiring + error passthrough.
const fakeAuthoring = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("../core_services/services/BrainAuthoringService.js", () => ({
  BrainAuthoringService: { getInstance: () => fakeAuthoring },
}));

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }) },
}));

import { appRouter } from "../routers.js";
import { meshNode } from "../ommesh/core/MeshNode.js";
import { EMBEDDING_CONFIG } from "../core_services/config/index.js";
import { packBrain } from "../core_services/brains/obpFormat.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let user: User;
let caller: Caller;

function vec(seed: number): number[] {
  return Array.from({ length: EMBEDDING_CONFIG.dimensions }, (_, i) => Math.sin(seed + i) * 0.1);
}

function packB64(over: { id?: string; embedderId?: string; embedderDim?: number } = {}): string {
  return packBrain({
    id: over.id ?? "coding",
    name: "Coding",
    version: "1.0.0",
    domain: "coding",
    embedder: {
      id: over.embedderId ?? EMBEDDING_CONFIG.modelId,
      dim: over.embedderDim ?? EMBEDDING_CONFIG.dimensions,
    },
    charter: "Write tests first.",
    chunks: [
      { id: "c1", text: "guard nulls", embedding: vec(1) },
      { id: "c2", text: "memoize renders", embedding: vec(2) },
    ],
  }).toString("base64");
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  fakeStore.collections.clear();
  fakeStore.searchResults.clear();
  vi.clearAllMocks();
  user = await seedUser(db, { role: "user", executionMode: "scrapper" });
  caller = appRouter.createCaller(makeContext(user, db));
});

describe("brainRouter", () => {
  it("imports a compatible pack, then lists/gets/stats it", async () => {
    const imp = await caller.brains.import({ data: packB64() });
    expect(imp.embedderMatch).toBe(true);
    expect(imp.brain?.status).toBe("ready");
    expect(imp.vectorsLoaded).toBe(2);

    const list = await caller.brains.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("coding");
    expect(list[0]?.embedderMatch).toBe(true);

    const got = await caller.brains.get({ brainId: "coding" });
    expect(got?.domain).toBe("coding");

    const stats = await caller.brains.stats({ brainId: "coding" });
    expect(stats).toMatchObject({ status: "ready", embedderMatch: true, chunkCount: 2, indexedCount: 2 });
  });

  it("flags an embedder-incompatible pack on import", async () => {
    const imp = await caller.brains.import({ data: packB64({ embedderId: "other-model" }) });
    expect(imp.embedderMatch).toBe(false);
    expect(imp.brain?.status).toBe("incompatible");
    expect(imp.vectorsLoaded).toBe(0);
  });

  it("rejects a malformed pack with BAD_REQUEST", async () => {
    await expect(caller.brains.import({ data: Buffer.from("not a pack").toString("base64") }))
      .rejects.toThrow(/Brain import failed/i);
  });

  it("exports a stored brain to a re-importable .obp", async () => {
    await caller.brains.import({ data: packB64() });
    const exp = await caller.brains.export({ brainId: "coding" });
    expect(exp.filename).toBe("coding.obp");
    // Re-import the exported bytes → still valid.
    const reimport = await caller.brains.import({ data: exp.data });
    expect(reimport.brain?.id).toBe("coding");
    expect(reimport.chunksStored).toBe(2);
  });

  it("deletes a brain (drops collection + cascade rows)", async () => {
    await caller.brains.import({ data: packB64() });
    const del = await caller.brains.delete({ brainId: "coding" });
    expect(del.deleted).toBe(true);
    expect(fakeStore.deleteCollection).toHaveBeenCalledWith("brain_coding");
    await expect(caller.brains.get({ brainId: "coding" })).rejects.toThrow(/not found/i);
    expect(await caller.brains.list()).toHaveLength(0);
  });

  it("rebuildIndex reloads vectors from the durable chunk store", async () => {
    await caller.brains.import({ data: packB64() });
    fakeStore.collections.clear();
    const res = await caller.brains.rebuildIndex({ brainId: "coding" });
    expect(res.status).toBe("ready");
    expect(res.vectorsLoaded).toBe(2);
  });

  it("suggest ranks brains by corpus relevance and includes the classification", async () => {
    await caller.brains.import({ data: packB64({ id: "coding" }) });
    await caller.brains.import({ data: packB64({ id: "cooking" }) });
    // Coding is a close match (distance 0.1 → relevance 0.9); cooking is far.
    fakeStore.searchResults.set("brain_coding", [{ id: "c1", text: "guard nulls", distance: 0.1, metadata: {} }]);
    fakeStore.searchResults.set("brain_cooking", [{ id: "c1", text: "chop onions", distance: 0.95, metadata: {} }]);

    const res = await caller.brains.suggest({ task: "how do I guard against null in typescript" });
    expect(res.category).toBe("code_generation");
    expect(res.valetOnline).toBe(false);
    // Coding ranks first; cooking (relevance 0.05) falls below the 0.3 floor.
    expect(res.suggestions[0]?.brainId).toBe("coding");
    expect(res.suggestions.map(s => s.brainId)).not.toContain("cooking");
    expect(res.suggestions[0]?.relevance).toBeGreaterThan(0.8);
    expect(res.suggestions[0]?.domainAligned).toBe(true); // "coding" ⊂ "code_generation"
  });

  it("suggest returns no suggestions when the user has no brains", async () => {
    const res = await caller.brains.suggest({ task: "anything" });
    expect(res.suggestions).toEqual([]);
    expect(res.category).toBe("code_generation");
  });

  it("suggest proposes an incompatible (charter-only) brain on domain alignment", async () => {
    await caller.brains.import({ data: packB64({ id: "coding", embedderId: "other-model" }) });
    const res = await caller.brains.suggest({ task: "write a function" });
    // No vectors to query (incompatible) but domain aligns → surfaced at 0.4.
    expect(res.suggestions[0]?.brainId).toBe("coding");
    expect(res.suggestions[0]?.relevance).toBeNull();
    expect(res.suggestions[0]?.domainAligned).toBe(true);
    expect(fakeStore.semanticSearch).not.toHaveBeenCalledWith("brain_coding", expect.anything(), expect.anything());
  });

  it("build serializes the authored brain + build stats and passes execution mode through", async () => {
    const now = new Date();
    fakeAuthoring.build.mockResolvedValueOnce({
      brainId: "authored", filePath: "/dir/authored.obp", bytes: 42,
      rawChunks: 2, distilledChunks: 1, totalChunks: 3, embedderMatch: true,
      distillProvider: "ollama", scrapeFailures: ["https://x/404"],
      import: {
        brain: {
          id: "authored", userId: user.id, name: "Authored", version: "1.0.0",
          domain: "coding", description: null, charter: "c", charterSha256: "x".repeat(64),
          embedderId: "all-MiniLM-L6-v2", embedderDim: 384, embedderMatch: 1,
          status: "ready", collectionName: "brain_authored", chunkCount: 3,
          provenance: { source: "mixed" }, builtin: 0, createdAt: now, updatedAt: now,
        },
        embedderMatch: true, chunksStored: 3, vectorsLoaded: 3,
      },
    });
    const res = await caller.brains.build({
      id: "authored", name: "Authored", domain: "coding", charter: "c",
      sources: [{ text: "some knowledge" }],
      distill: { providerId: "ollama", modelId: "m" },
    });
    expect(res.brain?.id).toBe("authored");
    expect(res.totalChunks).toBe(3);
    expect(res.scrapeFailures).toEqual(["https://x/404"]);
    expect(fakeAuthoring.build).toHaveBeenCalledWith(
      user.id, expect.objectContaining({ id: "authored" }), "scrapper"
    );
  });

  it("build preserves a Sovereign FORBIDDEN (not wrapped as BAD_REQUEST)", async () => {
    fakeAuthoring.build.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN", message: "Sovereign mode: cloud provider disabled" })
    );
    await expect(
      caller.brains.build({
        id: "blocked", name: "B", domain: "coding", charter: "x",
        sources: [{ text: "t" }], distill: { providerId: "anthropic", modelId: "m" },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("build wraps a pipeline failure as BAD_REQUEST", async () => {
    fakeAuthoring.build.mockRejectedValueOnce(new Error("embedder unavailable"));
    await expect(
      caller.brains.build({ id: "x", name: "X", domain: "d", charter: "c", sources: [{ text: "t" }] })
    ).rejects.toThrow(/Brain build failed: embedder unavailable/);
  });

  it("syncToPeer exports the brain and pushes it to the named mesh peer", async () => {
    await caller.brains.import({ data: packB64() });
    const spy = vi.spyOn(meshNode, "sendBrainToPeerByName").mockResolvedValue({
      ok: true, brainId: "coding", embedderMatch: true, status: "ready", chunksStored: 2, vectorsLoaded: 2,
    });
    try {
      const res = await caller.brains.syncToPeer({ brainId: "coding", peerId: "peer-1" });
      expect(res).toMatchObject({ peerId: "peer-1", brainId: "coding", ok: true, embedderMatch: true, status: "ready" });
      // The peer received a real, self-contained .obp buffer for this brain.
      expect(spy).toHaveBeenCalledTimes(1);
      const [peerName, buf] = spy.mock.calls[0];
      expect(peerName).toBe("peer-1");
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect((buf as Buffer).byteLength).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("syncToPeer rejects a brain the caller does not own with NOT_FOUND", async () => {
    const spy = vi.spyOn(meshNode, "sendBrainToPeerByName");
    try {
      await expect(caller.brains.syncToPeer({ brainId: "ghost", peerId: "peer-1" })).rejects.toThrow(/not found/i);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("syncToPeer surfaces a peer transport failure as BAD_REQUEST", async () => {
    await caller.brains.import({ data: packB64() });
    const spy = vi.spyOn(meshNode, "sendBrainToPeerByName").mockRejectedValue(new Error("peer offline"));
    try {
      await expect(caller.brains.syncToPeer({ brainId: "coding", peerId: "peer-1" }))
        .rejects.toThrow(/Brain sync to peer failed: peer offline/);
    } finally {
      spy.mockRestore();
    }
  });

  it("syncToPeer surfaces a peer-side import rejection as BAD_REQUEST", async () => {
    await caller.brains.import({ data: packB64() });
    const spy = vi.spyOn(meshNode, "sendBrainToPeerByName").mockResolvedValue({ ok: false, error: "no_local_owner" });
    try {
      await expect(caller.brains.syncToPeer({ brainId: "coding", peerId: "peer-1" }))
        .rejects.toThrow(/Peer rejected the brain: no_local_owner/);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not leak another user's brain", async () => {
    await caller.brains.import({ data: packB64() });
    const other = await seedUser(db, { openId: `o-${Date.now()}`, email: "x@y.z", role: "user", executionMode: "scrapper" });
    const otherCaller = appRouter.createCaller(makeContext(other, db));
    expect(await otherCaller.brains.list()).toHaveLength(0);
    await expect(otherCaller.brains.get({ brainId: "coding" })).rejects.toThrow(/not found/i);
    await expect(otherCaller.brains.delete({ brainId: "coding" })).rejects.toThrow(/not found/i);
  });
});
