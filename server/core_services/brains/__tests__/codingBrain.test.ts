/**
 * @file codingBrain.test.ts
 * @description Brains-Upgrade Phase 6 — the built-in **Coding** exemplar, end-to-end.
 *
 * Drives the REAL stack against the shipped `brains/coding.obp`:
 *   BrainPackService.importFromBuffer (real DB persist + embedder-match gate)
 *     → real EmbeddedVectorStore (libSQL `vector_top_k` / `vector_distance_cos`)
 *     → real on-device embedder (all-MiniLM-L6-v2) for the QUERY.
 *
 * This proves the pack is well-formed AND that semantic retrieval surfaces the
 * right curated chunk for representative coding questions — the measurable
 * retrieval-quality half of the Phase 6 proof (the model-answer half is driven
 * live in server/scripts/evalCodingBrain.ts).
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OBP_PATH = path.resolve(__dirname, "../../../../brains/coding.obp");

// Redirect BOTH the drizzle handle (getDb) and the raw libSQL client
// (getLibsqlClient — used by EmbeddedVectorStore) to ONE shared in-memory DB so
// the brains tables and the vector tables live in the same connection.
const { getDbMock, getLibsqlClientMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getLibsqlClientMock: vi.fn(),
}));
vi.mock("../../../db.factory.js", async orig => {
  const actual = await orig<typeof import("../../../db.factory.js")>();
  return { ...actual, getDb: getDbMock, getLibsqlClient: getLibsqlClientMock };
});

// AuditLogService must not touch the real file DB from route/service paths.
vi.mock("../../services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: vi.fn(async () => {}) }) },
}));

const { BrainPackService } = await import("../../services/BrainPackService.js");
const { EmbeddingService } = await import("../../services/EmbeddingService.js");
const { getVectorStore } = await import("../../services/VectorStore.js");
const { injectBrainContext } = await import("../../../_core/brainContext.js");
const { personas } = await import("../../../../drizzle/schema.js");

let USER_ID = 0;
let testDb: TestDb;
let embedderReady = false;
let packBuf: Buffer;

beforeAll(async () => {
  packBuf = await fsp.readFile(OBP_PATH);

  testDb = await createTestDb();
  getDbMock.mockResolvedValue(testDb.db);
  getLibsqlClientMock.mockResolvedValue(testDb.client);
  // BrainPackService persists user-scoped rows; the FK expects a users row.
  const user = await seedUser(testDb.db);
  USER_ID = user.id;

  const onnx = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.onnxRelPath);
  const vocab = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.vocabRelPath);
  if (fs.existsSync(onnx) && fs.existsSync(vocab)) {
    await EmbeddingService.getInstance().init();
    embedderReady = EmbeddingService.getInstance().isReady();
  }
}, 60_000);

describe("built-in Coding brain — pack shape", () => {
  it("is a valid .obp for the running embedder with a non-trivial corpus", () => {
    const { manifest, charter, chunks } = unpackBrain(packBuf);
    expect(manifest.id).toBe("omnecor-coding");
    expect(manifest.domain).toBe("coding");
    expect(manifest.embedder.id).toBe(EMBEDDING_CONFIG.modelId);
    expect(manifest.embedder.dim).toBe(EMBEDDING_CONFIG.dimensions);
    expect(manifest.chunkCount).toBe(chunks.length);
    expect(chunks.length).toBeGreaterThanOrEqual(40);
    expect(charter.length).toBeGreaterThan(500);
    // Every chunk is a distinct curated fact with a stable source label.
    const names = chunks.map(c => (c.metadata as Record<string, unknown>).sourcePath);
    expect(new Set(names).size).toBe(chunks.length);
    expect(names).toContain("sec-sql-injection-parameterized");
  });
});

describe("built-in Coding brain — import + embedder match", () => {
  it("imports as a ready, queryable brain with the full corpus indexed", async () => {
    if (!embedderReady) return;
    const res = await BrainPackService.getInstance().importFromBuffer(USER_ID, packBuf);
    expect(res.embedderMatch).toBe(true);
    expect(res.brain.status).toBe("ready");

    const stats = await BrainPackService.getInstance().stats(USER_ID, "omnecor-coding");
    expect(stats?.status).toBe("ready");
    expect(stats?.embedderMatch).toBe(true);
    expect(stats?.chunkCount).toBeGreaterThanOrEqual(40);
    expect(stats?.indexedCount).toBe(stats?.chunkCount);
  }, 60_000);
});

describe("built-in Coding brain — semantic retrieval surfaces the right fact", () => {
  // question → the curated entry we expect to rank #1 (its sourcePath label)
  const CASES: Array<[string, string]> = [
    ["how do I stop SQL injection in my database queries", "sec-sql-injection-parameterized"],
    ["why does 0.1 + 0.2 not equal 0.3 and how should I store currency", "js-floating-point-money"],
    ["what is the right way to hash user passwords before storing them", "sec-password-hashing"],
    ["my array of numbers sorts in the wrong order in javascript", "js-array-sort-default-lexicographic"],
    ["I keep getting way too many database queries when looping over rows", "sql-n-plus-one"],
    ["should I use == or === when comparing values in javascript", "js-equality-triple-vs-double"],
    ["a long synchronous computation is freezing my node server", "concurrency-event-loop-blocking"],
    ["how do I safely compare a secret token without leaking timing", "sec-timing-safe-comparison"],
  ];

  it("ranks the correct curated chunk first for each representative question", async () => {
    if (!embedderReady) return;
    // Ensure the pack is imported (idempotent if a prior test already did).
    await BrainPackService.getInstance().importFromBuffer(USER_ID, packBuf);
    const brain = await BrainPackService.getInstance().get(USER_ID, "omnecor-coding");
    expect(brain).not.toBeNull();
    const store = getVectorStore();

    let topHits = 0;
    for (const [question, expected] of CASES) {
      const hits = await store.semanticSearch(brain!.collectionName, question, 3);
      expect(hits.length).toBeGreaterThan(0);
      const top = (hits[0].metadata as Record<string, unknown>).sourcePath;
      if (top === expected) topHits++;
      // The expected fact must at least be in the top-3 for every question.
      const inTop3 = hits.some(h => (h.metadata as Record<string, unknown>).sourcePath === expected);
      expect(inTop3, `"${question}" → expected ${expected} in top-3, got ${hits.map(h => (h.metadata as any).sourcePath).join(", ")}`).toBe(true);
    }
    // Strong retrieval: the exact fact ranks #1 for the large majority.
    expect(topHits).toBeGreaterThanOrEqual(Math.ceil(CASES.length * 0.75));
  }, 60_000);
});

describe("built-in Coding brain — persona attach → injection", () => {
  it("injects the charter + cited corpus when attached to a persona", async () => {
    if (!embedderReady) return;
    await BrainPackService.getInstance().importFromBuffer(USER_ID, packBuf);

    // Durable persona attach: the brain lives in the persona's data.brains,
    // exactly like personaRouter.attachBrain writes it (Phase 4).
    const personaId = "persona-coding-test";
    await testDb.db.insert(personas).values({
      id: personaId,
      userId: USER_ID,
      name: "Coder",
      type: "self_clone",
      data: { brains: ["omnecor-coding"] },
    });

    const messages = [{ role: "user" as const, content: "How do I prevent SQL injection?" }];
    const result = await injectBrainContext({
      personaId,
      userId: USER_ID,
      messages,
      systemPrompt: "You are a coding assistant.",
    });

    expect(result.injected).toBe(true);
    expect(result.usedBrainIds).toContain("omnecor-coding");
    // Charter is always-on; retrieved corpus is cited by brain + source.
    const carrier = (result.systemPrompt ?? "") + JSON.stringify(result.messages);
    expect(carrier).toMatch(/Domain layer — software engineering/i); // charter domain layer (reasoning base + domain, blueprint pattern)
    expect(carrier).toMatch(/\[Brain: Coding ·/); // per-source citation
    expect(carrier.toLowerCase()).toMatch(/parameter|prepared statement/); // the retrieved fact
  }, 60_000);
});
