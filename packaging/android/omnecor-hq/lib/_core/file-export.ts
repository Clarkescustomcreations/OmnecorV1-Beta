/**
 * @file lib/_core/file-export.ts
 *
 * Save a base64 payload the desktop server produced (a `.obp` Brain Pack export,
 * a Blueprint PDF booklet) to a user-chosen device folder. The app has no
 * `expo-sharing`, so — exactly like `model-download.ts` — we use the Storage
 * Access Framework: prompt for a directory grant, create the file there, and
 * write the bytes. Android only (SAF); a no-op fallback keeps types honest.
 */
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const SAF = FileSystem.StorageAccessFramework;

export type SaveResult =
  | { ok: true; uri: string }
  | { ok: false; reason: "cancelled" | "unsupported" | "error"; message?: string };

/**
 * Prompt for a folder, then write `base64` into `<folder>/<filename>` with the
 * given MIME type. Returns the created content URI on success. The caller shows
 * the toast/alert — this stays UI-free.
 */
export async function saveBase64File(base64: string, filename: string, mimeType: string): Promise<SaveResult> {
  if (Platform.OS !== "android") {
    return { ok: false, reason: "unsupported", message: "Saving files is supported on Android." };
  }
  try {
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: "cancelled" };
    const fileUri = await SAF.createFileAsync(perm.directoryUri, filename, mimeType);
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { ok: true, uri: fileUri };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
