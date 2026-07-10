import { getSetting } from "./SettingsService.js";

export interface LlamaCppGenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

// LLAMA_CPP_PORT configures the llama.cpp bridge server port (default: 8013)
const LLAMA_CPP_PORT = process.env.LLAMA_CPP_PORT ?? "8013";

export class LlamaCppService {
  private static instance: LlamaCppService | null = null;
  private readonly bridgeUrl = `http://127.0.0.1:${LLAMA_CPP_PORT}`;

  static getInstance(): LlamaCppService {
    if (!LlamaCppService.instance) LlamaCppService.instance = new LlamaCppService();
    return LlamaCppService.instance;
  }

  async isOnline(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.bridgeUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, modelPath: string, options?: LlamaCppGenerateOptions): Promise<string> {
    // Hardware/inference tuning from Settings → Model: cpuThreads sets the
    // worker count, inferenceTimeout (seconds) bounds the request.
    const cpuThreads = getSetting<number>("cpuThreads", 0);
    const timeoutMs = getSetting<number>("inferenceTimeout", 60) * 1000;
    const resp = await fetch(`${this.bridgeUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model_path: modelPath,
        max_tokens: options?.maxTokens ?? 256,
        temperature: options?.temperature ?? 0.7,
        ...(cpuThreads > 0 ? { n_threads: cpuThreads } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs > 0 ? timeoutMs : 60000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText })) as { detail: string };
      throw new Error(`llama.cpp bridge error: ${err.detail}`);
    }
    const data = await resp.json() as { text: string };
    return data.text;
  }

  async getEmbedding(text: string, modelPath: string): Promise<number[]> {
    const resp = await fetch(`${this.bridgeUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_path: modelPath }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText })) as { detail: string };
      throw new Error(`llama.cpp embedding error: ${err.detail}`);
    }
    const data = await resp.json() as { embedding: number[] };
    return data.embedding;
  }

  // Explicitly evict a model from the bridge's warm cache to free RAM before
  // loading the next chain step. Silent no-op if model is not loaded.
  async unload(modelPath: string): Promise<void> {
    try {
      await fetch(`${this.bridgeUrl}/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_path: modelPath }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Bridge offline or model not cached — not an error for chain execution
    }
  }

  // Pre-load a model into the bridge's warm cache so the first generation
  // request doesn't pay the load latency. Used by MoeChainService to pipeline
  // the next step's load while the current step is still generating.
  async preWarm(modelPath: string): Promise<void> {
    try {
      await fetch(`${this.bridgeUrl}/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_path: modelPath, embedding: false }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      // Non-fatal — generate() will load on-demand if this fails
    }
  }
}
