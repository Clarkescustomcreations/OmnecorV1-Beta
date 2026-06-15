/**
 * Always-Listening voice orchestrator.
 *
 * The end-to-end loop:
 *   Porcupine wake word ("Hey Omnecor") → capture the utterance → on-device STT
 *   (whisper.rn) → send the text to the chosen PC persona via agentMessenger →
 *   speak the reply (expo-speech) + post a local notification + write an
 *   encrypted activation-audit entry.
 *
 * Design notes:
 *  - Audio CAPTURE is pluggable via `setCaptureProvider` so the same pipeline
 *    works with the in-app expo-audio recorder (foreground) and a background
 *    voice-processor/WAV dump (foreground service) without changing this module.
 *  - Porcupine owns the mic while listening; we stop it before capturing the
 *    utterance and restart it after, so there is only ever one mic owner.
 *  - All native deps (Porcupine, whisper.rn) are imported lazily, mirroring
 *    `local-inference.ts`, so the app type-checks before the deps are installed.
 *
 * Subscriber/status pattern mirrors `mobile-mesh-node.ts`.
 */
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpcMutate } from "./trpc-fetch";
import { isServerConfigured } from "./server-config";
import { transcribeFile, isSttModelLoaded, loadSttModel } from "./local-stt";
import { modelPath, isModelDownloaded } from "./model-download";
import {
  getListenConfig,
  getPicovoiceAccessKey,
  hasPicovoiceAccessKey,
} from "./always-listen-config";
import { encryptString, decryptString } from "./secure-crypto";

// ── Status ───────────────────────────────────────────────────────────────────

export type ListenState =
  | "off"          // service not running
  | "listening"    // armed, waiting for wake word
  | "capturing"    // wake detected, recording the utterance
  | "transcribing" // running on-device STT
  | "thinking"     // waiting for the PC persona reply
  | "speaking"     // reading the reply aloud
  | "error";

type StateListener = (s: ListenState) => void;
const stateListeners = new Set<StateListener>();
let _state: ListenState = "off";
let _lastError: string | null = null;

function setState(s: ListenState, err?: string) {
  _state = s;
  _lastError = err ?? (s === "error" ? _lastError : null);
  stateListeners.forEach((fn) => fn(s));
}

export function subscribeListenState(fn: StateListener): () => void {
  stateListeners.add(fn);
  return () => { stateListeners.delete(fn); };
}
export function getListenState(): ListenState { return _state; }
export function getListenError(): string | null { return _lastError; }

// ── Capture provider (pluggable mic source) ──────────────────────────────────

/** Records one utterance and returns its audio file URI (or null on failure). */
export type CaptureProvider = () => Promise<string | null>;

let _capture: CaptureProvider | null = null;

/** Register how utterance audio is captured (expo-audio hook, voice-processor…). */
export function setCaptureProvider(fn: CaptureProvider | null) {
  _capture = fn;
}

// ── Activation audit (encrypted ring buffer) ─────────────────────────────────

const AUDIT_KEY = "omnecor_listen_audit";
const AUDIT_MAX = 50;

export interface ActivationRecord {
  at: string;          // ISO-8601
  transcript: string;
  personaId: string;
  reply: string;
  ms: number;          // round-trip latency
  ok: boolean;
  error?: string;
}

async function appendAudit(rec: ActivationRecord): Promise<void> {
  try {
    const existing = await getAuditLog();
    const next = [rec, ...existing].slice(0, AUDIT_MAX);
    const enc = await encryptString(JSON.stringify(next));
    await AsyncStorage.setItem(AUDIT_KEY, enc);
  } catch (e) {
    console.warn("[AlwaysListen] audit write failed:", e);
  }
}

export async function getAuditLog(): Promise<ActivationRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(AUDIT_KEY);
    if (!raw) return [];
    const json = await decryptString(raw);
    if (!json) return [];
    return JSON.parse(json) as ActivationRecord[];
  } catch {
    return [];
  }
}

export async function clearAuditLog(): Promise<void> {
  await AsyncStorage.removeItem(AUDIT_KEY);
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function notify(title: string, body: string): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // deliver immediately
    });
  } catch (e) {
    console.warn("[AlwaysListen] notify failed:", e);
  }
}

// ── One voice turn ────────────────────────────────────────────────────────────

/**
 * Run a single capture→STT→persona→speak turn against an already-captured audio
 * file. Exposed directly so Phase-1 in-app testing can drive it from a button
 * before the wake word is wired. Returns the agent reply text (or "").
 */
export async function runVoiceTurn(audioUri: string): Promise<string> {
  const cfg = getListenConfig();
  const started = Date.now();

  if (!isServerConfigured()) {
    setState("error", "No server configured");
    return "";
  }
  if (!cfg.personaId) {
    setState("error", "No voice persona selected");
    return "";
  }
  if (!isSttModelLoaded()) {
    setState("error", "On-device STT model not loaded");
    return "";
  }

  let transcript = "";
  try {
    setState("transcribing");
    transcript = await transcribeFile(audioUri, { language: "en" });
    if (!transcript) {
      setState("listening");
      return ""; // nothing heard — quietly resume
    }

    setState("thinking");
    const res = await trpcMutate<{ reply: { content: string } }>(
      "agentMessenger.send",
      { personaId: cfg.personaId, content: transcript },
    );
    const reply = (res?.reply?.content ?? "").trim();

    if (reply && cfg.speakReplies) {
      setState("speaking");
      await speakAndWait(reply);
    }

    await notify("Omnecor", reply || transcript);
    await appendAudit({
      at: new Date().toISOString(),
      transcript,
      personaId: cfg.personaId,
      reply,
      ms: Date.now() - started,
      ok: true,
    });
    setState(_running ? "listening" : "off");
    return reply;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState("error", msg);
    await appendAudit({
      at: new Date().toISOString(),
      transcript,
      personaId: cfg.personaId,
      reply: "",
      ms: Date.now() - started,
      ok: false,
      error: msg,
    });
    return "";
  }
}

function speakAndWait(text: string): Promise<void> {
  // Strip markdown for cleaner reading (same cleanup as use-voice.ts).
  const clean = text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .slice(0, 2000);
  return new Promise<void>((resolve) => {
    Speech.speak(clean, {
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

// ── Wake-word service (Porcupine) ─────────────────────────────────────────────

let _porcupine: any = null;
let _running = false;

async function getPorcupine() {
  try {
    return await import("@picovoice/porcupine-react-native");
  } catch {
    throw new Error(
      "@picovoice/porcupine-react-native not installed. Run: pnpm add @picovoice/porcupine-react-native @picovoice/react-native-voice-processor && expo prebuild --platform android",
    );
  }
}

/**
 * Ensure the configured on-device Whisper model is downloaded and loaded into
 * whisper.rn before a turn runs. Throws a clear message if it isn't available.
 */
export async function ensureSttModelLoaded(): Promise<void> {
  if (isSttModelLoaded()) return;
  const filename = getListenConfig().sttModelFilename;
  if (!filename) throw new Error("No on-device STT model selected (Settings → Always Listening)");
  if (!(await isModelDownloaded(filename))) {
    throw new Error("On-device STT model not downloaded yet");
  }
  await loadSttModel(modelPath(filename));
}

/** Path to the bundled custom "Hey Omnecor" keyword, or null to use a built-in. */
let _keywordPath: string | null = null;
export function setKeywordPath(path: string | null) { _keywordPath = path; }

/** Pause the wake engine so it releases the mic before we record an utterance. */
async function pauseWake(): Promise<void> {
  if (_porcupine) { try { await _porcupine.stop(); } catch { /* ignore */ } }
}

/** Re-arm the wake engine after a capture, only if the service is still running. */
async function resumeWake(): Promise<void> {
  if (_running && _porcupine) {
    try { await _porcupine.start(); } catch (e) {
      setState("error", e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * Capture one utterance and run it through the pipeline, coordinating mic
 * ownership: the wake engine (Porcupine voice-processor) and the recorder can't
 * hold the mic at once, so we pause the wake engine first and re-arm after.
 * Used by BOTH the wake-word callback and the manual "Test" button, so neither
 * can collide with the other.
 */
export async function captureAndRun(): Promise<void> {
  if (!_capture) {
    setState("error", "No capture provider registered");
    return;
  }
  try {
    await pauseWake();
    setState("capturing");
    const uri = await _capture();
    if (uri) await runVoiceTurn(uri);     // sets its own terminal state
    else setState(_running ? "listening" : "off");
  } catch (err) {
    setState("error", err instanceof Error ? err.message : String(err));
  } finally {
    await resumeWake();
  }
}

/**
 * Start always-listening: initialise Porcupine and begin waiting for the wake
 * word. Requires a Picovoice access key and a registered capture provider.
 */
export async function startListening(): Promise<void> {
  if (_running) return;
  if (!hasPicovoiceAccessKey()) {
    setState("error", "Picovoice access key not set");
    throw new Error("Picovoice access key not set");
  }
  if (!_capture) {
    setState("error", "No capture provider registered");
    throw new Error("No capture provider registered");
  }

  // Load the on-device STT model up front so the first turn isn't delayed (and
  // so a missing model fails loudly here, not mid-conversation).
  await ensureSttModelLoaded();

  // Best-effort: ensure the OS will actually deliver our reply notifications
  // (Android 13+ gates POST_NOTIFICATIONS behind a runtime grant).
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.requestPermissionsAsync();
  } catch (e) {
    console.warn("[AlwaysListen] notification permission request failed:", e);
  }

  const { PorcupineManager, BuiltInKeywords } = await getPorcupine();
  const accessKey = getPicovoiceAccessKey();
  const sensitivity = getListenConfig().sensitivity;

  const detectionCb = () => { void captureAndRun(); };
  const errorCb = (e: any) => setState("error", String(e?.message ?? e));

  // Signature: (accessKey, keywords, detectionCb, errorCb, modelPath?, device?, sensitivities?)
  if (_keywordPath) {
    _porcupine = await PorcupineManager.fromKeywordPaths(
      accessKey,
      [_keywordPath],
      detectionCb,
      errorCb,
      undefined, // modelPath (default)
      undefined, // device (auto)
      [sensitivity],
    );
  } else {
    // Built-in fallback until the custom "Hey Omnecor" .ppn is bundled.
    _porcupine = await PorcupineManager.fromBuiltInKeywords(
      accessKey,
      [BuiltInKeywords.COMPUTER],
      detectionCb,
      errorCb,
      undefined, // modelPath (default)
      undefined, // device (auto)
      [sensitivity],
    );
  }

  await _porcupine.start();
  _running = true;
  setState("listening");
}

/** Stop always-listening and release the wake engine + mic. */
export async function stopListening(): Promise<void> {
  _running = false;
  if (_porcupine) {
    try { await _porcupine.stop(); } catch { /* ignore */ }
    try { _porcupine.delete(); } catch { /* ignore */ }
    _porcupine = null;
  }
  Speech.stop();
  setState("off");
}

export function isListening(): boolean { return _running; }
