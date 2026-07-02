/**
 * Batch C — Item 7: UpdateCheckerService
 *
 * Covers:
 *   getCurrentVersion(): reads version from package.json (real call — always returns a string)
 *   checkForUpdates(): updateAvailable=true when latestVersion differs from current
 *   checkForUpdates(): updateAvailable=false when latestVersion matches current
 *   checkForUpdates(): handles non-ok GitHub API response (error field set, updateAvailable=false)
 *   checkForUpdates(): handles network/timeout error (error field set, updateAvailable=false)
 *   checkForUpdates(): releaseUrl and releaseNotes populated from API response
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UpdateCheckerService } from "../phase2/services/UpdateCheckerService.js";

function makeGitHubResponse(tag: string, htmlUrl: string, body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve({ tag_name: tag, html_url: htmlUrl, body }),
  };
}

beforeEach(() => {
  (UpdateCheckerService as any).instance = null;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── getCurrentVersion ─────────────────────────────────────────────────────────

describe("UpdateCheckerService.getCurrentVersion", () => {
  it("returns a non-empty version string from package.json", () => {
    const version = UpdateCheckerService.getInstance().getCurrentVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    // Should be either semver or "unknown"
    expect(version).toMatch(/^[\d.]+.*$|^unknown$/);
  });
});

// ── checkForUpdates — update available ───────────────────────────────────────

describe("UpdateCheckerService.checkForUpdates", () => {
  it("updateAvailable=true when latest tag differs from current version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeGitHubResponse("v99.99.99", "https://github.com/x/releases/tag/v99.99.99", "Release notes")
    ));

    const svc = UpdateCheckerService.getInstance();
    const result = await svc.checkForUpdates();

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("99.99.99"); // "v" prefix stripped
    expect(result.releaseUrl).toBe("https://github.com/x/releases/tag/v99.99.99");
    expect(result.releaseNotes).toBe("Release notes");
    expect(result.currentVersion).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it("updateAvailable=false when latest tag matches current version", async () => {
    const svc = UpdateCheckerService.getInstance();
    const currentVersion = svc.getCurrentVersion();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeGitHubResponse(`v${currentVersion}`, "https://github.com/x", "notes")
    ));

    const result = await svc.checkForUpdates();
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe(currentVersion);
  });

  it("handles tag without 'v' prefix correctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeGitHubResponse("99.0.0", "https://github.com/x", "notes") // no v prefix
    ));

    const result = await UpdateCheckerService.getInstance().checkForUpdates();
    // tag_name.replace(/^v/, "") → "99.0.0" unchanged
    expect(result.latestVersion).toBe("99.0.0");
    expect(result.updateAvailable).toBe(true);
  });

  it("returns error field when GitHub API returns non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeGitHubResponse("", "", "", 404)
    ));

    const result = await UpdateCheckerService.getInstance().checkForUpdates();

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
    expect(result.releaseUrl).toBeNull();
    expect(result.error).toMatch(/404/);
  });

  it("returns error field when GitHub API returns 403 (rate limited)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeGitHubResponse("", "", "", 403)
    ));

    const result = await UpdateCheckerService.getInstance().checkForUpdates();
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toMatch(/403/);
  });

  it("returns error field on network error (fetch throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await UpdateCheckerService.getInstance().checkForUpdates();

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("returns error field on timeout (AbortError)", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));

    const result = await UpdateCheckerService.getInstance().checkForUpdates();
    expect(result.updateAvailable).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("currentVersion is always populated even on error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await UpdateCheckerService.getInstance().checkForUpdates();
    expect(typeof result.currentVersion).toBe("string");
    expect(result.currentVersion.length).toBeGreaterThan(0);
  });
});
