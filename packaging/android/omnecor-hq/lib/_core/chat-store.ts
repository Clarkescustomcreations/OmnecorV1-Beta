import AsyncStorage from "@react-native-async-storage/async-storage";

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
}

export interface ChatSnapshot {
  sessions: StoredChatSession[];
  activeSessionId: string;
}

export async function loadChats(): Promise<ChatSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSnapshot;
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
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // swallow errors — persistence is best-effort
  }
}

export async function clearChats(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // swallow errors
  }
}
