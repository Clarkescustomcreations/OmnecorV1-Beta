import { getTokenizer } from "@anthropic-ai/tokenizer";
import type * as OrtType from "onnxruntime-node";

type BPETokenizer = ReturnType<typeof getTokenizer>;

export class ONNXEmbeddingService {
  private static instance: ONNXEmbeddingService | null = null;
  private session: OrtType.InferenceSession | null = null;
  private ort: typeof OrtType | null = null;
  private tokenizer: BPETokenizer | null = null;

  static getInstance(): ONNXEmbeddingService {
    if (!ONNXEmbeddingService.instance) ONNXEmbeddingService.instance = new ONNXEmbeddingService();
    return ONNXEmbeddingService.instance;
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.ort) {
      try {
        this.ort = await import("onnxruntime-node") as typeof OrtType;
      } catch {
        throw new Error("onnxruntime-node not available. Run: pnpm approve-builds");
      }
    }
    this.session = await this.ort.InferenceSession.create(modelPath);
    if (!this.tokenizer) {
      this.tokenizer = getTokenizer();
    }
  }

  isModelLoaded(): boolean {
    return this.session !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.session || !this.ort || !this.tokenizer) throw new Error("Model not loaded. Call loadModel() first.");
    const encoded = this.tokenizer.encode(text.normalize("NFKC"), "all");
    const tokens = Array.from(encoded).slice(0, 512);
    if (tokens.length === 0) return [];
    const inputIds = new this.ort.Tensor("int64", BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
    const results = await this.session.run({ input_ids: inputIds });
    const output = results[Object.keys(results)[0]];
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
