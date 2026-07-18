/**
 * @file lib/_core/brain-store.ts
 *
 * Persists which Brain Packs are attached to the chat (Brains-Upgrade Phase 8).
 * The web client keeps this in the zustand store (`activeBrainIds` +
 * `toggleActiveBrain`); the APK has no zustand, so the chat screen holds the set
 * in component state and mirrors it here (same pattern as `chat-store.ts` /
 * `use-chat-display-settings`). Read at stream time and threaded to
 * `aiProvider.agentChatStream` as `brainIds` — the server injects each brain's
 * charter + retrieves its top-k corpus.
 *
 * Not encrypted: a list of brain ids is not sensitive (unlike chat contents).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "omnecor_active_brains";

/** Load the persisted set of attached brain ids (empty if none / unreadable). */
export async function loadActiveBrains(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: keep only strings, cap to the server's max of 16.
    return parsed.filter((x): x is string => typeof x === "string").slice(0, 16);
  } catch {
    return [];
  }
}

/** Persist the attached brain ids. Best-effort — a write failure is non-fatal. */
export async function saveActiveBrains(ids: string[]): Promise<void> {
  try {
    const clean = Array.from(new Set(ids.filter((x) => typeof x === "string"))).slice(0, 16);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn("[BrainStore] Failed to persist active brains:", e);
  }
}
