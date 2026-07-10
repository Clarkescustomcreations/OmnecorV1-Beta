/**
 * ModelIndexService — local GGUF model discovery (Model-Fabric Phase 8).
 *
 * The Omnecor-owned runtime (`LocalLlmRuntimeService`) is no longer a
 * single-static-model server: this service auto-discovers *every* GGUF the
 * machine already has and hands the runtime a registry it can hot-swap across.
 * Two sources, no manual registration:
 *
 *   1. `PATHS.models` — any `.gguf` the user dropped in the app's models dir
 *      (skips `valet-router/`, the routing classifier — not a chat model).
 *   2. The **Ollama blob store** (`~/.ollama/models`, or `$OLLAMA_MODELS`) —
 *      read straight off disk by parsing Ollama's own manifests, so every model
 *      the user ever `ollama pull`ed becomes Omnecor-hostable *with its real
 *      name* (`deepseek-r1:14b`, not a `sha256-…` blob). This works even when
 *      the Ollama server is stopped — the blobs are just files — which is the
 *      whole point: Omnecor hosts them, so Ollama becomes optional.
 *
 * Every entry is verified to be a real GGUF (4-byte magic) and de-duplicated by
 * content signature (size + a hash of the GGUF header), so the same weights
 * reached via two paths — e.g. a hardlink in the models dir and its Ollama blob
 * — collapse to one entry.
 *
 * The scan is **async** (`fs/promises`) and cached; `list()`/`resolve()` are
 * synchronous cache reads that never touch the disk — a stale cache triggers a
 * *background* refresh rather than blocking the caller. This keeps the model
 * scan off the request hot path (`getCatalog` runs it on every fetch), while
 * `LocalLlmRuntimeService` awaits `refresh()` once at boot to prime it.
 */
import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { PATHS } from "../../_core/paths.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("ModelIndex");

/** GGUF magic — first four bytes of a valid GGUF file ("GGUF"). */
const GGUF_MAGIC = Buffer.from([0x47, 0x47, 0x55, 0x46]);

export interface IndexedModel {
  /** Stable id used as the catalog `modelId`; round-trips back to `path`. */
  id: string;
  /** Human-readable display name (Ollama tag, or the filename). */
  name: string;
  /** Absolute path to the .gguf file (or the Ollama blob, itself a GGUF). */
  path: string;
  sizeBytes: number;
  source: "models-dir" | "ollama";
}

const CACHE_TTL_MS = 30_000;

export class ModelIndexService {
  private static instance: ModelIndexService | null = null;
  private _cache: IndexedModel[] | null = null;
  private _cachedAt = 0;
  /** In-flight refresh, so overlapping callers share one scan (never two). */
  private _refreshing: Promise<IndexedModel[]> | null = null;

  static getInstance(): ModelIndexService {
    if (!ModelIndexService.instance) ModelIndexService.instance = new ModelIndexService();
    return ModelIndexService.instance;
  }

  /**
   * Synchronous, non-blocking read of the cached model list. Never scans the
   * disk itself — a stale (or never-populated) cache fires a background
   * `refresh()` and returns whatever is cached now (`[]` before the first
   * scan completes; the runtime awaits `refresh()` at boot to avoid that).
   */
  list(): IndexedModel[] {
    if (!this._cache || Date.now() - this._cachedAt >= CACHE_TTL_MS) {
      void this.refresh().catch((err) =>
        log.warn("background model refresh failed", { error: err instanceof Error ? err.message : String(err) }),
      );
    }
    return this._cache ?? [];
  }

  /** Force (or await) a rescan; overlapping calls share the same in-flight scan. */
  refresh(): Promise<IndexedModel[]> {
    if (this._refreshing) return this._refreshing;
    this._refreshing = this._scan()
      .then((models) => {
        this._cache = models;
        this._cachedAt = Date.now();
        return models;
      })
      .finally(() => {
        this._refreshing = null;
      });
    return this._refreshing;
  }

  /** Resolve a catalog `modelId` (or a raw file path) to an indexed model. */
  resolve(idOrPath: string): IndexedModel | null {
    const models = this.list();
    return (
      models.find((m) => m.id === idOrPath) ??
      models.find((m) => m.path === idOrPath) ??
      models.find((m) => m.name === idOrPath) ??
      null
    );
  }

  // ── scan ────────────────────────────────────────────────────────────────

  private async _scan(): Promise<IndexedModel[]> {
    const found: IndexedModel[] = [];
    // models-dir first: a user-curated placement wins the dedup over the same
    // bytes discovered in the Ollama store.
    await this._scanModelsDir(found);
    await this._scanOllamaStore(found);
    return this._dedupeByContent(found);
  }

  private async _scanModelsDir(out: IndexedModel[]): Promise<void> {
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      let entries: string[];
      try {
        entries = await fsp.readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === "valet-router") continue;
        const full = path.join(dir, entry);
        let st;
        try {
          st = await fsp.stat(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          await walk(full, depth + 1);
        } else if (entry.toLowerCase().endsWith(".gguf") && (await this._isGguf(full))) {
          out.push({
            id: entry,
            name: entry.replace(/\.gguf$/i, ""),
            path: full,
            sizeBytes: st.size,
            source: "models-dir",
          });
        }
      }
    };
    await walk(PATHS.models, 0);
  }

  /** Locate the Ollama models root (env override, else `~/.ollama/models`). */
  private _ollamaRoot(): string {
    return process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");
  }

  private async _scanOllamaStore(out: IndexedModel[]): Promise<void> {
    const root = this._ollamaRoot();
    const manifestsDir = path.join(root, "manifests");
    const blobsDir = path.join(root, "blobs");

    const manifests: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      let entries: string[];
      try {
        entries = await fsp.readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        let st;
        try {
          st = await fsp.stat(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) await walk(full, depth + 1);
        else manifests.push(full);
      }
    };
    await walk(manifestsDir, 0);

    for (const manifestPath of manifests) {
      try {
        const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8")) as {
          layers?: Array<{ mediaType?: string; digest?: string; size?: number }>;
        };
        const modelLayer = manifest.layers?.find((l) => (l.mediaType ?? "").includes("model"));
        if (!modelLayer?.digest) continue;

        const blobPath = path.join(blobsDir, modelLayer.digest.replace(":", "-"));
        if (!(await this._isGguf(blobPath))) continue;

        const name = this._ollamaModelName(path.relative(manifestsDir, manifestPath));
        let sizeBytes = modelLayer.size ?? 0;
        if (!sizeBytes) {
          try {
            sizeBytes = (await fsp.stat(blobPath)).size;
          } catch {
            /* leave 0 */
          }
        }
        out.push({ id: name, name, path: blobPath, sizeBytes, source: "ollama" });
      } catch (err) {
        log.debug("skipping unreadable Ollama manifest", {
          manifestPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Reconstruct an Ollama model name from its manifest path, matching what
   * `ollama list` shows: `<host>/<namespace>/<name>:<tag>`, with the default
   * `registry.ollama.ai/library/` prefix stripped for official models.
   *   registry.ollama.ai/library/deepseek-r1/14b            → deepseek-r1:14b
   *   hf.co/empero-ai/Qwythos-9B-…-GGUF/Q4_K_M              → hf.co/empero-ai/Qwythos-9B-…-GGUF:Q4_K_M
   */
  private _ollamaModelName(relManifestPath: string): string {
    const segments = relManifestPath.split(/[\\/]/).filter(Boolean);
    const tag = segments.pop() ?? "latest";
    let nameParts = segments;
    if (nameParts[0] === "registry.ollama.ai") nameParts = nameParts.slice(1);
    if (nameParts[0] === "library") nameParts = nameParts.slice(1);
    return `${nameParts.join("/")}:${tag}`;
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /** True if the file's first four bytes are the GGUF magic. */
  private async _isGguf(file: string): Promise<boolean> {
    let fh: fsp.FileHandle | null = null;
    try {
      fh = await fsp.open(file, "r");
      const buf = Buffer.alloc(4);
      const { bytesRead } = await fh.read(buf, 0, 4, 0);
      return bytesRead === 4 && buf.equals(GGUF_MAGIC);
    } catch {
      return false;
    } finally {
      await fh?.close();
    }
  }

  /**
   * Collapse entries pointing at identical weights. Signature = file size + a
   * hash of the first 64 KB (the GGUF header + tensor metadata is unique per
   * model), which is enough to distinguish two different models and to unify a
   * models-dir hardlink with its Ollama blob (byte-identical) — without hashing
   * multi-GB files. First-seen wins (models-dir before Ollama).
   */
  private async _dedupeByContent(models: IndexedModel[]): Promise<IndexedModel[]> {
    const seen = new Set<string>();
    const out: IndexedModel[] = [];
    for (const m of models) {
      const sig = `${m.sizeBytes}:${await this._headerHash(m.path)}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(m);
    }
    return out;
  }

  private async _headerHash(file: string): Promise<string> {
    let fh: fsp.FileHandle | null = null;
    try {
      fh = await fsp.open(file, "r");
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return crypto.createHash("sha256").update(buf.subarray(0, bytesRead)).digest("hex");
    } catch {
      // Unreadable header — fall back to the path so it isn't wrongly merged.
      return `path:${file}`;
    } finally {
      await fh?.close();
    }
  }
}
