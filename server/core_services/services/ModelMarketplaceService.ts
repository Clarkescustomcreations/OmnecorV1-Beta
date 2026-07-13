/**
 * ModelMarketplaceService — curated model library with automated sync
 *
 * Aggregates models from multiple sources:
 * - Ollama local library (http://localhost:11434)
 * - Ollama registry (via ollamadb.dev API)
 * - HuggingFace models API
 *
 * Degrades gracefully when external services are offline.
 */

import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";
import { TRPCError } from "@trpc/server";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../_core/paths.js";
import { ModelIndexService } from "./ModelIndexService.js";

const log = createLogger("modelMarketplace");

export interface MarketplaceModel {
  id: string;
  name: string;
  source: "ollama" | "huggingface";
  description: string;
  tags: string[];
  sizeGb?: number;
  downloads?: number;
  pullCommand?: string;  // e.g. "ollama pull llama3.1:8b"
  huggingFaceId?: string;
  url?: string;
}

/** A downloadable GGUF weight file inside a Hugging Face repo. */
export interface HfRepoFile {
  /** Path within the repo (may include a subfolder), used to build the resolve URL. */
  path: string;
  /** Basename that will land in the local models dir. */
  filename: string;
  sizeBytes: number;
  /** Parsed quantization label (e.g. "Q4_K_M"), when detectable from the name. */
  quant: string | null;
}

/** Live status of a background HF → local disk download. */
export interface HfDownloadStatus {
  id: string;
  repoId: string;
  /** `gguf` = one quant into the runtime models dir; `base-model` = a whole repo into the base-models dir for training. */
  kind: "gguf" | "base-model";
  /** GGUF basename, or (for base models) the repo id. */
  filename: string;
  state: "downloading" | "done" | "error";
  receivedBytes: number;
  totalBytes: number;
  /** Base-model (multi-file) progress; `null` for a single GGUF. */
  totalFiles: number | null;
  completedFiles: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  /** Final on-disk location: the GGUF file path, or the base-model repo dir. */
  destPath: string | null;
}

// A repo id is `owner/name`; a file path is a clean relative `.gguf` path. Both
// are strictly validated before being interpolated into the Hugging Face URL so
// nothing can escape the host or path-traverse the local models dir.
const HF_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const HF_FILE_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.gguf$/i;
const QUANT_RE = /\b(IQ\d+(?:_[A-Za-z0-9]+)*|Q\d+(?:_[A-Za-z0-9]+)*|BF16|F16|F32|MXFP4)\b/i;

// Curated list of popular models for the "Featured" tab
const FEATURED_MODELS: MarketplaceModel[] = [
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B",
    source: "ollama",
    description: "Meta's Llama 3.1 8B — fast, capable open-source LLM for local inference.",
    tags: ["llm", "general", "popular"],
    pullCommand: "ollama pull llama3.1:8b",
  },
  {
    id: "mistral:7b",
    name: "Mistral 7B",
    source: "ollama",
    description: "Mistral AI's 7B model — efficient and versatile for most tasks.",
    tags: ["llm", "general", "popular"],
    pullCommand: "ollama pull mistral:7b",
  },
  {
    id: "phi-3:mini",
    name: "Phi-3 Mini",
    source: "ollama",
    description: "Microsoft's Phi-3 mini — tiny and fast, great for edge devices.",
    tags: ["llm", "lightweight"],
    pullCommand: "ollama pull phi-3:mini",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 9B",
    source: "ollama",
    description: "Google's Gemma 2 9B — high performance open-source model.",
    tags: ["llm", "general"],
    pullCommand: "ollama pull gemma2:9b",
  },
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    source: "ollama",
    description: "Alibaba's Qwen 2.5 7B — multilingual and code-aware.",
    tags: ["llm", "code", "multilingual"],
    pullCommand: "ollama pull qwen2.5:7b",
  },
  {
    id: "codellama:7b",
    name: "Code Llama 7B",
    source: "ollama",
    description: "Meta's Code Llama 7B — specialized for code generation and understanding.",
    tags: ["llm", "code"],
    pullCommand: "ollama pull codellama:7b",
  },
  {
    id: "llava:latest",
    name: "LLaVA",
    source: "ollama",
    description: "LLaVA — vision-language model for image understanding.",
    tags: ["multimodal", "vision"],
    pullCommand: "ollama pull llava:latest",
  },
  {
    id: "deepseek-coder:6.7b",
    name: "DeepSeek Coder 6.7B",
    source: "ollama",
    description: "DeepSeek's code-specialized 6.7B model.",
    tags: ["llm", "code"],
    pullCommand: "ollama pull deepseek-coder:6.7b",
  },
];

export class ModelMarketplaceService {
  private static instance: ModelMarketplaceService | null = null;

  /**
   * In-memory registry of background downloads, polled by the client. Kept in
   * memory (not the DB): a fresh process simply has no in-flight downloads, and
   * a finished file is discovered on disk by `ModelIndexService` regardless.
   */
  private readonly downloads = new Map<string, HfDownloadStatus>();

  private constructor() {}

  public static getInstance(): ModelMarketplaceService {
    if (!ModelMarketplaceService.instance) {
      ModelMarketplaceService.instance = new ModelMarketplaceService();
    }
    return ModelMarketplaceService.instance;
  }

  /**
   * Get curated featured models (no network calls)
   */
  getHotModels(): MarketplaceModel[] {
    return FEATURED_MODELS;
  }

  /**
   * Search Ollama library via ollamadb.dev API
   * Degrades gracefully if API is unavailable
   */
  async searchOllama(query: string, limit: number): Promise<MarketplaceModel[]> {
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        sort_by: "pulls",
        order: "desc",
      });
      if (query) params.set("search", query);

      const res = await fetch(`https://ollamadb.dev/api/v1/models?${params}`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log.warn(`[Ollama] Registry returned ${res.status}, degrading gracefully`);
        return [];
      }

      const data = (await res.json()) as {
        data: Array<{
          model_identifier: string;
          description: string;
          labels: string[];
          pulls: number;
          tags: number;
          last_updated: string;
          url: string;
        }>;
        total_count: number;
      };

      return (data.data ?? []).map(m => ({
        id: m.model_identifier,
        name: m.model_identifier,
        source: "ollama" as const,
        description: m.description || "No description available",
        tags: m.labels ?? [],
        downloads: m.pulls ?? 0,
        url: m.url,
        pullCommand: `ollama pull ${m.model_identifier}`,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[Ollama] Search failed: ${msg}, returning empty array`);
      return [];
    }
  }

  /**
   * Search HuggingFace models. Works anonymously for public models (local-first,
   * no key required); a HUGGINGFACE_API_KEY, when set, is sent for gated models
   * and higher rate limits.
   */
  async searchHuggingFace(query: string, limit: number): Promise<MarketplaceModel[]> {
    try {
      const params = new URLSearchParams({
        search: query || "",
        filter: "text-generation",
        limit: String(limit),
        sort: "downloads",
      });

      const res = await fetch(`https://huggingface.co/api/models?${params}`, {
        headers: { Accept: "application/json", ...this.hfHeaders() },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log.warn(`[HuggingFace] API returned ${res.status}, degrading gracefully`);
        return [];
      }

      const data = (await res.json()) as Array<{
        id: string;
        modelId: string;
        name?: string;
        description?: string;
        tags?: string[];
        downloads?: number;
        url?: string;
      }>;

      // Filter to text-generation models and map to MarketplaceModel
      return (Array.isArray(data) ? data : [])
        .filter(m => m.tags?.includes("text-generation") ?? false)
        .slice(0, limit)
        .map(m => ({
          id: m.id || m.modelId,
          name: m.name || m.modelId,
          source: "huggingface" as const,
          description: m.description || "No description available",
          tags: m.tags ?? [],
          downloads: m.downloads,
          huggingFaceId: m.modelId,
          url: m.url || `https://huggingface.co/${m.modelId}`,
        }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[HuggingFace] Search failed: ${msg}, returning empty array`);
      return [];
    }
  }

  /**
   * Search all sources in parallel, merge and deduplicate results
   */
  async searchAll(query: string, limit: number): Promise<MarketplaceModel[]> {
    const [ollamaResults, hfResults] = await Promise.allSettled([
      this.searchOllama(query, limit),
      this.searchHuggingFace(query, limit),
    ]);

    const results: MarketplaceModel[] = [];
    const seenIds = new Set<string>();

    // Collect Ollama results
    if (ollamaResults.status === "fulfilled") {
      for (const model of ollamaResults.value) {
        if (!seenIds.has(model.id)) {
          results.push(model);
          seenIds.add(model.id);
        }
      }
    }

    // Collect HuggingFace results
    if (hfResults.status === "fulfilled") {
      for (const model of hfResults.value) {
        if (!seenIds.has(model.id)) {
          results.push(model);
          seenIds.add(model.id);
        }
      }
    }

    // Sort by downloads/popularity (if available)
    results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));

    return results.slice(0, limit);
  }

  // ── Hugging Face GGUF download (into Omnecor's own local runtime) ────────────
  //
  // Browse a repo's .gguf files (each quant separately, with its real size) and
  // stream a chosen file into PATHS.models. ModelIndexService then discovers it,
  // so it becomes an "omnecor-runtime" catalog entry the local llama-server can
  // load — no Ollama required. Downloads work anonymously for public repos; a
  // HUGGINGFACE_API_KEY (if set) is sent for gated repos / higher rate limits.
  // Not gated by Sovereign mode: a download is a fetch, not AI inference, and an
  // air-gapped user still needs to populate local models.

  private hfHeaders(): Record<string, string> {
    return ENV.huggingfaceApiKey ? { Authorization: `Bearer ${ENV.huggingfaceApiKey}` } : {};
  }

  private parseQuant(filename: string): string | null {
    const m = filename.match(QUANT_RE);
    return m ? m[1].toUpperCase() : null;
  }

  /** Free bytes on the filesystem holding `dir` (walks up to the nearest existing ancestor). `null` if unknowable. */
  private async _freeBytes(dir: string): Promise<number | null> {
    try {
      let probe = dir;
      for (let i = 0; i < 12; i++) {
        if (await fs.stat(probe).then(() => true).catch(() => false)) break;
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
      const st = await fs.statfs(probe);
      return st.bsize * st.bavail;
    } catch {
      return null; // statfs unsupported on this platform/Node — don't block the download
    }
  }

  /** Fail fast (before streaming GB to disk) when the volume clearly can't hold the download. */
  private async _assertEnoughSpace(dir: string, requiredBytes: number): Promise<void> {
    if (requiredBytes <= 0) return;
    const free = await this._freeBytes(dir);
    if (free !== null && free < requiredBytes * 1.05) {
      const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
      throw new Error(
        `Not enough disk space for this download — need ~${gb(requiredBytes)} GB, but only ${gb(free)} GB is free.`,
      );
    }
  }

  /**
   * List the `.gguf` files in a Hugging Face repo (recursive), each with its
   * real content size so the user can pick a quant that fits their hardware.
   */
  async listRepoFiles(repoId: string): Promise<HfRepoFile[]> {
    if (!HF_REPO_RE.test(repoId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid Hugging Face repo id "${repoId}" (expected "owner/name").` });
    }
    const tree = await this._listRepoTree(repoId);
    return tree
      .filter((e) => e.path.toLowerCase().endsWith(".gguf"))
      .map((e) => ({
        path: e.path,
        filename: path.basename(e.path),
        sizeBytes: e.size,
        quant: this.parseQuant(e.path),
      }))
      .sort((a, b) => a.sizeBytes - b.sizeBytes);
  }

  /**
   * Kick off a background download of one repo file into PATHS.models. Returns
   * immediately with a tracking id; the client polls `getDownloadStatus(id)`.
   */
  startHuggingFaceDownload(repoId: string, filePath: string, knownSize = 0): { id: string } {
    if (!HF_REPO_RE.test(repoId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid Hugging Face repo id "${repoId}".` });
    }
    if (!HF_FILE_RE.test(filePath) || filePath.includes("..")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid file path "${filePath}" (must be a clean .gguf path).` });
    }

    // basename() is the second line of defence — even a validated path lands as a
    // flat file in the models dir, never traversing out of it.
    const destPath = path.join(PATHS.models, path.basename(filePath));
    // De-dupe a double-click: if the same file is already downloading, return
    // that in-flight download rather than racing a second write to the same path.
    const inFlight = [...this.downloads.values()].find(
      (d) => d.destPath === destPath && d.state === "downloading",
    );
    if (inFlight) return { id: inFlight.id };

    const id = randomUUID();
    const status: HfDownloadStatus = {
      id,
      repoId,
      kind: "gguf",
      filename: path.basename(filePath),
      state: "downloading",
      receivedBytes: 0,
      totalBytes: knownSize,
      totalFiles: null,
      completedFiles: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      destPath,
    };
    this.downloads.set(id, status);
    this.evictOldDownloads();

    // Detached — do not await; the client polls getDownloadStatus.
    void this._runDownload(status, repoId, filePath, destPath);
    return { id };
  }

  /**
   * Kick off a background download of a WHOLE base-model repo (config +
   * tokenizer + safetensors) into the base-models dir, for offline/sovereign
   * fine-tuning in the LLM Builder. Returns immediately with a tracking id; the
   * client polls `getDownloadStatus(id)` and, on completion, points the trainer
   * at `status.destPath` (a local path `from_pretrained` loads with no network).
   */
  startBaseModelDownload(repoId: string): { id: string } {
    if (!HF_REPO_RE.test(repoId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid Hugging Face repo id "${repoId}".` });
    }
    const destDir = path.join(PATHS.baseModels, repoId.replace("/", "__"));
    const inFlight = [...this.downloads.values()].find(
      (d) => d.destPath === destDir && d.state === "downloading",
    );
    if (inFlight) return { id: inFlight.id };

    const id = randomUUID();
    const status: HfDownloadStatus = {
      id,
      repoId,
      kind: "base-model",
      filename: repoId,
      state: "downloading",
      receivedBytes: 0,
      totalBytes: 0,
      totalFiles: null,
      completedFiles: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      destPath: destDir,
    };
    this.downloads.set(id, status);
    this.evictOldDownloads();
    void this._runBaseModelDownload(status, repoId, destDir);
    return { id };
  }

  getDownloadStatus(id: string): HfDownloadStatus | null {
    return this.downloads.get(id) ?? null;
  }

  /** Keep all in-flight downloads + the most recent finished ones; evict the rest. */
  private evictOldDownloads(keepFinished = 20): void {
    const finished = [...this.downloads.values()]
      .filter((d) => d.state !== "downloading")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const d of finished.slice(0, Math.max(0, finished.length - keepFinished))) {
      this.downloads.delete(d.id);
    }
  }

  /** Active + recently-finished downloads (most recent first). */
  listDownloads(): HfDownloadStatus[] {
    return [...this.downloads.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async _runDownload(
    status: HfDownloadStatus,
    repoId: string,
    filePath: string,
    destPath: string,
  ): Promise<void> {
    try {
      await fs.mkdir(PATHS.models, { recursive: true });

      // Already present on disk → nothing to do (idempotent). ModelIndexService
      // already surfaces it; report done so the UI reflects reality.
      const existing = await fs.stat(destPath).catch(() => null);
      if (existing) {
        status.receivedBytes = existing.size;
        status.totalBytes = existing.size;
        status.state = "done";
        status.finishedAt = new Date().toISOString();
        return;
      }

      await this._assertEnoughSpace(PATHS.models, status.totalBytes);
      await this._streamRepoFile(repoId, filePath, destPath, (n) => { status.receivedBytes += n; }, (total) => {
        if (total > 0) status.totalBytes = total;
      });

      if (!status.totalBytes) status.totalBytes = status.receivedBytes;
      status.state = "done";
      status.finishedAt = new Date().toISOString();
      log.info(`[HuggingFace] Downloaded ${filePath} → ${destPath} (${status.receivedBytes} bytes)`);

      // Make the new model immediately visible to the runtime + catalog.
      await ModelIndexService.getInstance().refresh();
    } catch (err) {
      status.state = "error";
      status.error = err instanceof Error ? err.message : String(err);
      status.finishedAt = new Date().toISOString();
      log.warn(`[HuggingFace] Download failed for ${filePath}: ${status.error}`);
    }
  }

  private async _runBaseModelDownload(
    status: HfDownloadStatus,
    repoId: string,
    destDir: string,
  ): Promise<void> {
    try {
      // List the whole repo, then keep only the files a trainer's
      // `from_pretrained` actually needs — skip other-framework weights and any
      // GGUF quant (this is the full-precision/bnb training repo, not inference).
      const tree = await this._listRepoTree(repoId);
      const hasSafetensors = tree.some((f) => f.path.toLowerCase().endsWith(".safetensors"));
      const wanted = tree.filter((f) => this._isTrainingFile(f.path, hasSafetensors));
      if (wanted.length === 0) {
        throw new Error("Repo has no trainable weight files (expected .safetensors or .bin + config/tokenizer).");
      }

      status.totalFiles = wanted.length;
      status.completedFiles = 0;
      status.totalBytes = wanted.reduce((sum, f) => sum + f.size, 0);
      await this._assertEnoughSpace(PATHS.baseModels, status.totalBytes);
      await fs.mkdir(destDir, { recursive: true });

      for (const file of wanted) {
        const dest = path.join(destDir, file.path);
        // Guard against a crafted repo path escaping destDir.
        if (!path.resolve(dest).startsWith(path.resolve(destDir) + path.sep)) {
          throw new Error(`Unsafe file path in repo tree: ${file.path}`);
        }
        const existing = await fs.stat(dest).catch(() => null);
        if (existing && existing.size === file.size && file.size > 0) {
          // Already fully downloaded (resume at file granularity).
          status.receivedBytes += existing.size;
          status.completedFiles += 1;
          continue;
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await this._streamRepoFile(repoId, file.path, dest, (n) => { status.receivedBytes += n; });
        status.completedFiles += 1;
      }

      status.state = "done";
      status.finishedAt = new Date().toISOString();
      log.info(`[HuggingFace] Downloaded base model ${repoId} → ${destDir} (${status.completedFiles}/${status.totalFiles} files, ${status.receivedBytes} bytes)`);
    } catch (err) {
      status.state = "error";
      status.error = err instanceof Error ? err.message : String(err);
      status.finishedAt = new Date().toISOString();
      log.warn(`[HuggingFace] Base-model download failed for ${repoId}: ${status.error}`);
    }
  }

  /** Raw HF tree listing (all files) — shared by listRepoFiles + base-model download. */
  private async _listRepoTree(repoId: string): Promise<Array<{ path: string; size: number }>> {
    const res = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`, {
      headers: { Accept: "application/json", ...this.hfHeaders() },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Hugging Face repo "${repoId}" not found (or gated — set HUGGINGFACE_API_KEY).` });
    }
    if (!res.ok) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Hugging Face API returned ${res.status} for "${repoId}".` });
    }
    const tree = (await res.json()) as Array<{ type?: string; path?: string; size?: number; lfs?: { size?: number } }>;
    return (Array.isArray(tree) ? tree : [])
      .filter((e) => e.type === "file" && typeof e.path === "string")
      .map((e) => ({ path: e.path!, size: e.lfs?.size ?? e.size ?? 0 }));
  }

  /** True for files a `from_pretrained` load needs; skips other-framework + GGUF blobs. */
  private _isTrainingFile(filePath: string, hasSafetensors: boolean): boolean {
    const lower = filePath.toLowerCase();
    // Never needed for training-from-repo.
    if (/\.(gguf|onnx|msgpack|h5|tflite|ot|npz)$/.test(lower)) return false;
    // Prefer safetensors: skip the redundant PyTorch/pickle weights when present.
    if (hasSafetensors && /\.(bin|pth|pt|ckpt)$/.test(lower)) return false;
    return true;
  }

  /**
   * Stream one repo file to `destPath` (atomic via a .part rename), counting
   * bytes through `onBytes`. `onTotal` (optional) reports Content-Length once.
   */
  private async _streamRepoFile(
    repoId: string,
    filePath: string,
    destPath: string,
    onBytes: (n: number) => void,
    onTotal?: (total: number) => void,
  ): Promise<void> {
    const tmpPath = `${destPath}.part`;
    try {
      const url = `https://huggingface.co/${repoId}/resolve/main/${filePath}`;
      const res = await fetch(url, { headers: this.hfHeaders(), redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`Hugging Face returned ${res.status} for ${filePath}`);
      if (onTotal) {
        const contentLen = Number(res.headers.get("content-length"));
        if (Number.isFinite(contentLen) && contentLen > 0) onTotal(contentLen);
      }
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          onBytes(chunk.length);
          cb(null, chunk);
        },
      });
      const source = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
      await pipeline(source, counter, createWriteStream(tmpPath));
      await fs.rename(tmpPath, destPath);
    } catch (err) {
      // Clean up the partial file so a retry starts fresh.
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
  }
}
