import { readFileSync } from "fs";
import { join } from "path";
import { ENV } from "../../_core/env.js";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  error?: string;
}

export class UpdateCheckerService {
  private static instance: UpdateCheckerService | null = null;

  static getInstance(): UpdateCheckerService {
    if (!UpdateCheckerService.instance) UpdateCheckerService.instance = new UpdateCheckerService();
    return UpdateCheckerService.instance;
  }

  getCurrentVersion(): string {
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { version?: string };
      return pkg.version ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const currentVersion = this.getCurrentVersion();
    const repo = ENV.updateCheckRepo;
    try {
      const resp = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { "User-Agent": "omnecor-hmci" },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        return { currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: null, releaseNotes: null, error: `GitHub API returned ${resp.status}` };
      }
      const data = await resp.json() as { tag_name?: string; html_url?: string; body?: string };
      const latestVersion = data.tag_name?.replace(/^v/, "") ?? null;
      return {
        currentVersion,
        latestVersion,
        updateAvailable: !!latestVersion && latestVersion !== currentVersion,
        releaseUrl: data.html_url ?? null,
        releaseNotes: data.body ?? null,
      };
    } catch (err) {
      return { currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: null, releaseNotes: null, error: (err as Error).message };
    }
  }
}
