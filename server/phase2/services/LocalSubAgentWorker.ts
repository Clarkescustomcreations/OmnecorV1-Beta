import { createLogger } from "../../_core/logger.js";
import { AiProviderService, type Message } from "./AiProviderService.js";
import { MemoryArchitectService } from "./MemoryArchitectService.js";
import { AgentService } from "./AgentService.js";
import { AuditLogService } from "./AuditLogService.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";

const execFileAsync = promisify(execFile);
const log = createLogger("LocalSubAgentWorker");

export interface SubAgentTask {
  goal: string;
  providerId?: string;
  modelId?: string;
  maxRetries?: number;
  userId?: number;
  mapId?: string; // For Neural Map retrieval
  systemPrompt?: string; // Allow overriding the default sandbox prompt
  baseUrl?: string;
}

export class LocalSubAgentWorker {
  private static instance: LocalSubAgentWorker | null = null;

  static getInstance(): LocalSubAgentWorker {
    if (!LocalSubAgentWorker.instance) {
      LocalSubAgentWorker.instance = new LocalSubAgentWorker();
    }
    return LocalSubAgentWorker.instance;
  }

  /**
   * Executes a task using a local model in a Try-Fail-Fix loop.
   */
  async executeTask(task: SubAgentTask): Promise<string> {
    const maxRetries = task.maxRetries ?? 3;
    let retries = 0;

    const messages: Message[] = [];
    const defaultSystemPrompt = `You are a localized autonomous agent running in Omnecor's execution harness.
Your goal is to complete the user's task. You have access to tools.
To use a tool, output a JSON block wrapped in <tool_call> tags.
Example:
<tool_call>
{
  "action": "execute_sandbox",
  "command": "python3",
  "args": ["-c", "print('hello')"]
}
</tool_call>

Available actions:
1. "execute_sandbox": Runs a safe CLI command. Provide "command" (string) and "args" (array of strings).
2. "execute_skill": Dynamically executes an MCP skill. Provide "skillName" (string) and "args" (object).

If you are done, simply output your final answer without a <tool_call> tag.`;

    // Combine custom logic loop prompt with hardcoded tool usage instructions
    const activePrompt = task.systemPrompt 
      ? `${task.systemPrompt}\n\n=== TOOL INSTRUCTIONS ===\n${defaultSystemPrompt}` 
      : defaultSystemPrompt;

    // Append the user's task or the GodMode system prompt explicitly
    messages.push({ role: "user", content: `Task Goal:\n${task.goal}` });

    const nativeTools: any[] = [
      {
        type: "function",
        function: {
          name: "execute_sandbox",
          description: "Runs a safe CLI command.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The command to run (e.g. 'python3', 'echo')" },
              args: { type: "array", items: { type: "string" }, description: "Arguments for the command" }
            },
            required: ["command", "args"]
          }
        }
      }
    ];

    // Dynamically inject MCP tools as native tools
    try {
      const agentService = (await import("./AgentService.js")).AgentService.getInstance();
      const mcpTools = await agentService.getAvailableMCPTools();
      for (const mTool of mcpTools) {
        nativeTools.push({
          type: "function",
          function: {
            name: mTool.name,
            description: mTool.description || `MCP Tool: ${mTool.name}`,
            parameters: mTool.inputSchema || { type: "object", properties: {} }
          }
        });
      }
    } catch (e) {
      log.warn("Failed to load MCP tools for LocalSubAgentWorker", e);
    }

    while (retries < maxRetries) {
      try {
        const responseText = await AiProviderService.getInstance().chat({
          providerId: task.providerId || "ollama",
          modelId: task.modelId || "llama3.2:latest",
          systemPrompt: activePrompt,
          baseUrl: task.baseUrl,
          messages,
          tools: nativeTools,
          maxTokens: 1500,
          temperature: 0.2,
          routingMode: "sub_agent_internal" as any,
        });

        if (!responseText) {
          throw new Error("Empty response from local model.");
        }

        messages.push({ role: "assistant", content: responseText });

        // Parse tool call if present (either <tool_call> tags or ```json blocks)
        let toolMatch = responseText.match(/<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/);
        let parsedToolReq: any = null;
        let jsonParseError: string | null = null;

        if (toolMatch) {
          try {
            parsedToolReq = JSON.parse(toolMatch[1]);
          } catch (e: any) {
            jsonParseError = e.message;
          }
        } else {
          // Fallback: Check for raw JSON blocks from native tool usage leaks
          const jsonMatch = responseText.match(/```json\s*({[\s\S]*?})\s*```/);
          if (jsonMatch) {
            try {
              const j = JSON.parse(jsonMatch[1]);
              if (j.name && j.arguments) {
                parsedToolReq = { action: j.name, ...j.arguments };
              } else if (j.action) {
                parsedToolReq = j;
              }
            } catch (e: any) {
              jsonParseError = e.message;
            }
          }
        }

        if (jsonParseError) {
          messages.push({ role: "user", content: `Tool Call Error: Invalid JSON syntax (${jsonParseError}). Make sure to properly escape backslashes (e.g. \\\\ instead of \\) in your JSON string.` });
          retries++;
          continue;
        }

        if (parsedToolReq) {
          try {
            const toolResult = await this.handleToolCall(parsedToolReq);
            messages.push({ role: "user", content: `Tool Result:\n${toolResult}` });
            continue; // Loop back for the model to process the tool result
          } catch (toolErr: any) {
            log.warn("Tool execution failed", toolErr.message);
            AuditLogService.getInstance().log({
              eventType: "sub_agent_failure",
              actorId: task.userId ?? null,
              actorType: "system",
              procedure: "LocalSubAgentWorker.executeTask",
              args: { error: toolErr.message, toolRequest: parsedToolReq },
              result: null,
              ipAddress: null,
              sessionId: null,
            }).catch(e => log.warn("audit log write failed", e.message));
            
            // Try-Fail-Fix: Inject Neural Map context on failure
            let RAGContext = "";
            if (task.mapId) {
                RAGContext = await this.getNeuralMapContext(task.mapId, toolErr.message);
            }
            
            messages.push({ 
                role: "user", 
                content: `Tool Execution Failed: ${toolErr.message}\n\n${RAGContext ? "Relevant Project Context to help fix this:\n" + RAGContext : "Please analyze the error and try again."}` 
            });
            retries++;
            continue;
          }
        }

        // No tool call, assume the model gave the final answer
        return responseText;
      } catch (err: any) {
        log.error("SubAgent harness error", err.message);
        retries++;
        if (retries >= maxRetries) {
            return `Task failed after ${maxRetries} retries. Last error: ${err.message}`;
        }
        messages.push({ role: "user", content: `System Error: ${err.message}. Please fix and try again.` });
      }
    }

    return "Task exceeded maximum retries without a clear final answer.";
  }

  private async handleToolCall(req: any): Promise<string> {
    if (req.action === "execute_sandbox") {
      // Very basic sandbox using execFile for safety (no shell interpolation)
      if (!req.command || !Array.isArray(req.args)) {
        throw new Error("Invalid execute_sandbox payload. Need command and args.");
      }
      // Simple guard against dangerous commands
      const allowedCommands = ["python3", "node", "ls", "echo"];
      if (!allowedCommands.includes(req.command)) {
          throw new Error(`Command ${req.command} is not allowed in sandbox.`);
      }
      const { stdout, stderr } = await execFileAsync(req.command, req.args, { timeout: 10000 });
      return stdout || stderr || "Execution successful (no output).";
    }

    // Native MCP Tool Fallback
    try {
      const agentService = (await import("./AgentService.js")).AgentService.getInstance();
      const skills = await agentService.getAvailableMCPTools();
      const skill = skills.find((s: any) => s.name === req.action);
      if (skill && skill.serverId) {
        // The LLM called an MCP tool natively!
        const result = await agentService.callMCPTool(skill.serverId, req.action, req.args || req || {});
        return typeof result === "string" ? result : JSON.stringify(result);
      }
    } catch (e) {}

    throw new Error(`Unknown action or MCP tool: ${req.action}`);
  }

  private async getNeuralMapContext(mapId: string, errorText: string): Promise<string> {
    try {
      const memory = MemoryArchitectService.getInstance();
      if (!memory.isOnline()) {
         return "";
      }
      const context = await memory.retrieveContext(mapId, `Fix error: ${errorText}`, 1000);
      return context || "";
    } catch {
      return "";
    }
  }
}
