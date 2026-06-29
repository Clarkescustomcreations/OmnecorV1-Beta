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
  | "moe_chain_omesh" | "multi_task" | "sub_agent_harness" | "sub_agent_internal";

export type ExecutionMode = "sovereign" | "scrapper" | "big_spender";

export type TaskCategory =
  | "code_generation" | "code_review" | "research" | "synthesis"
  | "media_generation" | "knowledge_retrieval" | "instruction_writing"
  | "integration" | "hardware" | "reporting" | "context_management"
  | "memory_operations" | "local_task";

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
      return this.fastFallback(request);
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
      return this.fastFallback(request);
    }
  }

  private async fastFallback(request: RouteRequest): Promise<RouteDecision> {
    log.warn(
      "[ValetRouter] Inference server offline — using fast static fallback. " +
        "Run 'pnpm valet:fetch' to load the dedicated fast router."
    );

    const mode = request.preferredMode ?? "main_api";
    const primary = request.availableProviders?.[0] ?? "ollama";
    return {
      category: "local_task",
      mode,
      primaryProvider: primary,
      primaryModel: "",
      secondaryProviders: request.availableProviders?.slice(1, 3) ?? [],
      costTier: "free",
      localCapable: true,
      reasoning: "Static fast fallback (Valet Router offline)",
      confidence: 0.5,
      requiresTodoMd: false,
      requiresStatusMd: false,
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
      { id: "sub_agent_harness", label: "Local Sub-Agent Harness", description: "Autonomous Try-Fail-Fix loop for local models" },
      { id: "main_api", label: "Main API", description: "Route to primary configured API" },
      { id: "multi_api", label: "Multi API", description: "Distribute across multiple APIs" },
      { id: "moe_chain", label: "MoE Chain", description: "Sequential chain through fine-tuned models" },
    ];
  }
}
