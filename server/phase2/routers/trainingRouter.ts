/**
 * @file routers/trainingRouter.ts
 * @description Omnecor — Training & Process Management tRPC Router
 *
 * Exposes tRPC endpoints for:
 *  - Starting LoRA fine-tuning jobs
 *  - Querying job status and progress
 *  - Cancelling running jobs
 *  - Listing all jobs (active and historical)
 *
 * Architecture Notes:
 *  - Training progress is streamed to the frontend via WebSocket (not tRPC)
 *    because tRPC subscriptions require a WebSocket transport layer.
 *    The tRPC router provides the control plane (start/stop/status),
 *    while the WebSocket server provides the data plane (real-time progress).
 *  - The ProcessManagerService emits "progress" events that are forwarded
 *    to connected WebSocket clients by the WebSocket server module.
 *  - Job IDs are returned immediately on start — the client then subscribes
 *    to the WebSocket channel for that specific job's progress updates.
 *
 * UNIFIED: This router now imports from the main _core/trpc.ts stack.
 */

import { z } from "zod";
import { router, publicProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const startTrainingSchema = z.object({
  /** HuggingFace model stub or local path (default: Qwen/Qwen2.5-1.5B-Instruct) */
  modelName: z.string().optional(),
  /** Path to the local JSONL dataset file */
  datasetPath: z.string().min(1, "Dataset path is required"),
  /** Output directory for the trained LoRA adapters */
  outputDir: z.string().optional(),
  /** Number of training epochs (default: 1) */
  epochs: z.number().int().min(1).max(100).optional(),
});

const buildValetRouterSchema = z.object({
  /** Path to valet.config.json (defaults to repo root) */
  configPath: z.string().optional(),
  /** Force rebuild even if a fresh artifact is already registered */
  force: z.boolean().optional(),
  /** Hard-fail if no GPU is detected (on-device mode B) */
  requireGpu: z.boolean().optional(),
});

const jobIdSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
});

// ---------------------------------------------------------------------------
// Router Definition
// ---------------------------------------------------------------------------

export const trainingRouter = router({
  /**
   * Start a new LoRA fine-tuning job.
   *
   * Returns the job ID immediately. The client should subscribe to
   * the WebSocket channel `training:${jobId}` for real-time progress.
   *
   * Progress events include: { epoch, step, loss, learning_rate }
   * Completion event: { status: "completed", output_dir: "..." }
   */
  startTraining: publicProcedure
    .input(startTrainingSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await ctx.services.processManager.spawnLoRATraining({
          modelName: input.modelName,
          datasetPath: input.datasetPath,
          outputDir: input.outputDir,
          epochs: input.epochs,
        });

        return {
          success: true,
          jobId,
          message: `Training job started. Subscribe to WebSocket channel "training:${jobId}" for progress.`,
        };
      } catch (error) {
        const message = (error as Error).message;

        if (message.includes("not found")) {
          throw new TRPCError({ code: "NOT_FOUND", message });
        }
        if (message.includes("Maximum concurrent")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to start training: ${message}`,
        });
      }
    }),

  /**
   * Run the full Valet Router build pipeline:
   * dataset build → validate → LoRA train → gguf export → register artifact.
   *
   * Reads configuration from valet.config.json. Idempotent — skips steps
   * whose outputs are already fresh unless `force` is true.
   *
   * Returns the job ID immediately. Subscribe to `training:${jobId}` for
   * streamed step-level progress (step_start / step_complete / step_error /
   * pipeline_complete events).
   */
  buildValetRouter: publicProcedure
    .input(buildValetRouterSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await ctx.services.processManager.spawnValetPipeline({
          configPath: input.configPath,
          force:      input.force ?? false,
          requireGpu: input.requireGpu ?? false,
        });

        return {
          success: true,
          jobId,
          message: `Valet Router pipeline started. Subscribe to "training:${jobId}" for progress.`,
        };
      } catch (error) {
        const message = (error as Error).message;

        if (message.includes("Maximum concurrent")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to start Valet Router pipeline: ${message}`,
        });
      }
    }),
});
