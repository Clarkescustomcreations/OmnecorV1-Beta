import { createLogger } from "../../_core/logger.js";
import { AiProviderService, type Message } from "./AiProviderService.js";
import { MemoryArchitectService } from "./MemoryArchitectService.js";
import { AgentService } from "./AgentService.js";
import { AuditLogService } from "./AuditLogService.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);
const log = createLogger("LocalSubAgentWorker");

/**
 * Observability events emitted during a run (opt-in via `SubAgentTask.onEvent`).
 * Lets a caller — e.g. the agentic benchmark — count real tool steps and record
 * the trajectory without changing execution behavior.
 */
export type SubAgentEvent =
  | { type: "assistant"; text: string }
  | { type: "tool_call"; action: string; request: unknown }
  | { type: "tool_result"; action: string; result: string }
  | { type: "tool_error"; action: string; error: string }
  | { type: "parse_error"; error: string }
  | { type: "final"; text: string }
  | { type: "harness_error"; error: string };

export interface SubAgentTask {
  goal: string;
  providerId?: string;
  modelId?: string;
  /** Failure budget — parse/tool/harness errors that consume a retry. */
  maxRetries?: number;
  /** Hard cap on total loop iterations (model turns), independent of retries.
   *  Prevents an unbounded loop when a model keeps making *successful* tool
   *  calls without ever finishing. Defaults to 50. */
  maxSteps?: number;
  userId?: number;
  mapId?: string; // For Neural Map retrieval
  systemPrompt?: string; // Allow overriding the default sandbox prompt
  baseUrl?: string;
  /** Optional trajectory observer (non-invasive; exceptions are swallowed). */
  onEvent?: (ev: SubAgentEvent) => void;
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
    const maxSteps = task.maxSteps ?? 50;
    let retries = 0;
    let steps = 0;
    // Recovery aids: remember the last call that FAILED so we can detect the
    // model re-sending the identical broken call and break the loop.
    let lastFailedSig: string | null = null;
    let sameFailCount = 0;
    const emit = (ev: SubAgentEvent) => { try { task.onEvent?.(ev); } catch { /* observer must never break the run */ } };

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
1. "execute_sandbox": Run code or a safe command (allowed: python3, node, ls, echo).
   • For a MULTI-LINE program (anything with def/while/for/if or more than one statement),
     pass a "code_lines" array — ONE array element per line of source. This is the reliable
     way; do NOT cram a multi-line program into "-c". Example:
     {"action":"execute_sandbox","command":"python3","code_lines":["def f(n):","    return n*n","print(f(27))"]}
   • You may instead pass "code" as a single string (use \\n for line breaks).
   • For a trivial one-liner or a plain command, pass "args": {"action":"execute_sandbox","command":"ls","args":["docs"]}.
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

    while (retries < maxRetries && steps < maxSteps) {
      steps++;
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
        emit({ type: "assistant", text: responseText });

        // Parse a tool call from the model's text. Small local models are wildly
        // inconsistent about framing, so accept all three shapes and normalize:
        //   1. `<tool_call>{…}</tool_call>` tags (the prompted convention)
        //   2. a ``` / ```json fenced object
        //   3. a BARE JSON object inline with no wrapper — qwen2.5-coder and many
        //      others emit `{"name":"execute_sandbox","arguments":{…}}` (or
        //      `{"action":…}`) as plain content, which the old parser missed
        //      entirely (→ the run mistook the tool call for a final answer).
        // All three normalize to `{action, …params}`.
        let parsedToolReq: any = null;
        let jsonParseError: string | null = null;
        const isExplicit = /<tool_call>/.test(responseText);
        const candidate =
          responseText.match(/<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/)?.[1]
          ?? responseText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/)?.[1]
          ?? this.extractFirstJsonObject(responseText);
        if (candidate) {
          try {
            const j = JSON.parse(candidate);
            if (j && typeof j === "object") {
              if (j.name && j.arguments) parsedToolReq = { action: j.name, ...j.arguments };
              else if (j.action) parsedToolReq = j;
            }
          } catch (e: any) {
            // Only treat a parse failure as a retryable tool error when the model
            // explicitly opened a <tool_call> tag; a bare-JSON guess that doesn't
            // parse is almost certainly just prose, so let it stand as the answer.
            if (isExplicit) jsonParseError = e.message;
          }
        }

        if (jsonParseError) {
          emit({ type: "parse_error", error: jsonParseError });
          messages.push({ role: "user", content: `Tool Call Error: Invalid JSON syntax (${jsonParseError}). Make sure to properly escape backslashes (e.g. \\\\ instead of \\) in your JSON string.` });
          retries++;
          continue;
        }

        if (parsedToolReq) {
          const action = String(parsedToolReq.action ?? "unknown");
          emit({ type: "tool_call", action, request: parsedToolReq });
          try {
            const toolResult = await this.handleToolCall(parsedToolReq);
            emit({ type: "tool_result", action, result: toolResult });
            messages.push({ role: "user", content: `Tool Result:\n${toolResult}` });
            continue; // Loop back for the model to process the tool result
          } catch (toolErr: any) {
            log.warn("Tool execution failed", toolErr.message);
            emit({ type: "tool_error", action, error: toolErr.message });
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
            
            // Build targeted recovery guidance so Try-Fail-Fix can actually make
            // progress instead of re-hitting the same wall.
            const hints: string[] = [];
            // (a) Multi-line program flattened onto one line → SyntaxError.
            if (/SyntaxError|IndentationError/i.test(toolErr.message) && (parsedToolReq?.args?.[0] === "-c" || parsedToolReq?.code != null)) {
              hints.push(`It looks like a multi-line program was flattened onto one line. Do NOT use "-c" for multi-line code. Re-send it as "code_lines" — an array with ONE element per line, e.g. {"action":"execute_sandbox","command":"python3","code_lines":["def f(n):","    return n*n","print(f(3))"]}.`);
            }
            // (b) Command exceeded the sandbox time limit.
            if (/timed out|ETIMEDOUT|timeout/i.test(toolErr.message)) {
              hints.push(`The command exceeded the 10s time limit. Use a faster / more efficient algorithm (e.g. memoize, avoid recomputation, reduce the search space) — brute force is too slow here.`);
            }
            // (c) Loop-breaker: the model re-sent the IDENTICAL failing call.
            const sig = JSON.stringify(parsedToolReq);
            if (sig === lastFailedSig) {
              sameFailCount++;
              hints.push(`You have already tried this EXACT call ${sameFailCount + 1} times and it fails the same way. Do NOT repeat it — change your APPROACH: fix the actual cause above, switch to "code_lines", or use a different method.`);
            } else { sameFailCount = 0; lastFailedSig = sig; }

            messages.push({
                role: "user",
                content: `Tool Execution Failed: ${toolErr.message}\n\n${RAGContext ? "Relevant Project Context to help fix this:\n" + RAGContext + "\n\n" : ""}${hints.length ? "HINTS:\n- " + hints.join("\n- ") : "Please analyze the error and try again — do not repeat the same call."}`
            });
            retries++;
            continue;
          }
        }

        // No tool call, assume the model gave the final answer
        emit({ type: "final", text: responseText });
        return responseText;
      } catch (err: any) {
        log.error("SubAgent harness error", err.message);
        emit({ type: "harness_error", error: err.message });
        retries++;
        if (retries >= maxRetries) {
            return `Task failed after ${maxRetries} retries. Last error: ${err.message}`;
        }
        messages.push({ role: "user", content: `System Error: ${err.message}. Please fix and try again.` });
      }
    }

    return steps >= maxSteps
      ? `Task exceeded the ${maxSteps}-step ceiling without a final answer.`
      : "Task exceeded maximum retries without a clear final answer.";
  }

  /**
   * Return the first *balanced* `{…}` JSON object in `text` (respecting strings
   * and escapes), or null. Lets us pull a bare inline tool-call object out of a
   * response that has no fence/tag and possibly trailing prose.
   */
  private extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
  }

  /** Write `source` to a temp file and run it with `command` (python3/node). */
  private async runScript(command: string, source: string): Promise<string> {
    const ext = command === "node" ? "js" : "py";
    const file = path.join(os.tmpdir(), `omnecor-sandbox-${uuidv4()}.${ext}`);
    try {
      await writeFile(file, source, "utf8");
      const { stdout, stderr } = await execFileAsync(command, [file], { timeout: 10000 });
      return stdout || stderr || "Execution successful (no output).";
    } finally {
      unlink(file).catch(() => { /* best-effort temp cleanup */ });
    }
  }

  private async handleToolCall(req: any): Promise<string> {
    if (req.action === "execute_sandbox") {
      const allowedCommands = ["python3", "node", "ls", "echo"];
      if (!req.command || !allowedCommands.includes(req.command)) {
        throw new Error(`Command ${req.command ?? "(none)"} is not allowed in sandbox (allowed: ${allowedCommands.join(", ")}).`);
      }

      // ── Multi-line SCRIPT path ──────────────────────────────────────────────
      // A `code` (string, may use \n) or `code_lines` (array of lines) field is
      // written to a temp file and executed. This is the reliable way to run a
      // REAL multi-line program: `python3 -c <arg>` and execFile args collapse a
      // def/while/for body onto one line and SyntaxError. `code_lines` is
      // especially robust for small models — no newline-escaping inside JSON.
      const codeRaw = req.code ?? req.script ?? req.code_lines;
      if (codeRaw != null) {
        const source = Array.isArray(codeRaw) ? codeRaw.join("\n") : String(codeRaw);
        return this.runScript(req.command, source);
      }

      // ── Simple-command path: {command, args} ────────────────────────────────
      if (!Array.isArray(req.args)) {
        throw new Error("Invalid execute_sandbox payload. Provide either `code` (a full script) or `args` (a command's arguments).");
      }
      // Safety net: if the model still used `-c <multi-line source>`, run it as a
      // real file so a valid program isn't rejected for physical-line reasons.
      if ((req.command === "python3" || req.command === "node") && req.args[0] === "-c" && typeof req.args[1] === "string" && /[\n;]/.test(req.args[1]) && /\b(def|class|while|for|if)\b/.test(req.args[1])) {
        return this.runScript(req.command, req.args[1]);
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
