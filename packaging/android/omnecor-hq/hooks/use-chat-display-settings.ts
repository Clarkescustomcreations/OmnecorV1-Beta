/**
 * @file hooks/use-chat-display-settings.ts
 *
 * Persists mobile chat display preferences in AsyncStorage so they survive
 * restarts and match the user's intent set in Settings → Appearance.
 *
 * Key: "omnecor:chatDisplaySettings" (JSON blob)
 * Defaults mirror the web client's useAppStore defaults.
 */

import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "omnecor:chatDisplaySettings";

export interface MobileChatDisplaySettings {
  showThinkingQuotes: boolean;
  quoteStyle: "random" | "funny" | "serious";
  /**
   * Session "auto-approve tool actions within the active map" — mirrors the web
   * `autoApproveTools`. When on, the PC agent's command/edit/job HITL gates are
   * approved automatically (still scoped to the active map's roots server-side).
   */
  autoApproveTools: boolean;
}

const DEFAULTS: MobileChatDisplaySettings = {
  showThinkingQuotes: true,
  quoteStyle: "random",
  autoApproveTools: false,
};

async function load(): Promise<MobileChatDisplaySettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MobileChatDisplaySettings>) };
  } catch {
    return DEFAULTS;
  }
}

async function save(settings: MobileChatDisplaySettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // persistence is best-effort
  }
}

export function useChatDisplaySettings() {
  const [settings, setSettingsState] = useState<MobileChatDisplaySettings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    load().then((s) => {
      setSettingsState(s);
      setReady(true);
    });
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<MobileChatDisplaySettings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...patch };
        save(next);
        return next;
      });
    },
    [],
  );

  return { settings, updateSettings, ready };
}
