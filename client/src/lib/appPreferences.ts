/**
 * Application Preferences Manager for Omnecor
 *
 * Manages user preferences including theme, language, and UI settings.
 * Persists preferences to localStorage and provides reactive updates.
 */

export type Theme = "dark" | "light" | "system";
export type Language = "en" | "es" | "fr" | "de" | "ja" | "zh";

export interface AppPreferences {
  theme: Theme;
  language: Language;
  fontSize: "small" | "normal" | "large";
  compactMode: boolean;
  autoSave: boolean;
  autoSaveInterval: number; // milliseconds
  showNotifications: boolean;
  soundEnabled: boolean;
  animationsEnabled: boolean;
  keyboardShortcutsEnabled: boolean;
  defaultModel: string;
  defaultProvider: string;
  contextSizeLimit: number; // tokens
  maxTokensPerRequest: number;
  temperatureDefault: number;
  topPDefault: number;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "dark",
  language: "en",
  fontSize: "normal",
  compactMode: false,
  autoSave: true,
  autoSaveInterval: 30000, // 30 seconds
  showNotifications: true,
  soundEnabled: false,
  animationsEnabled: true,
  keyboardShortcutsEnabled: true,
  defaultModel: "gpt-4",
  defaultProvider: "openai",
  contextSizeLimit: 8000,
  maxTokensPerRequest: 2000,
  temperatureDefault: 0.7,
  topPDefault: 0.9,
};

/**
 * Application Preferences Manager
 * Handles reading, writing, and managing user preferences
 */
export class AppPreferencesManager {
  private preferences: AppPreferences = { ...DEFAULT_PREFERENCES };
  private listeners: Set<(prefs: AppPreferences) => void> = new Set();
  private storageKey = "omnecor-app-preferences";

  constructor() {
    this.loadPreferences();
  }

  /**
   * Load preferences from localStorage
   */
  private loadPreferences() {
    try {
      const stored = safeStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.preferences = { ...DEFAULT_PREFERENCES, ...parsed };
      }
    } catch (error) {
      console.error("Failed to load preferences:", error);
      this.preferences = { ...DEFAULT_PREFERENCES };
    }
  }

  /**
   * Save preferences to localStorage
   */
  private savePreferences() {
    try {
      safeStorage.setItem(this.storageKey, JSON.stringify(this.preferences));
      this.notifyListeners();
    } catch (error) {
      console.error("Failed to save preferences:", error);
    }
  }

  /**
   * Get all preferences
   */
  getPreferences(): AppPreferences {
    return { ...this.preferences };
  }

  /**
   * Update a single preference
   */
  updatePreference<K extends keyof AppPreferences>(
    key: K,
    value: AppPreferences[K]
  ) {
    this.preferences[key] = value;
    this.savePreferences();
  }

  /**
   * Update multiple preferences
   */
  updatePreferences(updates: Partial<AppPreferences>) {
    this.preferences = { ...this.preferences, ...updates };
    this.savePreferences();
  }

  /**
   * Reset to default preferences
   */
  resetToDefaults() {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.savePreferences();
  }

  /**
   * Subscribe to preference changes
   */
  subscribe(listener: (prefs: AppPreferences) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.getPreferences()));
  }

  /**
   * Export preferences as JSON
   */
  exportPreferences(): string {
    return JSON.stringify(this.preferences, null, 2);
  }

  /**
   * Import preferences from JSON
   */
  importPreferences(json: string) {
    try {
      const parsed = JSON.parse(json);
      this.preferences = { ...DEFAULT_PREFERENCES, ...parsed };
      this.savePreferences();
      return true;
    } catch (error) {
      console.error("Failed to import preferences:", error);
      return false;
    }
  }
}

/**
 * Create and export global preferences manager
 */
export const appPreferences = new AppPreferencesManager();

/**
 * React hook for using app preferences
 */
export function useAppPreferences() {
  const [preferences, setPreferences] = React.useState<AppPreferences>(
    appPreferences.getPreferences()
  );

  React.useEffect(() => {
    return appPreferences.subscribe(setPreferences);
  }, []);

  return {
    preferences,
    updatePreference: appPreferences.updatePreference.bind(appPreferences),
    updatePreferences: appPreferences.updatePreferences.bind(appPreferences),
    resetToDefaults: appPreferences.resetToDefaults.bind(appPreferences),
  };
}

// Import React for the hook
import React from "react";
import { safeStorage } from "@/lib/safeStorage";
