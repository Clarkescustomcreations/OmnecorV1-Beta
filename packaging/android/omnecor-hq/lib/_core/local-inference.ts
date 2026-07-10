/**
 * On-device GGUF LLM inference via llama.rn.
 *
 * NPU path (Snapdragon Hexagon HTP): llama.rn 0.12.4 exposes the ggml-hexagon
 * backend natively — `initLlama({ devices: ["HTP*"] })` expands the wildcard to
 * the real HTP device names via `getBackendDevicesInfo()` and pins the model to
 * the NPU. No patched native code is involved. Two constraints make or break
 * NPU offload:
 *   1. Weight format — ggml-hexagon executes Q4_0 / IQ4_NL / Q8_0 / MXFP4 only.
 *      K-quants (Q4_K_M) run per-op on CPU. `model-catalog.ts` owns that truth.
 *   2. Device presence — HTP devices only register on Qualcomm builds/hardware.
 *
 * The loader resolves the app-wide acceleration mode (`acceleration.ts`) into
 * an attempt chain (auto: npu→gpu→cpu; manual modes strict), and after a
 * successful load reports the backend that ACTUALLY engaged — derived from the
 * context's used-device list, never from what was requested.
 *
 * The model catalogs live in `model-catalog.ts`.
 */

import * as FileSystem from "expo-file-system/legacy";
import type { AccelBackend, AccelMode } from "./acceleration";
import { getAccelMode } from "./acceleration";
import { isNpuCapableFile, isNpuHardwarePresent } from "./model-catalog";

// llama.rn is imported lazily so the JS bundle still evaluates in a build
// where the native module is missing (older APK) — errors surface at load
// time with an actionable message instead of a bundle-eval crash.
let initLlamaFn: ((params: any) => Promise<any>) | null = null;

async function getLlama() {
  if (!initLlamaFn) {
    try {
      const mod = await import("llama.rn");
      initLlamaFn = mod.initLlama;
    } catch {
      throw new Error(
        "llama.rn not installed. Run: pnpm add llama.rn && expo prebuild --platform android"
      );
    }
  }
  return initLlamaFn!;
}

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

/** Backend the loaded model actually runs on (null when nothing is loaded). */
let _activeBackend: AccelBackend | null = null;
/** ggml device names the context is using (e.g. ["HTP0"], ["GPUOpenCL"]). */
let _activeDevices: string[] = [];

export function getActiveBackend(): AccelBackend | null { return _activeBackend; }
export function getActiveDevices(): string[] { return _activeDevices; }

export interface LoadModelOptions {
  /** KV-cache context window. Smaller = less RAM. Default 2048. */
  nCtx?: number;
  /** Override the app-wide acceleration mode for this load only. */
  mode?: AccelMode;
}

/**
 * Resolve an acceleration mode into the ordered backends to attempt.
 * Manual modes are strict (a clear failure beats a silent downgrade — that is
 * what makes NPU verification trustworthy); auto degrades gracefully.
 */
async function resolveAttempts(filename: string, mode: AccelMode): Promise<AccelBackend[]> {
  if (mode === "cpu") return ["cpu"];
  if (mode === "gpu") return ["gpu", "cpu"];
  if (mode === "npu") {
    if (!(await isNpuHardwarePresent())) {
      throw new Error(
        "NPU (Hexagon) isn't available on this device/build. Switch Acceleration to Auto in Settings."
      );
    }
    if (!isNpuCapableFile(filename)) {
      throw new Error(
        "This file's quantization can't execute on the NPU (needs Q4_0 / IQ4_NL / Q8_0 / MXFP4). " +
        "Download the NPU-ready variant in Settings → Phone AI Model, or switch Acceleration to Auto."
      );
    }
    return ["npu"];
  }
  // auto
  const attempts: AccelBackend[] = [];
  if (isNpuCapableFile(filename) && (await isNpuHardwarePresent())) attempts.push("npu");
  attempts.push("gpu", "cpu");
  return attempts;
}

/** llama.rn context params for one backend attempt. */
function paramsForBackend(backend: AccelBackend): Record<string, unknown> {
  switch (backend) {
    case "npu":
      // "HTP*" expands to every registered Hexagon device; weights are pinned
      // to the NPU (n_gpu_layers governs how many layers leave the CPU).
      return { n_gpu_layers: 99, devices: ["HTP*"] };
    case "gpu":
      return { n_gpu_layers: 99 };
    case "cpu":
      return { n_gpu_layers: 0 };
  }
}

/** Derive the backend that actually engaged from the live context. */
function detectActualBackend(ctx: any): { backend: AccelBackend; devices: string[] } {
  const devices: string[] = Array.isArray(ctx?.devices) ? ctx.devices : [];
  if (devices.some((d) => typeof d === "string" && d.startsWith("HTP"))) {
    return { backend: "npu", devices };
  }
  if (ctx?.gpu) return { backend: "gpu", devices };
  return { backend: "cpu", devices };
}

/**
 * Load a GGUF model.
 *
 * Hard-won on-device lessons (S25 Ultra, ~3.4 GB free RAM):
 *   - **No `use_mlock`.** Locking a multi-GB model into physical RAM fails when
 *     the model is larger than free RAM (Android's memlock rlimit is tiny), and
 *     aborts the whole load. Memory-mapped weights page in on demand instead.
 *   - **GPU/NPU offload isn't free.** Full offload asks the backend to allocate
 *     the whole model in device memory; with little headroom that fails fast
 *     with an opaque "unable to load model" — hence the attempt chain.
 */
export async function loadModel(modelPath: string, opts: LoadModelOptions = {}): Promise<void> {
  setStatus("loading");

  // Preflight: a missing or truncated file otherwise surfaces as llama.cpp's
  // opaque "unable to load model". Give an actionable message instead.
  const fileUri = modelPath.startsWith("file://") ? modelPath : "file://" + modelPath;
  try {
    const info = await FileSystem.getInfoAsync(fileUri, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
    const size = (info as { size?: number }).size ?? 0;
    if (!info.exists || info.isDirectory) {
      setStatus("error");
      throw new Error(`Model file not found — it may have failed to download. Re-download it and try again.`);
    }
    if (size < 50 * 1024 * 1024) {
      setStatus("error");
      throw new Error(`Model file is only ${(size / 1e6).toFixed(0)} MB — the download looks incomplete. Delete and re-download it.`);
    }
  } catch (err) {
    // A stat failure shouldn't block a load that might otherwise work; only
    // rethrow our own actionable errors.
    if (err instanceof Error && /Model file/.test(err.message)) throw err;
  }

  const initLlama = await getLlama();
  if (context) {
    try { await context.release(); } catch { /* ignore */ }
    context = null;
    _activeBackend = null;
    _activeDevices = [];
  }

  const filename = modelPath.split("/").pop() ?? modelPath;
  const mode = opts.mode ?? (await getAccelMode());
  let attempts: AccelBackend[];
  try {
    attempts = await resolveAttempts(filename, mode);
  } catch (err) {
    setStatus("error");
    throw err;
  }

  const nCtx = opts.nCtx ?? 2048;
  let lastErr: unknown = null;

  for (const backend of attempts) {
    try {
      const ctx = await initLlama({
        model: modelPath,
        // use_mlock intentionally omitted (false) — see doc comment above.
        n_ctx: nCtx,
        ...paramsForBackend(backend),
      });
      const actual = detectActualBackend(ctx);
      // A strict NPU request that silently landed elsewhere is a failure, not
      // a success — release and surface it (auto never requests npu blindly,
      // so in the auto chain this simply advances to the gpu attempt).
      if (backend === "npu" && actual.backend !== "npu") {
        try { await ctx.release(); } catch { /* ignore */ }
        lastErr = new Error(
          `NPU requested but the model initialized on ${actual.backend} (devices: ${actual.devices.join(", ") || "none"}).`
        );
        continue;
      }
      context = ctx;
      loadedModelPath = modelPath;
      _activeBackend = actual.backend;
      _activeDevices = actual.devices;
      setStatus("ready");
      return;
    } catch (err) {
      lastErr = err;
      context = null;
    }
  }

  loadedModelPath = null;
  _activeBackend = null;
  _activeDevices = [];
  setStatus("error");
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
  throw new Error(
    (mode === "npu"
      ? `Couldn't load this model on the NPU.`
      : `Couldn't load this model on your phone. Large models (7B ≈ 4.7 GB) may not fit in available RAM — ` +
        `close background apps, or pick a smaller model like Llama-3.2-3B (2 GB).`) +
    (detail ? `\n\n(${detail})` : "")
  );
}

export async function releaseModel(): Promise<void> {
  if (context) {
    await context.release();
    context = null;
  }
  loadedModelPath = null;
  _activeBackend = null;
  _activeDevices = [];
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
