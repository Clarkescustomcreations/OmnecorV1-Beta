/**
 * On-device GGUF model downloads.
 *
 * Lets the user pull a model directly to the phone (Settings → Phone AI Model)
 * instead of manually copying a .gguf file over USB. Files land in the app's
 * document directory under /models and are fed straight to llama.rn's loadModel.
 *
 * Uses expo-file-system's resumable download (legacy API path on SDK 54) so we
 * get real byte-progress and can cancel.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ModelInfo } from "./model-catalog";

export const MODELS_DIR = FileSystem.documentDirectory + "models/";

export function modelPath(filename: string): string {
  return MODELS_DIR + filename;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

export interface DownloadedModel {
  filename: string;
  path: string;
  sizeBytes: number;
}

export async function isModelDownloaded(filename: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelPath(filename));
  return info.exists && !info.isDirectory;
}

export type ModelFileState = "missing" | "partial" | "complete";

/**
 * Classify a catalog model's on-disk file by comparing its actual size to the
 * expected size (same tolerance as the download completeness gate below).
 *
 * This exists because `isModelDownloaded` only checks *existence*: an
 * interrupted download (app backgrounded mid-transfer, network drop) leaves a
 * truncated file that then masquerades as "✓ Downloaded" and fails to load with
 * an opaque llama.cpp error. `"partial"` lets the UI show "Incomplete —
 * re-download" instead of offering a Load that can't succeed.
 */
export async function getModelFileState(model: ModelInfo): Promise<ModelFileState> {
  const info = await FileSystem.getInfoAsync(modelPath(model.filename), { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  if (!info.exists || info.isDirectory) return "missing";
  const size = (info as { size?: number }).size ?? 0;
  const expected = model.sizeGb * 1024 * 1024 * 1024;
  // `sizeGb` is a decimal-GB label but expected is computed in GiB, so a
  // complete file lands around 90–95% of `expected`; 0.9 matches the download
  // gate and reliably separates a full file from a truncated one.
  if (expected > 0 && size < expected * 0.9) return "partial";
  return "complete";
}

export async function getDownloadedModel(filename: string): Promise<DownloadedModel | null> {
  const path = modelPath(filename);
  const info = await FileSystem.getInfoAsync(path, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  if (!info.exists || info.isDirectory) return null;
  return { filename, path, sizeBytes: (info as { size?: number }).size ?? 0 };
}

export async function deleteModel(filename: string): Promise<void> {
  await FileSystem.deleteAsync(modelPath(filename), { idempotent: true });
}

export type ProgressCb = (fraction: number, writtenBytes: number, totalBytes: number) => void;

// Track active downloads so they can be cancelled.
const _active = new Map<string, FileSystem.DownloadResumable>();

/**
 * Download a model to the phone. Returns the local file path on success.
 * `onProgress` receives 0..1 fraction plus byte counters.
 */
export async function downloadModel(model: ModelInfo, onProgress?: ProgressCb): Promise<string> {
  await ensureDir();
  const dest = modelPath(model.filename);

  const resumable = FileSystem.createDownloadResumable(
    model.url,
    dest,
    {},
    (p) => {
      const total = p.totalBytesExpectedToWrite || Math.round(model.sizeGb * 1024 * 1024 * 1024);
      const frac = total > 0 ? p.totalBytesWritten / total : 0;
      onProgress?.(Math.min(1, frac), p.totalBytesWritten, total);
    }
  );
  _active.set(model.filename, resumable);

  try {
    const result = await resumable.downloadAsync();
    if (!result?.uri) throw new Error("Download did not complete");

    // Validate completeness — a truncated/partial file loads as a corrupt model
    // ("tensor data is not within the file bounds") and is useless. If the file
    // is well under the expected size, delete it and report so the user retries.
    const info = await FileSystem.getInfoAsync(dest, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
    const sizeBytes = (info as { size?: number }).size ?? 0;
    const expectedBytes = model.sizeGb * 1024 * 1024 * 1024;
    if (expectedBytes > 0 && sizeBytes < expectedBytes * 0.9) {
      await FileSystem.deleteAsync(dest, { idempotent: true });
      throw new Error(
        `Download incomplete: got ${(sizeBytes / 1e9).toFixed(2)} GB of ~${model.sizeGb} GB. Check your connection and try again.`
      );
    }
    return result.uri;
  } finally {
    _active.delete(model.filename);
  }
}

/** Cancel an in-flight download (leaves a partial file that can be deleted). */
export async function cancelDownload(filename: string): Promise<void> {
  const r = _active.get(filename);
  if (r) {
    try { await r.cancelAsync(); } catch { /* ignore */ }
    _active.delete(filename);
  }
}

export function isDownloading(filename: string): boolean {
  return _active.has(filename);
}

/** GGUF model file extensions llama.rn can load. */
const GGUF_EXTS = [".gguf"];
/** LiteRT-LM model file extensions (Google AI Edge Gallery). `.litertlm` is the
 *  format the LiteRT-LM engine loads; `.task` is the legacy MediaPipe bundle
 *  Edge Gallery still exports (the engine loads most of these too). We surface
 *  both so a user's existing Gallery downloads are discoverable. */
const TASK_EXTS = [".litertlm", ".task", ".bin"];

function hasExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

function isGguf(name: string): boolean { return hasExt(name, GGUF_EXTS); }

/**
 * whisper.rn STT models are `ggml-*.bin` (whisper.cpp GGML) and live in the same
 * /models dir as the LLMs. They are NOT LiteRT-LM models, so they must be
 * excluded from the `.litertlm`/.bin scanner — otherwise a downloaded
 * Whisper model would show up (and fail to load) in the LiteRT-LM model list.
 */
function isWhisperGgml(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("ggml-") && lower.endsWith(".bin");
}
function isTask(name: string): boolean { return hasExt(name, TASK_EXTS) && !isWhisperGgml(name); }

/**
 * Scan the app's models directory for ALL local .gguf files — including ones
 * the user imported from elsewhere on the device — so they can be loaded even
 * if they aren't in RECOMMENDED_MODELS.
 */
export async function listLocalGguf(): Promise<DownloadedModel[]> {
  const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) return [];
  const names = await FileSystem.readDirectoryAsync(MODELS_DIR);
  const out: DownloadedModel[] = [];
  for (const name of names) {
    if (!isGguf(name)) continue;
    const info = await FileSystem.getInfoAsync(MODELS_DIR + name, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
    if (info.exists && !info.isDirectory) {
      out.push({ filename: name, path: MODELS_DIR + name, sizeBytes: (info as { size?: number }).size ?? 0 });
    }
  }
  return out;
}

/**
 * Let the user pick a .gguf file already on the device (Files, Downloads, or a
 * model another app saved) and copy it into the app's models directory so it
 * can be loaded by llama.rn. Returns the imported model, or null if cancelled.
 *
 * NOTE: Google AI Edge Gallery models are LiteRT `.litertlm` — a different
 * runtime than llama.rn (GGUF). Those are handled by the separate LiteRT-LM
 * engine, not this importer.
 */
export async function importModelFromDevice(): Promise<DownloadedModel | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
  if (res.canceled) return null;
  const asset = res.assets[0];
  if (!asset) return null;
  if (!isGguf(asset.name)) {
    throw new Error(
      `"${asset.name}" is not a .gguf model. Edge Gallery .litertlm files use the LiteRT-LM engine instead.`
    );
  }
  await ensureDir();
  const dest = modelPath(asset.name);
  await FileSystem.copyAsync({ from: asset.uri, to: dest });
  const info = await FileSystem.getInfoAsync(dest, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  return { filename: asset.name, path: dest, sizeBytes: (info as { size?: number }).size ?? 0 };
}

/**
 * Scan the app models directory for LiteRT-LM `.litertlm` (or `.bin`)
 * files (Google AI Edge Gallery format) the user has imported.
 */
export async function listLocalTask(): Promise<DownloadedModel[]> {
  const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) return [];
  const names = await FileSystem.readDirectoryAsync(MODELS_DIR);
  const out: DownloadedModel[] = [];
  for (const name of names) {
    if (!isTask(name)) continue;
    const info = await FileSystem.getInfoAsync(MODELS_DIR + name, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
    if (info.exists && !info.isDirectory) {
      out.push({ filename: name, path: MODELS_DIR + name, sizeBytes: (info as { size?: number }).size ?? 0 });
    }
  }
  return out;
}

/** Whether a filename is any supported on-device model (GGUF or LiteRT-LM). */
export function isSupportedModelFile(name: string): boolean {
  return isGguf(name) || isTask(name);
}

/**
 * Import a model file the user SHARED into the app (e.g. "Share → Omnecor HQ"
 * from Google AI Edge Gallery). Copies the shared file into the models dir.
 * Returns the imported model, or null if it isn't a supported model file.
 */
export async function importSharedModelFile(srcPath: string, fileName: string): Promise<DownloadedModel | null> {
  if (!isSupportedModelFile(fileName)) return null;
  await ensureDir();
  const dest = modelPath(fileName);
  await FileSystem.copyAsync({ from: srcPath, to: dest });
  const info = await FileSystem.getInfoAsync(dest, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  return { filename: fileName, path: dest, sizeBytes: (info as { size?: number }).size ?? 0 };
}

/**
 * Pick a LiteRT-LM `.litertlm` (or `.bin`) model already on the device
 * (e.g. one exported/shared from Google AI Edge Gallery) and copy it into the app so the
 * LiteRT-LM engine (`mediapipe-inference.ts`) can load it. No code edits needed
 * by the user — purely in-app. Returns the imported model, or null if cancelled.
 */
export async function importTaskModelFromDevice(): Promise<DownloadedModel | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
  if (res.canceled) return null;
  const asset = res.assets[0];
  if (!asset) return null;
  if (!isTask(asset.name)) {
    throw new Error(`"${asset.name}" is not a LiteRT-LM model (.litertlm). Use GGUF import for .gguf files.`);
  }
  await ensureDir();
  const dest = modelPath(asset.name);
  await FileSystem.copyAsync({ from: asset.uri, to: dest });
  const info = await FileSystem.getInfoAsync(dest, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  return { filename: asset.name, path: dest, sizeBytes: (info as { size?: number }).size ?? 0 };
}

// ── Device model FOLDER (Storage Access Framework) ─────────────────────────
//
// The single-file DocumentPicker importers above make the user re-navigate to
// their model on every load. Worse, LiteRT-LM models pulled by the Google AI
// Edge Gallery app live in *its* storage — an app-private folder Omnecor can't
// see. SAF fixes both: the user grants Omnecor read access to the folder that
// holds their `.litertlm`/`.task` models ONCE (persisted across launches), and
// we then list every model in it and load any of them with a single tap.
//
// The grant is persistent (Android keeps the tree URI permission), so the whole
// folder becomes a live, re-scannable model list — exactly the "load a model
// list" experience that was missing.

const KEY_TASK_FOLDER = "omnecor_task_model_folder";
const SAF = FileSystem.StorageAccessFramework;

/** A LiteRT-LM model discovered inside a user-granted device folder. */
export interface FolderTaskModel {
  filename: string;
  /** SAF content:// URI — not a POSIX path, so it must be copied in before load. */
  uri: string;
  sizeBytes: number;
}

/** Decode a SAF content URI down to its plain display filename. */
function safDisplayName(uri: string): string {
  let s = uri;
  try { s = decodeURIComponent(uri); } catch { /* keep raw on malformed escape */ }
  const cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf(":"));
  return cut >= 0 ? s.slice(cut + 1) : s;
}

/**
 * Prompt the user to grant a device folder (e.g. Downloads, or wherever their
 * Edge Gallery / sideloaded models live) and remember it. Returns the granted
 * SAF tree URI, or null if the user cancelled. Android only.
 */
export async function pickTaskModelFolder(): Promise<string | null> {
  const res = await SAF.requestDirectoryPermissionsAsync();
  if (!res.granted) return null;
  await AsyncStorage.setItem(KEY_TASK_FOLDER, res.directoryUri).catch(() => { /* best-effort */ });
  return res.directoryUri;
}

/** The previously granted model folder, or null if none/permission lost. */
export async function getSavedTaskFolder(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY_TASK_FOLDER); } catch { return null; }
}

/** Forget the granted folder (the OS permission itself is dropped on uninstall). */
export async function clearTaskFolder(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY_TASK_FOLDER); } catch { /* best-effort */ }
}

/**
 * List every LiteRT-LM model (`.litertlm`/`.task`/`.bin`) inside a granted SAF
 * folder. A revoked/stale permission (e.g. folder deleted, or grant cleared by
 * the OS) throws from `readDirectoryAsync`; callers treat that as "re-pick".
 */
export async function scanFolderForTaskModels(dirUri: string): Promise<FolderTaskModel[]> {
  const entries = await SAF.readDirectoryAsync(dirUri);
  const out: FolderTaskModel[] = [];
  for (const uri of entries) {
    const name = safDisplayName(uri);
    if (!isTask(name)) continue;
    let sizeBytes = 0;
    try {
      const info = await FileSystem.getInfoAsync(uri, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
      sizeBytes = (info as { size?: number }).size ?? 0;
    } catch { /* size is best-effort — a listable file is still loadable */ }
    out.push({ filename: name, uri, sizeBytes });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

/**
 * Copy a folder-discovered model into the app's models directory so the native
 * LiteRT-LM engine (which needs a real POSIX path, not a content:// URI) can
 * load it. Reuses an existing same-name copy only when its size provably matches
 * the source, so a second load of the same model is instant instead of
 * re-copying gigabytes. When the source size is unknown (some content providers
 * don't report it) we always re-copy — reusing an unverified same-name file
 * risks silently loading stale/different bytes. Returns the local
 * `DownloadedModel`.
 */
export async function importTaskModelFromFolder(model: FolderTaskModel): Promise<DownloadedModel> {
  await ensureDir();
  const dest = modelPath(model.filename);
  const existing = await FileSystem.getInfoAsync(dest, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  const existingSize = (existing as { size?: number }).size ?? 0;
  const alreadyCopied = existing.exists && !existing.isDirectory &&
    model.sizeBytes > 0 && existingSize === model.sizeBytes;
  if (!alreadyCopied) {
    if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.copyAsync({ from: model.uri, to: dest });
  }
  const info = await FileSystem.getInfoAsync(dest, { size: true } as Parameters<typeof FileSystem.getInfoAsync>[1]);
  return { filename: model.filename, path: dest, sizeBytes: (info as { size?: number }).size ?? 0 };
}
