/**
 * Always-Listening voice orchestrator (Hybrid Architecture).
 *
 * Implements local wake-word trigger (Whisper NPU loop) and plays back
 * real-time streamed TTS audio chunks from the PC over OMMESH/Tailscale WebSocket.
 *
 * Flow:
 *   1. Android app-wide loop captures 2.0s audio segments locally.
 *   2. Transcribes locally via whisper.rn (GGML on NPU).
 *   3. If "Hey Omnecor" / "Computer" matches, vibrates and triggers utterance capture.
 *   4. Transcribes the full user question locally, then streams text to the PC over WS.
 *   5. PC generates LLM response and streams TTS WAV audio chunks back via WS.
 *   6. expo-audio plays chunks sequentially. Supports instant interruption.
 */
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isServerConfigured } from "./server-config";
import { transcribeFile, isSttModelLoaded, loadSttModel } from "./local-stt";
import { modelPath, isModelDownloaded } from "./model-download";
import { getListenConfig } from "./always-listen-config";
import { encryptString, decryptString } from "./secure-crypto";
import { sendWsMessage, subscribeChannel } from "./ws-channels";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import {
  startMicForegroundService,
  stopMicForegroundService,
  isMicForegroundServiceAvailable,
} from "../../modules/mic-foreground-service";

// ── Status ───────────────────────────────────────────────────────────────────

export type ListenState =
  | "off"          // service not running
  | "listening"    // armed, waiting for wake word
  | "capturing"    // wake detected, recording the utterance
  | "transcribing" // running on-device STT
  | "thinking"     // waiting for the PC response stream
  | "speaking"     // playing back the streamed response chunks
  | "error";

type StateListener = (s: ListenState) => void;
const stateListeners = new Set<StateListener>();
let _state: ListenState = "off";
let _lastError: string | null = null;
let _running = false;

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

export type CaptureProvider = () => Promise<string | null>;
let _capture: CaptureProvider | null = null;

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

// ── Audio Streaming Queue ─────────────────────────────────────────────────────

let audioQueue: string[] = [];
let activePlayer: any = null;
let activeSubscription: any = null;
let streamUnsubscribe: (() => void) | null = null;
let activeJobId: string | null = null;
let voiceTurnStartTime = 0;
let lastTranscript = "";

async function playNextInQueue() {
  if (activePlayer && _state === "speaking") {
    return; // Already playing, wait for finish handler
  }
  if (audioQueue.length === 0) {
    if (_state === "speaking") {
      // Finished all chunks, wrap up the turn
      finishVoiceTurn();
    }
    return;
  }

  const nextPath = audioQueue.shift();
  if (!nextPath) return;

  setState("speaking");
  try {
    const { createAudioPlayer } = await import("expo-audio");
    activePlayer = createAudioPlayer(nextPath);
    activeSubscription = activePlayer.addListener("playbackStatusUpdate", (status: any) => {
      if (status.didJustFinish) {
        cleanupActivePlayer();
        void playNextInQueue();
      }
    });
    activePlayer.play();
  } catch (err) {
    console.warn("[AlwaysListen] Failed to play audio chunk:", err);
    cleanupActivePlayer();
    void playNextInQueue();
  }
}

function cleanupActivePlayer() {
  if (activeSubscription) {
    activeSubscription.remove();
    activeSubscription = null;
  }
  if (activePlayer) {
    try { activePlayer.stop(); } catch {}
    try { activePlayer.release(); } catch {}
    activePlayer = null;
  }
}

export function stopAudioPlayback() {
  cleanupActivePlayer();
  audioQueue = [];
}

function finishVoiceTurn() {
  stopAudioPlayback();
  if (streamUnsubscribe) {
    streamUnsubscribe();
    streamUnsubscribe = null;
  }
  void appendAudit({
    at: new Date().toISOString(),
    transcript: lastTranscript,
    personaId: getListenConfig().personaId,
    reply: "[Streamed audio reply]",
    ms: Date.now() - voiceTurnStartTime,
    ok: true,
  });
  activeJobId = null;
  setState(_running ? "listening" : "off");
}

// ── Interruption ──────────────────────────────────────────────────────────────

export function interruptConversation() {
  if (activeJobId) {
    sendWsMessage({
      type: "voice:interrupt",
      data: { jobId: activeJobId },
    });
  }
  stopAudioPlayback();
  if (streamUnsubscribe) {
    streamUnsubscribe();
    streamUnsubscribe = null;
  }
  activeJobId = null;
  setState(_running ? "listening" : "off");
}

// ── One Voice Turn ────────────────────────────────────────────────────────────

export async function runVoiceTurn(audioUri: string): Promise<string> {
  const cfg = getListenConfig();
  voiceTurnStartTime = Date.now();

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

  try {
    setState("transcribing");
    const transcript = await transcribeFile(audioUri, { language: "en" });
    lastTranscript = transcript;
    if (!transcript) {
      setState("listening");
      return ""; // nothing heard — resume wake word
    }

    setState("thinking");

    // Initiate real-time streaming voice turn
    const jobId = Math.random().toString(36).slice(2) + "-" + Date.now();
    activeJobId = jobId;
    stopAudioPlayback();

    // Subscribe to chunk stream channel for this turn
    streamUnsubscribe = subscribeChannel(`voice:stream:${jobId}`, (data: any, type: string) => {
      if (type === "voice:audio_chunk" && data) {
        const { chunk, index } = data;
        const tempPath = `${FileSystem.cacheDirectory}voice_${jobId}_${index}.wav`;
        FileSystem.writeAsStringAsync(tempPath, chunk, {
          encoding: FileSystem.EncodingType.Base64,
        })
          .then(() => {
            audioQueue.push(tempPath);
            void playNextInQueue();
          })
          .catch((err) => console.warn("[AlwaysListen] Failed to write base64 chunk:", err));
      } else if (type === "voice:done") {
        // PC finished generating all chunks
      }
    });

    // Send input request to PC WebSocket
    sendWsMessage({
      type: "voice:audio_input",
      data: {
        personaId: cfg.personaId,
        text: transcript,
        jobId,
      },
    });

    // Fallback timeout: if no audio chunk arrives within 8 seconds, speak fallback warning locally
    setTimeout(() => {
      if (activeJobId === jobId && audioQueue.length === 0 && _state === "thinking") {
        console.log("[AlwaysListen] Fallback: No stream from PC, triggering native TTS");
        interruptConversation();
        Speech.speak("Cannot reach the PC server. Falling back to local offline mode.");
        setState("listening");
      }
    }, 8000);

    return "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState("error", msg);
    void appendAudit({
      at: new Date().toISOString(),
      transcript: lastTranscript,
      personaId: cfg.personaId,
      reply: "",
      ms: Date.now() - voiceTurnStartTime,
      ok: false,
      error: msg,
    });
    return "";
  }
}

// ── Wake-word service ─────────────────────────────────────────────────────────

export async function ensureSttModelLoaded(): Promise<void> {
  if (isSttModelLoaded()) return;
  const filename = getListenConfig().sttModelFilename;
  if (!filename) throw new Error("No on-device STT model selected (Settings → Always Listening)");
  if (!(await isModelDownloaded(filename))) {
    throw new Error("On-device STT model not downloaded yet");
  }
  await loadSttModel(modelPath(filename));
}

export async function captureAndRun(): Promise<void> {
  if (!_capture) {
    setState("error", "No capture provider registered");
    return;
  }
  try {
    setState("capturing");
    // Play quick success haptic pulse for recognition
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const uri = await _capture();
    if (uri) {
      await runVoiceTurn(uri);
    } else {
      setState(_running ? "listening" : "off");
    }
  } catch (err) {
    setState("error", err instanceof Error ? err.message : String(err));
  }
}

export async function startListening(): Promise<void> {
  if (_running) return;
  if (!_capture) {
    setState("error", "No capture provider registered");
    throw new Error("No capture provider registered");
  }

  await ensureSttModelLoaded();

  try {
    const Notifications = await import("expo-notifications");
    await Notifications.requestPermissionsAsync();
  } catch (e) {
    console.warn("[AlwaysListen] notification permission request failed:", e);
  }

  if (isMicForegroundServiceAvailable()) {
    try {
      startMicForegroundService("Omnecor is listening", 'Speak to trigger your persona.');
    } catch (e) {
      console.warn("[AlwaysListen] failed to start foreground service:", e);
    }
  }

  _running = true;
  setState("listening");
}

export async function stopListening(): Promise<void> {
  _running = false;
  if (isMicForegroundServiceAvailable()) {
    try { stopMicForegroundService(); } catch (e) { console.warn("[AlwaysListen] failed to stop foreground service:", e); }
  }
  stopAudioPlayback();
  if (streamUnsubscribe) {
    streamUnsubscribe();
    streamUnsubscribe = null;
  }
  Speech.stop();
  setState("off");
}

export function isListening(): boolean { return _running; }
