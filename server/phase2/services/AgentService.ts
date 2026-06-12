/**
 * @file server/phase2/services/AgentService.ts
 * @description Omnecor — Agent Orchestration Service
 *
 * Integrates LiteAgent, CrewAI, and n8n connectors.
 * Allows Omnecor to spawn and monitor agent crews or trigger automation workflows.
 */

import { EventEmitter } from "events";
import { ProcessManagerService } from "./ProcessManagerService.js";
import { ENV } from "../../_core/env.js";
import { AuditLogService } from "./AuditLogService.js";
import { PromptSanitizer } from "./PromptSanitizer.js";

// ── RecursiveMAS types ────────────────────────────────────────────────────────

export interface RecursiveMASConfig {
  goal: string;
  agentIds: string[];
  maxIterations?: number;
  mode?: "sequential" | "hierarchical" | "parallel";
  crewConfig?: Record<string, unknown>;
}

export interface AgentMessage {
  agentId: string;
  role: string;
  content: string;
  timestamp: number;
  flagged: boolean;
}

export interface RecursiveMASStatus {
  jobId: string;
  status: "running" | "complete" | "failed";
  messages: AgentMessage[];
  result: string | null;
}

// ── AgentMessageBus ───────────────────────────────────────────────────────────

/**
 * Parses stdout JSON lines emitted by the RecursiveMAS bridge and re-emits
 * them as typed events.
 *
 * Events:
 *   "message" (msg: AgentMessage)
 *   "error"   (err: Error)
 */
export class AgentMessageBus extends EventEmitter {
  private buffer = "";

  /** Feed a raw chunk of stdout data into the bus. */
  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed) as Record<string, unknown>;
        const msg: AgentMessage = {
          agentId: String(raw["agent_id"] ?? raw["agentId"] ?? "unknown"),
          role: String(raw["role"] ?? "assistant"),
          content: String(raw["content"] ?? ""),
          timestamp: Number(raw["timestamp"] ?? Date.now() / 1000),
          flagged: Boolean(raw["flagged"] ?? false),
        };
        this.emit("message", msg);
      } catch {
        // Non-JSON line — ignore
      }
    }
  }
}

export interface AgentTaskConfig {
  type: "crewai" | "liteagent" | "n8n";
  goal: string;
  backstory?: string;
  tools?: string[];
  workflowId?: string; // for n8n
  input?: Record<string, any>;
}

export class AgentService extends EventEmitter {
  private static instance: AgentService | null = null;
  private processManager: ProcessManagerService;

  private constructor() {
    super();
    this.processManager = ProcessManagerService.getInstance();
  }

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  /**
   * Run a CrewAI crew as a child process.
   */
  async runCrew(config: AgentTaskConfig): Promise<string> {
    if (config.type !== "crewai") throw new Error("Invalid agent type for runCrew");

    const sanitized = PromptSanitizer.getInstance().sanitize(config.goal);
    if (sanitized.flagged) {
      AuditLogService.getInstance().log({
        eventType: "security_injection_attempt",
        actorId: null,
        actorType: "system",
        procedure: "agent.runCrew",
        args: { violations: sanitized.violations } as Record<string, unknown>,
        result: null,
        ipAddress: null,
        sessionId: null,
      }).catch(() => {});
      this.emit("security:injection_attempt", { procedure: "agent.runCrew", violations: sanitized.violations });
    }
    const safeConfig = { ...config, goal: sanitized.clean };

    // This would typically involve generating a temporary python script
    // that imports crewai and sets up the crew based on config.
    // For now, we spawn the python bridge.
    AuditLogService.getInstance().log({
      eventType: "agent_crew_spawn",
      actorId: null,
      actorType: "system",
      procedure: "agent.runCrew",
      args: { type: safeConfig.type, goal: safeConfig.goal?.slice(0, 200) } as Record<string, unknown>,
      result: null,
      ipAddress: null,
      sessionId: null,
    }).catch(() => {});
    return this.processManager.spawn({
      type: "custom",
      command: "python3",
      args: ["server/python_bridges/crewai_bridge.py", JSON.stringify(safeConfig)],
      label: `CrewAI: ${safeConfig.goal.slice(0, 30)}...`,
    });
  }

  /**
   * Run a LiteAgent task.
   */
  async runLiteAgent(config: AgentTaskConfig): Promise<string> {
    if (config.type !== "liteagent") throw new Error("Invalid agent type for runLiteAgent");

    const sanitized = PromptSanitizer.getInstance().sanitize(config.goal);
    if (sanitized.flagged) {
      AuditLogService.getInstance().log({
        eventType: "security_injection_attempt",
        actorId: null,
        actorType: "system",
        procedure: "agent.runLiteAgent",
        args: { violations: sanitized.violations } as Record<string, unknown>,
        result: null,
        ipAddress: null,
        sessionId: null,
      }).catch(() => {});
      this.emit("security:injection_attempt", { procedure: "agent.runLiteAgent", violations: sanitized.violations });
    }
    const safeConfig = { ...config, goal: sanitized.clean };

    AuditLogService.getInstance().log({
      eventType: "agent_lite_spawn",
      actorId: null,
      actorType: "system",
      procedure: "agent.runLiteAgent",
      args: { type: safeConfig.type, goal: safeConfig.goal?.slice(0, 200) } as Record<string, unknown>,
      result: null,
      ipAddress: null,
      sessionId: null,
    }).catch(() => {});
    return this.processManager.spawn({
      type: "custom",
      command: "python3",
      args: ["server/python_bridges/liteagent_bridge.py", JSON.stringify(safeConfig)],
      label: `LiteAgent: ${safeConfig.goal.slice(0, 30)}...`,
    });
  }

  /**
   * Trigger an n8n webhook.
   */
  async triggerN8n(config: AgentTaskConfig): Promise<any> {
    if (config.type !== "n8n") throw new Error("Invalid agent type for triggerN8n");
    if (!config.workflowId) throw new Error("n8n workflowId is required");

    const baseUrl = ENV.n8nUrl || "http://localhost:5678";
    const webhookUrl = `${baseUrl}/webhook/${config.workflowId}`;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config.input || {}),
    });

    if (!response.ok) {
      throw new Error(`n8n webhook failed: ${response.statusText}`);
    }

    return await response.json();
  }

  // ── RecursiveMAS bridge methods ─────────────────────────────────────────────

  // MAS_BRIDGE_PORT configures the Multi-Agent System bridge port (default: 8011)
  private readonly MAS_BRIDGE_URL = `http://127.0.0.1:${process.env.MAS_BRIDGE_PORT ?? "8011"}`;
  private readonly MAS_TIMEOUT_MS = 5_000;

  /**
   * Start a RecursiveMAS crew job on the Python bridge.
   * Sanitizes the goal through PromptSanitizer before sending.
   * @returns job_id string from the bridge
   */
  async runRecursiveMAS(config: RecursiveMASConfig): Promise<string> {
    // Sanitize goal
    const sanitized = PromptSanitizer.getInstance().sanitize(config.goal);
    if (sanitized.flagged) {
      await AuditLogService.getInstance().log({
        eventType: "security_injection_attempt",
        actorId: null,
        actorType: "system",
        procedure: "agent.runRecursiveMAS",
        args: { violations: sanitized.violations } as Record<string, unknown>,
        result: null,
        ipAddress: null,
        sessionId: null,
      }).catch(() => {});
      this.emit("security:injection_attempt", {
        procedure: "agent.runRecursiveMAS",
        violations: sanitized.violations,
      });
    }

    const safeGoal = sanitized.clean;

    const body = {
      crew_config: { ...(config.crewConfig ?? {}), mode: config.mode ?? "sequential" },
      goal: safeGoal,
      max_iterations: config.maxIterations ?? 10,
      agent_ids: config.agentIds,
    };

    let response: Response;
    try {
      response = await fetch(`${this.MAS_BRIDGE_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.MAS_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`RecursiveMAS bridge unreachable: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`RecursiveMAS bridge /run failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { job_id: string };
    return data.job_id;
  }

  /**
   * Retrieve the status of a RecursiveMAS job.
   * All inter-agent messages are sanitized before being returned.
   */
  async getRecursiveMASStatus(jobId: string): Promise<RecursiveMASStatus> {
    let response: Response;
    try {
      response = await fetch(`${this.MAS_BRIDGE_URL}/status/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(this.MAS_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`RecursiveMAS bridge unreachable: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`RecursiveMAS bridge /status failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      job_id: string;
      status: "running" | "complete" | "failed";
      messages: Array<{ agent_id: string; role: string; content: string; timestamp: number; flagged: boolean }>;
      result: string | null;
    };

    // Sanitize each inter-agent message content
    const messages: AgentMessage[] = data.messages.map(m => {
      const san = PromptSanitizer.getInstance().sanitize(m.content);
      return {
        agentId: m.agent_id,
        role: m.role,
        content: san.clean,
        timestamp: m.timestamp,
        flagged: m.flagged || san.flagged,
      };
    });

    return {
      jobId: data.job_id,
      status: data.status,
      messages,
      result: data.result,
    };
  }

  // ── MCP tool methods ──────────────────────────────────────────────────────────

  async getAvailableMCPTools() {
    // Dynamic import (not a static top-level import) to break the
    // AgentService <-> MCPClientService circular dependency.
    const { MCPClientService } = await import("./MCPClientService.js");
    return MCPClientService.getInstance().listTools();
  }

  async callMCPTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    const sanitized = PromptSanitizer.getInstance().sanitize(JSON.stringify(args));
    const safeArgs = JSON.parse(sanitized.clean) as Record<string, unknown>;

    AuditLogService.getInstance().log({
      eventType: "mcp_tool_call",
      actorId: null,
      actorType: "system",
      procedure: "agent.callMCPTool",
      args: { serverId, toolName, args: safeArgs },
      result: null,
      ipAddress: null,
      sessionId: null,
    }).catch((err) => {
      console.warn("[AgentService] Failed to write mcp_tool_call audit log:", err);
    });

    const { MCPClientService } = await import("./MCPClientService.js");
    return MCPClientService.getInstance().callTool(serverId, toolName, safeArgs);
  }

  /**
   * Stop a running RecursiveMAS job.
   */
  async stopRecursiveMAS(jobId: string): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(`${this.MAS_BRIDGE_URL}/stop/${encodeURIComponent(jobId)}`, {
        method: "POST",
        signal: AbortSignal.timeout(this.MAS_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`RecursiveMAS bridge unreachable: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`RecursiveMAS bridge /stop failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { stopped: boolean };
    return data.stopped;
  }
}
