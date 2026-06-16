/**
 * @file server/routers/jobRouter.ts
 * @description Omnecor — Unified Job Management tRPC Router
 *
 * Exposes the ProcessManagerService via tRPC for controlling and monitoring
 * asynchronous background jobs (Blender renders, LoRA training, ESP flashing, etc.).
 */

import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";
import { AsyncJobService } from "../phase2/services/AsyncJobService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const jobIdSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
});

const listJobsSchema = z
  .object({
    /** Filter by process type */
    type: z
      .enum(["lora_training", "blender", "esp_flash", "custom"])
      .optional(),
    /** Filter by state */
    state: z
      .enum(["queued", "running", "completed", "failed", "cancelled"])
      .optional(),
  })
  .optional();

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const jobRouter = router({
  /**
   * Get the current status of a specific job.
   * Includes last progress data, stderr output, and timing info.
   */
  getStatus: protectedProcedure
    .input(jobIdSchema)
    .query(async ({ ctx, input }) => {
      const status = ctx.services.processManager.getJobStatus(input.jobId);

      if (!status) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Job not found: ${input.jobId}`,
        });
      }

      return status;
    }),

  /**
   * Start a long-running background command on behalf of the AI agent.
   *
   * The agent calls this, gets a jobId back immediately, and ends its turn — no
   * token-burning poll loop. When the job finishes, AsyncJobService condenses
   * the output and the result is pushed back into the conversation as a new turn.
   *
   * Host command execution is gated behind the HITL "command" approval. A denial
   * carries the reviewer's reason straight back to the agent so it can adjust.
   * Arguments are passed as a discrete array — never a shell string — so there
   * is no interpolation/injection surface.
   */
  startAsync: protectedProcedure
    .input(
      z.object({
        command: z.string().min(1, "command is required"),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
        label: z.string().max(120).optional(),
        conversationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const decision = await ctx.services.hitl.requestApprovalDetailed(
        "asyncJob.start",
        { command: input.command, args: input.args, cwd: input.cwd ?? null },
        "command"
      );
      if (!decision.approved) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: decision.reason
            ? `Async job denied: ${decision.reason}`
            : "Async job denied by reviewer.",
        });
      }

      // Validate any caller-supplied working directory against the allow-list.
      let cwd: string | undefined;
      if (input.cwd) {
        cwd = await validatePath(input.cwd);
      }

      const label =
        input.label ||
        `${input.command} ${input.args.join(" ")}`.trim().slice(0, 80);

      const jobId = await ctx.services.processManager.spawn({
        type: "custom",
        command: input.command,
        args: input.args,
        cwd,
        label,
        captureMode: "raw",
        timeoutMs: 0, // long build/download jobs: no auto-kill
      });

      AsyncJobService.getInstance().track(jobId, {
        userId: ctx.user?.id ?? null,
        conversationId: input.conversationId ?? null,
        label,
      });

      return { jobId, status: "started" as const, label };
    }),

  /**
   * List all jobs (running, completed, failed, cancelled).
   * Supports filtering by type and state.
   */
  list: protectedProcedure.input(listJobsSchema).query(async ({ ctx, input }) => {
    let jobs = ctx.services.processManager.getAllJobs();

    if (input?.type) {
      jobs = jobs.filter(j => j.type === input.type);
    }
    if (input?.state) {
      jobs = jobs.filter(j => j.state === input.state);
    }

    return {
      total: jobs.length,
      jobs,
    };
  }),

  /**
   * Cancel a running job.
   * Sends SIGTERM to the process, followed by SIGKILL after a timeout.
   */
  cancel: protectedProcedure
    .input(jobIdSchema)
    .mutation(async ({ ctx, input }) => {
      const success = await ctx.services.processManager.cancelJob(input.jobId);

      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Job "${input.jobId}" is not running or does not exist.`,
        });
      }

      return {
        success: true,
        message: `Job "${input.jobId}" cancellation initiated.`,
      };
    }),

  /**
   * Run a command in a sandboxed Docker container.
   */
  runSandboxCommand: adminProcedure
    .input(z.object({
      command: z.string(),
      image: z.string().default("alpine:latest"),
    }))
    .mutation(async ({ ctx, input }) => {
      // Split command into args
      const args = input.command.split(" ");
      const jobId = await ctx.services.docker.runInSandbox(input.image, args);
      
      return {
        success: true,
        jobId,
        message: `Command queued in sandbox: ${input.image}`,
      };
    }),

  /**
   * Prune old job history. Keeps the last N completed jobs.
   */
  prune: adminProcedure
    .input(
      z.object({ keepLast: z.number().int().min(0).default(20) }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      const pruned = ctx.services.processManager.pruneHistory(
        input?.keepLast || 20
      );
      return {
        success: true,
        prunedCount: pruned,
      };
    }),
});
