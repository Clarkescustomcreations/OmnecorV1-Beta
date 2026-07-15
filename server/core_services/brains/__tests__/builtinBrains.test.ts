/**
 * @file builtinBrains.test.ts
 * @description Brains-Upgrade Phase 6 — the whole built-in "Team of Experts",
 * end-to-end and deterministic (no live model needed).
 *
 * For EVERY registered built-in brain, drives the REAL stack against the shipped
 * `brains/<slug>.obp`:
 *   BrainPackService.importFromBuffer (real DB persist + embedder-match gate)
 *     → real EmbeddedVectorStore (libSQL vector_top_k / vector_distance_cos)
 *     → real on-device embedder (all-MiniLM-L6-v2) for the QUERY.
 *
 * Proves each pack is well-formed, imports ready/queryable with its full corpus
 * indexed, and that semantic retrieval surfaces a relevant curated fact in the
 * top-k for its eval questions (the retrieval-quality half of the Phase-6 proof;
 * the model-answer half is driven live in server/scripts/evalBrain.ts).
 *
 * Model-dependent cases self-skip when the embedding asset isn't on disk, so a
 * bare CI never fails spuriously; the pack-shape assertions always run.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createTestDb, seedUser, type TestDb } from "../../../__tests__/_helpers/trpcHarness.js";
import { unpackBrain } from "../obpFormat.js";
import { EMBEDDING_CONFIG } from "../../config/index.js";
import { BRAIN_MODULES } from "../../../../brains/sources/index.js";
import { getEvalSpec } from "../../../../brains/eval/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAINS_DIR = path.resolve(__dirname, "../../../../brains");

const { getDbMock, getLibsqlClientMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getLibsqlClientMock: vi.fn(),
}));
vi.mock("../../../db.factory.js", async orig => {
  const actual = await orig<typeof import("../../../db.factory.js")>();
  return { ...actual, getDb: getDbMock, getLibsqlClient: getLibsqlClientMock };
});
vi.mock("../../services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: vi.fn(async () => {}) }) },
}));

const { BrainPackService } = await import("../../services/BrainPackService.js");
const { EmbeddingService } = await import("../../services/EmbeddingService.js");
const { getVectorStore } = await import("../../services/VectorStore.js");

let USER_ID = 0;
let testDb: TestDb;
let embedderReady = false;

beforeAll(async () => {
  testDb = await createTestDb();
  getDbMock.mockResolvedValue(testDb.db);
  getLibsqlClientMock.mockResolvedValue(testDb.client);
  const user = await seedUser(testDb.db);
  USER_ID = user.id;

  const onnx = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.onnxRelPath);
  const vocab = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.vocabRelPath);
  if (fs.existsSync(onnx) && fs.existsSync(vocab)) {
    await EmbeddingService.getInstance().init();
    embedderReady = EmbeddingService.getInstance().isReady();
  }
}, 60_000);

describe.each(BRAIN_MODULES.map(m => [m.slug, m] as const))("built-in brain: %s", (slug, mod) => {
  const obpPath = path.join(BRAINS_DIR, `${slug}.obp`);

  it("ships a valid .obp for the running embedder with a substantial curated corpus", async () => {
    const buf = await fsp.readFile(obpPath);
    const { manifest, charter, chunks } = unpackBrain(buf);
    expect(manifest.id).toBe(mod.id);
    expect(manifest.domain).toBe(mod.domain);
    expect(manifest.embedder.id).toBe(EMBEDDING_CONFIG.modelId);
    expect(manifest.embedder.dim).toBe(EMBEDDING_CONFIG.dimensions);
    expect(manifest.chunkCount).toBe(chunks.length);
    // Every built-in was curated to Phase-6 grade (well beyond a handful of chunks).
    expect(chunks.length).toBeGreaterThanOrEqual(20);
    expect(charter.length).toBeGreaterThan(500);
    // Each chunk is a distinct curated fact with a stable citable source label.
    const names = chunks.map(c => (c.metadata as Record<string, unknown>).sourcePath);
    expect(new Set(names).size).toBe(chunks.length);
  });

  it("imports as a ready, queryable brain with the full corpus indexed", async () => {
    if (!embedderReady) return;
    const buf = await fsp.readFile(obpPath);
    const res = await BrainPackService.getInstance().importFromBuffer(USER_ID, buf);
    expect(res.embedderMatch).toBe(true);
    expect(res.brain.status).toBe("ready");

    const stats = await BrainPackService.getInstance().stats(USER_ID, mod.id);
    expect(stats?.status).toBe("ready");
    expect(stats?.indexedCount).toBe(stats?.chunkCount);
  }, 60_000);

  it("retrieves a relevant curated fact in the top-k for its eval questions", async () => {
    if (!embedderReady) return;
    const spec = getEvalSpec(slug);
    if (!spec) return; // every built-in has a spec, but stay defensive.

    const buf = await fsp.readFile(obpPath);
    await BrainPackService.getInstance().importFromBuffer(USER_ID, buf);
    const brain = await BrainPackService.getInstance().get(USER_ID, mod.id);
    expect(brain).not.toBeNull();
    const store = getVectorStore();

    let covered = 0;
    for (const c of spec.cases) {
      const hits = await store.semanticSearch(brain!.collectionName, c.q, 4);
      expect(hits.length).toBeGreaterThan(0);
      // At least one retrieved chunk must contain an expected fact term — i.e.
      // retrieval surfaced material that answers the question.
      const blob = hits.map(h => (h.text ?? "").toLowerCase()).join("\n");
      const ok = c.facts.some(group => group.some(t => blob.includes(t.toLowerCase())));
      if (ok) covered++;
    }
    // Retrieval must be relevant for the large majority of representative questions.
    expect(covered).toBeGreaterThanOrEqual(Math.ceil(spec.cases.length * 0.8));
  }, 120_000);
});
