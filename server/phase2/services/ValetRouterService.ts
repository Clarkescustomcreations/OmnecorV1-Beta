/**
 * ValetRouterService — TypeScript bridge to the Python Valet Router inference server.
 *
 * Handles routing decisions, rule-based fallback, and the HARDCODED RULE
 * that every project must create todo.md + status.md.
 */
import { ENV } from "../../_core/env.js";

export type RoutingMode =
  | "api_direct" | "valet_background" | "local_omesh" | "main_api"
  | "multi_api" | "main_api_omesh" | "multi_api_omesh" | "moe_chain"
  | "moe_chain_omesh" | "multi_task";

export interface RouteRequest {
  task: string;
  context?: string;
  preferredMode?: RoutingMode;
  availableProviders?: string[];
  taskType?: "chat" | "code" | "research" | "router";
}

export interface RouteDecision {
  mode: RoutingMode;
  primaryProvider: string;
  secondaryProviders: string[];
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
  planModeDocs: ["PRD.md", "Feature-Plan.md", "Voice-Tone.md", "Design-Preferences.md", "Rules-Standards.md"],
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
          task_type: request.taskType ?? "chat",
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Valet Router HTTP ${res.status}`);
      const data = await res.json() as {
        mode: RoutingMode; primary_provider: string; secondary_providers: string[];
        reasoning: string; confidence: number; requires_todo_md: boolean; requires_status_md: boolean;
      };
      return {
        mode: data.mode,
        primaryProvider: data.primary_provider,
        secondaryProviders: data.secondary_providers ?? [],
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
    const taskLower = request.task.toLowerCase();
    const isProject = /project|plan|build|create app|create system/.test(taskLower);
    const mode = request.preferredMode ?? "main_api";
    const primary = request.availableProviders?.[0] ?? "ollama";
    return {
      mode,
      primaryProvider: primary,
      secondaryProviders: request.availableProviders?.slice(1, 3) ?? [],
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
