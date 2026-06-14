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
