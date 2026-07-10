/**
 * Batch C — Item 4: ValetArtifactRegistry
 *
 * Covers:
 *   versionedPath(): slug format, 8-digit YYYYMMDD date suffix, 8-char hash prefix,
 *     path is under REGISTRY_ROOT
 *   read(): returns {artifact_path:null, status:"pending"} when fs.readFile throws
 *   read(): parses valid JSON when file exists
 *   seedFromRepoIfMissing(): returns false when registry already ready
 *   seedFromRepoIfMissing(): returns false when no candidate has status="ready"
 *   seedFromRepoIfMissing(): returns false when candidate path equals registry path (guard)
 *   seedFromRepoIfMissing(): seeds and resolves relative artifact_path to absolute
 *   hashFile(): returns SHA-256 hex of file contents
 *   downloadGithubRelease(): throws on non-ok response, throws when body is null,
 *     writes file via pipeline on success
 *
 * Note: The project ships models/valet-router/current.json (a real ready artifact), so
 * we must fully control fs.readFile via vi.hoisted mocks to prevent tests from
 * accidentally picking up real files.
 *
 * Note: The self-overwrite guard inside seedFromRepoIfMissing() requires that the
 * candidate path equal CURRENT_JSON. We achieve this inside vi.isolateModules by
 * setting DATA_DIR=process.cwd() so PATHS.valetRouter resolves to the CWD candidate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { createHash } from "crypto";

// ── Hoisted mocks — created before any module imports ────────────────────────
// ValetArtifactRegistry does: `import fs from "fs/promises"` (async) and
// `import { createWriteStream } from "fs"` (sync).
// We provide both default+named exports for each mocked module.

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateWriteStream = vi.hoisted(() => vi.fn().mockReturnValue({}));
const mockPipeline = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("fs/promises", () => {
  const mod = {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  };
  return { ...mod, default: mod };
});

// Mock synchronous "fs" so createWriteStream can be intercepted without
// touching the real filesystem during downloadGithubRelease tests.
// We spread ...actual so paths.ts's existsSync/mkdirSync calls still use the
// real implementations (the project directory structure is intact in CI).
vi.mock("fs", async (importActual) => {
  const actual = await importActual<typeof import("fs")>();
  const mod = { ...actual, createWriteStream: mockCreateWriteStream };
  return { ...mod, default: mod };
});

vi.mock("stream/promises", () => ({
  pipeline: mockPipeline,
  default: { pipeline: mockPipeline },
}));

import { ValetArtifactRegistry } from "../core_services/services/ValetArtifactRegistry.js";

// ── Default behaviour: all reads throw ENOENT ─────────────────────────────────
beforeEach(() => {
  mockReadFile.mockReset();
  mockWriteFile.mockReset().mockResolvedValue(undefined);
  mockMkdir.mockReset().mockResolvedValue(undefined);
  mockCreateWriteStream.mockReset().mockReturnValue({});
  mockPipeline.mockReset().mockResolvedValue(undefined);
  // Default: no file found (ENOENT) — each test overrides specific calls as needed
  mockReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  vi.unstubAllGlobals();
});

// ── versionedPath — pure function ─────────────────────────────────────────────

describe("ValetArtifactRegistry.versionedPath", () => {
  it("path is under REGISTRY_ROOT", () => {
    const p = ValetArtifactRegistry.versionedPath("my-model", "abc123def456");
    expect(p.startsWith(ValetArtifactRegistry.registryRoot)).toBe(true);
  });

  it("includes first 8 chars of datasetHash in the directory name", () => {
    const hash = "deadbeef1234567890abcdef";
    const p = ValetArtifactRegistry.versionedPath("model", hash);
    expect(path.basename(p)).toContain("deadbeef");
  });

  it("slugifies baseTag to lowercase hyphenated with no leading/trailing hyphens", () => {
    const p = ValetArtifactRegistry.versionedPath("My Model V2!!", "aabbccdd");
    const base = path.basename(p);
    expect(base).toMatch(/^[a-z0-9-]+$/);
    expect(base).not.toMatch(/^-|-$/);
  });

  it("includes an 8-digit YYYYMMDD date suffix", () => {
    const p = ValetArtifactRegistry.versionedPath("model", "hash00000000abcdef");
    const base = path.basename(p);
    const datePart = base.split("-").pop()!;
    expect(datePart).toMatch(/^\d{8}$/);
    expect(parseInt(datePart, 10)).toBeGreaterThan(20240000);
  });

  it("uses the first 8 chars of the hash in the slug", () => {
    const hash = "00112233445566778899aabbcc";
    const p = ValetArtifactRegistry.versionedPath("test", hash);
    expect(p).toContain("00112233");
  });
});

// ── read — file-level behaviour ────────────────────────────────────────────────

describe("ValetArtifactRegistry.read", () => {
  it("returns pending default when the registry file does not exist", async () => {
    // mockReadFile already throws ENOENT by default (set in beforeEach)
    const result = await ValetArtifactRegistry.read();
    expect(result.status).toBe("pending");
    expect(result.artifact_path).toBeNull();
  });

  it("returns parsed record when the file exists and contains valid JSON", async () => {
    const record = { artifact_path: "/models/router.gguf", status: "ready" as const };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(record));
    const result = await ValetArtifactRegistry.read();
    expect(result.status).toBe("ready");
    expect(result.artifact_path).toBe("/models/router.gguf");
  });
});

// ── seedFromRepoIfMissing ─────────────────────────────────────────────────────

describe("ValetArtifactRegistry.seedFromRepoIfMissing", () => {
  it("returns false immediately when registry is already ready", async () => {
    // First readFile call is from read() inside seedFromRepoIfMissing
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ artifact_path: "/existing/model.gguf", status: "ready" })
    );
    const seeded = await ValetArtifactRegistry.seedFromRepoIfMissing();
    expect(seeded).toBe(false);
    // No write should occur
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns false when no candidate file has status='ready'", async () => {
    // read() → pending (first call)
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ artifact_path: null, status: "pending" }));
    // All candidate reads throw ENOENT (default mockRejectedValue covers these)
    const seeded = await ValetArtifactRegistry.seedFromRepoIfMissing();
    expect(seeded).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("returns false when candidate exists but has status='pending' (not ready)", async () => {
    // read() → pending
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ artifact_path: null, status: "pending" }));
    // First candidate found but it's also pending
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ artifact_path: null, status: "pending" }));
    // Remaining candidates → ENOENT (from the default reject in beforeEach)
    const seeded = await ValetArtifactRegistry.seedFromRepoIfMissing();
    expect(seeded).toBe(false);
  });

  it("seeds registry and resolves relative artifact_path to absolute when candidate found", async () => {
    // read() → pending (registry not yet populated)
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ artifact_path: null, status: "pending" }));
    // First candidate (CWD-based) returns a ready record with a relative path
    const candidateRecord = { artifact_path: "model.gguf", status: "ready" as const };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(candidateRecord));

    const seeded = await ValetArtifactRegistry.seedFromRepoIfMissing();

    expect(seeded).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledOnce();

    // The written JSON should have an absolute artifact_path
    const writtenJson = mockWriteFile.mock.calls[0]![1] as string;
    const written = JSON.parse(writtenJson) as { artifact_path: string; status: string };
    expect(written.status).toBe("ready");
    expect(path.isAbsolute(written.artifact_path)).toBe(true);
    expect(written.artifact_path).toContain("model.gguf");
  });

  /**
   * Self-overwrite guard test (line 97 of ValetArtifactRegistry.ts):
   *   if (path.resolve(src) === path.resolve(CURRENT_JSON)) return false;
   *
   * The guard fires when a candidate src path resolves to the same file as the
   * registry CURRENT_JSON. We use vi.doMock + vi.resetModules() to load
   * ValetArtifactRegistry with a patched PATHS where valetRouter equals the
   * CWD candidate path, making src === CURRENT_JSON and triggering the guard.
   */
  it("returns false when candidate path is the same file as the registry (self-overwrite guard)", async () => {
    // Patch paths.ts so PATHS.valetRouter = process.cwd()/models/valet-router,
    // which is the exact same value as the first candidate path inside
    // seedFromRepoIfMissing — causing the self-overwrite guard to fire.
    vi.doMock("../_core/paths.js", () => ({
      PATHS: { valetRouter: path.join(process.cwd(), "models", "valet-router") },
      resolveDataPath: (rel: string) => path.join(process.cwd(), rel),
      initPaths: vi.fn(),
    }));

    vi.resetModules();
    const { ValetArtifactRegistry: IsolatedRegistry } =
      await import("../core_services/services/ValetArtifactRegistry.js");

    // Restore so subsequent tests get the real PATHS.
    vi.doUnmock("../_core/paths.js");

    // read() → pending (registry not yet seeded)
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ artifact_path: null, status: "pending" }));
    // First candidate path === CURRENT_JSON → guard fires → return false
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ artifact_path: "/abs/model.gguf", status: "ready" }));

    const seeded = await (IsolatedRegistry as unknown as typeof ValetArtifactRegistry)
      .seedFromRepoIfMissing();

    expect(seeded).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ── hashFile ──────────────────────────────────────────────────────────────────

describe("ValetArtifactRegistry.hashFile", () => {
  it("returns the SHA-256 hex digest of the file contents", async () => {
    const content = Buffer.from("hello world from the model file");
    mockReadFile.mockResolvedValueOnce(content);

    const hash = await ValetArtifactRegistry.hashFile("/some/model.gguf");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHash("sha256").update(content).digest("hex");
    expect(hash).toBe(expected);
  });

  it("propagates fs errors (e.g. file not found)", async () => {
    // default beforeEach mock: throws ENOENT
    await expect(ValetArtifactRegistry.hashFile("/nonexistent.gguf")).rejects.toThrow("ENOENT");
  });
});

// ── downloadGithubRelease ─────────────────────────────────────────────────────

describe("ValetArtifactRegistry.downloadGithubRelease", () => {
  it("throws when GitHub API returns non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, statusText: "Not Found" }));
    await expect(
      ValetArtifactRegistry.downloadGithubRelease("v1.0.0", "model.gguf", "/dest")
    ).rejects.toThrow(/Failed to download/);
  });

  it("throws when response body is null (no stream to pipe)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: null }));
    await expect(
      ValetArtifactRegistry.downloadGithubRelease("v1.0.0", "model.gguf", "/dest")
    ).rejects.toThrow(/No response body/);
  });

  it("creates destDir, pipes response body to destPath, on successful download", async () => {
    // A minimal web ReadableStream that immediately closes (Readable.fromWeb needs a real one)
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("gguf-bytes"));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));

    await ValetArtifactRegistry.downloadGithubRelease("v1.0.0", "model.gguf", "/dest");

    expect(mockMkdir).toHaveBeenCalledWith("/dest", { recursive: true });
    expect(mockCreateWriteStream).toHaveBeenCalledWith("/dest/model.gguf");
    expect(mockPipeline).toHaveBeenCalledOnce();
  });

  it("constructs the correct GitHub release URL from tag and filename", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, statusText: "Not Found" }));
    try {
      await ValetArtifactRegistry.downloadGithubRelease("v2.3.4", "router.gguf", "/dest");
    } catch {
      // expected — we just care about what URL was fetched
    }
    const fetchMock = (globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch;
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("v2.3.4");
    expect(calledUrl).toContain("router.gguf");
  });
});
