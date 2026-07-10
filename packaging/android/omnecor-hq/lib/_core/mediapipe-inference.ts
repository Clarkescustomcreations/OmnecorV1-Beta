/**
 * On-device LLM inference via **LiteRT-LM** (`react-native-litert-lm`).
 *
 * LiteRT-LM is Google's maintained successor to the (now maintenance-only)
 * MediaPipe LLM Inference API. This is a SECOND engine alongside llama.rn
 * (`local-inference.ts`):
 *   - llama.rn   → GGUF models
 *   - LiteRT-LM  → `.litertlm` models (Gemma / Google AI Edge family)
 *
 * Acceleration: the app-wide mode (`acceleration.ts`) resolves to a delegate:
 * auto → GPU with CPU fallback; manual cpu/gpu/npu → that delegate, strict.
 * GPU/NPU loads pass `validate: true`, which runs a real test inference at
 * load time — Google's SDK can otherwise initialize a GPU/NPU engine that
 * silently produces no tokens. A validated load is the only "it really
 * accelerated" signal available from JS, so that's what `getTaskBackend()`
 * reports. LiteRT NPU needs NPU-compiled `.litertlm` builds (Edge Gallery
 * preview) — treat it as experimental.
 *
 * The engine is a Nitro HybridObject created lazily, so the JS bundle still
 * runs even when the native library isn't present in a given build.
 *
 * Model residency/persistence is owned by `phone-model.ts` — this module is a
 * pure engine wrapper.
 */
import { createLLM, type LiteRTLMInstance, type LLMConfig } from "react-native-litert-lm";
import type { AccelBackend, AccelMode } from "./acceleration";
import { getAccelMode } from "./acceleration";

export type MpStatus = "idle" | "loading" | "ready" | "running" | "error";
export type MpBackend = AccelBackend;

let _status: MpStatus = "idle";
const _listeners = new Set<(s: MpStatus) => void>();
function setStatus(s: MpStatus) { _status = s; _listeners.forEach((fn) => fn(s)); }
export function subscribeMpStatus(fn: (s: MpStatus) => void) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function getMpStatus(): MpStatus { return _status; }

let _llm: LiteRTLMInstance | null = null;
let _available: boolean | null = null;
let _modelPath: string | null = null;
let _loaded = false;

/**
 * Lazily create the Nitro LiteRT-LM engine. Returns null (and caches that)
 * when the native library isn't linked into the current build.
 */
function getEngine(): LiteRTLMInstance | null {
  if (_llm) return _llm;
  try {
    _llm = createLLM();
    _available = true;
    return _llm;
  } catch {
    _available = false;
    return null;
  }
}

/** True if the native LiteRT-LM engine is present (engine usable). */
export function isMediapipeAvailable(): boolean {
  if (_available !== null) return _available;
  return getEngine() !== null;
}

export function isTaskModelLoaded(): boolean { return _loaded; }
export function getLoadedTaskPath(): string | null { return _modelPath; }

let _backend: MpBackend | null = null;
/**
 * Delegate the current model loaded on (null when nothing loaded). GPU/NPU
 * values are load-validated (a real test inference produced tokens).
 */
export function getTaskBackend(): MpBackend | null { return _backend; }

export interface MpLoadOptions {
  maxTokens?: number;
  topK?: number;
  temperature?: number;
  /** Accepted for API compatibility; LiteRT-LM does not expose a seed. */
  randomSeed?: number;
  /** Override the app-wide acceleration mode for this load only. */
  mode?: AccelMode;
  /** Force one exact delegate (used internally for retries/reloads). */
  backend?: MpBackend;
}

/** Ordered delegate attempts for an acceleration mode (manual = strict). */
function attemptsForMode(mode: AccelMode): MpBackend[] {
  switch (mode) {
    case "cpu": return ["cpu"];
    case "gpu": return ["gpu"];
    case "npu": return ["npu"];
    case "auto": return ["gpu", "cpu"];
  }
}

/**
 * Load a local `.litertlm` model by absolute path (a remote URL also works).
 *
 * **Stability note (hard-won):** an earlier version looped `npu → gpu → cpu`,
 * calling `_llm.close()` and recreating the engine after each failed delegate.
 * On this native module that pattern **segfaults Hermes** (SIGSEGV, null write
 * on the JS thread): closing a Nitro HybridObject whose native `loadModel` just
 * failed frees resources a pending JSI promise still references (use-after-free).
 * So: we never close-and-recreate after a failed load. The auto chain retries
 * `loadModel` on the SAME engine object — the native side runs
 * `cleanupInternal()` after a failed load, so the engine is reusable; only a
 * *successfully* loaded engine is ever `close()`d (when switching models).
 */
export async function loadTaskModel(modelPath: string, opts: MpLoadOptions = {}): Promise<void> {
  // Switching models: release a *cleanly loaded* engine first so the new load
  // starts fresh. We only ever close an engine that loaded successfully —
  // closing one whose load failed is the use-after-free that crashes Hermes.
  if (_loaded && _llm) {
    try { _llm.close(); } catch { /* ignore */ }
    _llm = null;
    _loaded = false;
  }
  const engine = getEngine();
  if (!engine) {
    throw new Error(
      "LiteRT-LM engine not available in this build. Rebuild the APK with react-native-litert-lm linked (expo prebuild + assembleRelease)."
    );
  }
  setStatus("loading");
  // Expo's FileSystem.documentDirectory paths carry a file:// scheme; the
  // native engine opens the string as a POSIX path, so strip the scheme
  // (otherwise: "Model file not found: file:///data/user/0/…").
  const nativePath = modelPath.startsWith("file://")
    ? decodeURI(modelPath.slice("file://".length))
    : modelPath;

  const attempts = opts.backend
    ? [opts.backend]
    : attemptsForMode(opts.mode ?? (await getAccelMode()));
  let lastErr: unknown = null;

  for (const backend of attempts) {
    try {
      const config: LLMConfig = {
        backend,
        temperature: opts.temperature ?? 0.8,
        topK: opts.topK ?? 40,
        maxTokens: opts.maxTokens ?? 1024,
        // GPU/NPU can initialize but silently produce no tokens; validation
        // runs a real test inference at load time so a "loaded on gpu/npu"
        // claim is backed by observed output. No-op on CPU.
        validate: backend !== "cpu",
      };
      await engine.loadModel(nativePath, config);
      _modelPath = modelPath;
      _loaded = true;
      _backend = backend;
      setStatus("ready");
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  _modelPath = null;
  _loaded = false;
  _backend = null;
  setStatus("error");
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "LiteRT-LM load failed");
  throw new Error(
    attempts.length === 1 && attempts[0] !== "cpu"
      ? `Couldn't load on the ${attempts[0].toUpperCase()} delegate. ` +
        `LiteRT ${attempts[0].toUpperCase()} needs a compatible model build — switch Acceleration to Auto, or use a GGUF model for the NPU.\n\n(${detail})`
      : detail
  );
}

export async function releaseTaskModel(): Promise<void> {
  // Only a successfully loaded engine is closed (see stability note above);
  // an idle/failed engine object stays reusable for the next load.
  if (_llm && _loaded) {
    try { _llm.close(); } catch { /* ignore */ }
    _llm = null;
  }
  _loaded = false;
  _modelPath = null;
  _backend = null;
  setStatus("idle");
}

/**
 * Generate a response from the loaded model. When `onToken` is given, streams
 * the cumulative text as tokens arrive (matching the previous engine's
 * contract); otherwise runs a single blocking generation.
 */
export async function generateTask(
  prompt: string,
  onToken?: (partial: string) => void,
): Promise<string> {
  if (!getEngine() || !_loaded) throw new Error("No LiteRT-LM model loaded");
  setStatus("running");

  const run = async (): Promise<string> => {
    const llm = getEngine();
    if (!llm) throw new Error("LiteRT-LM engine unavailable");
    let full = "";
    if (onToken) {
      await llm.sendMessageAsync(prompt, (token: string, _done: boolean) => {
        full += token;
        onToken(full);
      });
    } else {
      full = await llm.sendMessage(prompt);
    }
    return full;
  };

  try {
    return await run();
  } catch (err) {
    // Android can evict the model (GPU memory reclaim while backgrounded)
    // leaving the JS `_loaded` flag stale — the native side then throws
    // "No model loaded". Reload the known model once and retry.
    const msg = err instanceof Error ? err.message : String(err);
    if (_modelPath && /no model loaded/i.test(msg)) {
      try {
        const path = _modelPath;
        _loaded = false;
        await loadTaskModel(path, _backend ? { backend: _backend } : {});
        setStatus("running");
        return await run();
      } catch (reloadErr) {
        setStatus("error");
        throw reloadErr;
      }
    }
    setStatus("ready");
    throw err;
  } finally {
    if (_status === "running") setStatus("ready");
  }
}
