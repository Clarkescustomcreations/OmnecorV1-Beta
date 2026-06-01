import type * as OrtType from "onnxruntime-node";

export class ONNXEmbeddingService {
  private static instance: ONNXEmbeddingService | null = null;
  private session: OrtType.InferenceSession | null = null;
  private ort: typeof OrtType | null = null;

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
  }

  isModelLoaded(): boolean {
    return this.session !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.session || !this.ort) throw new Error("Model not loaded. Call loadModel() first.");
    // Simple whitespace tokenization — replace with a proper tokenizer for production accuracy
    const tokens = text.split(/\s+/).map((_, i) => i + 1).slice(0, 512);
    const inputIds = new this.ort.Tensor("int64", BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
    const results = await this.session.run({ input_ids: inputIds });
    const output = results[Object.keys(results)[0]];
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
