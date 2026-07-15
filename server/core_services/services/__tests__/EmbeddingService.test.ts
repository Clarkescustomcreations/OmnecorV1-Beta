/**
 * EmbeddingService — on-device all-MiniLM-L6-v2 embedder (WordPiece tokenizer +
 * ONNX + masked mean pooling + L2 normalize). These are REAL embeddings; the
 * suite self-skips the model-dependent assertions when the ONNX asset is not
 * present locally (e.g. an offline CI without a pre-seeded model cache), so it
 * never fails spuriously — but it runs fully wherever the model is available.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { EmbeddingService } from "../EmbeddingService.js";
import { EMBEDDING_CONFIG } from "../../config/index.js";

const svc = EmbeddingService.getInstance();

// The model lives on disk (env → cache); tests do NOT force a network download.
// If it's absent, model-dependent cases skip rather than fail.
let ready = false;
beforeAll(async () => {
  // Only attempt to load if the asset is already on disk — never download in tests.
  const fs = await import("fs");
  const path = await import("path");
  const onnx = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.onnxRelPath);
  const vocab = path.join(EMBEDDING_CONFIG.modelDir, EMBEDDING_CONFIG.vocabRelPath);
  if (fs.existsSync(onnx) && fs.existsSync(vocab)) {
    await svc.init();
    ready = svc.isReady();
  }
});

function cos(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

describe("EmbeddingService", () => {
  it("reports the model dimensionality", () => {
    expect(svc.dimensions).toBe(384);
  });

  it("produces unit-normalized vectors of the right dimension", async () => {
    if (!ready) return; // model asset unavailable — skip
    const [v] = await svc.embedBatch(["hello world"]);
    expect(v).toHaveLength(384);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it("is deterministic — identical text yields identical vectors", async () => {
    if (!ready) return;
    const [a] = await svc.embedBatch(["the quick brown fox"]);
    const [b] = await svc.embedBatch(["the quick brown fox"]);
    expect(cos(a, b)).toBeCloseTo(1, 5);
  });

  it("ranks semantically related text above unrelated text", async () => {
    if (!ready) return;
    const [q, near, far] = await svc.embedBatch([
      "The cat sat on the mat",
      "A feline rested on the rug",
      "Quarterly financial earnings report for shareholders",
    ]);
    expect(cos(q, near)).toBeGreaterThan(cos(q, far));
    expect(cos(q, near)).toBeGreaterThan(0.3);
  });

  it("batching matches single-item embedding (within quantization noise)", async () => {
    if (!ready) return;
    // Padding shorter sequences in a batch is attention-masked out, so batched
    // and single embeddings are essentially identical — but int8-quantized ONNX
    // inference is not bit-identical across differing tensor shapes, so allow a
    // small tolerance rather than exact equality.
    const texts = ["alpha beta", "gamma delta epsilon"];
    const batched = await svc.embedBatch(texts);
    const single0 = await svc.embed(texts[0]);
    expect(cos(batched[0], single0)).toBeGreaterThan(0.98);
  });

  it("handles empty input without throwing", async () => {
    if (!ready) return;
    const [v] = await svc.embedBatch([""]);
    expect(v).toHaveLength(384);
  });

  it("returns an empty array for an empty batch", async () => {
    if (!ready) return;
    expect(await svc.embedBatch([])).toEqual([]);
  });
});
