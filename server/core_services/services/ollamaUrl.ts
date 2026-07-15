import { ENV } from "../../_core/env.js";
import { SettingsService } from "./SettingsService.js";

/**
 * Canonical Ollama base-URL resolution — the SINGLE source of truth shared by
 * inference (`AiProviderService`) and every status/report/probe path
 * (`system.aiProviders`, `detectHardware`, `checkDependencies`), so the endpoint
 * the UI reports is always the endpoint inference actually uses.
 *
 * Resolution order (highest priority first):
 *   1. an explicit caller-supplied URL (a per-request override),
 *   2. the `OLLAMA_BASE_URL` setting (the key the Settings page writes),
 *   3. the legacy `ollamaUrl` setting key (older installs / migrated configs),
 *   4. `ENV.ollamaUrl` (the `OLLAMA_URL` env var, defaulting to 127.0.0.1:11434).
 *
 * Reads through `SettingsService` (the canonical, mtime-cached settings reader)
 * — never a raw `settings.json` read — so all callers observe the same value
 * regardless of which key the URL was saved under. Previously the status query
 * read the raw file and only the `OLLAMA_BASE_URL` key, so a URL saved under the
 * legacy `ollamaUrl` key made the reported endpoint disagree with the one
 * inference used (a real, debugged-live mismatch).
 */
export function resolveOllamaUrl(inputUrl?: string): string {
  if (inputUrl) return inputUrl;
  const settings = SettingsService.getInstance();
  return settings.getSecret(
    "OLLAMA_BASE_URL",
    settings.getSecret("ollamaUrl", ENV.ollamaUrl || "http://localhost:11434"),
  );
}
