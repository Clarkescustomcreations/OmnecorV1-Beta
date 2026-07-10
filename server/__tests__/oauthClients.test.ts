import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRedirectUri,
  isPlatformConfigured,
  listOAuthPlatforms,
  getOAuthClient,
  canonicalProvider,
} from "../oauth/oauthClients.js";

// These tests rely on env-var credential resolution. SettingsService reads
// ~/.omnecor/settings.json; when absent it returns {} and getSecret() falls
// back to the env var — which is the precedence we assert here.

const ENV_KEYS = [
  "PUBLIC_URL",
  "PORT",
  "OMNECOR_PORT",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
];

describe("oauthClients credential resolution", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("lists gmail among supported providers", () => {
    expect(listOAuthPlatforms()).toContain("gmail");
    expect(listOAuthPlatforms()).toContain("google_drive");
  });

  it("reports a platform unconfigured when no credentials are present", () => {
    expect(isPlatformConfigured("gmail")).toBe(false);
  });

  it("resolves credentials from env vars (Settings fallback)", () => {
    process.env.GMAIL_CLIENT_ID = "id-123";
    process.env.GMAIL_CLIENT_SECRET = "secret-456";
    expect(isPlatformConfigured("gmail")).toBe(true);
    // A configured platform builds a client without throwing.
    expect(() => getOAuthClient("gmail")).not.toThrow();
  });

  it("throws for an unknown platform", () => {
    expect(() => getOAuthClient("myspace")).toThrow(/Unsupported platform/);
    expect(isPlatformConfigured("myspace")).toBe(false);
  });

  it("derives the redirect URI from PORT when PUBLIC_URL is unset", () => {
    process.env.PORT = "37291";
    expect(getRedirectUri("gmail")).toBe(
      "http://localhost:37291/api/oauth/callback/gmail",
    );
  });

  it("defaults the port to 3000 when nothing is set", () => {
    expect(getRedirectUri("youtube")).toBe(
      "http://localhost:3000/api/oauth/callback/youtube",
    );
  });

  it("prefers PUBLIC_URL over the derived port", () => {
    process.env.PUBLIC_URL = "https://omnecor.example.com";
    process.env.PORT = "37291";
    expect(getRedirectUri("dropbox")).toBe(
      "https://omnecor.example.com/api/oauth/callback/dropbox",
    );
  });

  it("lowercases the platform in the callback path", () => {
    expect(getRedirectUri("Google_Drive")).toBe(
      "http://localhost:3000/api/oauth/callback/google_drive",
    );
  });
});

describe("oauthClients provider-slug normalisation (canonicalProvider)", () => {
  const GDRIVE_KEYS = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of GDRIVE_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of GDRIVE_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("maps the hyphenated integrations slug to the canonical underscore key", () => {
    expect(canonicalProvider("google-drive")).toBe("google_drive");
    expect(canonicalProvider("Google-Drive")).toBe("google_drive");
    expect(canonicalProvider("googledrive")).toBe("google_drive");
    expect(canonicalProvider("gdrive")).toBe("google_drive");
    expect(canonicalProvider("one-drive")).toBe("onedrive");
  });

  it("passes through already-canonical and unknown slugs unchanged (lower-cased)", () => {
    expect(canonicalProvider("google_drive")).toBe("google_drive");
    expect(canonicalProvider("Dropbox")).toBe("dropbox");
    expect(canonicalProvider("gmail")).toBe("gmail");
    expect(canonicalProvider("myspace")).toBe("myspace");
  });

  it("resolves provider config for either slug so token refresh never depends on the source UI", () => {
    process.env.GOOGLE_DRIVE_CLIENT_ID = "gd-id";
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = "gd-secret";
    // Both the underscore (social/cloud/podcast) and hyphen (neural-map) slugs
    // must resolve to the same configured client.
    expect(isPlatformConfigured("google_drive")).toBe(true);
    expect(isPlatformConfigured("google-drive")).toBe(true);
    expect(() => getOAuthClient("google-drive")).not.toThrow();
  });
});
