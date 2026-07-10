import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants, readdir, readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";
import { ValetRouterService } from "../core_services/services/ValetRouterService.js";
import { ValetArtifactRegistry } from "../core_services/services/ValetArtifactRegistry.js";
import { ValetServerService } from "../core_services/services/ValetServerService.js";
import { PYTHON_SCRIPTS } from "../core_services/config/index.js";
import { getDb } from "../db.factory.js";
import { moeChainConfigs, type MoeChainStep } from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { PATHS } from "../_core/paths.js";

const execFileAsync = promisify(execFile);

// 8-GB-class minimum for 1.5B LoRA on Unsloth. Set below a literal 8192 because
// every "8 GB" card reports slightly less usable VRAM (an RTX 4060 Ti reports
// 8188 MiB) — a `>= 8*1024` check rejects exactly the hardware this gate exists
// to admit, while 7.5 GB still excludes the 6-GB tier.
const MIN_TRAINING_VRAM_MB = 7680;

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
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: gpu.available
            ? `GPU has ${gpu.vramMb} MB VRAM — minimum ${MIN_TRAINING_VRAM_MB} MB required for local training.`
            : "No GPU detected. Local router training requires a supported NVIDIA or AMD GPU.",
        });
      }

      // ML venv gate.
      const venv = await detectMlVenv();
      if (!venv.installed) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Unsloth ML environment not found. Run `pnpm valet:setup-ml` to install the training stack.",
        });
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
   * Return the currently registered model info from current.json.
   * Used by the Settings panel to show what model is active.
   */
  getModelInfo: protectedProcedure.query(async () => {
    const record = await ValetArtifactRegistry.read();
    return {
      status: record.status,
      format: record.format ?? null,
      artifactPath: record.artifact_path ?? null,
      ggufFile: record.gguf_file ?? null,
      baseModel: record.base_model ?? null,
      evalScores: record.eval_scores ?? null,
      registryPath: ValetArtifactRegistry.currentJsonPath,
    };
  }),

  /**
   * Swap the active Valet Router model to a user-supplied GGUF file or directory.
   * Validates the path exists, updates current.json, then restarts the inference server.
   * Admin-only — mutates the shared inference registry.
   */
  setModelPath: adminProcedure
    .input(z.object({
      artifactPath: z.string().min(1).max(4096),
      ggufFile: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Validate against ALLOWED_DIRECTORIES + no path traversal (AGENTS.md security rule).
      // Model files must live in PATHS.models (~/.omnecor/models/ or cwd/models/).
      const safePath = await validatePath(input.artifactPath);

      const isGguf = safePath.toLowerCase().endsWith(".gguf");
      const resolvedPath = isGguf ? path.dirname(safePath) : safePath;
      const resolvedGgufFile = isGguf ? path.basename(safePath) : input.ggufFile;

      const current = await ValetArtifactRegistry.read();
      await ValetArtifactRegistry.write({
        ...current,
        artifact_path: resolvedPath,
        // Only overwrite gguf_file when we have a resolved value; preserve existing otherwise.
        ...(resolvedGgufFile ? { gguf_file: resolvedGgufFile } : {}),
        format: "gguf",
        status: "ready",
      });

      // Fire-and-forget restart — mutation returns immediately; server reloads in background.
      ValetServerService.getInstance().restart().catch(e =>
        console.warn("[ValetRouter] restart after model swap failed:", e)
      );

      return { ok: true, artifactPath: resolvedPath, ggufFile: resolvedGgufFile ?? null };
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

  // ── MoE Chain procedures ────────────────────────────────────────────────────

  /** Return the user's chain config for a given chain type. */
  getMoeChain: protectedProcedure
    .input(z.object({ chainType: z.enum(["local", "cloud"]) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db
        .select()
        .from(moeChainConfigs)
        .where(and(eq(moeChainConfigs.userId, ctx.user.id), eq(moeChainConfigs.chainType, input.chainType)))
        .limit(1);
      return rows[0] ?? null;
    }),

  /** Upsert the user's chain config and rewrite the corresponding .md file. */
  saveMoeChain: protectedProcedure
    .input(z.object({
      chainType: z.enum(["local", "cloud"]),
      steps: z.array(z.object({
        order: z.number().int(),
        label: z.string().min(1).max(128),
        taskCategories: z.array(z.string().max(64)).max(20),
        modelPath: z.string().max(4096).optional(),
        ggufFile: z.string().max(512).optional(),
        providerId: z.string().max(64).optional(),
        modelId: z.string().max(256).optional(),
        enabled: z.boolean(),
      })).max(50),
      projectPath: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await _upsertMoeChain(
        db,
        ctx.user.id,
        input.chainType,
        input.steps as MoeChainStep[],
        input.projectPath ?? null,
      );
      return { ok: true };
    }),

  /**
   * First-run setup: scan available GGUFs + configured providers, seed the DB
   * with a default chain, and write MOE-Chain-L.md / MOE-Chain-C.md to the
   * project directory. Returns the seeded steps so the UI can render them.
   */
  initMoeChain: protectedProcedure
    .input(z.object({
      projectPath: z.string().optional(),
      chainType: z.enum(["local", "cloud", "both"]).default("both"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const wantLocal = input.chainType === "local" || input.chainType === "both";
      const wantCloud = input.chainType === "cloud" || input.chainType === "both";
      const projPath = input.projectPath ?? null;

      // Only walk the models directory when a local chain is actually requested;
      // seed placeholder cloud steps (enabled=false) only when cloud is requested.
      const localSteps: MoeChainStep[] = wantLocal ? await _scanLocalGgufs() : [];
      const cloudSteps: MoeChainStep[] = wantCloud ? _defaultCloudSteps() : [];

      // First-run helper, not a destructive reset → preserve any existing config.
      if (wantLocal) await _upsertMoeChain(db, ctx.user.id, "local", localSteps, projPath, { preserveExisting: true });
      if (wantCloud) await _upsertMoeChain(db, ctx.user.id, "cloud", cloudSteps, projPath, { preserveExisting: true });

      return { localSteps, cloudSteps, projectPath: input.projectPath ?? null };
    }),

  /** Scan the models directory for available GGUF files (for the panel picker). */
  scanLocalModels: protectedProcedure.query(async () => {
    return _scanLocalGgufs();
  }),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const LOGICAL_TASK_ORDER: string[] = [
  "knowledge_retrieval",
  "research",
  "code_generation",
  "code_review",
  "integration",
  "synthesis",
  "reporting",
];

async function _scanLocalGgufs(): Promise<MoeChainStep[]> {
  const results: MoeChainStep[] = [];
  const modelsDir = PATHS.models;
  try {
    const entries = await readdir(modelsDir, { recursive: true, withFileTypes: true });
    let order = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!name.toLowerCase().endsWith(".gguf")) continue;
      const fullPath = path.join(entry.parentPath ?? (entry as { path?: string }).path ?? modelsDir, name);
      results.push({
        order: order++,
        label: name.replace(/\.gguf$/i, ""),
        taskCategories: [],
        modelPath: path.dirname(fullPath),
        ggufFile: name,
        enabled: false,
      });
    }
  } catch { /* models dir absent or unreadable */ }
  return results;
}

function _defaultCloudSteps(): MoeChainStep[] {
  return LOGICAL_TASK_ORDER.map((category, order) => ({
    order,
    label: `${category.replace(/_/g, " ")} specialist`,
    taskCategories: [category],
    providerId: "",
    modelId: "",
    enabled: false,
  }));
}

/**
 * Upsert a user's MoE chain config and (best-effort) rewrite its .md file. Shared
 * by saveMoeChain (explicit save) and initMoeChain (first-run seed). When
 * `preserveExisting` is set, an already-configured chain is left untouched so the
 * first-run seed never clobbers a user's hand-built chain.
 */
async function _upsertMoeChain(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: number,
  chainType: "local" | "cloud",
  steps: MoeChainStep[],
  projectPath: string | null,
  opts: { preserveExisting?: boolean } = {},
): Promise<void> {
  const existing = await db
    .select()
    .from(moeChainConfigs)
    .where(and(eq(moeChainConfigs.userId, userId), eq(moeChainConfigs.chainType, chainType)))
    .limit(1);

  if (opts.preserveExisting && existing[0] && (existing[0].steps ?? []).length > 0) {
    return;
  }

  if (existing[0]) {
    await db
      .update(moeChainConfigs)
      .set({ steps, projectPath, updatedAt: new Date() })
      .where(eq(moeChainConfigs.id, existing[0].id));
  } else {
    await db.insert(moeChainConfigs).values({
      userId, chainType, steps, projectPath,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }

  if (projectPath) {
    try {
      const safeProjPath = await validatePath(projectPath);
      await _writeMoeChainMd(safeProjPath, chainType, steps);
    } catch { /* Non-fatal — .md write failure doesn't block the upsert */ }
  }
}

async function _writeMoeChainMd(
  projectPath: string,
  chainType: "local" | "cloud",
  steps: MoeChainStep[],
): Promise<void> {
  const fileName = chainType === "local" ? "MOE-Chain-L.md" : "MOE-Chain-C.md";
  const title = chainType === "local" ? "MoE Chain — Local (GGUF)" : "MoE Chain — Cloud";
  const filePath = path.join(projectPath, fileName);

  await mkdir(projectPath, { recursive: true });

  const stepLines = steps
    .sort((a, b) => a.order - b.order)
    .map((s, i) => {
      const categories = s.taskCategories.length > 0 ? s.taskCategories.join(", ") : "all tasks";
      const target = chainType === "local"
        ? `${s.modelPath ?? ""}/${s.ggufFile ?? ""}`.replace(/\/+/g, "/")
        : `${s.providerId ?? ""}/${s.modelId ?? ""}`;
      const status = s.enabled ? "✅" : "⬜";
      return `${i + 1}. ${status} **${s.label}** — \`${target}\`\n   *Handles:* ${categories}`;
    })
    .join("\n");

  const md = [
    `# ${title}`,
    "",
    "Auto-generated by Omnecor `/MOE-Chain`. Edit model assignments in",
    "**Settings → Valet Router → MoE Chain** or update this file and re-run `/MOE-Chain` to reload.",
    "",
    "## Chain Steps (execution order)",
    "",
    stepLines || "_No steps configured yet. Use Settings → Valet Router → MoE Chain to add models._",
    "",
    "## Notes",
    "- Steps run sequentially. Output of each step becomes context for the next.",
    "- Steps with empty *Handles* categories run on every task.",
    "- ⬜ = disabled (skipped). ✅ = active.",
    chainType === "local"
      ? "- Only one model loads in RAM at a time (explicit unload between steps)."
      : "- Cloud chain steps are blocked in **Sovereign mode**.",
  ].join("\n");

  await writeFile(filePath, md, "utf8");
}
