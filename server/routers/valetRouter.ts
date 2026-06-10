import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { router, protectedProcedure } from "../_core/trpc.js";
import { ValetRouterService } from "../phase2/services/ValetRouterService.js";
import { ValetArtifactRegistry } from "../phase2/services/ValetArtifactRegistry.js";
import { PYTHON_SCRIPTS } from "../phase2/config/index.js";

const execFileAsync = promisify(execFile);

const MIN_TRAINING_VRAM_MB = 8 * 1024; // 8 GB — minimum for 1.5B LoRA on Unsloth

async function detectGpu(): Promise<{ available: boolean; name: string; vramMb: number }> {
  // NVIDIA
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 5000 },
    );
    const parts = stdout.trim().split(",");
    if (parts.length >= 2) {
      return { available: true, name: parts[0].trim(), vramMb: parseInt(parts[1].trim(), 10) };
    }
  } catch { /* not available */ }
  // AMD (ROCm)
  try {
    const { stdout } = await execFileAsync("rocm-smi", ["--showmeminfo", "VRAM"], { timeout: 5000 });
    const m = stdout.match(/Total Memory.*?:\s*(\d+)/);
    if (m) {
      const vramMb = Math.round(parseInt(m[1], 10) / (1024 * 1024));
      return { available: true, name: "AMD GPU", vramMb };
    }
  } catch { /* not available */ }
  return { available: false, name: "none", vramMb: 0 };
}

async function detectMlVenv(): Promise<{ installed: boolean; path: string }> {
  const candidates = [
    path.join(homedir(), ".omnecor", "ml-venv"),
    path.join(homedir(), ".omnecor", "valet-venv"),
    path.resolve("server", "ml-venv"),
  ];
  for (const dir of candidates) {
    try {
      // Check for a well-known marker: the unsloth package inside the venv.
      const sitePackages = path.join(dir, "lib");
      await access(sitePackages, constants.R_OK);
      return { installed: true, path: dir };
    } catch { /* next */ }
  }
  // Quick python3 import check (falls through if importable globally).
  try {
    await execFileAsync(PYTHON_SCRIPTS.pythonBin, ["-c", "import unsloth"], { timeout: 5000 });
    return { installed: true, path: "system" };
  } catch { /* not installed */ }
  return { installed: false, path: "" };
}

export const valetRouter = router({
  status: protectedProcedure.query(async () => {
    const url = process.env.VALET_ROUTER_URL ?? "http://127.0.0.1:8010";
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = (await res.json()) as { model_loaded: boolean; backend?: string };
        return {
          available: true,
          modelLoaded: data.model_loaded,
          backend: data.backend ?? null,
          url,
        };
      }
    } catch { /* server offline */ }
    return { available: false, modelLoaded: false, backend: null, url };
  }),
  getModes: protectedProcedure.query(async () => {
    const svc = ValetRouterService.getInstance();
    const modes = await svc.getModes();
    return { modes };
  }),

  /** GPU availability + VRAM for training feasibility gate (Phase 5.1). */
  gpuStatus: protectedProcedure.query(async () => {
    const gpu = await detectGpu();
    return {
      ...gpu,
      minVramMet: gpu.vramMb >= MIN_TRAINING_VRAM_MB,
      minVramRequiredMb: MIN_TRAINING_VRAM_MB,
    };
  }),

  /** ML venv status — checks for an Unsloth-capable Python environment (Phase 5.1). */
  mlVenvStatus: protectedProcedure.query(async () => {
    return detectMlVenv();
  }),
  testRoute: protectedProcedure
    .input(z.object({
      task: z.string().min(1).max(2000),
      preferredMode: z.enum([
        "api_direct", "valet_background", "local_omesh", "main_api",
        "multi_api", "main_api_omesh", "multi_api_omesh", "moe_chain",
        "moe_chain_omesh", "multi_task",
      ]).optional(),
      availableProviders: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const svc = ValetRouterService.getInstance();
      const decision = await svc.route({
        task: input.task,
        preferredMode: input.preferredMode,
        availableProviders: input.availableProviders,
        taskType: "chat",
      });
      return decision;
    }),

  /**
   * Phase 5.2: Kick off local router training from the UI.
   * Gated by the localTraining setting + GPU check + ML venv check.
   *
   * Step detection:
   *   - If no dataset exists at data/valet/train.jsonl → spawn dataset generation.
   *   - If dataset exists → spawn LoRA training with registry wiring.
   * Once Phase 1 orchestrator (buildValetRouter) is implemented, this becomes a
   * single call to it; for now the two steps are chained through UI interaction.
   */
  startLocalTraining: protectedProcedure
    .input(z.object({
      step: z.enum(["dataset", "training"]),
      /** Base model for training. Defaults to canonical Qwen2.5-1.5B. */
      modelName: z.string().default("Qwen/Qwen2.5-1.5B-Instruct"),
      examplesPerCategory: z.number().int().min(10).max(1000).default(400),
      oracleModel: z.string().default("llama3.2:latest"),
    }))
    .mutation(async ({ input, ctx }) => {
      // GPU gate.
      const gpu = await detectGpu();
      if (!gpu.available || gpu.vramMb < MIN_TRAINING_VRAM_MB) {
        throw new Error(
          gpu.available
            ? `GPU has ${gpu.vramMb} MB VRAM — minimum ${MIN_TRAINING_VRAM_MB} MB required for local training.`
            : "No GPU detected. Local router training requires a supported NVIDIA or AMD GPU.",
        );
      }

      // ML venv gate.
      const venv = await detectMlVenv();
      if (!venv.installed) {
        throw new Error(
          "Unsloth ML environment not found. Run `pnpm valet:setup-ml` to install the training stack.",
        );
      }

      if (input.step === "dataset") {
        const dir = "data/valet";
        const jobId = await ctx.services.processManager.spawn({
          type: "custom",
          command: PYTHON_SCRIPTS.pythonBin,
          args: [
            PYTHON_SCRIPTS.valetDatasetBuilder,
            "--out", `${dir}/train.jsonl`,
            "--val-out", `${dir}/val.jsonl`,
            "--eval-out", `${dir}/eval.jsonl`,
            "--oracle-model", input.oracleModel,
            "--emit-text",
          ],
          env: { OLLAMA_URL: process.env.OLLAMA_URL ?? "http://localhost:11434" },
          label: "Valet Dataset Gen (local training)",
        });
        return { step: "dataset" as const, jobId };
      }

      // Training step.
      const registryRoot = ValetArtifactRegistry.registryRoot;
      const datasetPath = "data/valet/train.jsonl";
      const datasetHash = await ValetArtifactRegistry.hashFile(datasetPath).catch(() => "unknown");
      const outputDir = ValetArtifactRegistry.versionedPath(input.modelName, datasetHash);

      const jobId = await ctx.services.processManager.spawnLoRATraining({
        modelName: input.modelName,
        datasetPath,
        outputDir,
        saveMethod: "gguf",
        r: 8,
        loraAlpha: 16,
        epochs: 3,
        maxSeqLength: 2048,
        registryRoot,
        datasetHash,
      });
      return { step: "training" as const, jobId };
    }),

  /**
   * Phase 7.3: Refresh the Valet knowledge base.
   * Bumps knowledge_base_version in routing_manifest.json, signals the
   * inference server to hot-reload, and optionally spawns valet_knowledge_refresh.py
   * to re-embed KB chunks into ChromaDB.
   */
  refreshKnowledge: protectedProcedure.mutation(async ({ ctx }) => {
    // Signal inference server to hot-reload (fast path — always attempted)
    const valetUrl = process.env.VALET_ROUTER_URL ?? "http://127.0.0.1:8010";
    let reloaded = false;
    try {
      const res = await fetch(`${valetUrl}/admin/reload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(3000),
      });
      reloaded = res.ok;
    } catch { /* inference server may be offline */ }

    // Spawn valet_knowledge_refresh.py — it owns the version bump, ChromaDB
    // re-embedding, and a second /admin/reload after writing the manifest.
    const kbScript = path.resolve(
      process.cwd(),
      "server/python_bridges/valet_knowledge_refresh.py",
    );
    let embeddingJobId: string | undefined;
    try {
      await access(kbScript, constants.R_OK);
      embeddingJobId = await ctx.services.processManager.spawn({
        type: "custom",
        command: PYTHON_SCRIPTS.pythonBin,
        args: [kbScript],
        label: "Valet KB Refresh (ChromaDB embedding)",
      });
    } catch { /* script absent or processManager unavailable */ }

    return { reloaded, embeddingJobId };
  }),
});
