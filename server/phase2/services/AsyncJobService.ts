/**
 * @file services/AsyncJobService.ts
 * @description Omnecor — Async Job continuation layer
 *
 * Bridges long-running background jobs to the AI agent's conversation so the
 * agent can fire a job, end its turn (no token-burning poll loop), and be
 * re-prompted with a *condensed* result when the job finishes or fails.
 *
 * Flow:
 *   1. The async-job tool spawns a job via ProcessManager (captureMode: "raw")
 *      and calls `track(jobId, context)` to remember which conversation it
 *      belongs to.
 *   2. This service listens to ProcessManager's "lifecycle" stream. When a
 *      tracked job reaches a terminal state it reads the captured output,
 *      condenses it (exit code + tail + extracted errors + optional LLM
 *      summary) and emits a "result" event.
 *   3. The WebSocket layer broadcasts that result to the originating client,
 *      which injects it as a new conversation turn — re-prompting the agent.
 *
 * The condensing keeps a multi-thousand-line build log from ever reaching the
 * model verbatim; only a compact, token-budgeted summary is delivered.
 */

import { EventEmitter } from "events";
import { ProcessManagerService } from "./ProcessManagerService.js";
import type { ProcessLifecycleEvent } from "./ProcessManagerService.js";
import {
  condenseJobResult,
  formatCondensedResultForAgent,
  type CondensedJobResult,
} from "./JobResultCondenser.js";
import { createLogger } from "../../_core/logger.js";
import { getDb } from "../../db.factory.js";
import { asyncJobTracking } from "../../../drizzle/schema.js";
import { eq } from "drizzle-orm";

const log = createLogger("AsyncJob");

/** Where a job came from, so its result can be routed back to the right place. */
export interface AsyncJobContext {
  /** Owning user id — used to scope the result broadcast channel. */
  userId?: string | number | null;
  /** Conversation the job was launched from, echoed back to the client. */
  conversationId?: string | null;
  /** Human-readable label for the job. */
  label?: string;
}

/** Payload emitted (and broadcast) when a tracked job finishes. */
export interface AsyncJobResultEvent {
  jobId: string;
  context: AsyncJobContext;
  result: CondensedJobResult;
  /** Pre-rendered, token-budgeted block to inject into the conversation. */
  formatted: string;
}

/**
 * Optional async summariser. When set (and execution mode permits), the service
 * asks it to compress a large log tail into one paragraph. Injected rather than
 * imported so Sovereign mode never makes an external call by default, and so the
 * pure condensing path stays dependency-free and testable.
 */
export type JobSummarizer = (
  input: { label: string; tail: string[]; errors: string[] }
) => Promise<string | null>;

export class AsyncJobService extends EventEmitter {
  private static instance: AsyncJobService | null = null;
  private readonly processManager: ProcessManagerService;
  private readonly tracked = new Map<string, AsyncJobContext>();
  private summarizer: JobSummarizer | null = null;

  private constructor() {
    super();
    this.processManager = ProcessManagerService.getInstance();
    this.processManager.on("lifecycle", (e) => {
      void this.onLifecycle(e);
    });
    void this.hydrateFromDb();
  }

  /** Load pending jobs from DB on startup to re-populate in-memory tracking. */
  private async hydrateFromDb(): Promise<void> {
    try {
      const db = await getDb();
      const rows = await db.select().from(asyncJobTracking)
        .where(eq(asyncJobTracking.status, "pending"));
      for (const row of rows) {
        this.tracked.set(row.jobId, {
          userId: row.userId ?? undefined,
          conversationId: row.conversationId ?? undefined,
          label: row.label ?? undefined,
        });
      }
      if (rows.length > 0) {
        log.info("AsyncJob: restored pending jobs from DB", { count: rows.length });
      }
    } catch (err) {
      log.warn("AsyncJob: failed to hydrate from DB", err);
    }
  }

  public static getInstance(): AsyncJobService {
    if (!AsyncJobService.instance) {
      AsyncJobService.instance = new AsyncJobService();
    }
    return AsyncJobService.instance;
  }

  /**
   * Plug in an optional LLM summariser (e.g. routed through AiProviderService and
   * gated by execution mode). When unset, condensing uses tail + regex only.
   */
  setSummarizer(summarizer: JobSummarizer | null): void {
    this.summarizer = summarizer;
  }

  /** Remember that `jobId` was launched by the agent from `context`. */
  track(jobId: string, context: AsyncJobContext): void {
    this.tracked.set(jobId, context);
    getDb().then(db =>
      db.insert(asyncJobTracking).values({
        jobId,
        userId: context.userId != null ? String(context.userId) : null,
        conversationId: context.conversationId ?? null,
        label: context.label ?? null,
        jobType: "async",
        status: "pending",
      }).onConflictDoNothing()
    ).catch(err => log.warn("AsyncJob: failed to persist tracked job", err));
  }

  /** Whether a job is being tracked for agent continuation. */
  isTracked(jobId: string): boolean {
    return this.tracked.has(jobId);
  }

  private async onLifecycle(event: ProcessLifecycleEvent): Promise<void> {
    const context = this.tracked.get(event.jobId);
    if (!context) return; // not an agent-launched async job

    // Narrow to a terminal state (also lets TS treat event.state as the
    // three-literal CondensedJobStatus union below).
    if (
      event.state !== "completed" &&
      event.state !== "failed" &&
      event.state !== "cancelled"
    ) {
      return;
    }
    const status = event.state;

    this.tracked.delete(event.jobId);
    const terminalStatus = status === "completed" ? "completed" : "failed";
    getDb().then(db =>
      db.update(asyncJobTracking).set({ status: terminalStatus }).where(eq(asyncJobTracking.jobId, event.jobId))
    ).catch(err => log.warn("AsyncJob: failed to update job status in DB", err));

    try {
      const captured = this.processManager.getCapturedOutput(event.jobId) ?? {
        stdoutTail: [],
        stderr: "",
      };

      const result = condenseJobResult({
        status,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        label: context.label || event.label || event.type,
        stdoutTail: captured.stdoutTail,
        stderr: captured.stderr,
      });

      // Optional LLM summary — only when a summariser is wired and the log is
      // large enough to be worth compressing.
      if (this.summarizer && (result.tail.length > 20 || result.errors.length > 0)) {
        try {
          const summary = await this.summarizer({
            label: result.label,
            tail: result.tail,
            errors: result.errors,
          });
          if (summary) result.summary = summary;
        } catch (err) {
          log.warn("Job summariser failed; using tail/regex only", {
            jobId: event.jobId,
            err: (err as Error).message,
          });
        }
      }

      const payload: AsyncJobResultEvent = {
        jobId: event.jobId,
        context,
        result,
        formatted: formatCondensedResultForAgent(result),
      };

      this.emit("result", payload);
    } catch (err) {
      log.warn("Failed to condense async job result", {
        jobId: event.jobId,
        err: (err as Error).message,
      });
    }
  }
}
