/**
 * LocalLlmRuntimeService — Omnecor-owned local LLM runtime (Model-Fabric Phase 1).
 *
 * Supervises `llama-server` (llama.cpp's OpenAI-compatible HTTP server) as a
 * managed child process, the same way ValetServerService supervises the Valet
 * Router's Python inference server. This is what lets the "llamacpp" provider
 * work WITHOUT Ollama: Omnecor spawns its own inference engine, posts the raw
 * `/completion` endpoint (no chat template applied server-side — see
 * AiProviderService.chatLocalLlm), and streams tokens back.
 *
 * Set LOCAL_LLM_AUTO_START=false to opt out. Absent a `llama-server` binary or
 * a discoverable .gguf model, the service logs one actionable line and stays
 * offline — the app boots fine either way (Ollama/cloud providers still work).
 */

import { spawn, execFile, ChildProcess } from "child_process";
import { promisify } from "util";
import { existsSync, statSync } from "fs";
import path from "path";
import { ENV } from "../../_core/env.js";
import { PATHS } from "../../_core/paths.js";
import { createLogger } from "../../_core/logger.js";
import { ModelIndexService, type IndexedModel } from "./ModelIndexService.js";
import { collectGpuTelemetry } from "../../ommesh/core/HostTelemetry.js";
import { getSetting, setSetting } from "./SettingsService.js";

const execFileAsync = promisify(execFile);
const log = createLogger("LocalLlmRuntime");

/** Persisted last-loaded model id, so a restart resumes the same selection. */
const LAST_MODEL_SETTING = "localLlmLastModel";

/** Headroom (MB) reserved for the KV cache + context when fitting a model to VRAM. */
const VRAM_KV_RESERVE_MB = 1024;

/** Candidate install locations checked when `llama-server` isn't on PATH. */
function platformBinaryCandidates(bin: string): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (process.platform === "win32") {
    return [
      `${bin}.exe`,
      "C:\\llama.cpp\\llama-server.exe",
      path.join(home, "llama.cpp", "build", "bin", "Release", "llama-server.exe"),
    ];
  }
  return [
    bin,
    "/usr/local/bin/llama-server",
    "/usr/bin/llama-server",
    "/opt/homebrew/bin/llama-server",
    path.join(home, "llama.cpp", "build", "bin", "llama-server"),
    path.join(home, ".local", "bin", "llama-server"),
  ];
}

export class LocalLlmRuntimeService {
  private static instance: LocalLlmRuntimeService | null = null;

  private _proc: ChildProcess | null = null;
  private _restartCount = 0;
  private readonly _maxRestarts = 5;
  private _started = false;
  private _stopping = false;
  private _ready = false;
  /** True during the backoff delay between a crash and the scheduled respawn. */
  private _restartScheduled = false;
  private _binPath: string | null = null;
  private _modelPath: string | null = null;
  /** Index id of the currently-loaded model (catalog `modelId`), null when none. */
  private _loadedModelId: string | null = null;
  /** `--n-gpu-layers` value used for the current model (computed per-model to fit VRAM). */
  private _gpuLayers: string = ENV.localLlmGpuLayers;
  /**
   * Serializes ALL llama-server lifecycle work — boot load, hot-swap, and
   * crash respawn — so no two paths ever touch `_proc` concurrently (which
   * could otherwise orphan a server on the port and null out `_proc`).
   */
  private _chain: Promise<unknown> = Promise.resolve();
  private _port: string = ENV.localLlmPort;

  static getInstance(): LocalLlmRuntimeService {
    if (!LocalLlmRuntimeService.instance) {
      LocalLlmRuntimeService.instance = new LocalLlmRuntimeService();
    }
    return LocalLlmRuntimeService.instance;
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  getModelPath(): string | null {
    return this._modelPath;
  }

  /** Index id of the currently-loaded model (used for the catalog's `loaded` flag). */
  getLoadedModelId(): string | null {
    return this._loadedModelId;
  }

  /**
   * True when a `llama-server` binary is resolvable — i.e. this node *can* host
   * GGUF models, even if none is loaded yet. Distinct from `isReady()` (a model
   * is loaded and serving). The catalog lists every indexed model as hostable
   * whenever this is true; `isReady()` only flags which one is warm.
   */
  isAvailable(): boolean {
    return this._binPath !== null;
  }

  /** Every local GGUF this node can host (models dir + Ollama blob store). */
  listModels(): IndexedModel[] {
    return ModelIndexService.getInstance().list();
  }

  /** Last-known health state (updated by the health poll, not a live probe). */
  isReady(): boolean {
    return this._ready;
  }

  /**
   * Ensure a specific model is the one loaded and serving (Model-Fabric
   * Phase 8 hot-swap). `idOrPath` is a catalog `modelId` / index id / file path;
   * omitted → just ensure *some* (default) model is warm. Stops the current
   * `llama-server` and starts one for the requested model when they differ.
   * Serialized so overlapping requests swap once, not N times.
   */
  async ensureModelLoaded(idOrPath?: string): Promise<boolean> {
    if (!this._started) await this.start();
    if (!this._binPath) return false;
    return this._enqueue(() => this._doEnsure(idOrPath));
  }

  /**
   * Run `task` only after every previously-queued lifecycle task finishes —
   * the single serialization point for the managed process. `ensureModelLoaded`
   * (hot-swap), `start()` (boot load) and `_handleCrash` (respawn) all funnel
   * through here, so no two can spawn/kill `_proc` at once. The chain never
   * rejects, so one failed task can't wedge the ones behind it.
   */
  private _enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this._chain.then(task, task);
    this._chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async _doEnsure(idOrPath?: string): Promise<boolean> {
    if (idOrPath) {
      const index = ModelIndexService.getInstance();
      let target = index.resolve(idOrPath);
      if (!target) {
        // Might be a just-added model the cache hasn't picked up — rescan once.
        await index.refresh();
        target = index.resolve(idOrPath);
      }
      if (target) {
        if (this._loadedModelId === target.id && this._ready) return true;
        await this._loadModel(target);
        return this._ready;
      }
      log.warn(
        `[LocalLlmRuntime] Requested model "${idOrPath}" is not in the local index — ` +
          "serving the currently-loaded model instead.",
      );
    }
    if (this._ready) return true;
    const def = this._defaultModel();
    if (!def) return false;
    await this._loadModel(def);
    return this._ready;
  }

  /** Boot the given model unless a concurrent request already warmed one. */
  private async _bootLoad(target: IndexedModel): Promise<void> {
    if (this._ready) return;
    await this._loadModel(target);
  }

  /** Stop whatever is loaded, then bring up `target`: fit to VRAM, spawn, persist. */
  private async _loadModel(target: IndexedModel): Promise<void> {
    if (this._proc) await this.stop();
    this._stopping = false;
    this._modelPath = target.path;
    this._loadedModelId = target.id;
    this._gpuLayers = await this._computeGpuLayers(target.sizeBytes);
    this._restartCount = 0;
    log.info(
      `[LocalLlmRuntime] Loading "${target.name}" (${(target.sizeBytes / 1024 ** 3).toFixed(2)} GB, ` +
        `n-gpu-layers=${this._gpuLayers})`,
    );
    await this._spawn();
    if (this._ready) {
      try {
        setSetting(LAST_MODEL_SETTING, target.id);
      } catch {
        /* persistence is best-effort — a warm model is what matters */
      }
    }
  }

  /**
   * Start the local runtime if a binary + model are available. Safe to call
   * multiple times — only acts on the first call. Resolves once the server is
   * confirmed healthy or the readiness poll times out (mirrors
   * ValetServerService, so boot never hangs waiting on this).
   */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    if (!ENV.localLlmAutoStart) {
      log.info("[LocalLlmRuntime] Auto-start disabled via LOCAL_LLM_AUTO_START=false");
      return;
    }

    const bin = await this._resolveBinary();
    if (!bin) {
      log.info(
        "[LocalLlmRuntime] llama-server binary not found — local runtime disabled. " +
          "Install llama.cpp (https://github.com/ggml-org/llama.cpp#build) or set " +
          "LLAMA_SERVER_BIN to its path. The llamacpp provider will report unavailable " +
          "until then; Ollama/cloud providers are unaffected."
      );
      return;
    }
    this._binPath = bin;

    // Prime the model index once (async, off the request hot path) so
    // _defaultModel and the first catalog fetch see a populated list.
    await ModelIndexService.getInstance()
      .refresh()
      .catch((err) => log.warn(`[LocalLlmRuntime] initial model scan failed: ${err?.message ?? err}`));

    const def = this._defaultModel();
    if (!def) {
      const count = ModelIndexService.getInstance().list().length;
      log.info(
        count > 0
          ? `[LocalLlmRuntime] Available with ${count} hostable model(s); none warmed yet — ` +
              "will load on first selection (or the last one used, once persisted)."
          : `[LocalLlmRuntime] No .gguf model found (searched ${PATHS.models} and the Ollama ` +
              "store) — runtime is available but idle. Place a .gguf under the models dir, " +
              "pull one with Ollama, or set LOCAL_LLM_MODEL_PATH."
      );
      return;
    }

    log.info(`[LocalLlmRuntime] Starting llama-server (bin=${bin})`);
    // Serialized: yields to a model a concurrent request may already be loading.
    await this._enqueue(() => this._bootLoad(def));
  }

  /**
   * Choose the model to warm at boot: an explicit `LOCAL_LLM_MODEL_PATH`, else
   * the last model the user had loaded (persisted). Otherwise `null` — the
   * runtime stays *available* (it lists every indexed model as hostable) but
   * loads nothing until the user picks one, rather than guessing and pinning a
   * possibly-huge model in VRAM the user never asked for.
   */
  private _defaultModel(): IndexedModel | null {
    const index = ModelIndexService.getInstance();
    if (ENV.localLlmModelPath && existsSync(ENV.localLlmModelPath)) {
      return (
        index.resolve(ENV.localLlmModelPath) ?? {
          id: path.basename(ENV.localLlmModelPath),
          name: path.basename(ENV.localLlmModelPath).replace(/\.gguf$/i, ""),
          path: ENV.localLlmModelPath,
          sizeBytes: (() => {
            try {
              return statSync(ENV.localLlmModelPath).size;
            } catch {
              return 0;
            }
          })(),
          source: "models-dir",
        }
      );
    }
    const last = getSetting<string>(LAST_MODEL_SETTING, "");
    return last ? index.resolve(last) : null;
  }

  /**
   * Compute `--n-gpu-layers` to fit `sizeBytes` in available VRAM, the way
   * Ollama does: everything on the GPU when it fits, otherwise a proportional
   * partial offload (rest on CPU — slower but it runs, instead of an OOM
   * crash-loop). An explicit numeric `LOCAL_LLM_GPU_LAYERS` overrides this;
   * "auto" (the default) triggers the fit. No GPU / no telemetry → CPU only.
   */
  private async _computeGpuLayers(sizeBytes: number): Promise<string> {
    const override = ENV.localLlmGpuLayers;
    if (override && override !== "auto") return override;
    try {
      const { vram } = await collectGpuTelemetry(); // free VRAM in MB
      if (!vram || vram <= 0) return "0";
      const modelMb = sizeBytes / (1024 * 1024);
      const budgetMb = vram * 0.9 - VRAM_KV_RESERVE_MB;
      if (budgetMb <= 0) return "0";
      if (modelMb <= budgetMb) return "999"; // whole model on the GPU
      const layers = Math.max(0, Math.floor(99 * (budgetMb / modelMb)));
      return String(layers);
    } catch {
      // Can't read VRAM → CPU-only is the safe default (never risk an OOM
      // crash-loop by blindly offloading everything).
      return "0";
    }
  }

  /** Restart with the currently-resolved binary/model (used after a config change). */
  async restart(): Promise<void> {
    await this.stop();
    this._started = false;
    this._stopping = false;
    this._restartCount = 0;
    await this.start();
  }

  async stop(): Promise<void> {
    this._stopping = true;
    this._ready = false;
    if (!this._proc) return;

    log.info("[LocalLlmRuntime] Stopping llama-server");
    this._proc.kill("SIGTERM");

    const forceKill = setTimeout(() => {
      if (this._proc && !this._proc.killed) this._proc.kill("SIGKILL");
    }, 5000);

    await new Promise<void>(resolve => {
      if (!this._proc) {
        clearTimeout(forceKill);
        resolve();
        return;
      }
      this._proc.once("close", () => {
        clearTimeout(forceKill);
        resolve();
      });
    });

    this._proc = null;
    log.info("[LocalLlmRuntime] llama-server stopped");
  }

  /**
   * Called from the chat dispatch path before use. If start() was never
   * invoked (auto-start off) or the process died without exhausting restarts,
   * this gives one more chance to come up. Waits briefly for readiness rather
   * than failing on a cold start.
   */
  async ensureReady(waitMs = 8000): Promise<boolean> {
    if (this._ready) return true;
    if (!this._started) await this.start();
    if (this._ready) return true;
    // No live process AND no restart pending — genuinely nothing to wait for
    // (never spawned, or max restarts already exhausted). A crash mid-backoff
    // (_proc null, _restartScheduled true) still falls through to the poll
    // below instead of failing immediately on a restart that's seconds away.
    if (!this._proc && !this._restartScheduled) return false;

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (this._ready) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return this._ready;
  }

  // ── private ────────────────────────────────────────────────────────────

  private async _resolveBinary(): Promise<string | null> {
    const configured = ENV.localLlmBin;

    // Explicit LLAMA_SERVER_BIN: honor it exactly. Silently falling through to
    // an unrelated system "llama-server" if the configured one is missing
    // would mask a real misconfiguration (wrong path, wrong build) by quietly
    // running a different binary than the one the operator asked for.
    if (configured !== "llama-server") {
      if (path.isAbsolute(configured) || configured.includes(path.sep)) {
        if (existsSync(configured)) return configured;
        log.warn(`[LocalLlmRuntime] LLAMA_SERVER_BIN=${configured} does not exist`);
        return null;
      }
      try {
        await execFileAsync(configured, ["--version"], { timeout: 4000 });
        return configured;
      } catch {
        log.warn(`[LocalLlmRuntime] LLAMA_SERVER_BIN=${configured} is not runnable`);
        return null;
      }
    }

    // No explicit override — search the standard "llama-server" locations.
    for (const candidate of platformBinaryCandidates(configured)) {
      if (path.isAbsolute(candidate) || candidate.includes(path.sep)) {
        if (existsSync(candidate)) return candidate;
        continue;
      }
      // Bare command name — verify it actually runs via --version rather than
      // just checking PATH, since a stale/broken shim would otherwise pass.
      try {
        await execFileAsync(candidate, ["--version"], { timeout: 4000 });
        return candidate;
      } catch {
        // not runnable under this name — try the next candidate
      }
    }
    return null;
  }

  private async _spawn(): Promise<void> {
    this._restartScheduled = false;
    if (this._stopping || !this._binPath || !this._modelPath) return;

    const args = [
      "--model", this._modelPath,
      "--port", this._port,
      "--host", "127.0.0.1",
      "--ctx-size", ENV.localLlmCtxSize,
      "--n-gpu-layers", this._gpuLayers,
      "--no-webui",
    ];

    this._proc = spawn(this._binPath, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`[LocalLlmRuntime] Spawned llama-server (pid=${this._proc.pid}, port=${this._port})`);

    this._proc.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const t = line.trim();
        if (t) log.info(`[LocalLlmRuntime] ${t}`);
      }
    });
    // llama-server logs its normal startup/progress banner to stderr — treat
    // as info, not errors (same convention as ValetServerService/uvicorn).
    this._proc.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const t = line.trim();
        if (t) log.info(`[LocalLlmRuntime] ${t}`);
      }
    });

    this._proc.on("close", (code, signal) => {
      log.info(`[LocalLlmRuntime] Process exited (code=${code}, signal=${signal})`);
      this._proc = null;
      this._ready = false;
      if (!this._stopping && code !== 0) this._handleCrash();
    });

    this._proc.on("error", err => {
      log.warn(`[LocalLlmRuntime] Spawn error: ${err.message}`);
      this._proc = null;
      this._ready = false;
      if (!this._stopping) this._handleCrash();
    });

    await this._waitForHealth();
  }

  private _handleCrash(): void {
    if (this._restartCount >= this._maxRestarts) {
      this._restartScheduled = false;
      log.error(
        `[LocalLlmRuntime] Max restarts (${this._maxRestarts}) reached — ` +
          "llama-server will not be restarted. The llamacpp provider stays offline " +
          "until the app is restarted."
      );
      return;
    }
    this._restartCount++;
    this._restartScheduled = true;
    const delayMs = 2000 * this._restartCount;
    log.warn(
      `[LocalLlmRuntime] llama-server crashed — restart ${this._restartCount}/${this._maxRestarts} in ${delayMs}ms`
    );
    // Serialize the respawn with any in-flight swap, and skip it if a swap
    // already brought a process back up in the meantime (no double-spawn).
    setTimeout(() => {
      void this._enqueue(() => (this._proc ? Promise.resolve() : this._spawn()));
    }, delayMs);
  }

  /**
   * llama-server's HTTP listener opens before the model finishes loading, and
   * /health itself 503s with {"message":"Loading model"} until is_ready flips
   * — so poll for a 200, not just a connection. Model loading (especially a
   * large quant, cold disk cache) can legitimately take longer than Valet's
   * 30s budget, so this uses a longer 90s deadline.
   */
  private async _waitForHealth(): Promise<void> {
    const healthUrl = `${this.getBaseUrl()}/health`;
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000));
      // Bail the moment the process is gone (crash) or a stop/swap is under way
      // — don't keep polling a dead port for the full 90s, which would also
      // stall the serialized crash-respawn queued behind this spawn.
      if (this._stopping || !this._proc) return;
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          log.info(`[LocalLlmRuntime] Ready — serving ${this._modelPath} on ${this.getBaseUrl()}`);
          this._ready = true;
          this._restartCount = 0;
          return;
        }
      } catch {
        /* not listening yet — keep polling */
      }
    }
    log.warn(
      "[LocalLlmRuntime] Health check timed out after 90s — model may still be loading " +
        "(check logs above for progress)"
    );
  }
}
