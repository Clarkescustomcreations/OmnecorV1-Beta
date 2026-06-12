/**
 * On-device LLM inference via llama.rn.
 *
 * The Samsung Galaxy S25 Ultra (Snapdragon 8 Elite) has a dedicated Hexagon NPU.
 * llama.rn uses the Vulkan / NNAPI backend on Android which routes work to the NPU/GPU,
 * enabling fast local inference without the PC.
 *
 * Typical performance on S25 Ultra:
 *   Qwen2.5-7B-Q4_K_M  ~20–35 tok/s
 *   Llama3.2-3B-Q4_K_M  ~55–80 tok/s
 *
 * SETUP: Run `pnpm add llama.rn` then `expo prebuild` to compile the native NDK module.
 * Requires Android NDK r26+ and CMake 3.22+ (install via Android Studio → SDK Tools).
 */

// llama.rn is an optional peer dependency — import lazily so the app still compiles
// even before the user installs it.  Replace the dynamic import with a static one once
// `pnpm add llama.rn` has been run.
let LlamaCtxClass: any = null;
let initLlamaFn: ((params: any) => Promise<any>) | null = null;

async function getLlama() {
  if (!initLlamaFn) {
    try {
      const mod = await import("llama.rn");
      initLlamaFn = mod.initLlama;
      LlamaCtxClass = mod.LlamaContext;
    } catch {
      throw new Error(
        "llama.rn not installed. Run: pnpm add llama.rn && expo prebuild --platform android"
      );
    }
  }
  return initLlamaFn!;
}

export interface ModelInfo {
  name: string;
  filename: string;
  sizeGb: number;
  description: string;
  recommendedForPhone: boolean;
}

export const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    name: "Qwen2.5-7B (Q4_K_M)",
    filename: "qwen2.5-7b-instruct-q4_k_m.gguf",
    sizeGb: 4.7,
    description: "Best quality/speed balance for S25 Ultra NPU",
    recommendedForPhone: true,
  },
  {
    name: "Llama-3.2-3B (Q4_K_M)",
    filename: "llama-3.2-3b-instruct-q4_k_m.gguf",
    sizeGb: 2.0,
    description: "Fast & compact — 55+ tok/s on Snapdragon 8 Elite",
    recommendedForPhone: true,
  },
  {
    name: "Mistral-7B (Q4_K_M)",
    filename: "mistral-7b-instruct-v0.3-q4_k_m.gguf",
    sizeGb: 4.4,
    description: "Strong instruction following",
    recommendedForPhone: false,
  },
  {
    name: "Llama-3.1-8B (Q4_K_M)",
    filename: "meta-llama-3.1-8b-instruct-q4_k_m.gguf",
    sizeGb: 4.9,
    description: "Meta's latest — good for OMMESH worker role",
    recommendedForPhone: false,
  },
];

let context: any = null;
let loadedModelPath: string | null = null;

export type InferenceStatus = "idle" | "loading" | "ready" | "running" | "error";
let _status: InferenceStatus = "idle";
const _statusListeners = new Set<(s: InferenceStatus) => void>();

function setStatus(s: InferenceStatus) {
  _status = s;
  _statusListeners.forEach((fn) => fn(s));
}

export function subscribeStatus(fn: (s: InferenceStatus) => void) {
  _statusListeners.add(fn);
  return () => _statusListeners.delete(fn);
}

export function getStatus(): InferenceStatus { return _status; }
export function getLoadedModelPath(): string | null { return loadedModelPath; }
export function isModelLoaded(): boolean { return context !== null; }

export async function loadModel(modelPath: string): Promise<void> {
  setStatus("loading");
  try {
    const initLlama = await getLlama();
    if (context) {
      await context.release();
      context = null;
    }
    context = await initLlama({
      model: modelPath,
      use_mlock: true,
      n_ctx: 4096,
      // Use all available GPU/NPU layers on Snapdragon 8 Elite
      n_gpu_layers: 99,
    });
    loadedModelPath = modelPath;
    setStatus("ready");
  } catch (err) {
    context = null;
    loadedModelPath = null;
    setStatus("error");
    throw err;
  }
}

export async function releaseModel(): Promise<void> {
  if (context) {
    await context.release();
    context = null;
  }
  loadedModelPath = null;
  setStatus("idle");
}

export interface InferenceOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  onToken?: (token: string) => void;
}

export async function runInference(
  prompt: string,
  opts: InferenceOptions = {}
): Promise<string> {
  if (!context) throw new Error("No model loaded");
  setStatus("running");
  try {
    const { text } = await context.completion(
      {
        prompt,
        n_predict: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.7,
        stop: opts.stopSequences ?? ["</s>", "<|endoftext|>", "\nUser:", "\nHuman:"],
      },
      (data: any) => {
        if (opts.onToken && data.token) opts.onToken(data.token);
      }
    );
    setStatus("ready");
    return text ?? "";
  } catch (err) {
    setStatus("ready");
    throw err;
  }
}

let _totalRequests = 0;
let _totalTokens = 0;

export function recordStats(tokens: number) {
  _totalRequests++;
  _totalTokens += tokens;
}

export function getStats() {
  return { totalRequests: _totalRequests, totalTokens: _totalTokens };
}
