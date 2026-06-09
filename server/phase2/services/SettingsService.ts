import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SETTINGS_PATH = join(homedir(), ".omnecor", "settings.json");

export interface OmnecorSettings {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  xaiApiKey?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  [key: string]: any;
}

export class SettingsService {
  private static instance: SettingsService | null = null;

  static getInstance(): SettingsService {
    if (!SettingsService.instance) SettingsService.instance = new SettingsService();
    return SettingsService.instance;
  }

  getSettings(): OmnecorSettings {
    try {
      if (!existsSync(SETTINGS_PATH)) return {};
      return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      return {};
    }
  }

  getSecret(key: string, envFallback?: string): string {
    const settings = this.getSettings();
    return settings[key] || envFallback || "";
  }
}
