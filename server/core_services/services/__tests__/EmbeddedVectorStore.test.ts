/**
 * EmbeddedVectorStore — the DEFAULT libSQL-native vector backend. Drives the
 * REAL store against a shared in-memory libSQL client (so `vector_top_k` /
 * `libsql_vector_idx` / `vector32` execute for real) with the REAL on-device
 * embedder. Model-dependent cases self-skip when the embedding asset is not on
 * disk, so the suite never fails spuriously in a bare CI.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";

// Redirect the raw libSQL client to a shared in-memory DB. The store reads
// `getLibsqlClient()` at call time, so setting the impl in beforeAll is enough.
const { getLibsqlClientMock } = vi.hoisted(() => ({ getLibsqlClientMock: vi.fn() }));
vi.mock("../../../db.factory.js", async (orig) => {
  const actual = await orig<typeof import("../../../db.factory.js")>();
  return { ...actual, getLibsqlClient: getLibsqlClientMock };
});

import { EmbeddedVectorStore } from "../EmbeddedVectorStore.js";
import { EmbeddingService } from "../EmbeddingService.js";
import { EMBEDDING_CONFIG } from "../../config/index.js";

const store = EmbeddedVectorStore.getInstance();
const COLL = "omnecor_test_map_01";
let client: Client;
let ready = false;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  getLibsqlClientMock.mockResolvedValue(client);

  const fs = await import("fs");
  const path = await import("path");
  const onnx = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.onnxRelPath);
  const vocab = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.vocabRelPath);
  if (fs.existsSync(onnx) && fs.existsSync(vocab)) {
    await EmbeddingService.getInstance().init();
    ready = EmbeddingService.getInstance().isReady();
  }
  if (ready) {
    await store.init();
    await store.addDocuments(COLL, [
      { id: "d1", text: "Fix a null pointer exception in TypeScript with optional chaining and null guards.", metadata: { sourceUri: "docs://ts", topic: "coding" } },
      { id: "d2", text: "Preheat the oven to 220C and roast the vegetables with olive oil.", metadata: { sourceUri: "docs://cook", topic: "cooking" } },
      { id: "d3", text: "React re-renders when props or state change; memoize with useMemo.", metadata: { sourceUri: "docs://react", topic: "coding" } },
      { id: "d4", text: "Knead the sourdough for ten minutes then proof overnight.", metadata: { sourceUri: "docs://cook", topic: "cooking" } },
    ]);
  }
});

describe("EmbeddedVectorStore", () => {
  it("reports embedded backend in status with the created collection", async () => {
    if (!ready) return;
    const st = await store.getStatus();
    expect(st.chromaUrl).toBe("libsql://embedded");
    expect(st.isConnected).toBe(true);
    expect(st.collections).toContain(COLL);
  });

  it("ranks semantically relevant documents first", async () => {
    if (!ready) return;
    const results = await store.semanticSearch(
      COLL,
      "how do I handle a null reference error in my typescript code",
      3
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("d1");
    // distances are ascending (closest first)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance!).toBeGreaterThanOrEqual(results[i - 1].distance!);
    }
  });

  it("round-trips metadata as parsed objects", async () => {
    if (!ready) return;
    const [top] = await store.semanticSearch(COLL, "typescript null pointer", 1);
    expect(top.metadata).toMatchObject({ topic: "coding", sourceUri: "docs://ts" });
  });

  it("upsert (INSERT OR REPLACE) keeps the vector index consistent", async () => {
    if (!ready) return;
    await store.addDocuments(COLL, [
      { id: "d2", text: "Debugging async race conditions in Node.js event loops and promise ordering.", metadata: { sourceUri: "docs://ts", topic: "coding" } },
    ]);
    const [top] = await store.semanticSearch(COLL, "asynchronous promise race condition bug", 1);
    expect(top.id).toBe("d2");
    expect((top.metadata as Record<string, unknown>).topic).toBe("coding");
  });

  it("removes documents by metadata filter", async () => {
    if (!ready) return;
    await store.removeDocumentsWhere(COLL, { sourceUri: "docs://cook" });
    const results = await store.semanticSearch(COLL, "bread baking recipe", 5);
    expect(results.map(r => r.id)).not.toContain("d4");
  });

  it("rejects unsafe metadata filter keys", async () => {
    await expect(
      store.removeDocumentsWhere(COLL, { "evil'; DROP TABLE x; --": "x" })
    ).rejects.toThrow(/unsafe metadata key/i);
  });

  it("returns [] for a search on a collection that never existed", async () => {
    if (!ready) return;
    const results = await store.semanticSearch("omnecor_does_not_exist", "anything", 5);
    expect(results).toEqual([]);
  });

  it("handles collection ids with special characters safely", async () => {
    if (!ready) return;
    const weird = "map/with:special-chars.123";
    await store.addDocuments(weird, [
      { id: "x1", text: "content about photosynthesis in plants", metadata: {} },
    ]);
    const res = await store.semanticSearch(weird, "how plants convert sunlight to energy", 1);
    expect(res.length).toBe(1);
    expect(res[0].id).toBe("x1");
    await store.deleteCollection(weird);
  });

  it("addDocumentsWithEmbeddings stores prebuilt vectors under stable ids", async () => {
    if (!ready) return;
    const PB = "omnecor_prebuilt_01";
    // Reuse the real embedder to make two genuinely-related vectors so KNN is
    // meaningful, but insert them via the prebuilt-embedding path (stable ids).
    const [e1, e2] = await EmbeddingService.getInstance().embedBatch([
      "async await promise concurrency in javascript",
      "baking a chocolate cake with butter and sugar",
    ]);
    await store.addDocumentsWithEmbeddings(PB, [
      { id: "p1", text: "async await promise concurrency in javascript", metadata: { topic: "coding" }, embedding: e1 },
      { id: "p2", text: "baking a chocolate cake with butter and sugar", metadata: { topic: "cooking" }, embedding: e2 },
    ]);
    const [top] = await store.semanticSearch(PB, "how do promises and async functions work", 1);
    expect(top.id).toBe("p1");
    expect((top.metadata as Record<string, unknown>).topic).toBe("coding");
    await store.deleteCollection(PB);
  });

  it("addDocumentsWithEmbeddings rejects a wrong-dimension vector", async () => {
    if (!ready) return;
    await expect(
      store.addDocumentsWithEmbeddings("omnecor_baddim", [
        { id: "b1", text: "x", metadata: {}, embedding: [0.1, 0.2, 0.3] },
      ])
    ).rejects.toThrow(/dimension mismatch/i);
  });

  it("deleteCollection removes the collection from status", async () => {
    if (!ready) return;
    await store.deleteCollection(COLL);
    const st = await store.getStatus();
    expect(st.collections).not.toContain(COLL);
  });
});
