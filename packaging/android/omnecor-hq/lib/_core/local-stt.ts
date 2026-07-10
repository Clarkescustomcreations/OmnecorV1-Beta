/**
 * On-device speech-to-text via whisper.rn (whisper.cpp GGML).
 *
 * The always-listening voice loop transcribes the captured utterance ON THE
 * PHONE — only the resulting text leaves the device (sent to the PC persona).
 * This keeps raw audio local for privacy and works with no network.
 *
 * Models are GGML `.bin` files (e.g. ggml-base.en.bin) from
 * huggingface.co/ggerganov/whisper.cpp, downloaded through the existing
 * `model-download.ts` flow into the same /models directory as the LLM GGUFs.
 *
 * SETUP: `pnpm add whisper.rn` then `expo prebuild --platform android` to
 * compile the native module. Mirrors the llama.rn optional-peer pattern in
 * `local-inference.ts` so the app still type-checks before the dep is installed.
 */
import type { ModelInfo } from "./model-catalog";

// whisper.rn is an optional peer dependency — import lazily so the app compiles
// even before `pnpm add whisper.rn` has been run. Swap to a static import once
// the native module is installed.
let initWhisperFn: ((params: { filePath: string }) => Promise<any>) | null = null;

async function getWhisper() {
  if (!initWhisperFn) {
    try {
      const mod = await import("whisper.rn");
      initWhisperFn = mod.initWhisper;
    } catch {
      throw new Error(
        "whisper.rn not installed. Run: pnpm add whisper.rn && expo prebuild --platform android",
      );
    }
  }
  return initWhisperFn!;
}

/**
 * Whisper GGML models suitable for on-device transcription. Kept separate from
 * `RECOMMENDED_MODELS` (LLM GGUFs) because these are `.bin` STT models with a
 * different runtime. `english`-only quants are smaller/faster for an English
 * wake-word assistant; `base` multilingual is the accuracy fallback.
 */
export const WHISPER_MODELS: ModelInfo[] = [
  {
    name: "Whisper tiny.en (Q5)",
    filename: "ggml-tiny.en-q5_1.bin",
    sizeGb: 0.032,
    description: "Fastest on-device STT — English only, lowest latency",
    recommendedForPhone: true,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
  },
  {
    name: "Whisper base.en (Q5)",
    filename: "ggml-base.en-q5_1.bin",
    sizeGb: 0.057,
    description: "Better accuracy, still fast — English only (recommended)",
    recommendedForPhone: true,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin",
  },
  {
    name: "Whisper small.en (Q5)",
    filename: "ggml-small.en-q5_1.bin",
    sizeGb: 0.182,
    description: "Highest accuracy of the .en set — heavier, slower",
    recommendedForPhone: false,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin",
  },
];

export type SttStatus = "idle" | "loading" | "ready" | "transcribing" | "error";

let _ctx: any = null;
let _loadedPath: string | null = null;
let _status: SttStatus = "idle";
const _statusListeners = new Set<(s: SttStatus) => void>();

function setStatus(s: SttStatus) {
  _status = s;
  _statusListeners.forEach((fn) => fn(s));
}

export function subscribeSttStatus(fn: (s: SttStatus) => void) {
  _statusListeners.add(fn);
  return () => _statusListeners.delete(fn);
}

export function getSttStatus(): SttStatus { return _status; }
export function isSttModelLoaded(): boolean { return _ctx !== null; }
export function getLoadedSttPath(): string | null { return _loadedPath; }

/** Load a whisper GGML model from a local file path (idempotent per path). */
export async function loadSttModel(filePath: string): Promise<void> {
  if (_ctx && _loadedPath === filePath) return;
  setStatus("loading");
  try {
    const initWhisper = await getWhisper();
    if (_ctx) {
      try { await _ctx.release(); } catch { /* ignore */ }
      _ctx = null;
    }
    _ctx = await initWhisper({ filePath });
    _loadedPath = filePath;
    setStatus("ready");
  } catch (err) {
    _ctx = null;
    _loadedPath = null;
    setStatus("error");
    throw err;
  }
}

export async function releaseSttModel(): Promise<void> {
  if (_ctx) {
    try { await _ctx.release(); } catch { /* ignore */ }
    _ctx = null;
  }
  _loadedPath = null;
  setStatus("idle");
}

export interface TranscribeOptions {
  /** Whisper language code; "en" for the .en models. */
  language?: string;
}

/**
 * Transcribe an audio file already on disk (any source — expo-audio recording,
 * a voice-processor WAV dump, etc.). Returns the trimmed text, or "" if empty.
 * Throws if no model is loaded.
 */
export async function transcribeFile(
  audioUri: string,
  opts: TranscribeOptions = {},
): Promise<string> {
  if (!_ctx) throw new Error("No STT model loaded — download/select a Whisper model first");
  setStatus("transcribing");
  try {
    // whisper.rn returns { stop, promise }; promise resolves to { result }.
    const { promise } = _ctx.transcribe(audioUri, { language: opts.language ?? "en" });
    const { result } = await promise;
    return (result ?? "").trim();
  } finally {
    setStatus(_ctx ? "ready" : "idle");
  }
}
