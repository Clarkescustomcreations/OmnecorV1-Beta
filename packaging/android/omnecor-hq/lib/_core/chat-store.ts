import AsyncStorage from "@react-native-async-storage/async-storage";
import { decryptString, encryptString, isEncrypted } from "./secure-crypto";

const STORAGE_KEY = "omnecor_chats";

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO string on disk
}

export interface StoredChatSession {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  neuralMapId?: string | null;
  personaId?: string | null;
  /** Mesh-Delegation.md — persisted so a managed sub-agent chat survives a
   *  reload as a delegated session (routes turns to the peer, not the local
   *  model). Absent for ordinary chats. */
  delegatedNodeName?: string | null;
}

export interface ChatSnapshot {
  sessions: StoredChatSession[];
  activeSessionId: string;
}

export async function loadChats(): Promise<ChatSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let json: string | null;
    if (isEncrypted(raw)) {
      json = await decryptString(raw);
    } else {
      // Legacy plaintext snapshot from an older build — read it, then re-persist
      // it encrypted so it never sits in plaintext again.
      json = raw;
      try {
        await AsyncStorage.setItem(STORAGE_KEY, await encryptString(raw));
      } catch {
        /* migration is best-effort; fall through with the plaintext we read */
      }
    }
    if (!json) return null;

    const parsed = JSON.parse(json) as ChatSnapshot;
    if (!parsed || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveChats(snapshot: ChatSnapshot): Promise<void> {
  try {
    const cipher = await encryptString(JSON.stringify(snapshot));
    await AsyncStorage.setItem(STORAGE_KEY, cipher);
  } catch (e) {
    // persistence is best-effort, but surface why it failed
    console.warn("[ChatStore] Failed to persist encrypted chats:", e);
  }
}

export async function clearChats(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("[ChatStore] Failed to clear chats:", e);
  }
}
