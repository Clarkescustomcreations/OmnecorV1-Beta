import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export function getSettingsPath(): string {
  if (typeof globalThis !== "undefined" && (globalThis as any).__testSettingsPath) {
    return (globalThis as any).__testSettingsPath;
  }
  return join(homedir(), ".omnecor", "settings.json");
}

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
      const path = getSettingsPath();
      if (!existsSync(path)) {
        this.cache = {};
        this.cacheMtimeMs = -1;
        return this.cache;
      }
      const isTest = typeof globalThis !== "undefined" && !!(globalThis as any).__testSettingsPath;
      const mtime = statSync(path).mtimeMs;
      if (!isTest && mtime === this.cacheMtimeMs) return this.cache;
      this.cache = JSON.parse(readFileSync(path, "utf-8"));
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
  update(key: string, value: any): void {
    const path = getSettingsPath();
    const settings = this.getSettings();
    settings[key] = value;
    // Write synchronously so the value is durably persisted before this method
    // returns — callers (e.g. PenpotService) rely on the setting being saved.
    // A failure throws to the caller rather than vanishing in a detached promise.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
    this.cache = settings;
    this.cacheMtimeMs = statSync(path).mtimeMs;
  }
}

/** Convenience accessor — `SettingsService.getInstance().get(key, fallback)`. */
export function getSetting<T>(key: string, fallback: T): T {
  return SettingsService.getInstance().get(key, fallback);
}

/** Convenience mutator — updates the file and cache. */
export function setSetting(key: string, value: any): void {
  SettingsService.getInstance().update(key, value);
}
