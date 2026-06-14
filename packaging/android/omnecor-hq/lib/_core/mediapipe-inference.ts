/**
 * On-device LiteRT / MediaPipe LLM inference for Google AI Edge Gallery models
 * (`.task` / `.bin`).
 *
 * This is a SECOND engine alongside llama.rn (`local-inference.ts`):
 *   - llama.rn  → GGUF models
 *   - MediaPipe → LiteRT `.task` models (what Edge Gallery downloads)
 *
 * It wraps the native `LlmInferenceModule` (react-native-llm-mediapipe) directly
 * with an imperative API, mirroring the structure of `local-inference.ts`. The
 * native module is accessed lazily so the JS bundle still runs even if the
 * native library isn't present in a given build.
 *
 * Native API (see node_modules/react-native-llm-mediapipe/src/llmInference.ts):
 *   createModel(modelPath, maxTokens, topK, temperature, randomSeed) → handle
 *   generateResponse(handle, requestId, prompt) → string
 *   releaseModel(handle) → boolean
 *   events: onPartialResponse {handle,requestId,response}, onErrorResponse
 */
import { NativeModules, NativeEventEmitter } from "react-native";

export type MpStatus = "idle" | "loading" | "ready" | "running" | "error";

let _status: MpStatus = "idle";
const _listeners = new Set<(s: MpStatus) => void>();
function setStatus(s: MpStatus) { _status = s; _listeners.forEach((fn) => fn(s)); }
export function subscribeMpStatus(fn: (s: MpStatus) => void) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function getMpStatus(): MpStatus { return _status; }

let _handle: number | null = null;
let _modelPath: string | null = null;
let _emitter: NativeEventEmitter | null = null;
let _requestId = 0;

interface LlmNative {
  createModel: (modelPath: string, maxTokens: number, topK: number, temperature: number, randomSeed: number) => Promise<number>;
  releaseModel: (handle: number) => Promise<boolean>;
  generateResponse: (handle: number, requestId: number, prompt: string) => Promise<string>;
}

/** Lazily resolve the native module; throws a clear error if not built in. */
function getNative(): LlmNative {
  const mod = (NativeModules as Record<string, unknown>).LlmInferenceModule as LlmNative | undefined;
  if (!mod) {
    throw new Error(
      "MediaPipe engine not available in this build. Rebuild the APK with react-native-llm-mediapipe linked (expo prebuild + assembleDebug)."
    );
  }
  if (!_emitter) _emitter = new NativeEventEmitter(NativeModules.LlmInferenceModule);
  return mod;
}

/** True if the native MediaPipe module is present (engine usable). */
export function isMediapipeAvailable(): boolean {
  return !!(NativeModules as Record<string, unknown>).LlmInferenceModule;
}

export function isTaskModelLoaded(): boolean { return _handle !== null; }
export function getLoadedTaskPath(): string | null { return _modelPath; }

export interface MpLoadOptions {
  maxTokens?: number;
  topK?: number;
  temperature?: number;
  randomSeed?: number;
}

/** Load a local `.task`/.bin model by absolute path. */
export async function loadTaskModel(modelPath: string, opts: MpLoadOptions = {}): Promise<void> {
  setStatus("loading");
  try {
    const native = getNative();
    if (_handle !== null) {
      try { await native.releaseModel(_handle); } catch { /* ignore */ }
      _handle = null;
    }
    _handle = await native.createModel(
      modelPath,
      opts.maxTokens ?? 1024,
      opts.topK ?? 40,
      opts.temperature ?? 0.8,
      opts.randomSeed ?? 0,
    );
    _modelPath = modelPath;
    setStatus("ready");
  } catch (err) {
    _handle = null;
    _modelPath = null;
    setStatus("error");
    throw err;
  }
}

export async function releaseTaskModel(): Promise<void> {
  if (_handle !== null) {
    try { await getNative().releaseModel(_handle); } catch { /* ignore */ }
    _handle = null;
  }
  _modelPath = null;
  setStatus("idle");
}

/** Generate a response from the loaded `.task` model. Streams via onToken. */
export async function generateTask(
  prompt: string,
  onToken?: (partial: string) => void,
): Promise<string> {
  if (_handle === null) throw new Error("No .task model loaded");
  const native = getNative();
  setStatus("running");
  const requestId = _requestId++;
  let partialSub: { remove: () => void } | null = null;
  let errorSub: { remove: () => void } | null = null;
  if (_emitter) {
    partialSub = _emitter.addListener("onPartialResponse", (ev: { requestId: number; response: string }) => {
      if (ev.requestId === requestId && onToken) onToken(ev.response);
    });
    errorSub = _emitter.addListener("onErrorResponse", () => { /* surfaced via reject below */ });
  }
  try {
    const text = await native.generateResponse(_handle, requestId, prompt);
    setStatus("ready");
    return text ?? "";
  } catch (err) {
    setStatus("ready");
    throw err;
  } finally {
    partialSub?.remove();
    errorSub?.remove();
  }
}
