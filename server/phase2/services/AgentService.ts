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

    // This would typically involve generating a temporary python script 
    // that imports crewai and sets up the crew based on config.
    // For now, we spawn the python bridge.
    return this.processManager.spawn({
      type: "custom",
      command: "python3",
      args: ["server/python_bridges/crewai_bridge.py", JSON.stringify(config)],
      label: `CrewAI: ${config.goal.slice(0, 30)}...`,
    });
  }

  /**
   * Run a LiteAgent task.
   */
  async runLiteAgent(config: AgentTaskConfig): Promise<string> {
    if (config.type !== "liteagent") throw new Error("Invalid agent type for runLiteAgent");

    return this.processManager.spawn({
      type: "custom",
      command: "python3",
      args: ["server/python_bridges/liteagent_bridge.py", JSON.stringify(config)],
      label: `LiteAgent: ${config.goal.slice(0, 30)}...`,
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
}
