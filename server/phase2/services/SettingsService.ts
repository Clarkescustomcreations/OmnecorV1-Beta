import { readFileSync, existsSync, statSync } from "fs";
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
  // ---- Service-connection (System B) OAuth client credentials ----
  // These power Drive/OneDrive/social publishing/YouTube/Gmail — independent of
  // the Google/Microsoft *login* clients above. Resolved by oauthClients.ts via
  // getSecret(<key>, <ENV fallback>).
  twitterClientId?: string;
  twitterClientSecret?: string;
  linkedinClientId?: string;
  linkedinClientSecret?: string;
  instagramClientId?: string;
  instagramClientSecret?: string;
  tiktokClientId?: string;
  tiktokClientSecret?: string;
  facebookClientId?: string;
  facebookClientSecret?: string;
  youtubeClientId?: string;
  youtubeClientSecret?: string;
  gmailClientId?: string;
  gmailClientSecret?: string;
  googleDriveClientId?: string;
  googleDriveClientSecret?: string;
  dropboxClientId?: string;
  dropboxClientSecret?: string;
  oneDriveClientId?: string;
  oneDriveClientSecret?: string;
  [key: string]: any;
}

export class SettingsService {
  private static instance: SettingsService | null = null;

  // Cache the parsed file and invalidate on mtime so hot edits (and the
  // Settings page's saveSettings writes) are picked up without a restart.
  private cache: OmnecorSettings = {};
  private cacheMtimeMs = -1;

  static getInstance(): SettingsService {
    if (!SettingsService.instance) SettingsService.instance = new SettingsService();
    return SettingsService.instance;
  }

  getSettings(): OmnecorSettings {
    try {
      if (!existsSync(SETTINGS_PATH)) {
        this.cache = {};
        this.cacheMtimeMs = -1;
        return this.cache;
      }
      const mtime = statSync(SETTINGS_PATH).mtimeMs;
      if (mtime === this.cacheMtimeMs) return this.cache;
      this.cache = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      this.cacheMtimeMs = mtime;
      return this.cache;
    } catch {
      return this.cache;
    }
  }

  getSecret(key: string, envFallback?: string): string {
    const settings = this.getSettings();
    return settings[key] || envFallback || "";
  }

  /**
   * Read a single setting, coercing to the type of `fallback` and returning
   * `fallback` when unset/null or unparseable. This is how the server consumes
   * the toggles/sliders persisted by the Settings page.
   */
  get<T>(key: string, fallback: T): T {
    const v = this.getSettings()[key];
    if (v === undefined || v === null) return fallback;
    if (typeof fallback === "number") {
      const n = typeof v === "number" ? v : Number(v);
      return (Number.isFinite(n) ? n : fallback) as T;
    }
    if (typeof fallback === "boolean") {
      return (typeof v === "boolean" ? v : v === "true") as T;
    }
    return v as T;
  }
}

/** Convenience accessor — `SettingsService.getInstance().get(key, fallback)`. */
export function getSetting<T>(key: string, fallback: T): T {
  return SettingsService.getInstance().get(key, fallback);
}
