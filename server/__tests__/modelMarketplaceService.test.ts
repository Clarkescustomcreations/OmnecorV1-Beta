/**
 * ModelMarketplaceService — Hugging Face → local runtime downloads.
 *
 * Covers the two download shapes the LLM feature adds:
 *   - GGUF (runtime): browse a repo's quant files, stream one into the models
 *     dir, and trigger a ModelIndexService rescan so it enters the catalog.
 *   - Base model (training): download the WHOLE repo's trainable files
 *     (config + tokenizer + safetensors), skipping GGUF/other-framework blobs
 *     and the redundant PyTorch weights when safetensors are present.
 *
 * `fetch` is mocked (tree JSON for the API, byte bodies for resolve URLs);
 * PATHS is redirected to a temp dir so the real streaming/rename code runs for
 * real; ModelIndexService.refresh is spied. No network, no real HF.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const env = vi.hoisted(() => ({ huggingfaceApiKey: "" }));
vi.mock("../_core/env.js", () => ({ ENV: env }));

const refreshMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("../core_services/services/ModelIndexService.js", () => ({
  ModelIndexService: { getInstance: () => ({ refresh: refreshMock }) },
}));

// PATHS.models/baseModels are read at download time (not import), so we mutate
// the real (unfrozen) PATHS to temp dirs rather than mocking the module — which
// would also blank PATHS.logs that logger.ts reads at import.
import { PATHS } from "../_core/paths.js";
import { ModelMarketplaceService } from "../core_services/services/ModelMarketplaceService.js";

const paths = { models: "", baseModels: "" };
const origPaths = { models: PATHS.models, baseModels: PATHS.baseModels };
let tmpRoot: string;
let fetchMock: ReturnType<typeof vi.fn>;

/** Route the mocked fetch by URL: tree API → JSON, resolve → byte body. */
function routeFetch(treeByRepo: Record<string, unknown[]>) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    const treeMatch = u.match(/\/api\/models\/([^/]+\/[^/]+)\/tree\/main/);
    if (treeMatch) {
      const repo = treeMatch[1];
      const tree = treeByRepo[repo];
      if (!tree) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(tree), { status: 200, headers: { "content-type": "application/json" } });
    }
    const resolveMatch = u.match(/\/resolve\/main\/(.+)$/);
    if (resolveMatch) {
      const body = `BYTES:${resolveMatch[1]}`;
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    }
    return new Response("unexpected", { status: 500 });
  });
}

const waitForState = async (svc: ModelMarketplaceService, id: string) =>
  vi.waitFor(() => {
    const s = svc.getDownloadStatus(id);
    if (!s || s.state === "downloading") throw new Error("still downloading");
    return s;
  }, { timeout: 4000, interval: 20 });

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omnecor-hf-"));
  paths.models = path.join(tmpRoot, "models");
  paths.baseModels = path.join(tmpRoot, "models", "base");
  PATHS.models = paths.models;
  PATHS.baseModels = paths.baseModels;
  env.huggingfaceApiKey = "";
  refreshMock.mockClear();
  (ModelMarketplaceService as unknown as { instance: unknown }).instance = null;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  PATHS.models = origPaths.models;
  PATHS.baseModels = origPaths.baseModels;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ── listRepoFiles ─────────────────────────────────────────────────────────────

describe("ModelMarketplaceService.listRepoFiles", () => {
  it("returns only .gguf files with parsed quant + size, smallest first", async () => {
    fetchMock = routeFetch({
      "owner/repo": [
        { type: "file", path: "model-Q8_0.gguf", lfs: { size: 200 } },
        { type: "file", path: "model-Q4_K_M.gguf", size: 100 },
        { type: "file", path: "README.md", size: 5 },
        { type: "directory", path: "sub" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const files = await ModelMarketplaceService.getInstance().listRepoFiles("owner/repo");

    expect(files.map((f) => f.filename)).toEqual(["model-Q4_K_M.gguf", "model-Q8_0.gguf"]);
    expect(files[0].quant).toBe("Q4_K_M");
    expect(files[0].sizeBytes).toBe(100);
    expect(files[1].sizeBytes).toBe(200); // lfs.size preferred
  });

  it("rejects a malformed repo id with BAD_REQUEST (no network call)", async () => {
    fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(ModelMarketplaceService.getInstance().listRepoFiles("not-a-repo")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a missing repo to NOT_FOUND", async () => {
    fetchMock = routeFetch({}); // no repos → 404
    vi.stubGlobal("fetch", fetchMock);
    await expect(ModelMarketplaceService.getInstance().listRepoFiles("owner/ghost")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ── GGUF download (runtime) ───────────────────────────────────────────────────

describe("ModelMarketplaceService GGUF download", () => {
  it("rejects an unsafe filename before starting", () => {
    fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    expect(() =>
      ModelMarketplaceService.getInstance().startHuggingFaceDownload("owner/repo", "../escape.gguf"),
    ).toThrow(/Invalid file path/);
    expect(() =>
      ModelMarketplaceService.getInstance().startHuggingFaceDownload("owner/repo", "notgguf.bin"),
    ).toThrow(/Invalid file path/);
  });

  it("streams the file into the models dir and triggers a catalog rescan", async () => {
    fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const svc = ModelMarketplaceService.getInstance();

    const { id } = svc.startHuggingFaceDownload("owner/repo", "model-Q4_K_M.gguf", 20);
    const status = await waitForState(svc, id);

    expect(status.state).toBe("done");
    expect(status.kind).toBe("gguf");
    const dest = path.join(paths.models, "model-Q4_K_M.gguf");
    expect(await fs.readFile(dest, "utf8")).toBe("BYTES:model-Q4_K_M.gguf");
    expect(status.receivedBytes).toBe("BYTES:model-Q4_K_M.gguf".length);
    expect(refreshMock).toHaveBeenCalledOnce(); // model made visible to the runtime
  });

  it("is idempotent — an already-present file reports done without downloading", async () => {
    fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    await fs.mkdir(paths.models, { recursive: true });
    await fs.writeFile(path.join(paths.models, "have.gguf"), "existing");
    const svc = ModelMarketplaceService.getInstance();

    const { id } = svc.startHuggingFaceDownload("owner/repo", "have.gguf", 8);
    const status = await waitForState(svc, id);

    expect(status.state).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled(); // never hit the resolve URL
  });

  it("de-dupes a concurrent download of the same file (double-click → one download)", () => {
    fetchMock = vi.fn(() => new Promise(() => {})); // resolve URL hangs → stays "downloading"
    vi.stubGlobal("fetch", fetchMock);
    const svc = ModelMarketplaceService.getInstance();

    const { id: id1 } = svc.startHuggingFaceDownload("owner/repo", "dup.gguf", 10);
    const { id: id2 } = svc.startHuggingFaceDownload("owner/repo", "dup.gguf", 10);

    expect(id2).toBe(id1);
    expect(svc.listDownloads().filter((d) => d.state === "downloading")).toHaveLength(1);
  });

  it("fails fast with a clear message when the disk can't hold the download", async () => {
    fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    // Pretend the volume is nearly full: 4096 * 10 ≈ 40 KB free.
    const statfsSpy = vi.spyOn(fs, "statfs").mockResolvedValue({ bsize: 4096, bavail: 10 } as any);
    const svc = ModelMarketplaceService.getInstance();

    const { id } = svc.startHuggingFaceDownload("owner/repo", "big.gguf", 5_000_000_000);
    const status = await waitForState(svc, id);

    expect(status.state).toBe("error");
    expect(status.error).toMatch(/Not enough disk space/);
    expect(fetchMock).not.toHaveBeenCalled(); // guard fired before streaming
    statfsSpy.mockRestore();
  });
});

// ── Base-model download (training) ────────────────────────────────────────────

describe("ModelMarketplaceService base-model download", () => {
  it("downloads the trainable files (config + tokenizer + safetensors), skipping GGUF and redundant PyTorch weights", async () => {
    fetchMock = routeFetch({
      "org/base": [
        { type: "file", path: "config.json", size: 10 },
        { type: "file", path: "tokenizer.json", size: 20 },
        { type: "file", path: "model.safetensors", size: 100 },
        { type: "file", path: "pytorch_model.bin", size: 100 }, // skipped: safetensors present
        { type: "file", path: "model.gguf", size: 500 },        // skipped: inference quant
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const svc = ModelMarketplaceService.getInstance();

    const { id } = svc.startBaseModelDownload("org/base");
    const status = await waitForState(svc, id);

    expect(status.state).toBe("done");
    expect(status.kind).toBe("base-model");
    expect(status.totalFiles).toBe(3);
    expect(status.completedFiles).toBe(3);

    const destDir = path.join(paths.baseModels, "org__base");
    const written = await fs.readdir(destDir);
    expect(written.sort()).toEqual(["config.json", "model.safetensors", "tokenizer.json"]);
    // destPath is the local dir the trainer loads with from_pretrained (offline).
    expect(status.destPath).toBe(destDir);
    // Base models are NOT runtime GGUFs — no catalog rescan.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed repo id", () => {
    fetchMock = routeFetch({});
    vi.stubGlobal("fetch", fetchMock);
    expect(() => ModelMarketplaceService.getInstance().startBaseModelDownload("bad")).toThrow();
  });
});
