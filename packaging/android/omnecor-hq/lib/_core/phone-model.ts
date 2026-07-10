/**
 * Phone-model lifecycle manager — the ONE owner of on-device model residency.
 *
 * Rules (agreed design, 2026-07-05):
 *   - **One resident model, ever**, across BOTH engines (llama.rn GGUF +
 *     LiteRT-LM). Loading a model unloads whatever else was resident — two
 *     multi-GB models must never coexist on a phone with ~3.4 GB free.
 *   - **Selection is the only lifecycle verb.** Picking a phone model in chat
 *     or AI Node loads it here; picking a remote model (Ollama/OMMESH/cloud)
 *     never touches phone residency. Settings only downloads/deletes/unloads.
 *   - **Status is observable and honest**: one subscribable snapshot with the
 *     engine, path, state and the backend that ACTUALLY engaged (from
 *     llama.rn's used-device list / LiteRT's validated delegate).
 *
 * The manager also owns persistence: the last successfully loaded model is
 * re-armed at app start (mesh worker phones must survive restarts without a
 * manual Settings tap), honoring the saved acceleration mode via the loaders.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AccelBackend } from "./acceleration";
import type { PhoneEngine } from "./model-catalog";
import {
  loadModel, releaseModel, getActiveBackend, getActiveDevices,
  subscribeStatus as subscribeGgufStatus, getStatus as getGgufStatus,
  getLoadedModelPath,
} from "./local-inference";
import {
  loadTaskModel, releaseTaskModel, getTaskBackend, isMediapipeAvailable,
  subscribeMpStatus, getMpStatus, getLoadedTaskPath,
} from "./mediapipe-inference";

const KEY_LAST_PHONE_MODEL = "omnecor_last_phone_model"; // "<engine>:<path>"
/** Pre-manager key (LiteRT-only auto-load) — migrated on first read. */
const LEGACY_KEY_LAST_TASK_MODEL = "omnecor_last_task_model";

export type PhoneModelState = "idle" | "loading" | "ready" | "running" | "error";

export interface PhoneModelStatus {
  engine: PhoneEngine | null;
  path: string | null;
  filename: string | null;
  state: PhoneModelState;
  /** Backend that actually engaged (never the request). Null until loaded. */
  backend: AccelBackend | null;
  /** ggml device names in use (GGUF only, e.g. ["HTP0"]). */
  devices: string[];
  /** Last load error message (state === "error"). */
  error: string | null;
}

let _current: PhoneModelStatus = {
  engine: null, path: null, filename: null,
  state: "idle", backend: null, devices: [], error: null,
};

const _listeners = new Set<(s: PhoneModelStatus) => void>();

function emit(next: Partial<PhoneModelStatus>) {
  _current = { ..._current, ...next };
  _listeners.forEach((fn) => fn(_current));
}

export function getPhoneModelStatus(): PhoneModelStatus { return _current; }

export function subscribePhoneModel(fn: (s: PhoneModelStatus) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// Engine status changes (running/ready during generation, background eviction
// reloads, direct engine calls) flow into the unified snapshot so subscribers
// see generation activity without polling.
subscribeGgufStatus((s) => {
  if (_current.engine === "gguf") {
    emit({ state: s, backend: getActiveBackend(), devices: getActiveDevices() });
  }
});
subscribeMpStatus((s) => {
  if (_current.engine === "litert") {
    emit({ state: s, backend: getTaskBackend() });
  }
});

/** Serialize load/unload — a tap-happy user must not race two native loads. */
let _op: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = _op.then(fn, fn);
  _op = run.catch(() => { /* keep the chain alive after failures */ });
  return run;
}

function filenameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Load a phone model, unloading whatever else is resident first (either
 * engine). No-op when the same path is already loaded and ready.
 */
export function loadPhoneModel(engine: PhoneEngine, path: string): Promise<void> {
  return serialize(async () => {
    if (_current.path === path && _current.engine === engine &&
        (_current.state === "ready" || _current.state === "running")) {
      return;
    }

    emit({
      engine, path, filename: filenameOf(path),
      state: "loading", backend: null, devices: [], error: null,
    });

    try {
      // One resident model across engines: evict the other engine first.
      if (engine === "gguf") {
        await releaseTaskModel().catch(() => { /* nothing loaded */ });
        await loadModel(path);
        emit({ state: "ready", backend: getActiveBackend(), devices: getActiveDevices() });
      } else {
        await releaseModel().catch(() => { /* nothing loaded */ });
        await loadTaskModel(path);
        emit({ state: "ready", backend: getTaskBackend(), devices: [] });
      }
      await AsyncStorage.setItem(KEY_LAST_PHONE_MODEL, `${engine}:${path}`)
        .catch(() => { /* best-effort */ });
    } catch (err) {
      emit({
        engine: null, path: null, filename: null,
        state: "error", backend: null, devices: [],
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
}

/** Ensure a model is resident (used by chat sends) — loads only if needed. */
export async function ensurePhoneModel(engine: PhoneEngine, path: string): Promise<void> {
  const loadedPath = engine === "gguf" ? getLoadedModelPath() : getLoadedTaskPath();
  if (loadedPath === path) return;
  await loadPhoneModel(engine, path);
}

/** Unload the resident model (both engines released) and forget auto-arm. */
export function unloadPhoneModel(): Promise<void> {
  return serialize(async () => {
    await releaseModel().catch(() => { /* ignore */ });
    await releaseTaskModel().catch(() => { /* ignore */ });
    await AsyncStorage.removeItem(KEY_LAST_PHONE_MODEL).catch(() => { /* best-effort */ });
    emit({
      engine: null, path: null, filename: null,
      state: "idle", backend: null, devices: [], error: null,
    });
  });
}

/**
 * Re-arm the model from the previous session at app startup. Failures are
 * silent — the user can always load from the chat model picker.
 */
export async function autoLoadLastPhoneModel(): Promise<boolean> {
  if (_current.state === "ready" || _current.state === "loading") return true;
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(KEY_LAST_PHONE_MODEL);
    if (!saved) {
      // Migrate the legacy LiteRT-only auto-load key.
      const legacy = await AsyncStorage.getItem(LEGACY_KEY_LAST_TASK_MODEL);
      if (legacy) {
        saved = `litert:${legacy}`;
        await AsyncStorage.setItem(KEY_LAST_PHONE_MODEL, saved).catch(() => { /* best-effort */ });
        await AsyncStorage.removeItem(LEGACY_KEY_LAST_TASK_MODEL).catch(() => { /* best-effort */ });
      }
    }
  } catch {
    return false;
  }
  if (!saved) return false;
  const sep = saved.indexOf(":");
  if (sep < 0) return false;
  const engine = saved.slice(0, sep) as PhoneEngine;
  const path = saved.slice(sep + 1);
  if (engine !== "gguf" && engine !== "litert") return false;
  if (engine === "litert" && !isMediapipeAvailable()) return false;
  try {
    await loadPhoneModel(engine, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kept in sync with the engines even when something bypasses the manager
 * (e.g. generateTask's eviction-reload) — recompute a truthful snapshot.
 */
export function refreshPhoneModelStatus(): PhoneModelStatus {
  const ggufPath = getLoadedModelPath();
  const litertPath = getLoadedTaskPath();
  if (ggufPath) {
    _current = {
      engine: "gguf", path: ggufPath, filename: filenameOf(ggufPath),
      state: getGgufStatus(), backend: getActiveBackend(),
      devices: getActiveDevices(), error: null,
    };
  } else if (litertPath) {
    _current = {
      engine: "litert", path: litertPath, filename: filenameOf(litertPath),
      state: getMpStatus(), backend: getTaskBackend(), devices: [], error: null,
    };
  }
  return _current;
}
