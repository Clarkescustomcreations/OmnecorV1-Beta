import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveOllamaUrl } from "../ollamaUrl.js";
import { ENV } from "../../../_core/env.js";

// The resolver reads through SettingsService, which honors globalThis.__testSettingsPath
// (and bypasses its mtime cache in that mode), so we point it at a throwaway file.
let dir: string;
let settingsPath: string;

function writeSettings(obj: Record<string, unknown>): void {
  writeFileSync(settingsPath, JSON.stringify(obj), "utf-8");
}

describe("resolveOllamaUrl — single source of truth for status + inference", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omnecor-ollamaurl-"));
    settingsPath = join(dir, "settings.json");
    (globalThis as any).__testSettingsPath = settingsPath;
  });

  afterEach(() => {
    delete (globalThis as any).__testSettingsPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it("an explicit per-request URL wins over everything", () => {
    writeSettings({ OLLAMA_BASE_URL: "http://settings:11434" });
    expect(resolveOllamaUrl("http://explicit:11434")).toBe("http://explicit:11434");
  });

  it("prefers the OLLAMA_BASE_URL key (what the Settings page writes)", () => {
    writeSettings({ OLLAMA_BASE_URL: "http://lan-box:11434", ollamaUrl: "http://legacy:11434" });
    expect(resolveOllamaUrl()).toBe("http://lan-box:11434");
  });

  it("resolves a URL saved under the LEGACY `ollamaUrl` key — the exact status/inference mismatch bug", () => {
    // Before the fix, system.aiProviders read only OLLAMA_BASE_URL from the raw
    // file and would report the ENV default here, while inference used this value.
    writeSettings({ ollamaUrl: "http://legacy-only:11434" });
    expect(resolveOllamaUrl()).toBe("http://legacy-only:11434");
  });

  it("falls back to ENV.ollamaUrl when no setting is present", () => {
    writeSettings({});
    expect(resolveOllamaUrl()).toBe(ENV.ollamaUrl || "http://localhost:11434");
  });
});
