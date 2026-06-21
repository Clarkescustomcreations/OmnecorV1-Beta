/**
 * On-device LLM inference via **LiteRT-LM** (`react-native-litert-lm`).
 *
 * LiteRT-LM is Google's maintained successor to the (now maintenance-only)
 * MediaPipe LLM Inference API. This is a SECOND engine alongside llama.rn
 * (`local-inference.ts`):
 *   - llama.rn   → GGUF models
 *   - LiteRT-LM  → `.litertlm` models (Gemma / Google AI Edge family)
 *
 * The engine is a Nitro HybridObject created lazily, so the JS bundle still
 * runs even when the native library isn't present in a given build (e.g. an
 * older APK). The exported API is kept identical to the previous MediaPipe
 * wrapper so callers (`settings.tsx`) need no structural change — only the
 * underlying engine and the model format (`.task` → `.litertlm`) changed.
 *
 * Installed API (react-native-litert-lm@0.4.x):
 *   createLLM() → instance
 *   instance.loadModel(pathOrUrl, config) → Promise<void>
 *   instance.sendMessage(prompt) → Promise<string>            (blocking)
 *   instance.sendMessageAsync(prompt, (token, done) => void)  (streaming)
 *   instance.close()
 */
import { createLLM, type LiteRTLMInstance, type LLMConfig } from "react-native-litert-lm";

export type MpStatus = "idle" | "loading" | "ready" | "running" | "error";

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

export interface MpLoadOptions {
  maxTokens?: number;
  topK?: number;
  temperature?: number;
  /** Accepted for API compatibility; LiteRT-LM does not expose a seed. */
  randomSeed?: number;
}

/** Load a local `.litertlm` model by absolute path (a remote URL also works). */
export async function loadTaskModel(modelPath: string, opts: MpLoadOptions = {}): Promise<void> {
  const llm = getEngine();
  if (!llm) {
    throw new Error(
      "LiteRT-LM engine not available in this build. Rebuild the APK with react-native-litert-lm linked (expo prebuild + assembleRelease)."
    );
  }
  setStatus("loading");
  try {
    if (_loaded) { try { llm.close(); } catch { /* ignore */ } _loaded = false; }
    const config: LLMConfig = {
      backend: "cpu", // safe default — always available; GPU/NPU may fail per device/model
      temperature: opts.temperature ?? 0.8,
      topK: opts.topK ?? 40,
      maxTokens: opts.maxTokens ?? 1024,
    };
    await llm.loadModel(modelPath, config);
    _modelPath = modelPath;
    _loaded = true;
    setStatus("ready");
  } catch (err) {
    _modelPath = null;
    _loaded = false;
    setStatus("error");
    throw err;
  }
}

export async function releaseTaskModel(): Promise<void> {
  if (_llm && _loaded) { try { _llm.close(); } catch { /* ignore */ } }
  _loaded = false;
  _modelPath = null;
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
  const llm = getEngine();
  if (!llm || !_loaded) throw new Error("No LiteRT-LM model loaded");
  setStatus("running");
  try {
    let full = "";
    if (onToken) {
      await llm.sendMessageAsync(prompt, (token: string, _done: boolean) => {
        full += token;
        onToken(full);
      });
    } else {
      full = await llm.sendMessage(prompt);
    }
    setStatus("ready");
    return full;
  } catch (err) {
    setStatus("ready");
    throw err;
  }
}
