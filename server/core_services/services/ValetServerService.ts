/**
 * ValetServerService — manages the lifecycle of the Valet Router inference server.
 *
 * On startup it reads models/valet-router/current.json and, when an artifact is
 * registered, spawns valet_router_inference.py as a managed child process.
 * Health-checks on :8010/health confirm the server is up, and the service
 * auto-restarts on crash (up to MAX_RESTARTS times with exponential back-off).
 *
 * Set VALET_AUTO_START=false to opt-out of auto-start without removing the artifact.
 */

import { spawn, execFile, ChildProcess } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { ValetArtifactRegistry } from "./ValetArtifactRegistry.js";
import { ENV } from "../../_core/env.js";
import { PYTHON_SCRIPTS } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";

const execFileAsync = promisify(execFile);

const log = createLogger("ValetServer");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/core_services/services/ → ../../python_bridges/
const INFERENCE_SCRIPT = path.resolve(
  __dirname,
  "../../python_bridges/valet_router_inference.py"
);

export class ValetServerService {
  private static instance: ValetServerService | null = null;

  private _proc: ChildProcess | null = null;
  private _restartCount = 0;
  private readonly _maxRestarts = 5;
  private _started = false;
  private _stopping = false;
  /** Python interpreter validated by the runtime preflight; reused across restarts. */
  private _pythonBin: string | null = null;

  static getInstance(): ValetServerService {
    if (!ValetServerService.instance) {
      ValetServerService.instance = new ValetServerService();
    }
    return ValetServerService.instance;
  }

  /**
   * Start the inference server if an artifact is registered.
   * Safe to call multiple times — only acts on the first call.
   */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    if (!ENV.valetAutoStart) {
      log.info("[ValetServer] Auto-start disabled via VALET_AUTO_START=false");
      return;
    }

    // Seed the centralized app-data registry from the bundled/repo current.json
    // when it's missing (fresh machine / fresh install) so the trained model is
    // actually registered instead of silently falling back to keyword routing.
    if (await ValetArtifactRegistry.seedFromRepoIfMissing()) {
      log.info(
        "[ValetServer] Seeded artifact registry from bundled current.json " +
          `→ ${ValetArtifactRegistry.currentJsonPath}`
      );
    }

    const artifact = await ValetArtifactRegistry.read();
    let missingModel = false;

    if (artifact.status === "ready" && artifact.artifact_path && artifact.gguf_file) {
      const ggufPath = path.join(artifact.artifact_path, artifact.gguf_file);
      if (!existsSync(ggufPath)) {
        missingModel = true;
      }
    }

    if (missingModel && artifact.source === "github-release" && artifact.tag && artifact.gguf_file && artifact.artifact_path) {
      log.info(`[ValetServer] Model missing locally. Downloading ${artifact.gguf_file} from GitHub release ${artifact.tag}...`);
      try {
        await ValetArtifactRegistry.downloadGithubRelease(artifact.tag, artifact.gguf_file, artifact.artifact_path);
        missingModel = false;
      } catch (err) {
        log.error(`[ValetServer] Failed to download model: ${(err as Error).message}`);
      }
    }

    if (artifact.status !== "ready" || !artifact.artifact_path || missingModel) {
      log.info(
        "[ValetServer] No usable artifact found locally — inference server not started " +
          "(rule-based keyword fallback active). " +
          "Run 'pnpm valet:fetch' or 'pnpm valet:build' to get a model manually."
      );
      return;
    }

    // Preflight: confirm a usable Python runtime + the minimal FastAPI deps
    // exist BEFORE spawning. On a fresh machine without Python/deps this lets us
    // degrade to rule-based keyword routing with a single actionable log line,
    // instead of thrashing the spawn → ENOENT → crash → backoff loop 5× (~30 s).
    const pythonBin = await this._checkRuntime();
    if (!pythonBin) return;
    this._pythonBin = pythonBin;

    log.info(
      `[ValetServer] Artifact registered (format=${artifact.format ?? "unknown"}) — ` +
        `starting Valet Router inference server (python=${pythonBin})`
    );
    await this._spawn();
  }

  /**
   * Resolve the Python interpreter to use: prefer a provisioned Valet/ML venv
   * (created by packaging/scripts/setup-valet-python) so a bundled installer can
   * ship deps in an isolated env, otherwise fall back to PYTHON_BIN / the system
   * `python`/`python3`.
   */
  private _resolvePythonBin(): string {
    const isWin = process.platform === "win32";
    const venvCandidates = [
      path.join(os.homedir(), ".omnecor", "valet-venv"),
      path.join(os.homedir(), ".omnecor", "ml-venv"),
    ];
    for (const venv of venvCandidates) {
      const bin = isWin
        ? path.join(venv, "Scripts", "python.exe")
        : path.join(venv, "bin", "python");
      if (existsSync(bin)) return bin;
    }
    return PYTHON_SCRIPTS.pythonBin;
  }

  /**
   * Verify the Valet inference server can actually run before spawning it.
   * Checks that the resolved Python interpreter exists and that the minimal
   * hard dependencies import (`fastapi`, `uvicorn`, `pydantic` — the GGUF
   * `llama_cpp` / `transformers` backends are optional and loaded lazily by the
   * bridge). Returns the resolved python bin when ready, or null to keep the
   * server disabled (rule-based keyword fallback stays active).
   */
  private async _checkRuntime(): Promise<string | null> {
    const pythonBin = this._resolvePythonBin();
    try {
      await execFileAsync(pythonBin, ["-c", "import fastapi, uvicorn, pydantic"], { timeout: 8000 });
      return pythonBin;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        log.warn(
          `[ValetServer] Python interpreter not found ('${pythonBin}') — Valet inference ` +
            "server disabled; rule-based keyword routing remains active. Install Python 3.10+ " +
            "or run packaging/scripts/setup-valet-python, then restart to enable local Valet inference."
        );
      } else {
        log.warn(
          "[ValetServer] Python is present but the Valet inference dependencies are missing " +
            "(need: fastapi, uvicorn, pydantic) — server disabled; rule-based keyword routing " +
            "remains active. Provision them with packaging/scripts/setup-valet-python " +
            `(creates ~/.omnecor/valet-venv). Detail: ${e.message}`
        );
      }
      return null;
    }
  }

  /**
   * Restart the inference server — used after swapping the active model.
   * Stops the running process, resets state flags, then re-starts.
   */
  async restart(): Promise<void> {
    await this.stop();
    this._started = false;
    this._stopping = false;
    this._restartCount = 0;
    await this.start();
  }

  /**
   * Stop the inference server gracefully (called on app shutdown).
   */
  async stop(): Promise<void> {
    this._stopping = true;
    if (!this._proc) return;

    log.info("[ValetServer] Stopping inference server");
    this._proc.kill("SIGTERM");

    // Force-kill after 5 s if still alive
    const forceKill = setTimeout(() => {
      if (this._proc && !this._proc.killed) {
        this._proc.kill("SIGKILL");
      }
    }, 5000);

    // Wait for exit
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
    log.info("[ValetServer] Inference server stopped");
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _spawn(): Promise<void> {
    if (this._stopping) return;

    let port = "8010";
    try {
      port = new URL(ENV.valetRouterUrl).port || "8010";
    } catch { /* ENV.valetRouterUrl malformed — use default */ }

    this._proc = spawn(this._pythonBin ?? PYTHON_SCRIPTS.pythonBin, [INFERENCE_SCRIPT], {
      env: {
        ...(process.env as Record<string, string>),
        PYTHONUNBUFFERED: "1",
        VALET_ROUTER_PORT: port,
        OLLAMA_URL: ENV.ollamaUrl,
        // Pin the Python bridge to the same registry dir the TS side reads/writes
        // (PATHS.valetRouter → %APPDATA% on Windows), so both always agree.
        VALET_REGISTRY_ROOT: ValetArtifactRegistry.registryRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    log.info(`[ValetServer] Spawned inference server (pid=${this._proc.pid})`);

    this._proc.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const t = line.trim();
        if (t) log.info(`[ValetServer] ${t}`);
      }
    });

    // uvicorn logs to stderr — treat as info, not errors
    this._proc.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        const t = line.trim();
        if (t) log.info(`[ValetServer] ${t}`);
      }
    });

    this._proc.on("close", (code, signal) => {
      log.info(`[ValetServer] Process exited (code=${code}, signal=${signal})`);
      this._proc = null;
      if (!this._stopping && code !== 0) {
        this._handleCrash();
      }
    });

    this._proc.on("error", err => {
      log.warn(`[ValetServer] Spawn error: ${err.message}`);
      this._proc = null;
      if (!this._stopping) this._handleCrash();
    });

    await this._waitForHealth();
  }

  private _handleCrash(): void {
    if (this._restartCount >= this._maxRestarts) {
      log.error(
        `[ValetServer] Max restarts (${this._maxRestarts}) reached — ` +
          "inference server will not be restarted. Rule-based fallback remains active."
      );
      return;
    }
    this._restartCount++;
    const delayMs = 2000 * this._restartCount;
    log.warn(
      `[ValetServer] Server crashed — restart ${this._restartCount}/${this._maxRestarts} in ${delayMs}ms`
    );
    setTimeout(() => this._spawn(), delayMs);
  }

  private async _waitForHealth(): Promise<void> {
    const healthUrl = `${ENV.valetRouterUrl}/health`;
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = (await res.json()) as {
            model_loaded: boolean;
            backend?: string;
          };
          if (data.model_loaded) {
            log.info(
              `[ValetServer] Ready — model loaded (backend: ${data.backend ?? "unknown"})`
            );
          } else {
            log.info(
              "[ValetServer] Server online — model loading in background " +
                "(rule-based fallback until load completes)"
            );
          }
          this._restartCount = 0; // reset crash counter after clean start
          return;
        }
      } catch {
        /* not ready yet — keep polling */
      }
    }
    log.warn(
      "[ValetServer] Health check timed out after 30 s — " +
        "server may still be loading (check logs above)"
    );
  }
}
