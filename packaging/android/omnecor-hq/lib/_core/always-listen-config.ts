/**
 * Persistent configuration for Always-Listening voice mode.
 *
 * All settings live in AsyncStorage with an in-memory cache for synchronous reads.
 * Removed Picovoice keys as we run 100% locally on the NPU/GPU via Whisper.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_ENABLED      = "omnecor_listen_enabled";
const KEY_PERSONA      = "omnecor_listen_persona";
const KEY_SPEAK        = "omnecor_listen_speak";
const KEY_SENSITIVITY  = "omnecor_listen_sensitivity";
const KEY_STT_MODEL    = "omnecor_listen_stt_model";
const KEY_WAKE_WORD    = "omnecor_listen_wake_word";

export interface AlwaysListenConfig {
  /** Master toggle — whether the wake-word service should run. */
  enabled: boolean;
  /** Persona that answers voice intents (agentMessenger personaId, a string). */
  personaId: string;
  /** Speak the agent reply aloud via expo-speech / streaming after each turn. */
  speakReplies: boolean;
  /** Voice trigger sensitivity, 0..1 (higher = more sensitive / lower energy threshold). */
  sensitivity: number;
  /** Filename of the downloaded Whisper GGML model used for on-device STT. */
  sttModelFilename: string;
  /** Wake word to listen for (defaults to "omnecor"). */
  wakeWord: string;
}

// In-memory cache so callers (the orchestrator/service) can read synchronously
// after the first loadListenConfig() call at startup.
let _cfg: AlwaysListenConfig = {
  enabled: false,
  personaId: "",
  speakReplies: true,
  sensitivity: 0.5,
  sttModelFilename: "",
  wakeWord: "omnecor",
};

export async function loadListenConfig(): Promise<void> {
  const [enabled, persona, speak, sens, model, wakeWord] = await AsyncStorage.multiGet([
    KEY_ENABLED, KEY_PERSONA, KEY_SPEAK, KEY_SENSITIVITY, KEY_STT_MODEL, KEY_WAKE_WORD,
  ]).then((pairs) => pairs.map(([, v]) => v));

  _cfg = {
    enabled: enabled === "true",
    personaId: persona ?? "",
    speakReplies: speak !== "false", // default on
    sensitivity: sens != null ? clamp01(parseFloat(sens)) : 0.5,
    sttModelFilename: model ?? "",
    wakeWord: wakeWord ?? "omnecor",
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function getListenConfig(): AlwaysListenConfig { return _cfg; }
export function isListenEnabled(): boolean { return _cfg.enabled; }
export function getListenPersonaId(): string { return _cfg.personaId; }

/** Persist a partial config update; only provided fields change. */
export async function saveListenConfig(
  patch: Partial<AlwaysListenConfig>,
): Promise<void> {
  _cfg = {
    ..._cfg,
    ...patch,
    sensitivity: patch.sensitivity != null ? clamp01(patch.sensitivity) : _cfg.sensitivity,
  };
  await AsyncStorage.multiSet([
    [KEY_ENABLED,     String(_cfg.enabled)],
    [KEY_PERSONA,     _cfg.personaId],
    [KEY_SPEAK,       String(_cfg.speakReplies)],
    [KEY_SENSITIVITY, String(_cfg.sensitivity)],
    [KEY_STT_MODEL,   _cfg.sttModelFilename],
    [KEY_WAKE_WORD,   _cfg.wakeWord],
  ]);
}
