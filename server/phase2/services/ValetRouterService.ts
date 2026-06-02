/**
 * ValetRouterService — TypeScript bridge to the Python Valet Router inference server.
 *
 * Handles routing decisions, rule-based fallback, and the HARDCODED RULE
 * that every project must create todo.md + status.md.
 */
import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("ValetRouter");

export type RoutingMode =
  | "api_direct" | "valet_background" | "local_omesh" | "main_api"
  | "multi_api" | "main_api_omesh" | "multi_api_omesh" | "moe_chain"
  | "moe_chain_omesh" | "multi_task";

export type ExecutionMode = "sovereign" | "scrapper" | "big_spender";

export type TaskCategory =
  | "code_generation" | "code_review" | "research" | "synthesis"
  | "media_generation" | "knowledge_retrieval" | "instruction_writing"
  | "integration" | "hardware" | "reporting" | "local_task";

export type CostTier = "free" | "low" | "medium" | "high";

export interface RouteRequest {
  task: string;
  context?: string;
  preferredMode?: RoutingMode;
  availableProviders?: string[];
  executionMode?: ExecutionMode;
  taskType?: "chat" | "code" | "research" | "router";
}

export interface RouteDecision {
  category: TaskCategory;
  mode: RoutingMode;
  primaryProvider: string;
  primaryModel: string;
  secondaryProviders: string[];
  costTier: CostTier;
  localCapable: boolean;
  reasoning: string;
  confidence: number;
  requiresTodoMd: boolean;
  requiresStatusMd: boolean;
}

// HARDCODED RULE: Every task/project must start with todo.md + status.md
export const HARDCODED_RULE = {
  requireTodoMd: true,
  requireStatusMd: true,
  planModeFolder: "project-docs",
  planModeDocs: ["PRD.md", "Feature-Plan.md", "Voice-Tone.md", "Design-Preferences.md", "Rules/standards.md"],
} as const;

export class ValetRouterService {
  private static instance: ValetRouterService | null = null;
  private readonly baseUrl: string;
  private available: boolean | null = null; // cached availability

  private constructor() {
    this.baseUrl = ENV.valetRouterUrl;
  }

  public static getInstance(): ValetRouterService {
    if (!ValetRouterService.instance) {
      ValetRouterService.instance = new ValetRouterService();
    }
    return ValetRouterService.instance;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      this.available = res.ok;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async route(request: RouteRequest): Promise<RouteDecision> {
    const available = await this.isAvailable();
    if (!available) {
      return this.ruleFallback(request);
    }
    try {
      const res = await fetch(`${this.baseUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: request.task,
          context: request.context,
          preferred_mode: request.preferredMode ?? "main_api",
          available_providers: request.availableProviders ?? [],
          execution_mode: request.executionMode ?? "scrapper",
          task_type: request.taskType ?? "chat",
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Valet Router HTTP ${res.status}`);
      const data = await res.json() as {
        category: TaskCategory; mode: RoutingMode;
        primary_provider: string; primary_model: string; secondary_providers: string[];
        cost_tier: CostTier; local_capable: boolean;
        reasoning: string; confidence: number;
        requires_todo_md: boolean; requires_status_md: boolean;
      };
      return {
        category: data.category ?? "local_task",
        mode: data.mode,
        primaryProvider: data.primary_provider,
        primaryModel: data.primary_model ?? "",
        secondaryProviders: data.secondary_providers ?? [],
        costTier: data.cost_tier ?? "free",
        localCapable: data.local_capable ?? true,
        reasoning: data.reasoning,
        confidence: data.confidence,
        requiresTodoMd: data.requires_todo_md,
        requiresStatusMd: data.requires_status_md,
      };
    } catch {
      return this.ruleFallback(request);
    }
  }

  private ruleFallback(request: RouteRequest): RouteDecision {
    log.warn(
      "[ValetRouter] Inference server offline — using keyword rule fallback. " +
        "Run 'pnpm valet:fetch' or check Settings → Valet Router to load a model."
    );
    const taskLower = request.task.toLowerCase();
    const isProject = /project|plan|build|create app|create system/.test(taskLower);
    const isCode = /code|function|implement|debug|script/.test(taskLower);
    const isResearch = /research|analyze|compare|summarize/.test(taskLower);
    const isMedia = /image|video|audio|generate picture/.test(taskLower);

    let category: TaskCategory = "local_task";
    let costTier: CostTier = "free";
    let localCapable = true;
    if (isMedia) { category = "media_generation"; costTier = "medium"; }
    else if (isCode) { category = "code_generation"; costTier = "medium"; localCapable = false; }
    else if (isResearch) { category = "research"; costTier = "low"; localCapable = false; }

    const mode = request.preferredMode ?? "main_api";
    const primary = request.availableProviders?.[0] ?? "ollama";
    return {
      category,
      mode,
      primaryProvider: primary,
      primaryModel: "",
      secondaryProviders: request.availableProviders?.slice(1, 3) ?? [],
      costTier,
      localCapable,
      reasoning: "Rule-based fallback (Valet Router offline)",
      confidence: 0.5,
      requiresTodoMd: isProject,
      requiresStatusMd: isProject,
    };
  }

  async getModes(): Promise<Array<{ id: string; label: string; description: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/modes`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json() as { modes: Array<{ id: string; label: string; description: string }> };
        return data.modes;
      }
    } catch {}
    // Static fallback
    return [
      { id: "api_direct", label: "API Direct", description: "Bypass valet, send directly to provider" },
      { id: "main_api", label: "Main API", description: "Route to primary configured API" },
      { id: "multi_api", label: "Multi API", description: "Distribute across multiple APIs" },
      { id: "moe_chain", label: "MoE Chain", description: "Sequential chain through fine-tuned models" },
    ];
  }
}
