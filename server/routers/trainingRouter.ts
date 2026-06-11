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
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ValetArtifactRegistry } from "../phase2/services/ValetArtifactRegistry.js";

const execFileP = promisify(execFile);

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

  // -------------------------------------------------------------------------
  // Kaggle free-GPU training (for weak/old PCs without sufficient VRAM)
  // -------------------------------------------------------------------------

  /** Save Kaggle API credentials to ~/.kaggle/kaggle.json */
  saveKaggleKey: protectedProcedure
    .input(z.object({ username: z.string().min(1), key: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const kaggleDir = path.join(os.homedir(), ".kaggle");
      await fs.mkdir(kaggleDir, { recursive: true });
      await fs.mkdir(path.join(os.tmpdir(), ".kaggle", "uploads"), { recursive: true });
      const content = JSON.stringify({ username: input.username, key: input.key }, null, 2);
      const kaggleJsonPath = path.join(kaggleDir, "kaggle.json");
      try {
        await fs.writeFile(kaggleJsonPath, content, { mode: 0o600 });
      } catch {
        await fs.writeFile(kaggleJsonPath, content);
      }
      return { success: true };
    }),

  /** Return Kaggle connection status (username only, never the API key). */
  kaggleStatus: protectedProcedure.query(async () => {
    try {
      const data = JSON.parse(
        await fs.readFile(path.join(os.homedir(), ".kaggle", "kaggle.json"), "utf-8")
      );
      const connected = Boolean(data.username && data.key);
      return { connected, username: connected ? (data.username as string) : undefined };
    } catch {
      return { connected: false, username: undefined as string | undefined };
    }
  }),

  /**
   * Upload dataset to Kaggle and push the training kernel.
   * Returns immediately — training runs in the cloud (~30–120 min).
   */
  startKaggleTraining: protectedProcedure
    .input(z.object({
      datasetPath: z.string().min(1).default("data/valet"),
      modelName: z.string().optional(),
      epochs: z.number().default(1.5),
      maxSeqLength: z.number().int().default(3072),
      r: z.number().int().default(8),
      loraAlpha: z.number().int().default(16),
    }))
    .mutation(async ({ input }) => {
      const kaggleJsonPath = path.join(os.homedir(), ".kaggle", "kaggle.json");
      let username: string;
      try {
        const kj = JSON.parse(await fs.readFile(kaggleJsonPath, "utf-8"));
        if (!kj.username) throw new Error("missing username");
        username = kj.username as string;
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Kaggle API key not configured. Go to Settings → API Providers → Kaggle first.",
        });
      }

      const validatedDatasetPath = await validatePath(input.datasetPath);
      await fs.mkdir(path.join(os.tmpdir(), ".kaggle", "uploads"), { recursive: true });

      const bundleBase = path.join(os.tmpdir(), "omnecor-kaggle-bundle");
      const dataDir = path.join(bundleBase, "data");
      const kernelDir = path.join(bundleBase, "kernel");
      await fs.rm(bundleBase, { recursive: true, force: true });
      await fs.mkdir(dataDir, { recursive: true });
      await fs.mkdir(kernelDir, { recursive: true });

      for (const fname of ["train.jsonl", "val.jsonl", "eval.jsonl"]) {
        try {
          await fs.copyFile(path.join(validatedDatasetPath, fname), path.join(dataDir, fname));
        } catch { /* val/eval optional */ }
      }
      try {
        await fs.access(path.join(dataDir, "train.jsonl"));
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No train.jsonl found in ${validatedDatasetPath}. Dataset folder must contain at least train.jsonl.`,
        });
      }

      const datasetSlug = `${username}/omnecor-valet-data`;
      const kernelSlug = `${username}/omnecor-valet-train`;

      await fs.writeFile(path.join(dataDir, "dataset-metadata.json"), JSON.stringify({
        title: "omnecor-valet-data", id: datasetSlug, licenses: [{ name: "CC0-1.0" }],
      }, null, 2));

      try {
        await execFileP("kaggle", ["datasets", "version", "-p", dataDir, "-m",
          `Omnecor upload ${new Date().toISOString()}`]);
      } catch {
        await execFileP("kaggle", ["datasets", "create", "-p", dataDir]);
      }

      const refScript = path.join(process.cwd(), "tmp-valet-train", "kaggle-bundle", "valet_train_kaggle.py");
      let script = await fs.readFile(refScript, "utf-8");
      const modelName = input.modelName ?? "Qwen/Qwen2.5-1.5B-Instruct";
      script = script
        .replace(/^MODEL_ID\s*=\s*.+$/m, `MODEL_ID = "${modelName}"`)
        .replace(/^EPOCHS\s*=\s*.+$/m, `EPOCHS = ${input.epochs}`)
        .replace(/^MAX_SEQ_LENGTH\s*=\s*.+$/m, `MAX_SEQ_LENGTH = ${input.maxSeqLength}`)
        .replace(/^LORA_R\s*=\s*.+$/m, `LORA_R = ${input.r}`)
        .replace(/^LORA_ALPHA\s*=\s*.+$/m, `LORA_ALPHA = ${input.loraAlpha}`);
      await fs.writeFile(path.join(kernelDir, "valet_train_kaggle.py"), script);

      await fs.writeFile(path.join(kernelDir, "kernel-metadata.json"), JSON.stringify({
        id: kernelSlug, title: "omnecor-valet-train",
        code_file: "valet_train_kaggle.py", language: "python", kernel_type: "script",
        is_private: true, enable_gpu: true, enable_internet: true,
        dataset_sources: [datasetSlug],
      }, null, 2));

      await execFileP("kaggle", ["kernels", "push", "-p", kernelDir]);

      return {
        success: true, kernelSlug, datasetSlug,
        message: "Kaggle training job submitted. Poll with kaggleJobStatus. Runs take 30–120 min.",
      };
    }),

  /** Poll a Kaggle kernel status. Safe to call every 60 s. */
  kaggleJobStatus: protectedProcedure
    .input(z.object({ kernelSlug: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const { stdout } = await execFileP("kaggle", ["kernels", "status", input.kernelSlug]);
        const lower = stdout.toLowerCase();
        const status: "running" | "complete" | "error" | "queued" | "unknown" =
          lower.includes("complete") ? "complete" :
          lower.includes("error") || lower.includes("failed") ? "error" :
          lower.includes("running") ? "running" :
          lower.includes("queued") || lower.includes("pending") ? "queued" : "unknown";
        const runtimeMatch = stdout.match(/(\d{2}:\d{2}:\d{2})/);
        return { status, rawOutput: stdout.trim(), runtime: runtimeMatch?.[1] };
      } catch (e) {
        return { status: "error" as const, rawOutput: String(e), runtime: undefined };
      }
    }),

  /**
   * Download a completed Kaggle adapter, merge into the base model (CPU job),
   * and queue registration. Returns mergeJobId to monitor in Jobs panel.
   */
  pullKaggleArtifact: protectedProcedure
    .input(z.object({ kernelSlug: z.string().min(1), baseModel: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const outDir = path.join(os.tmpdir(), "omnecor-kaggle-output");
      await fs.rm(outDir, { recursive: true, force: true });
      await fs.mkdir(outDir, { recursive: true });

      await execFileP("kaggle", ["kernels", "output", input.kernelSlug, "-p", outDir]);

      let adapterDir: string | undefined;
      for (const e of await fs.readdir(outDir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          try {
            await fs.access(path.join(outDir, e.name, "adapter_config.json"));
            adapterDir = path.join(outDir, e.name);
            break;
          } catch { /* keep looking */ }
        }
      }
      if (!adapterDir) {
        try {
          await fs.access(path.join(outDir, "adapter_config.json"));
          adapterDir = outDir;
        } catch {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Could not find adapter_config.json in Kaggle output. The kernel may still be running or errored.",
          });
        }
      }

      const slug = `kaggle-${new Date().toISOString().slice(0, 10)}`;
      const stagedAdapterPath = path.join(ValetArtifactRegistry.registryRoot, `${slug}-adapter`);
      await fs.mkdir(stagedAdapterPath, { recursive: true });
      for (const f of await fs.readdir(adapterDir)) {
        await fs.copyFile(path.join(adapterDir, f), path.join(stagedAdapterPath, f));
      }

      const mergedModelPath = path.join(ValetArtifactRegistry.registryRoot, slug);
      const baseModel = input.baseModel ?? "Qwen/Qwen2.5-1.5B-Instruct";
      const mergeJobId = await ctx.services.processManager.spawn({
        type: "custom",
        command: "python3",
        args: ["server/python_bridges/valet_merge.py"],
        env: {
          VALET_MERGE_ADAPTER: stagedAdapterPath,
          VALET_MERGE_BASE: baseModel,
          VALET_MERGE_OUT: mergedModelPath,
        },
        label: "Valet Kaggle Adapter Merge",
      });

      return {
        success: true, mergeJobId, adapterPath: stagedAdapterPath, mergedModelPath,
        message: `Adapter staged. Merge job ${mergeJobId} started — monitor in Jobs panel. When done, click Activate.`,
      };
    }),

  /**
   * Manually register an artifact path as the active Valet Router model.
   * Used after training completes or after fetching a pre-built release artifact.
   */
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
