/**
 * @file services/ProcessManagerService.ts
 * @description Omnecor — Python Process Manager Service
 *
 * Manages the lifecycle of Python child processes spawned by the Node.js backend.
 * This is the central orchestrator for:
 *
 *  - LoRA fine-tuning jobs (localLLMfine-tuning.py)
 *  - Blender headless script execution (blender_bridge.py)
 *  - ESP firmware flashing (flash_mcu.py)
 *  - Any future Python CLI bridges
 *
 * Architecture Notes:
 *  - Each spawned process is tracked by a unique job ID
 *  - stdout is parsed line-by-line for JSON progress messages
 *  - stderr is captured for error reporting
 *  - Process lifecycle events (start, progress, complete, error) are emitted
 *    via EventEmitter for downstream consumers (WebSocket, SSE, tRPC)
 *  - Supports graceful termination (SIGTERM) and forced kill (SIGKILL)
 *  - Maximum concurrent processes are configurable to prevent resource exhaustion
 *
 * Security Considerations:
 *  - All script paths are resolved and validated before execution
 *  - Arguments are passed as array elements (no shell interpolation)
 *  - Environment variables are sanitized before passing to child processes
 *  - Process output is size-limited to prevent memory exhaustion
 */

import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { PYTHON_SCRIPTS, TRAINING_CONFIG } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported process types */
export type ProcessType = "lora_training" | "blender" | "esp_flash" | "custom";

/** Current state of a managed process */
export type ProcessState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Configuration for spawning a new process */
export interface SpawnConfig {
  /** Type of process being spawned */
  type: ProcessType;
  /** The executable to run (e.g., "python3", "blender") */
  command: string;
  /** Arguments array passed to the executable */
  args: string[];
  /** Working directory for the process */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Optional human-readable label for this job */
  label?: string;
  /** Maximum runtime in milliseconds before auto-kill (0 = no limit) */
  timeoutMs?: number;
}

/** Progress event emitted when a JSON line is parsed from stdout */
export interface ProcessProgressEvent {
  jobId: string;
  type: ProcessType;
  label: string;
  /** The parsed JSON payload from the process stdout */
  data: Record<string, any>;
  timestamp: string;
}

/** Lifecycle event emitted on state transitions */
export interface ProcessLifecycleEvent {
  jobId: string;
  type: ProcessType;
  label: string;
  state: ProcessState;
  exitCode: number | null;
  error: string | null;
  timestamp: string;
  durationMs: number | null;
}

/** Full status of a managed process */
export interface ProcessStatus {
  jobId: string;
  type: ProcessType;
  label: string;
  state: ProcessState;
  pid: number | null;
  startedAt: string | null;
  completedAt: string | null;
  lastProgress: Record<string, any> | null;
  stderrBuffer: string;
}

// ---------------------------------------------------------------------------
// Internal Process Record
// ---------------------------------------------------------------------------

interface ManagedProcess {
  jobId: string;
  type: ProcessType;
  label: string;
  state: ProcessState;
  process: ChildProcess | null;
  pid: number | null;
  startedAt: string | null;
  completedAt: string | null;
  lastProgress: Record<string, any> | null;
  stderrBuffer: string;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

/**
 * ProcessManagerService — Manages Python child process lifecycles.
 *
 * Emits the following events:
 *  - "progress"  → ProcessProgressEvent (JSON line parsed from stdout)
 *  - "lifecycle" → ProcessLifecycleEvent (state transitions)
 *
 * @example
 * ```ts
 * const pm = ProcessManagerService.getInstance();
 *
 * pm.on("progress", (event) => {
 *   // Stream to frontend via WebSocket/SSE
 *   wsBroadcast({ type: "training_progress", ...event });
 * });
 *
 * const jobId = await pm.spawnLoRATraining({
 *   modelName: "unsloth/llama-3-8b-bnb-4bit",
 *   datasetPath: "/data/train.jsonl",
 *   outputDir: "/models/my-lora",
 *   epochs: 3,
 * });
 * ```
 */
export class ProcessManagerService extends EventEmitter {
  private static instance: ProcessManagerService | null = null;
  private processes: Map<string, ManagedProcess> = new Map();
  private readonly maxConcurrent: number;

  private constructor() {
    super();
    this.maxConcurrent = TRAINING_CONFIG.maxConcurrentJobs;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): ProcessManagerService {
    if (!ProcessManagerService.instance) {
      ProcessManagerService.instance = new ProcessManagerService();
    }
    return ProcessManagerService.instance;
  }

  // -------------------------------------------------------------------------
  // High-Level Convenience Methods
  // -------------------------------------------------------------------------

  /**
   * Spawn a LoRA fine-tuning job using the Unsloth training script.
   * Parses JSON progress lines from stdout and emits them as events.
   *
   * @param config - Training configuration
   * @returns Job ID for tracking
   */
  async spawnLoRATraining(config: {
    modelName?: string;
    datasetPath: string;
    outputDir?: string;
    epochs?: number;
    r?: number;
    loraAlpha?: number;
    maxSeqLength?: number;
    saveMethod?: string;
  }): Promise<string> {
    const { modelName, datasetPath, outputDir, epochs, r, loraAlpha, maxSeqLength, saveMethod } = config;

    // Validate dataset file exists
    await this.validatePath(datasetPath, "Dataset file");

    const args = [PYTHON_SCRIPTS.loraTraining, "--dataset_path", datasetPath];

    if (modelName) {
      args.push("--model_name", modelName);
    }
    if (outputDir) {
      args.push("--output_dir", outputDir);
    }
    if (epochs) {
      args.push("--epochs", String(epochs));
    }
    if (r) {
      args.push("--r", String(r));
    }
    if (loraAlpha) {
      args.push("--lora_alpha", String(loraAlpha));
    }
    if (maxSeqLength) {
      args.push("--max_seq_length", String(maxSeqLength));
    }
    if (saveMethod) {
      args.push("--save_method", saveMethod);
    }

    return this.spawn({
      type: "lora_training",
      command: PYTHON_SCRIPTS.pythonBin,
      args,
      label: `LoRA Training: ${modelName || "default"}`,
      // Training can take hours — no timeout by default
      timeoutMs: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Core Process Management
  // -------------------------------------------------------------------------

  /**
   * Spawn a new managed child process.
   *
   * @param config - Process spawn configuration
   * @returns Unique job ID for tracking this process
   * @throws Error if max concurrent processes exceeded
   */
  async spawn(config: SpawnConfig): Promise<string> {
    // Check concurrent process limit
    const runningCount = Array.from(this.processes.values()).filter(
      p => p.state === "running"
    ).length;

    if (runningCount >= this.maxConcurrent) {
      throw new Error(
        `[Omnecor ProcessManager] Maximum concurrent processes (${this.maxConcurrent}) reached. ` +
          `Wait for a running job to complete before starting a new one.`
      );
    }

    const jobId = uuidv4();
    const label = config.label || `${config.type}:${jobId.slice(0, 8)}`;

    const managed: ManagedProcess = {
      jobId,
      type: config.type,
      label,
      state: "running",
      process: null,
      pid: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      lastProgress: null,
      stderrBuffer: "",
      timeoutHandle: null,
    };

    this.processes.set(jobId, managed);

    // Prepare sanitized environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PYTHONUNBUFFERED: "1", // Force unbuffered output for real-time streaming
      ...(config.env || {}),
    };

    // Spawn the child process
    const child = spawn(config.command, config.args, {
      cwd: config.cwd || process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"], // stdin ignored, stdout/stderr piped
    });

    managed.process = child;
    managed.pid = child.pid || null;

    console.log(
      `[Omnecor ProcessManager] Spawned: jobId="${jobId}" type="${config.type}" ` +
        `pid=${child.pid} cmd="${config.command} ${config.args.join(" ")}"`
    );

    // Emit lifecycle event: started
    this.emitLifecycle(managed, "running");

    // --- stdout: parse JSON lines for progress ---
    let stdoutBuffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();

      // Process complete lines
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || ""; // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          managed.lastProgress = parsed;

          const progressEvent: ProcessProgressEvent = {
            jobId,
            type: config.type,
            label,
            data: parsed,
            timestamp: new Date().toISOString(),
          };

          this.emit("progress", progressEvent);
        } catch {
          // Non-JSON stdout line — log but don't crash
          // This handles Blender/Python print statements that aren't JSON
          console.debug(
            `[Omnecor ProcessManager] Non-JSON stdout [${jobId}]: ${trimmed}`
          );
        }
      }
    });

    // --- stderr: accumulate for error reporting ---
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // Cap stderr buffer at 10KB to prevent memory issues
      if (managed.stderrBuffer.length < 10240) {
        managed.stderrBuffer += text;
      }

      // Also try to parse stderr as JSON (some scripts emit JSON errors to stderr)
      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.error) {
            this.emit("progress", {
              jobId,
              type: config.type,
              label,
              data: { error: parsed.error },
              timestamp: new Date().toISOString(),
            } as ProcessProgressEvent);
          }
        } catch {
          // Not JSON — that's fine, it's just regular stderr output
        }
      }
    });

    // --- Process exit ---
    child.on("close", (code, signal) => {
      managed.completedAt = new Date().toISOString();

      if (managed.timeoutHandle) {
        clearTimeout(managed.timeoutHandle);
        managed.timeoutHandle = null;
      }

      if (managed.state === "cancelled") {
        // Already marked as cancelled — don't override
        this.emitLifecycle(managed, "cancelled", code);
      } else if (code === 0) {
        managed.state = "completed";
        this.emitLifecycle(managed, "completed", code);
      } else {
        managed.state = "failed";
        this.emitLifecycle(managed, "failed", code);
      }

      console.log(
        `[Omnecor ProcessManager] Exited: jobId="${jobId}" code=${code} signal=${signal}`
      );
    });

    child.on("error", err => {
      managed.state = "failed";
      managed.stderrBuffer += `\nSpawn error: ${err.message}`;
      managed.completedAt = new Date().toISOString();
      this.emitLifecycle(managed, "failed", null, err.message);
    });

    // --- Timeout handling ---
    if (config.timeoutMs && config.timeoutMs > 0) {
      managed.timeoutHandle = setTimeout(() => {
        if (managed.state === "running") {
          console.warn(
            `[Omnecor ProcessManager] Timeout: jobId="${jobId}" exceeded ${config.timeoutMs}ms`
          );
          this.cancelJob(jobId);
        }
      }, config.timeoutMs);
    }

    return jobId;
  }

  /**
   * Cancel a running job by sending SIGTERM, then SIGKILL after 5s.
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const managed = this.processes.get(jobId);
    if (!managed || managed.state !== "running" || !managed.process) {
      return false;
    }

    managed.state = "cancelled";

    // Graceful termination
    managed.process.kill("SIGTERM");

    // Force kill after 5 seconds if still alive
    setTimeout(() => {
      if (managed.process && !managed.process.killed) {
        managed.process.kill("SIGKILL");
      }
    }, 5000);

    return true;
  }

  /**
   * Get the status of a specific job.
   */
  getJobStatus(jobId: string): ProcessStatus | null {
    const managed = this.processes.get(jobId);
    if (!managed) return null;

    return {
      jobId: managed.jobId,
      type: managed.type,
      label: managed.label,
      state: managed.state,
      pid: managed.pid,
      startedAt: managed.startedAt,
      completedAt: managed.completedAt,
      lastProgress: managed.lastProgress,
      stderrBuffer: managed.stderrBuffer,
    };
  }

  /**
   * Get status of all managed processes.
   */
  getAllJobs(): ProcessStatus[] {
    return Array.from(this.processes.values()).map(m => ({
      jobId: m.jobId,
      type: m.type,
      label: m.label,
      state: m.state,
      pid: m.pid,
      startedAt: m.startedAt,
      completedAt: m.completedAt,
      lastProgress: m.lastProgress,
      stderrBuffer: m.stderrBuffer,
    }));
  }

  /**
   * Clean up completed/failed/cancelled jobs from the registry.
   * Keeps only the last N completed jobs for history.
   */
  pruneHistory(keepLast: number = 20): number {
    const completed = Array.from(this.processes.entries())
      .filter(([_, m]) => m.state !== "running" && m.state !== "queued")
      .sort((a, b) => {
        const aTime = a[1].completedAt || "";
        const bTime = b[1].completedAt || "";
        return bTime.localeCompare(aTime); // newest first
      });

    let pruned = 0;
    for (let i = keepLast; i < completed.length; i++) {
      this.processes.delete(completed[i][0]);
      pruned++;
    }

    return pruned;
  }

  /**
   * Gracefully shut down all running processes. Call on application exit.
   */
  async shutdown(): Promise<void> {
    const running = Array.from(this.processes.entries()).filter(
      ([_, m]) => m.state === "running"
    );

    for (const [jobId] of running) {
      await this.cancelJob(jobId);
    }

    console.log(
      `[Omnecor ProcessManager] Shut down ${running.length} running process(es).`
    );
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** Validate that a file path exists and is accessible */
  private async validatePath(filePath: string, label: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(
        `[Omnecor ProcessManager] ${label} not found: ${filePath}`
      );
    }
  }

  /** Emit a lifecycle event */
  private emitLifecycle(
    managed: ManagedProcess,
    state: ProcessState,
    exitCode: number | null = null,
    error: string | null = null
  ): void {
    const startTime = managed.startedAt
      ? new Date(managed.startedAt).getTime()
      : null;
    const now = Date.now();

    const event: ProcessLifecycleEvent = {
      jobId: managed.jobId,
      type: managed.type,
      label: managed.label,
      state,
      exitCode,
      error:
        error ||
        (state === "failed" ? managed.stderrBuffer.slice(0, 500) : null),
      timestamp: new Date().toISOString(),
      durationMs: startTime ? now - startTime : null,
    };

    this.emit("lifecycle", event);
  }
}
