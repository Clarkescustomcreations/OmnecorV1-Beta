/**
 * MoeChainService — sequential MoE chain executor.
 *
 * Runs an ordered list of domain-specialist models one at a time, passing each
 * step's output as context into the next. Only one model loads in RAM at once —
 * the design target is 8–16 GB machines.
 *
 * Chain types:
 *   local  — GGUF specialists on Omnecor's own managed `llama-server` runtime
 *            (LocalLlmRuntimeService). `ensureModelLoaded` hot-swaps the runtime
 *            to each step's model (stop current → spawn next), so the swap
 *            itself frees the prior model's RAM — no separate unload needed.
 *   cloud  — configured API providers via AiProviderService
 *
 * Step skipping: if a step has non-empty taskCategories[] and the Valet's
 * classified category doesn't match, that step is skipped to save compute.
 * Empty taskCategories means the step always runs.
 */
import nodePath from "node:path";
import type { MoeChainStep } from "../../../drizzle/schema.js";
import { isSovereignMode } from "../../_core/sovereign.js";
import type { Message } from "./AiProviderService.js";

export type ChunkCallback = (chunk: { content: string; done: boolean }) => void;

export interface ChainContext {
  messages: Message[];
  taskCategory?: string;
  maxTokensPerStep?: number;
  temperature?: number;
  apiKey?: string;
  baseUrl?: string;
  executionMode?: string; // "sovereign" blocks cloud chain steps
  // Spend/budget correlation — forwarded into each cloud step's chat() so per-step
  // cloud usage is logged and counted against the project budget.
  projectId?: string;
  sessionId?: string;
  userId?: number;
}

export interface ChainResult {
  output: string;
  stepsRan: number;
  stepsSkipped: number;
}

export class MoeChainService {
  private static instance: MoeChainService | null = null;

  static getInstance(): MoeChainService {
    if (!MoeChainService.instance) MoeChainService.instance = new MoeChainService();
    return MoeChainService.instance;
  }

  async execute(
    steps: MoeChainStep[],
    chainType: "local" | "cloud",
    ctx: ChainContext,
    onChunk: ChunkCallback,
  ): Promise<ChainResult> {
    const activeSteps = steps
      .filter(s => s.enabled)
      .sort((a, b) => a.order - b.order)
      .filter(s => {
        if (!s.taskCategories || s.taskCategories.length === 0) return true;
        if (!ctx.taskCategory) return true;
        return s.taskCategories.includes(ctx.taskCategory);
      });

    if (activeSteps.length === 0) {
      throw new Error("MoE chain has no active steps matching this task category.");
    }

    const skipped = steps.filter(s => s.enabled).length - activeSteps.length;
    let rollingContext: Message[] = [...ctx.messages];
    let lastOutput = "";
    let stepsRan = 0;

    for (let i = 0; i < activeSteps.length; i++) {
      const step = activeSteps[i]!;
      const isLast = i === activeSteps.length - 1;
      const stepNum = i + 1;
      const total = activeSteps.length;

      // Status chunk so the user sees chain progress in the stream
      onChunk({ content: `\n\n*[MoE Chain — Step ${stepNum}/${total}: ${step.label}…]*\n\n`, done: false });

      if (chainType === "local") {
        lastOutput = await this.runLocalStep(step, rollingContext, ctx, isLast, onChunk);
      } else {
        lastOutput = await this.runCloudStep(step, rollingContext, ctx, isLast, onChunk);
      }

      stepsRan++;

      // Accumulate: append each step's output so later steps see the full
      // transcript of all prior steps' work, not just the immediately-previous one.
      rollingContext = [
        ...rollingContext,
        { role: "assistant" as const, content: lastOutput },
      ];
    }

    onChunk({ content: "", done: true });
    return { output: lastOutput, stepsRan, stepsSkipped: skipped };
  }

  private async runLocalStep(
    step: MoeChainStep,
    messages: Message[],
    ctx: ChainContext,
    isLast: boolean,
    onChunk: ChunkCallback,
  ): Promise<string> {
    const dir = step.modelPath ?? "";
    if (!dir) throw new Error(`MoE local step "${step.label}" has no modelPath configured.`);
    // `scanLocalModels` stores the containing directory in `modelPath` and the
    // filename separately in `ggufFile`; the actual .gguf the runtime must load
    // is their join — which is exactly the absolute path ModelIndexService
    // indexes, so `ensureModelLoaded` resolves it. Fall back to `modelPath`
    // alone for a step that predates `ggufFile` (may already be a full path).
    const modelFile = step.ggufFile ? nodePath.join(dir, step.ggufFile) : dir;

    // Lazy import to avoid the circular dep (AiProviderService → MoeChainService → AiProviderService).
    const { AiProviderService } = await import("./AiProviderService.js") as typeof import("./AiProviderService.js");
    const svc = AiProviderService.getInstance();

    // `completeLocal` hot-swaps the managed llama-server to this step's model
    // (ensureModelLoaded: stop current → spawn requested — the swap itself frees
    // the prior step's model), renders the prompt with the model's own template,
    // and generates via the raw /completion endpoint. Intermediate steps run
    // non-streaming (buffered silently so their content doesn't clutter the
    // chat — the status chunk above already signals progress); only the final
    // step streams visibly to the user.
    const text = await svc.completeLocal(
      {
        providerId: "llamacpp",
        modelId: modelFile,
        modelPath: modelFile,
        messages,
        maxTokens: ctx.maxTokensPerStep ?? 512,
        temperature: ctx.temperature ?? 0.7,
      },
      isLast ? (chunk) => onChunk({ content: chunk.content, done: false }) : undefined,
    );

    return text;
  }

  private async runCloudStep(
    step: MoeChainStep,
    messages: Message[],
    ctx: ChainContext,
    isLast: boolean,
    onChunk: ChunkCallback,
  ): Promise<string> {
    if (isSovereignMode(ctx.executionMode)) {
      throw new Error(
        `Sovereign mode: cloud chain step "${step.label}" is blocked. ` +
        "Switch to the local GGUF chain or disable Sovereign mode."
      );
    }

    const providerId = step.providerId ?? "";
    const modelId = step.modelId ?? "";
    if (!providerId || !modelId) {
      throw new Error(`MoE cloud step "${step.label}" is missing providerId or modelId.`);
    }

    // Lazy import to avoid circular dep (AiProviderService → MoeChainService → AiProviderService)
    const { AiProviderService } = await import("./AiProviderService.js") as typeof import("./AiProviderService.js");
    const svc = AiProviderService.getInstance();

    // Use non-streaming chat() — collects full response then either streams to
    // user (final step) or passes silently as context to the next step.
    const text = await svc.chat({
      providerId,
      modelId,
      messages,
      apiKey: ctx.apiKey,
      baseUrl: ctx.baseUrl,
      maxTokens: ctx.maxTokensPerStep ?? 512,
      temperature: ctx.temperature,
      routingMode: "api_direct", // step-level routing already resolved; bypass Valet
      // Per-step spend accounting (budget pre-flight + logSpend are gated on projectId).
      projectId: ctx.projectId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
    });

    if (isLast) {
      onChunk({ content: text, done: false });
    }

    return text;
  }
}
