/**
 * App-wide acceleration preference for on-device inference — one setting that
 * both engines (llama.rn GGUF + LiteRT-LM) obey.
 *
 *  - "auto" (default): NPU when the loaded file is NPU-capable and Hexagon
 *    hardware is present, else GPU, with CPU fallback. The chain is resolved
 *    per-load by the engine loaders, and the backend that *actually* engaged is
 *    reported back through the phone-model status store — never assumed.
 *  - "cpu" / "gpu" / "npu": manual override (Settings → advanced). Manual modes
 *    are strict: if the requested backend can't run the model, the load fails
 *    with a clear error instead of silently running somewhere else — that
 *    honesty is what makes NPU verification possible at all.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AccelMode = "auto" | "cpu" | "gpu" | "npu";
/** A concrete backend a model actually runs on (no "auto" here). */
export type AccelBackend = "cpu" | "gpu" | "npu";

const KEY_ACCEL_MODE = "omnecor_accel_mode";
/** Pre-acceleration key (LiteRT-only backend pref) — migrated on first read. */
const LEGACY_KEY_LITERT_BACKEND = "omnecor_litert_backend";

let _cached: AccelMode | null = null;

function isMode(v: unknown): v is AccelMode {
  return v === "auto" || v === "cpu" || v === "gpu" || v === "npu";
}

/** Current acceleration mode (cached after first read; defaults to "auto"). */
export async function getAccelMode(): Promise<AccelMode> {
  if (_cached) return _cached;
  try {
    const v = await AsyncStorage.getItem(KEY_ACCEL_MODE);
    if (isMode(v)) {
      _cached = v;
      return _cached;
    }
    // One-time migration: an explicit legacy LiteRT backend choice carries over
    // (it was only ever written on a user tap, so it reflects intent).
    const legacy = await AsyncStorage.getItem(LEGACY_KEY_LITERT_BACKEND);
    if (isMode(legacy)) {
      _cached = legacy;
      await AsyncStorage.setItem(KEY_ACCEL_MODE, legacy).catch(() => { /* best-effort */ });
      await AsyncStorage.removeItem(LEGACY_KEY_LITERT_BACKEND).catch(() => { /* best-effort */ });
      return _cached;
    }
    _cached = "auto";
  } catch {
    _cached = "auto";
  }
  return _cached;
}

export async function setAccelMode(mode: AccelMode): Promise<void> {
  _cached = mode;
  try { await AsyncStorage.setItem(KEY_ACCEL_MODE, mode); } catch { /* best-effort */ }
}
