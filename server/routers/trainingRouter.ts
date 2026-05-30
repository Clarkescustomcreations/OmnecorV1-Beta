/**
 * @file routers/trainingRouter.ts
 * @description Omnecor — Training & Process Management tRPC Router
 *
 * Exposes tRPC endpoints for:
 *  - Starting LoRA fine-tuning jobs
 *  - Validating dataset formats
 *
 * Architecture Notes:
 *  - Job status, listing, and cancellation are handled by the unified `jobRouter.ts`.
 *  - Dataset uploads are handled via Express multipart middleware (not tRPC),
 *    which saves the file to disk and passes the `datasetPath` here.
 *  - Training progress is streamed to the frontend via WebSocket.
 *
 * UNIFIED: This router now imports from the main _core/trpc.ts stack.
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";
import fs from "fs/promises";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const startTrainingSchema = z.object({
  /** HuggingFace model stub or local path (default: unsloth/llama-3-8b-bnb-4bit) */
  modelName: z.string().optional(),
  /** Path to the local JSONL dataset file */
  datasetPath: z.string().min(1, "Dataset path is required"),
  /** Output directory for the trained LoRA adapters */
  outputDir: z.string().optional(),
  /** Number of training epochs (default: 1) */
  epochs: z.number().int().min(1).max(100).optional(),
  /** LoRA Rank (r) parameter (default: 16) */
  r: z.number().int().min(1).optional(),
  /** LoRA Alpha parameter (default: 16) */
  loraAlpha: z.number().int().min(1).optional(),
  /** Maximum sequence length (default: 2048) */
  maxSeqLength: z.number().int().min(128).optional(),
  /** Save method: lora, merged_16bit, merged_4bit, gguf, ollama */
  saveMethod: z.enum(["lora", "merged_16bit", "merged_4bit", "gguf", "ollama"]).optional(),
});

const validateDatasetSchema = z.object({
  datasetPath: z.string().min(1, "Dataset path is required"),
});

// ---------------------------------------------------------------------------
// Router Definition
// ---------------------------------------------------------------------------

export const trainingRouter = router({
  /**
   * Validate a local JSONL dataset file for fine-tuning.
   * Ensures the file exists, is readable, and contains valid JSON lines.
   */
  validateDataset: publicProcedure
    .input(validateDatasetSchema)
    .mutation(async ({ input }) => {
      try {
        const content = await fs.readFile(input.datasetPath, "utf-8");
        const lines = content
          .split("\n")
          .filter(line => line.trim().length > 0);

        if (lines.length === 0) {
          throw new Error("Dataset file is empty");
        }

        let validCount = 0;
        let invalidCount = 0;

        for (const line of lines) {
          try {
            JSON.parse(line);
            validCount++;
          } catch {
            invalidCount++;
          }
        }

        return {
          success: invalidCount === 0,
          totalLines: lines.length,
          validLines: validCount,
          invalidLines: invalidCount,
          message:
            invalidCount === 0
              ? "Dataset is valid JSONL."
              : `Found ${invalidCount} invalid JSON lines.`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Validation failed: ${(error as Error).message}`,
        });
      }
    }),

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
        const validatedPath = await validatePath(input.datasetPath);
        const jobId = await ctx.services.processManager.spawnLoRATraining({
          modelName: input.modelName,
          datasetPath: validatedPath,
          outputDir: input.outputDir,
          epochs: input.epochs,
          r: input.r,
          loraAlpha: input.loraAlpha,
          maxSeqLength: input.maxSeqLength,
          saveMethod: input.saveMethod,
        });

        return {
          success: true,
          jobId,
          message: `Training job started. Subscribe to WebSocket channel "training:${jobId}" for progress.`,
        };
      } catch (error) {
        const message = (error as Error).message;

        if (
          message.includes("not found") ||
          message.includes("Security Violation")
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message,
          });
        }
        if (message.includes("Maximum concurrent")) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to start training: ${message}`,
        });
      }
    }),
});
