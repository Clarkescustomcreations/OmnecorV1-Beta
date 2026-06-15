/**
 * Persistent configuration for Always-Listening voice mode.
 *
 * Mirrors `server-config.ts`: non-sensitive settings live in AsyncStorage with
 * an in-memory cache for synchronous reads; the Picovoice access key is a
 * credential and lives in the hardware KeyStore via SecureStore — never in
 * plaintext AsyncStorage (AGENTS.md mobile rule).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const KEY_ENABLED      = "omnecor_listen_enabled";
const KEY_PERSONA      = "omnecor_listen_persona";
const KEY_SPEAK        = "omnecor_listen_speak";
const KEY_SENSITIVITY  = "omnecor_listen_sensitivity";
const KEY_STT_MODEL    = "omnecor_listen_stt_model";
// Picovoice access key is a credential → KeyStore, not AsyncStorage.
const KEY_PV_ACCESS    = "omnecor_picovoice_key";

export interface AlwaysListenConfig {
  /** Master toggle — whether the wake-word service should run. */
  enabled: boolean;
  /** Persona that answers voice intents (agentMessenger personaId, a string). */
  personaId: string;
  /** Speak the agent reply aloud via expo-speech after each turn. */
  speakReplies: boolean;
  /** Porcupine wake-word sensitivity, 0..1 (higher = more sensitive). */
  sensitivity: number;
  /** Filename of the downloaded Whisper GGML model used for on-device STT. */
  sttModelFilename: string;
}

// In-memory cache so callers (the orchestrator/service) can read synchronously
// after the first loadListenConfig() call at startup.
let _cfg: AlwaysListenConfig = {
  enabled: false,
  personaId: "",
  speakReplies: true,
  sensitivity: 0.5,
  sttModelFilename: "",
};
let _accessKey = "";

export async function loadListenConfig(): Promise<void> {
  const [enabled, persona, speak, sens, model] = await AsyncStorage.multiGet([
    KEY_ENABLED, KEY_PERSONA, KEY_SPEAK, KEY_SENSITIVITY, KEY_STT_MODEL,
  ]).then((pairs) => pairs.map(([, v]) => v));

  _cfg = {
    enabled: enabled === "true",
    personaId: persona ?? "",
    speakReplies: speak !== "false", // default on
    sensitivity: sens != null ? clamp01(parseFloat(sens)) : 0.5,
    sttModelFilename: model ?? "",
  };

  try {
    _accessKey = (await SecureStore.getItemAsync(KEY_PV_ACCESS)) ?? "";
  } catch (e) {
    console.warn("[ListenConfig] SecureStore read failed:", e);
    _accessKey = "";
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function getListenConfig(): AlwaysListenConfig { return _cfg; }
export function isListenEnabled(): boolean { return _cfg.enabled; }
export function getListenPersonaId(): string { return _cfg.personaId; }
export function getPicovoiceAccessKey(): string { return _accessKey; }
export function hasPicovoiceAccessKey(): boolean { return _accessKey.length > 0; }

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
  ]);
}

/** Store (or clear, with "") the Picovoice access key in the KeyStore. */
export async function savePicovoiceAccessKey(key: string): Promise<void> {
  _accessKey = key.trim();
  try {
    if (_accessKey) await SecureStore.setItemAsync(KEY_PV_ACCESS, _accessKey);
    else await SecureStore.deleteItemAsync(KEY_PV_ACCESS);
  } catch (e) {
    console.warn("[ListenConfig] SecureStore key write failed:", e);
  }
}
