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

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ValetArtifactRegistry } from "./ValetArtifactRegistry.js";
import { ENV } from "../../_core/env.js";
import { PYTHON_SCRIPTS } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("ValetServer");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/phase2/services/ → ../../python_bridges/
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

    const artifact = await ValetArtifactRegistry.read();
    if (artifact.status !== "ready" || !artifact.artifact_path) {
      log.info(
        "[ValetServer] No registered artifact — inference server not started " +
          "(rule-based keyword fallback active). " +
          "Run 'pnpm valet:fetch' or 'pnpm valet:build' to get a model."
      );
      return;
    }

    log.info(
      `[ValetServer] Artifact registered (format=${artifact.format ?? "unknown"}) — ` +
        "starting Valet Router inference server"
    );
    await this._spawn();
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

    this._proc = spawn(PYTHON_SCRIPTS.pythonBin, [INFERENCE_SCRIPT], {
      env: {
        ...(process.env as Record<string, string>),
        PYTHONUNBUFFERED: "1",
        VALET_ROUTER_PORT: port,
        OLLAMA_URL: ENV.ollamaUrl,
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
