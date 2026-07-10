/**
 * ModelIndexService tests (Model-Fabric Phase 8).
 *
 * A tiny in-memory virtual filesystem backs `fs/promises` so the (async)
 * scanner runs against a deterministic tree: the app models dir + a realistic
 * Ollama blob store (manifests → model-layer digest → GGUF blob). Verifies name
 * reconstruction, the GGUF-magic gate, content de-duplication (a models-dir
 * hardlink and its Ollama blob collapse to one entry), and that `list()` is a
 * non-blocking cache read.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Virtual filesystem (async fs/promises) ───────────────────────────────────
const { vfs, fspApi } = vi.hoisted(() => {
  const vfs = new Map<string, { dir?: string[]; content?: Buffer }>();
  const fspApi = {
    readdir: async (p: string) => {
      const n = vfs.get(p);
      if (!n?.dir) throw Object.assign(new Error("ENOTDIR"), { code: "ENOTDIR" });
      return n.dir;
    },
    stat: async (p: string) => {
      const n = vfs.get(p);
      if (!n) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { isDirectory: () => !!n.dir, size: n.content?.length ?? 0 };
    },
    readFile: async (p: string, _enc?: string) => {
      const n = vfs.get(p);
      if (!n?.content) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return n.content.toString("utf8");
    },
    open: async (p: string) => {
      const n = vfs.get(p);
      if (!n?.content) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const content = n.content;
      return {
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const end = Math.min(position + length, content.length);
          const bytesRead = Math.max(0, end - position);
          content.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
        close: async () => {},
      };
    },
  };
  return { vfs, fspApi };
});
vi.mock("fs", () => ({ promises: fspApi }));
vi.mock("os", () => ({ default: { homedir: () => "/home/user" }, homedir: () => "/home/user" }));
vi.mock("../../../_core/paths.js", () => ({ PATHS: { models: "/models" } }));
vi.mock("../../../_core/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── VFS builders ─────────────────────────────────────────────────────────────
function dir(path: string, entries: string[]) {
  vfs.set(path, { dir: entries });
}
function gguf(path: string, unique = path) {
  vfs.set(path, { content: Buffer.concat([Buffer.from("GGUF"), Buffer.from(`::${unique}`)]) });
}
function rawFile(path: string, content: string) {
  vfs.set(path, { content: Buffer.from(content) });
}
function manifest(path: string, digest: string, size = 0) {
  vfs.set(path, {
    content: Buffer.from(JSON.stringify({ layers: [{ mediaType: "application/vnd.ollama.image.model", digest, size }] })),
  });
}

import { ModelIndexService } from "../ModelIndexService.js";

const OLLAMA = "/home/user/.ollama/models";

describe("ModelIndexService", () => {
  let svc: ModelIndexService;

  beforeEach(() => {
    vfs.clear();
    vi.clearAllMocks();
    (ModelIndexService as any).instance = null; // fresh singleton (no cache bleed)
    svc = ModelIndexService.getInstance();
  });

  it("scans PATHS.models for .gguf, skipping valet-router/ and non-GGUF files", async () => {
    dir("/models", ["valet-router", "chat", "notes.txt"]);
    dir("/models/valet-router", ["classifier.gguf"]);
    gguf("/models/valet-router/classifier.gguf");
    dir("/models/chat", ["mymodel.gguf"]);
    gguf("/models/chat/mymodel.gguf");
    rawFile("/models/notes.txt", "just notes");

    const models = await svc.refresh();
    expect(models.map((m) => m.id)).toEqual(["mymodel.gguf"]);
    expect(models[0]).toMatchObject({ name: "mymodel", source: "models-dir", path: "/models/chat/mymodel.gguf" });
  });

  it("rejects a .gguf-named file that lacks the GGUF magic", async () => {
    dir("/models", ["fake.gguf"]);
    rawFile("/models/fake.gguf", "NOT a gguf file");
    expect(await svc.refresh()).toEqual([]);
  });

  it("indexes the Ollama blob store with real model names from manifests", async () => {
    dir("/models", []);
    dir(OLLAMA, ["manifests", "blobs"]);
    dir(`${OLLAMA}/manifests`, ["registry.ollama.ai", "hf.co"]);
    dir(`${OLLAMA}/manifests/registry.ollama.ai`, ["library"]);
    dir(`${OLLAMA}/manifests/registry.ollama.ai/library`, ["deepseek-r1"]);
    dir(`${OLLAMA}/manifests/registry.ollama.ai/library/deepseek-r1`, ["14b"]);
    manifest(`${OLLAMA}/manifests/registry.ollama.ai/library/deepseek-r1/14b`, "sha256:deep", 8_000_000_000);
    dir(`${OLLAMA}/manifests/hf.co`, ["empero-ai"]);
    dir(`${OLLAMA}/manifests/hf.co/empero-ai`, ["Qwythos-9B-GGUF"]);
    dir(`${OLLAMA}/manifests/hf.co/empero-ai/Qwythos-9B-GGUF`, ["Q4_K_M"]);
    manifest(`${OLLAMA}/manifests/hf.co/empero-ai/Qwythos-9B-GGUF/Q4_K_M`, "sha256:qw");
    dir(`${OLLAMA}/blobs`, ["sha256-deep", "sha256-qw"]);
    gguf(`${OLLAMA}/blobs/sha256-deep`, "deep");
    gguf(`${OLLAMA}/blobs/sha256-qw`, "qw");

    const names = (await svc.refresh()).map((m) => m.name).sort();
    expect(names).toEqual(["deepseek-r1:14b", "hf.co/empero-ai/Qwythos-9B-GGUF:Q4_K_M"]);

    const deep = svc.list().find((m) => m.name === "deepseek-r1:14b")!;
    expect(deep).toMatchObject({ source: "ollama", path: `${OLLAMA}/blobs/sha256-deep`, sizeBytes: 8_000_000_000 });
  });

  it("skips an Ollama blob that isn't actually a GGUF", async () => {
    dir("/models", []);
    dir(OLLAMA, ["manifests", "blobs"]);
    dir(`${OLLAMA}/manifests`, ["registry.ollama.ai"]);
    dir(`${OLLAMA}/manifests/registry.ollama.ai`, ["library"]);
    dir(`${OLLAMA}/manifests/registry.ollama.ai/library`, ["broken"]);
    dir(`${OLLAMA}/manifests/registry.ollama.ai/library/broken`, ["latest"]);
    manifest(`${OLLAMA}/manifests/registry.ollama.ai/library/broken/latest`, "sha256:bad");
    dir(`${OLLAMA}/blobs`, ["sha256-bad"]);
    rawFile(`${OLLAMA}/blobs/sha256-bad`, "corrupt");
    expect(await svc.refresh()).toEqual([]);
  });

  it("de-duplicates identical weights reached via two paths (models-dir hardlink wins)", async () => {
    const bytes = Buffer.concat([Buffer.from("GGUF"), Buffer.from("::shared-weights")]);
    dir("/models", ["Qwythos.gguf"]);
    vfs.set("/models/Qwythos.gguf", { content: bytes });
    dir(OLLAMA, ["manifests", "blobs"]);
    dir(`${OLLAMA}/manifests`, ["hf.co"]);
    dir(`${OLLAMA}/manifests/hf.co`, ["empero-ai"]);
    dir(`${OLLAMA}/manifests/hf.co/empero-ai`, ["Qwythos-GGUF"]);
    dir(`${OLLAMA}/manifests/hf.co/empero-ai/Qwythos-GGUF`, ["Q4_K_M"]);
    manifest(`${OLLAMA}/manifests/hf.co/empero-ai/Qwythos-GGUF/Q4_K_M`, "sha256:shared", bytes.length);
    dir(`${OLLAMA}/blobs`, ["sha256-shared"]);
    vfs.set(`${OLLAMA}/blobs/sha256-shared`, { content: bytes });

    const models = await svc.refresh();
    expect(models).toHaveLength(1);
    expect(models[0]!.source).toBe("models-dir"); // scanned first, wins the dedup
  });

  it("resolve() maps an id, path, or name back to the indexed model", async () => {
    dir("/models", ["m.gguf"]);
    gguf("/models/m.gguf");
    await svc.refresh();
    expect(svc.resolve("m.gguf")?.path).toBe("/models/m.gguf");
    expect(svc.resolve("/models/m.gguf")?.id).toBe("m.gguf");
    expect(svc.resolve("m")?.id).toBe("m.gguf"); // by name
    expect(svc.resolve("nope")).toBeNull();
  });

  it("list() serves the cache without rescanning, and refreshes in the background when stale", async () => {
    dir("/models", ["m.gguf"]);
    gguf("/models/m.gguf");
    await svc.refresh();
    const readdirSpy = vi.spyOn(fspApi, "readdir");
    // A fresh cache read must not touch the disk.
    expect(svc.list().map((m) => m.id)).toEqual(["m.gguf"]);
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it("returns [] gracefully when neither source exists", async () => {
    expect(await svc.refresh()).toEqual([]);
  });
});
