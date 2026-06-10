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
import { router, publicProcedure, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";
import fs from "fs/promises";
import path from "path";
import { ValetArtifactRegistry } from "../phase2/services/ValetArtifactRegistry.js";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const startTrainingSchema = z.object({
  /** HuggingFace model stub or local path (default: unsloth/llama-3-8b-bnb-4bit) */
  modelName: z.string().optional(),
  /** Path to the local JSONL dataset file */
  datasetPath: z.string().min(1, "Dataset path is required"),
  /** Output directory for the trained LoRA adapters. Auto-computed from registryRoot when omitted. */
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
  /** When set, the trainer writes metadata.json + current.json into this registry dir after completion. */
  registryRoot: z.string().optional(),
  /** Pre-computed SHA-256 of the dataset file; auto-computed by the trainer if absent. */
  datasetHash: z.string().optional(),
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
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  validateDataset: protectedProcedure
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
  startTraining: protectedProcedure
    .input(startTrainingSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedPath = await validatePath(input.datasetPath);

        // Auto-build a versioned output path when a registry root is provided and no
        // explicit outputDir was given (Phase 2.1 deterministic naming).
        let outputDir = input.outputDir;
        if (!outputDir && input.registryRoot) {
          const hash = input.datasetHash
            ?? await ValetArtifactRegistry.hashFile(validatedPath);
          const baseTag = input.modelName ?? "model";
          outputDir = ValetArtifactRegistry.versionedPath(baseTag, hash);
        }

        const jobId = await ctx.services.processManager.spawnLoRATraining({
          modelName: input.modelName,
          datasetPath: validatedPath,
          outputDir,
          epochs: input.epochs,
          r: input.r,
          loraAlpha: input.loraAlpha,
          maxSeqLength: input.maxSeqLength,
          saveMethod: input.saveMethod,
          registryRoot: input.registryRoot,
          datasetHash: input.datasetHash,
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
  generateValetDataset: protectedProcedure
    .input(
      z.object({
        examplesPerCategory: z.number().int().min(10).max(1000).default(400),
        oracleModel: z.string().default("llama3.2:latest"),
        outputPath: z.string().default("data/valet/train.jsonl"),
        /** Write the Qwen2.5 ChatML `text` field per row so the trainer runs unmodified. */
        emitText: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const outputPath = await validatePath(input.outputPath);
      const dir = outputPath.replace(/\/[^/]*$/, "");
      const valPath = `${dir}/val.jsonl`;
      const evalPath = `${dir}/eval.jsonl`;
      const env: Record<string, string> = {
        OLLAMA_URL: process.env.OLLAMA_URL ?? "http://localhost:11434",
        EXAMPLES_PER_CATEGORY: String(input.examplesPerCategory),
        ORACLE_MODEL: input.oracleModel,
      };
      const args = [
        "server/python_bridges/valet_dataset_builder.py",
        "--out", outputPath,
        "--val-out", valPath,
        "--eval-out", evalPath,
        "--oracle-model", input.oracleModel,
      ];
      if (input.emitText) {
        args.push("--emit-text");
      }
      try {
        const jobId = await ctx.services.processManager.spawn({
          type: "custom",
          command: "python3",
          args,
          env,
          label: "Valet Router Dataset Builder",
        });
        return { jobId };
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes("Maximum concurrent")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to start dataset builder: ${message}`,
        });
      }
    }),

  /**
   * Persist LoRA configuration to valet.config.json.
   */
  saveLoraConfig: protectedProcedure
    .input(z.object({
      r: z.number().int().min(1).max(64),
      alpha: z.number().int().min(1).max(128),
      dropout: z.number().min(0).max(1),
      targetModules: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      const configPath = path.join(process.cwd(), "valet.config.json");
      let existing: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(configPath, "utf-8");
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch { /* file doesn't exist yet */ }
      await fs.writeFile(configPath, JSON.stringify({ ...existing, lora: input }, null, 2));
      return { saved: true };
    }),

  /** Return the current registered Valet Router artifact (reads current.json). */
  getArtifact: protectedProcedure.query(async () => {
    const record = await ValetArtifactRegistry.read();
    return {
      ...record,
      registryRoot: ValetArtifactRegistry.registryRoot,
    };
  }),

  /**
   * Manually register an artifact path as the active Valet Router model.
   * Used after training completes or after fetching a pre-built release artifact.
   */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  registerArtifact: protectedProcedure
    .input(
      z.object({
        artifactPath: z.string().min(1),
        baseModel: z.string().optional(),
        datasetHash: z.string().optional(),
        format: z.enum(["gguf", "ollama", "lora", "merged_16bit", "merged_4bit"]).optional(),
        ggufFile: z.string().optional(),
        evalScores: z.record(z.string(), z.number()).optional(),
        gitSha: z.string().optional(),
        source: z.enum(["trained", "github-release"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Verify the artifact path exists before registering it
      try {
        await fs.access(input.artifactPath);
      } catch {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Artifact path not found: ${input.artifactPath}`,
        });
      }

      const record = {
        artifact_path: input.artifactPath,
        status: "ready" as const,
        base_model: input.baseModel,
        dataset_hash: input.datasetHash,
        format: input.format,
        gguf_file: input.ggufFile,
        config: undefined,
        eval_scores: input.evalScores ?? {},
        git_sha: input.gitSha,
        created_at: new Date().toISOString(),
        source: input.source ?? "trained",
      };
      await ValetArtifactRegistry.write(record);
      return { success: true, record };
    }),
});
