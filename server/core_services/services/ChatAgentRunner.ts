/**
 * @file services/ChatAgentRunner.ts
 * @description Streaming agentic chat loop for the main Omnecor chat.
 *
 * Turns a chat turn into an ordered stream of typed `AgentStreamEvent`s: prose
 * as `text_delta`, and click-to-expand tool boxes (command / edit / job / mcp)
 * as `block_start` → `block_update` → `block_end`. It extends the batch-oriented
 * `LocalSubAgentWorker` tool-call convention (`<tool_call>{…}</tool_call>`) into a
 * real, HITL-gated, in-place-streaming loop.
 *
 * Tools:
 *  - `edit_file`   — search/replace (or whole-file / create) → `FileDiff`, written
 *                    to disk only on approval; every path passes `validatePath`
 *                    scoped to the active neural map's root directory.
 *  - `run_command` — spawn via ProcessManager (no shell interpolation), await
 *                    completion, stream stdout/stderr into the box.
 *  - `start_job`   — spawn a long job via ProcessManager + `AsyncJobService.track`;
 *                    return immediately so the turn ends and the AI is re-prompted
 *                    when the job finishes (the existing async-job → WS path).
 *  - MCP tools     — any other action name is dispatched to `AgentService` MCP.
 *
 * Command and edit actions are gated by the Human-in-the-Loop approval broker
 * (`ToolApprovalRegistry`) unless the session enabled "auto-approve within the
 * active map". A denial is fed back to the model so it can adjust rather than
 * retrying blind.
 *
 * Provider/sovereign gating is the caller's responsibility (the router applies
 * `assertProviderAllowedInMode` per-provider, exactly like the plain chat stream)
 * — this runner never decides whether a provider is allowed.
 */

import path from "path";
import fsp from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../../_core/logger.js";
import { validatePath as defaultValidatePath } from "../../_core/security.js";
import { AiProviderService, type ChatChunk, type ChatInput, type Message, type NativeToolCall } from "./AiProviderService.js";
import {
  AGENT_TOOL_DEFINITIONS,
  DELEGATE_TOOL_DEFINITION,
  TOOL_CALL_TAG,
  toOpenAiToolSchemas,
  type OpenAiToolSchema,
  type ToolDefinition,
} from "./toolSchemas.js";
import { DelegationService, type DelegateParams } from "./DelegationService.js";
import { meshNode } from "../../ommesh/core/MeshNode.js";
import { ProcessManagerService, type ProcessLifecycleEvent } from "./ProcessManagerService.js";
import { AsyncJobService } from "./AsyncJobService.js";
import { ToolApprovalRegistry } from "./ToolApprovalRegistry.js";
import type {
  AssistantBlock,
  CommandBlock,
  EditBlock,
  FileDiff,
  JobBlock,
  McpBlock,
  SubAgentBlock,
  ToolBlockStatus,
} from "@shared/chatBlocks";
import { flattenBlocksToText } from "@shared/chatBlocks";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";

const log = createLogger("ChatAgentRunner");

/** The `<tool_call>` opening marker — prose is everything before it in a turn.
 *  Re-exported from toolSchemas.ts so llama-server's grammar trigger word (see
 *  AiProviderService.chatLocalLlm) can never drift from the text protocol's. */
const TOOL_TAG = TOOL_CALL_TAG;
/** Reasoning markers emitted by "thinking" models (qwen3, deepseek-r1, Qwythos…).
 * Content between them is routed to a collapsible thinking block, not prose. */
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";
/** Hard ceiling on model↔tool round-trips per turn — prevents runaway loops. */
const MAX_TURNS = 8;
/** Per-command wall-clock cap for `run_command` (5 minutes). */
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** Everything a single agentic turn needs. */
export interface AgentRunParams {
  /** Provider + model + conversation history (already RAG-injected upstream). */
  input: ChatInput;
  userId?: number;
  executionMode?: string;
  conversationId?: string;
  mapId?: string;
  /** Active map root directories — file edits + command cwd are scoped here. */
  rootDirectories?: string[];
  /** Session "auto-approve within active map" toggle — skips the HITL wait. */
  autoApprove?: boolean;
  /**
   * Offer the `delegate_task` tool (Mesh-Delegation.md). Only the origin's
   * `agentChatStream` sets this — a delegated run on a peer never gets it, so
   * delegation can't chain peer-to-peer. The spawn is ALWAYS HITL-gated, even
   * with `autoApprove` on (another machine is outside "within the active map").
   */
  allowDelegation?: boolean;
  /** Aborts the run when the client disconnects (subscription teardown). */
  signal?: AbortSignal;
}

/** Injectable collaborators (defaults are the process-wide singletons). */
export interface ChatAgentRunnerDeps {
  aiProvider?: Pick<AiProviderService, "streamChat">;
  approvals?: ToolApprovalRegistry;
  processManager?: ProcessManagerService;
  asyncJob?: Pick<AsyncJobService, "track">;
  validatePath?: (userPath: string, baseDir?: string) => Promise<string>;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, content: string) => Promise<void>;
  /** MCP dispatcher — action names that aren't a built-in tool route here. */
  callMcpTool?: (action: string, args: unknown) => Promise<string>;
  /** Mesh delegation spawn — defaults to `DelegationService.delegate`. */
  delegate?: (params: DelegateParams) => Promise<{ taskId: string; conversationId: string; nodeName: string }>;
  /** Discoverable mesh peer names (for the delegation prompt note + errors). */
  listPeerNames?: () => string[];
}

/** A parsed `<tool_call>` request. */
interface ToolRequest {
  action: string;
  [k: string]: unknown;
}

/** What a turn produced, independent of which tool protocol decodes it. */
interface TurnOutcome {
  fullText: string;
  toolCalls?: NativeToolCall[];
}

/** What a protocol contributes to a turn's request (system prompt + optional
 *  native tool schemas) and how it reads a tool call back out of the result. */
interface ToolProtocol {
  encode(baseSystemPrompt: string | undefined, defs: ToolDefinition[]): { systemPrompt: string; tools?: OpenAiToolSchema[] };
  decode(turn: TurnOutcome): { request?: ToolRequest; error?: string };
}

/**
 * Text `<tool_call>` protocol (Model-Fabric Phase 2 "floor" tier) — works on
 * any model, even a base GGUF with no tool-calling training. Unchanged from
 * pre-Phase-2 behavior: full instructions + JSON example live in the system
 * prompt, and the tag is parsed back out of the streamed text.
 */
const TextToolProtocol: ToolProtocol = {
  encode(base, defs) {
    return { systemPrompt: buildTextToolSystemPrompt(base, defs.includes(DELEGATE_TOOL_DEFINITION)) };
  },
  decode(turn) {
    return parseToolCallText(turn.fullText);
  },
};

/**
 * Native (structured) tool-calling protocol (Model-Fabric Phase 2 "upgrade"
 * tier) — selected per-model via `ChatInput.supportsNativeTools`. The system
 * prompt carries NO tool-call instructions (no prompt pollution): tool schemas
 * ride in `ChatInput.tools` instead, and each provider realizes them for its
 * own transport (OpenAI/Anthropic/Ollama native `tools` params; llama-server's
 * grammar-constrained `<tool_call>` upgrade — see AiProviderService). Decoding
 * prefers the provider's structured `toolCalls`, but still falls back to
 * parsing a stray text `<tool_call>` — a model that ignores the native `tools`
 * param and emits the text convention anyway is still honored.
 */
const NativeToolProtocol: ToolProtocol = {
  encode(base, defs) {
    return { systemPrompt: base ?? "", tools: toOpenAiToolSchemas(defs) };
  },
  decode(turn) {
    const call = turn.toolCalls?.[0];
    if (call) {
      let args: Record<string, unknown>;
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch (e) {
        return { error: `Native tool call arguments were not valid JSON (${(e as Error).message}).` };
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return { error: "Native tool call arguments were not a JSON object." };
      }
      return { request: { action: call.name, ...args } };
    }
    return parseToolCallText(turn.fullText);
  },
};

export class ChatAgentRunner {
  private readonly aiProvider: Pick<AiProviderService, "streamChat">;
  private readonly approvals: ToolApprovalRegistry;
  private readonly processManager: ProcessManagerService;
  private readonly asyncJob: Pick<AsyncJobService, "track">;
  private readonly validatePath: (userPath: string, baseDir?: string) => Promise<string>;
  private readonly readFile: (p: string) => Promise<string>;
  private readonly writeFile: (p: string, content: string) => Promise<void>;
  private readonly callMcpToolOverride?: (action: string, args: unknown) => Promise<string>;
  private readonly delegate: (params: DelegateParams) => Promise<{ taskId: string; conversationId: string; nodeName: string }>;
  private readonly listPeerNames: () => string[];

  constructor(deps: ChatAgentRunnerDeps = {}) {
    this.aiProvider = deps.aiProvider ?? AiProviderService.getInstance();
    this.approvals = deps.approvals ?? ToolApprovalRegistry.getInstance();
    this.processManager = deps.processManager ?? ProcessManagerService.getInstance();
    this.asyncJob = deps.asyncJob ?? AsyncJobService.getInstance();
    this.validatePath = deps.validatePath ?? defaultValidatePath;
    this.readFile = deps.readFile ?? ((p) => fsp.readFile(p, "utf-8"));
    this.writeFile = deps.writeFile ?? ((p, c) => fsp.writeFile(p, c, "utf-8"));
    this.callMcpToolOverride = deps.callMcpTool;
    this.delegate = deps.delegate ?? ((p) => DelegationService.getInstance().delegate(p));
    this.listPeerNames =
      deps.listPeerNames ??
      (() => {
        try {
          return meshNode.getDiscovery().getPeers().map((p) => p.name);
        } catch {
          return [];
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------

  /**
   * Run one agentic turn, yielding the block stream. The generator ends with a
   * single `done` event (final ordered blocks + flattened content) or an `error`.
   */
  async *run(params: AgentRunParams): AsyncGenerator<AgentStreamEvent> {
    const blocks: AssistantBlock[] = [];
    // Track approval ids created this run so teardown can cancel dangling waits.
    const pendingApprovalIds = new Set<string>();
    const onAbort = () => {
      for (const id of pendingApprovalIds) this.approvals.cancel(id);
      pendingApprovalIds.clear();
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });

    // Working message list — seeded with the caller's history, grown with each
    // assistant turn and tool result so the model sees the full trace.
    const messages: Message[] = [...params.input.messages];
    // supportsNativeTools is curated/static per model (Model-Fabric Decision 2)
    // — never probed live — and defaults to the proven text protocol when unset.
    const protocol: ToolProtocol = params.input.supportsNativeTools ? NativeToolProtocol : TextToolProtocol;
    // Mesh delegation is offered only to origin runs (never to a delegated run
    // on a peer). The prompt note names the currently-discoverable peers so the
    // model targets real nodes instead of guessing.
    const defs: ToolDefinition[] = params.allowDelegation
      ? [...AGENT_TOOL_DEFINITIONS, DELEGATE_TOOL_DEFINITION]
      : AGENT_TOOL_DEFINITIONS;
    let baseSystemPrompt = params.input.systemPrompt;
    if (params.allowDelegation) {
      const peers = this.listPeerNames();
      const note = peers.length
        ? `Mesh delegation: "delegate_task" can hand a self-contained task to another Omnecor node. Currently discoverable nodes: ${peers.join(", ")}.`
        : `Mesh delegation: no peer nodes are currently discoverable, so "delegate_task" will fail right now.`;
      baseSystemPrompt = baseSystemPrompt ? `${baseSystemPrompt}\n\n${note}` : note;
    }
    const encoded = protocol.encode(baseSystemPrompt, defs);
    let totalTokens = 0;

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (params.signal?.aborted) break;

        // --- Stream one model turn, splitting prose from the tool call ---------
        const turnResult = yield* this.streamModelTurn(params, messages, encoded.systemPrompt, encoded.tools, blocks);
        totalTokens += turnResult.tokens;
        messages.push({ role: "assistant", content: turnResult.fullText });

        const parsed = protocol.decode(turnResult);
        if (parsed.error) {
          // Malformed tool call — feed the parser error back and let it retry.
          messages.push({
            role: "user",
            content: `Tool Call Error: ${parsed.error} Re-emit a single valid <tool_call> JSON block.`,
          });
          continue;
        }
        if (!parsed.request) {
          // No tool call → this was the final answer (prose already streamed).
          break;
        }

        // --- Execute the tool (HITL-gated), feed the result back --------------
        const toolResult = yield* this.executeTool(parsed.request, params, blocks, pendingApprovalIds);
        messages.push({ role: "user", content: `Tool Result:\n${toolResult}` });

        // A successfully started `start_job` ends the turn: the async-job path
        // re-prompts the AI when the job finishes, so there's no reason to keep
        // looping. But a *denied* or failed start must fall through so the model
        // gets a turn to acknowledge — detected structurally (the job block
        // reached the `running` state), never by parsing the tool-result string.
        const last = blocks.at(-1);
        if (parsed.request.action === "start_job" && last?.type === "job" && last.status === "running") break;
        // A successfully spawned delegation ends the turn the same way — the
        // sub-agent's condensed result re-prompts through the async-job path.
        if (parsed.request.action === "delegate_task" && last?.type === "subagent" && last.status === "running") break;
      }

      yield {
        type: "done",
        blocks,
        content: flattenBlocksToText(blocks),
        totalTokens,
      };
    } catch (err) {
      log.error("ChatAgentRunner failed", { err: (err as Error).message });
      yield { type: "error", message: (err as Error).message };
    } finally {
      params.signal?.removeEventListener("abort", onAbort);
      onAbort();
    }
  }

  // ---------------------------------------------------------------------------
  // Model turn streaming (prose ⇄ tool-call split)
  // ---------------------------------------------------------------------------

  /**
   * Stream a single model completion, splitting it into three regions:
   *  - a leading `<think>…</think>` reasoning block (thinking models) → emitted
   *    as `thinking_delta` into a collapsible thinking block, never as prose;
   *  - prose → `text_delta` into a lazily-created text block;
   *  - a trailing `<tool_call>…` → buffered and returned for parsing.
   * A short suffix is withheld each chunk so a `<think>` / `</think>` / `<tool_call>`
   * tag split across deltas is never leaked into the wrong region.
   */
  private async *streamModelTurn(
    params: AgentRunParams,
    messages: Message[],
    systemPrompt: string,
    tools: OpenAiToolSchema[] | undefined,
    blocks: AssistantBlock[],
  ): AsyncGenerator<AgentStreamEvent, TurnOutcome & { tokens: number }> {
    const chatInput: ChatInput = {
      ...params.input,
      messages,
      systemPrompt,
      tools,
      userId: params.userId,
      executionMode: params.executionMode,
    };

    let fullText = "";
    let emittedLen = 0; // prose chars emitted as text_delta (starts after any </think>)
    let toolTagAt = -1; // index of TOOL_TAG once seen (stops prose emission)
    let tokens = 0;
    let toolCalls: NativeToolCall[] | undefined;
    let textBlockId: string | null = null;

    // Reasoning-region state (inline <think>…</think> in the content stream).
    let reasoningDone = false; // true once past any leading <think>…</think>
    let thinkBlockId: string | null = null;
    let thinkEmittedLen = 0; // fullText index up to which reasoning was emitted

    // Native-reasoning state: some providers stream reasoning in a dedicated
    // field (Ollama `message.thinking`, OpenAI-compatible `delta.reasoning`)
    // rather than as inline tags. Those deltas arrive as `chunk.thinking` and
    // are routed straight to their own thinking block, independent of the inline
    // parser above (a given model uses one convention or the other, not both).
    let nativeThinkBlockId: string | null = null;

    const emitProseTo = (target: number): AgentStreamEvent | null => {
      if (target <= emittedLen) return null;
      const delta = fullText.slice(emittedLen, target);
      emittedLen = target;
      if (!delta) return null;
      if (!textBlockId) {
        textBlockId = uuidv4();
        blocks.push({ id: textBlockId, type: "text", text: "" });
      }
      // Mutate the block in place so `blocks` stays the render source of truth.
      const tb = blocks.find((b) => b.id === textBlockId);
      if (tb && tb.type === "text") tb.text += delta;
      return { type: "text_delta", id: textBlockId, delta };
    };

    const emitThinkingTo = (target: number): AgentStreamEvent | null => {
      if (target <= thinkEmittedLen) return null;
      const delta = fullText.slice(thinkEmittedLen, target);
      thinkEmittedLen = target;
      if (!delta) return null;
      const tb = blocks.find((b) => b.id === thinkBlockId);
      if (tb && tb.type === "thinking") tb.text += delta;
      return { type: "thinking_delta", id: thinkBlockId!, delta };
    };

    /** Longest suffix of `s` that is a prefix of `tag` (for partial-tag withholding). */
    const partialTail = (s: string, tag: string): number => {
      const max = Math.min(s.length, tag.length - 1);
      for (let n = max; n > 0; n--) {
        if (tag.startsWith(s.slice(s.length - n))) return n;
      }
      return 0;
    };

    for await (const chunk of this.aiProvider.streamChat(chatInput, messages, systemPrompt) as AsyncGenerator<ChatChunk>) {
      if (params.signal?.aborted) break;

      // --- Native reasoning field (Ollama think / OpenAI reasoning) ------------
      // Streams alongside (before) the content; never part of `fullText`.
      if (chunk.thinking) {
        if (!nativeThinkBlockId) {
          nativeThinkBlockId = uuidv4();
          blocks.push({ id: nativeThinkBlockId, type: "thinking", text: "", done: false });
        }
        const tb = blocks.find((b) => b.id === nativeThinkBlockId);
        if (tb && tb.type === "thinking") tb.text += chunk.thinking;
        yield { type: "thinking_delta", id: nativeThinkBlockId, delta: chunk.thinking };
      }

      fullText += chunk.delta;
      if (typeof chunk.totalTokens === "number") tokens = chunk.totalTokens;
      if (chunk.toolCalls?.length) toolCalls = chunk.toolCalls;

      // The first real content delta means native reasoning (if any) is done.
      if (chunk.delta && nativeThinkBlockId) {
        const tb = blocks.find((b) => b.id === nativeThinkBlockId);
        if (tb && tb.type === "thinking" && !tb.done) {
          tb.done = true;
          yield { type: "thinking_delta", id: nativeThinkBlockId, delta: "", done: true };
        }
      }

      // --- Reasoning region (only possible at the very start of a turn) --------
      if (!reasoningDone) {
        const trimmed = fullText.replace(/^\s+/, "");
        const openIdx = fullText.indexOf(THINK_OPEN);
        if (openIdx === -1) {
          // No <think> yet. If the start is still a growing prefix of "<think>",
          // withhold and wait; otherwise this turn has no reasoning.
          if (!chunk.done && trimmed.length < THINK_OPEN.length && THINK_OPEN.startsWith(trimmed)) {
            continue; // ambiguous — need more tokens before routing anything
          }
          reasoningDone = true;
          emittedLen = 0;
        } else {
          if (!thinkBlockId) {
            thinkBlockId = uuidv4();
            blocks.push({ id: thinkBlockId, type: "thinking", text: "", done: false });
            thinkEmittedLen = openIdx + THINK_OPEN.length;
          }
          const closeIdx = fullText.indexOf(THINK_CLOSE, openIdx + THINK_OPEN.length);
          if (closeIdx === -1) {
            // Reasoning still streaming — withhold a partial closing tag.
            const safe = fullText.length - partialTail(fullText, THINK_CLOSE);
            const ev = emitThinkingTo(safe);
            if (ev) yield ev;
            continue; // stay in reasoning until </think>
          }
          const ev = emitThinkingTo(closeIdx);
          if (ev) yield ev;
          const tb = blocks.find((b) => b.id === thinkBlockId);
          if (tb && tb.type === "thinking") tb.done = true;
          yield { type: "thinking_delta", id: thinkBlockId, delta: "", done: true };
          reasoningDone = true;
          emittedLen = closeIdx + THINK_CLOSE.length; // prose begins after </think>
        }
      }

      // --- Prose / tool region -------------------------------------------------
      if (reasoningDone && toolTagAt === -1) {
        const idx = fullText.indexOf(TOOL_TAG, emittedLen);
        if (idx !== -1) {
          toolTagAt = idx;
          const ev = emitProseTo(idx); // flush prose up to the tag, then stop
          if (ev) yield ev;
        } else {
          // Withhold a tail that could be a partial opening tag.
          const safe = fullText.length - (TOOL_TAG.length - 1);
          const ev = emitProseTo(Math.max(emittedLen, safe));
          if (ev) yield ev;
        }
      }
      if (chunk.done) break;
    }

    // Stream ended: close out any open reasoning, then flush withheld prose.
    if (thinkBlockId) {
      if (!reasoningDone) {
        const ev = emitThinkingTo(fullText.length);
        if (ev) yield ev;
        reasoningDone = true;
      }
      const tb = blocks.find((b) => b.id === thinkBlockId);
      if (tb && tb.type === "thinking" && !tb.done) {
        tb.done = true;
        yield { type: "thinking_delta", id: thinkBlockId, delta: "", done: true };
      }
    }
    if (!reasoningDone) {
      // A partial-looking "<think>" prefix that never materialised → it was prose.
      reasoningDone = true;
      emittedLen = 0;
    }
    // Close a native reasoning block that never saw a following content delta.
    if (nativeThinkBlockId) {
      const tb = blocks.find((b) => b.id === nativeThinkBlockId);
      if (tb && tb.type === "thinking" && !tb.done) {
        tb.done = true;
        yield { type: "thinking_delta", id: nativeThinkBlockId, delta: "", done: true };
      }
    }
    if (toolTagAt === -1) {
      const ev = emitProseTo(fullText.length);
      if (ev) yield ev;
    }

    if (textBlockId) {
      const tb = blocks.find((b) => b.id === textBlockId);
      if (tb) yield { type: "block_end", block: { ...tb } };
    }

    return { fullText, tokens, toolCalls };
  }

  // ---------------------------------------------------------------------------
  // Tool dispatch
  // ---------------------------------------------------------------------------

  private async *executeTool(
    req: ToolRequest,
    params: AgentRunParams,
    blocks: AssistantBlock[],
    pendingApprovalIds: Set<string>,
  ): AsyncGenerator<AgentStreamEvent, string> {
    switch (req.action) {
      case "edit_file":
        return yield* this.executeEdit(req, params, blocks, pendingApprovalIds);
      case "run_command":
      case "execute_sandbox": // back-compat alias with LocalSubAgentWorker
        return yield* this.executeCommand(req, params, blocks, pendingApprovalIds);
      case "start_job":
        return yield* this.executeStartJob(req, params, blocks, pendingApprovalIds);
      case "delegate_task":
        if (!params.allowDelegation) {
          return "delegate_task is not available in this context (delegated runs cannot delegate further).";
        }
        return yield* this.executeDelegate(req, params, blocks, pendingApprovalIds);
      default:
        return yield* this.executeMcp(req, params, blocks);
    }
  }

  /**
   * Await a HITL decision for `block`. Emits the `pending_approval` update, waits
   * on the registry (unless auto-approved), and returns the outcome. Auto-approve
   * only applies when the action is scoped to the active map (the caller has
   * already validated the path/cwd against the map root).
   */
  private async *awaitApproval(
    block: CommandBlock | EditBlock | JobBlock,
    params: AgentRunParams,
    pendingApprovalIds: Set<string>,
  ): AsyncGenerator<AgentStreamEvent, { approved: boolean; denyReason?: string }> {
    if (params.autoApprove) return { approved: true };
    block.status = "pending_approval";
    yield { type: "block_update", block: { ...block } };
    pendingApprovalIds.add(block.id);
    try {
      const outcome = await this.approvals.waitFor(block.id, params.userId);
      return outcome;
    } finally {
      pendingApprovalIds.delete(block.id);
    }
  }

  // ---------------------------------------------------------------------------
  // edit_file
  // ---------------------------------------------------------------------------

  private async *executeEdit(
    req: ToolRequest,
    params: AgentRunParams,
    blocks: AssistantBlock[],
    pendingApprovalIds: Set<string>,
  ): AsyncGenerator<AgentStreamEvent, string> {
    const relPath = typeof req.path === "string" ? req.path : "";
    const block: EditBlock = { id: uuidv4(), type: "edit", path: relPath, status: "pending" };
    blocks.push(block);
    yield { type: "block_start", block: { ...block } };

    const fail = (msg: string): string => {
      block.status = "error";
      return msg;
    };

    const root = params.rootDirectories?.[0];
    if (!root) {
      const r = fail("No active neural map root directory is set; file edits are disabled. Ask the user to add a root directory to the active map.");
      yield { type: "block_end", block: { ...block } };
      return r;
    }
    if (!relPath) {
      const r = fail("edit_file requires a \"path\".");
      yield { type: "block_end", block: { ...block } };
      return r;
    }

    // Resolve + validate the path against the map root (which validatePath also
    // confirms is inside the global allow-list). Any traversal/escape throws.
    let resolved: string;
    try {
      const absolute = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
      resolved = await this.validatePath(absolute, root);
    } catch (e) {
      const r = fail(`Security: ${(e as Error).message}`);
      yield { type: "block_end", block: { ...block } };
      return r;
    }

    // Read current contents (empty for a new file).
    let before = "";
    let isNew = false;
    try {
      before = await this.readFile(resolved);
    } catch {
      isNew = true;
    }

    // Compute the new contents: whole-file `content`, or a unique search/replace.
    let after: string;
    if (typeof req.content === "string") {
      after = req.content;
    } else if (typeof req.search === "string" && typeof req.replace === "string") {
      if (isNew) {
        const r = fail(`Cannot search/replace in "${relPath}": file does not exist. Provide "content" to create it.`);
        yield { type: "block_end", block: { ...block } };
        return r;
      }
      const occurrences = before.split(req.search).length - 1;
      if (occurrences === 0) {
        const r = fail(`Search text not found in "${relPath}". Read the file and match exactly.`);
        yield { type: "block_end", block: { ...block } };
        return r;
      }
      if (occurrences > 1) {
        const r = fail(`Search text is ambiguous in "${relPath}" (${occurrences} matches). Include more surrounding context so it is unique.`);
        yield { type: "block_end", block: { ...block } };
        return r;
      }
      after = before.replace(req.search, req.replace);
    } else {
      const r = fail("edit_file needs either \"content\" (whole file) or both \"search\" and \"replace\".");
      yield { type: "block_end", block: { ...block } };
      return r;
    }

    block.diff = buildFileDiff(before, after, relPath);
    yield { type: "block_update", block: { ...block } };

    // HITL gate.
    const decision = yield* this.awaitApproval(block, params, pendingApprovalIds);
    if (!decision.approved) {
      block.status = "denied";
      yield { type: "block_end", block: { ...block } };
      return `The user denied the edit to "${relPath}".${decision.denyReason ? ` Reason: ${decision.denyReason}` : ""}`;
    }

    block.status = "running";
    yield { type: "block_update", block: { ...block } };
    try {
      await this.writeFile(resolved, after);
      block.status = "success";
      yield { type: "block_end", block: { ...block } };
      const verb = isNew ? "Created" : "Edited";
      return `${verb} "${relPath}" (+${block.diff.additions ?? 0}/-${block.diff.deletions ?? 0}).`;
    } catch (e) {
      block.status = "error";
      yield { type: "block_end", block: { ...block } };
      return `Failed to write "${relPath}": ${(e as Error).message}`;
    }
  }

  // ---------------------------------------------------------------------------
  // run_command
  // ---------------------------------------------------------------------------

  private async *executeCommand(
    req: ToolRequest,
    params: AgentRunParams,
    blocks: AssistantBlock[],
    pendingApprovalIds: Set<string>,
  ): AsyncGenerator<AgentStreamEvent, string> {
    const command = typeof req.command === "string" ? req.command : "";
    const args = Array.isArray(req.args) ? req.args.map(String) : [];
    const cwd = params.rootDirectories?.[0];

    const block: CommandBlock = {
      id: uuidv4(),
      type: "command",
      command,
      args,
      cwd,
      status: "pending",
    };
    blocks.push(block);
    yield { type: "block_start", block: { ...block } };

    if (!command) {
      block.status = "error";
      yield { type: "block_end", block: { ...block } };
      return "run_command requires a \"command\" string.";
    }

    // HITL gate — the approval dialog is the security boundary for arbitrary
    // commands; execution never uses a shell (spawn with an args array).
    const decision = yield* this.awaitApproval(block, params, pendingApprovalIds);
    if (!decision.approved) {
      block.status = "denied";
      yield { type: "block_end", block: { ...block } };
      return `The user denied running "${command} ${args.join(" ")}".${decision.denyReason ? ` Reason: ${decision.denyReason}` : ""}`;
    }

    block.status = "running";
    block.startedAt = new Date().toISOString();
    yield { type: "block_update", block: { ...block } };

    try {
      const jobId = await this.processManager.spawn({
        type: "custom",
        command,
        args,
        cwd,
        label: `chat: ${command}`,
        captureMode: "raw",
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      const life = await this.waitForLifecycle(jobId, params.signal);
      const captured = this.processManager.getCapturedOutput(jobId) ?? { stdoutTail: [], stderr: "" };
      const output = [captured.stdoutTail.join("\n"), captured.stderr].filter(Boolean).join("\n").trim();

      block.exitCode = life.exitCode ?? undefined;
      block.output = output;
      block.finishedAt = new Date().toISOString();
      block.status = life.state === "completed" ? "success" : "error";
      yield { type: "block_end", block: { ...block } };

      const header = block.status === "success"
        ? `Command exited 0.`
        : `Command failed (state=${life.state}, exit=${life.exitCode ?? "?"}).`;
      return `${header}\nOutput:\n${output || "(no output)"}`;
    } catch (e) {
      block.status = "error";
      block.output = (e as Error).message;
      block.finishedAt = new Date().toISOString();
      yield { type: "block_end", block: { ...block } };
      return `Command errored: ${(e as Error).message}`;
    }
  }

  // ---------------------------------------------------------------------------
  // start_job (long-running, async continuation)
  // ---------------------------------------------------------------------------

  private async *executeStartJob(
    req: ToolRequest,
    params: AgentRunParams,
    blocks: AssistantBlock[],
    pendingApprovalIds: Set<string>,
  ): AsyncGenerator<AgentStreamEvent, string> {
    const command = typeof req.command === "string" ? req.command : "";
    const args = Array.isArray(req.args) ? req.args.map(String) : [];
    const cwd = params.rootDirectories?.[0];
    const label = typeof req.label === "string" && req.label ? req.label : command || "background job";
    const kind = normalizeJobKind(req.kind);

    // A single job box carries the whole lifecycle: proposal → HITL approval →
    // async run. It shows the command it will run during approval, then adopts
    // the spawned `jobId` once launched — no throwaway command box beforehand.
    const jobBlock: JobBlock = {
      id: uuidv4(),
      type: "job",
      jobId: "", // assigned on spawn
      label,
      command,
      args,
      cwd,
      kind,
      status: "pending",
    };
    blocks.push(jobBlock);
    yield { type: "block_start", block: { ...jobBlock } };

    if (!command) {
      jobBlock.status = "failed";
      yield { type: "block_end", block: { ...jobBlock } };
      return "start_job requires a \"command\" string.";
    }

    // A job is a command with an unbounded lifetime — gate it the same way.
    const decision = yield* this.awaitApproval(jobBlock, params, pendingApprovalIds);
    if (!decision.approved) {
      jobBlock.status = "denied";
      yield { type: "block_end", block: { ...jobBlock } };
      return `The user denied starting the job "${label}".${decision.denyReason ? ` Reason: ${decision.denyReason}` : ""}`;
    }

    try {
      const jobId = await this.processManager.spawn({
        type: "custom",
        command,
        args,
        cwd,
        label,
        captureMode: "raw",
      });
      this.asyncJob.track(jobId, {
        userId: params.userId,
        conversationId: params.conversationId,
        label,
      });

      // Adopt the live id and go running — the box stays open so the async-job
      // WS ping can drive it to completion (correlated by `jobId`).
      jobBlock.jobId = jobId;
      jobBlock.status = "running";
      yield { type: "block_update", block: { ...jobBlock } };

      return `Started background job "${label}" (id ${jobId}). It runs asynchronously; you will be re-prompted with a condensed result when it finishes. End your turn now.`;
    } catch (e) {
      jobBlock.status = "failed";
      yield { type: "block_end", block: { ...jobBlock } };
      return `Failed to start job "${label}": ${(e as Error).message}`;
    }
  }

  // ---------------------------------------------------------------------------
  // delegate_task (Mesh-Delegation.md)
  // ---------------------------------------------------------------------------

  /**
   * Spawn a full sub-agent on a mesh peer. The spawn is ALWAYS HITL-gated —
   * even when the session's `autoApprove` is on, because auto-approve is scoped
   * "within the active map" and another machine is categorically outside it.
   * The approval box shows the target node + requested scope (Decision 3) so
   * the user grants exactly that. On approval the delegation launches with
   * start_job semantics: the block goes `running`, the turn ends, and the
   * condensed result re-prompts this conversation via the async-job path.
   */
  private async *executeDelegate(
    req: ToolRequest,
    params: AgentRunParams,
    blocks: AssistantBlock[],
    pendingApprovalIds: Set<string>,
  ): AsyncGenerator<AgentStreamEvent, string> {
    const node = typeof req.node === "string" ? req.node.trim() : "";
    const task = typeof req.task === "string" ? req.task.trim() : "";
    const label =
      typeof req.label === "string" && req.label.trim()
        ? req.label.trim().slice(0, 120)
        : task.split("\n")[0]!.slice(0, 120);
    const scopePath = typeof req.scope_path === "string" && req.scope_path.trim() ? req.scope_path.trim() : undefined;
    const modelId = typeof req.model === "string" && req.model.trim() ? req.model.trim() : undefined;

    const block: SubAgentBlock = {
      id: uuidv4(),
      type: "subagent",
      taskId: "",
      nodeId: node,
      label: label || "delegated task",
      status: "pending",
      scopePath,
      modelId,
    };
    blocks.push(block);
    yield { type: "block_start", block: { ...block } };

    if (!node || !task) {
      block.status = "failed";
      yield { type: "block_end", block: { ...block } };
      return 'delegate_task requires "node" (a discoverable peer name) and "task" (the full instruction).';
    }
    const peers = this.listPeerNames();
    if (!peers.includes(node)) {
      block.status = "failed";
      yield { type: "block_end", block: { ...block } };
      return `Mesh node "${node}" is not currently discoverable. Available nodes: ${peers.join(", ") || "(none)"}.`;
    }

    // HITL — deliberately NOT via awaitApproval: that helper honours
    // params.autoApprove, and a spawn on another machine must never auto-pass.
    block.status = "pending_approval";
    yield { type: "block_update", block: { ...block } };
    pendingApprovalIds.add(block.id);
    let outcome: { approved: boolean; denyReason?: string };
    try {
      outcome = await this.approvals.waitFor(block.id, params.userId);
    } finally {
      pendingApprovalIds.delete(block.id);
    }
    if (!outcome.approved) {
      block.status = "denied";
      yield { type: "block_end", block: { ...block } };
      return `User denied the delegation${outcome.denyReason ? `: ${outcome.denyReason}` : "."} Adjust your approach based on this feedback.`;
    }

    try {
      const spawned = await this.delegate({
        userId: params.userId,
        executionMode: params.executionMode,
        targetNodeId: node,
        label: block.label,
        task,
        scopePath,
        modelId,
        autoApprove: params.autoApprove,
        parentConversationId: params.conversationId,
      });
      block.taskId = spawned.taskId;
      block.conversationId = spawned.conversationId;
      block.nodeName = spawned.nodeName;
      block.status = "running";
      yield { type: "block_update", block: { ...block } };
      return `Delegation started on mesh node "${spawned.nodeName}" (task ${spawned.taskId}). The sub-agent runs in its own managed chat; you will be re-prompted with its condensed result when it finishes. End your turn now.`;
    } catch (e) {
      block.status = "failed";
      block.output = (e as Error).message;
      yield { type: "block_end", block: { ...block } };
      return `Failed to delegate to "${node}": ${(e as Error).message}`;
    }
  }

  // ---------------------------------------------------------------------------
  // MCP tool passthrough
  // ---------------------------------------------------------------------------

  private async *executeMcp(
    req: ToolRequest,
    _params: AgentRunParams,
    blocks: AssistantBlock[],
  ): AsyncGenerator<AgentStreamEvent, string> {
    const block: McpBlock = {
      id: uuidv4(),
      type: "mcp",
      tool: req.action,
      title: req.action,
      status: "running",
      args: req.args ?? req,
    };
    blocks.push(block);
    yield { type: "block_start", block: { ...block } };

    try {
      const result = await this.callMcpTool(req.action, req.args ?? req);
      block.status = "success";
      block.result = result;
      yield { type: "block_end", block: { ...block } };
      return `Tool "${req.action}" result:\n${result}`;
    } catch (e) {
      block.status = "error";
      block.result = (e as Error).message;
      yield { type: "block_end", block: { ...block } };
      return `Tool "${req.action}" failed: ${(e as Error).message}. If this is not a known tool, produce your final answer instead.`;
    }
  }

  private async callMcpTool(action: string, args: unknown): Promise<string> {
    if (this.callMcpToolOverride) return this.callMcpToolOverride(action, args);
    const { AgentService } = await import("./AgentService.js");
    const agentService = AgentService.getInstance();
    const skills = await agentService.getAvailableMCPTools();
    const skill = skills.find((s: { name: string; serverId?: string }) => s.name === action);
    if (!skill || !skill.serverId) {
      throw new Error(`Unknown action or MCP tool: ${action}`);
    }
    const result = await agentService.callMCPTool(skill.serverId, action, (args as Record<string, unknown>) ?? {});
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Await a spawned process reaching a terminal lifecycle state. Guards the race
   * where a fast command exits before the listener attaches by checking the
   * current status first, and cancels the job if the client disconnects.
   */
  private waitForLifecycle(jobId: string, signal?: AbortSignal): Promise<ProcessLifecycleEvent> {
    return new Promise<ProcessLifecycleEvent>((resolve, reject) => {
      const pm = this.processManager;
      const isTerminal = (s: string) => s === "completed" || s === "failed" || s === "cancelled";

      const onLifecycle = (e: ProcessLifecycleEvent) => {
        if (e.jobId !== jobId || !isTerminal(e.state)) return;
        cleanup();
        resolve(e);
      };
      const onAbort = () => {
        cleanup();
        void pm.cancelJob(jobId);
        reject(new Error("Chat stream closed before the command finished."));
      };
      const cleanup = () => {
        pm.off("lifecycle", onLifecycle);
        signal?.removeEventListener("abort", onAbort);
      };

      pm.on("lifecycle", onLifecycle);
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }
      // Race guard: already finished before we subscribed.
      const status = pm.getJobStatus(jobId);
      if (status && isTerminal(status.state)) {
        cleanup();
        resolve({
          jobId,
          type: status.type,
          label: status.label,
          state: status.state,
          exitCode: null,
          error: null,
          timestamp: new Date().toISOString(),
          durationMs: null,
        });
      }
    });
  }

}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Compose the tool-usage system prompt on top of any caller system prompt —
 *  the text protocol's encode(). Unchanged wording from before Model-Fabric
 *  Phase 2 (proven working); the native protocol never calls this. */
export function buildTextToolSystemPrompt(base?: string, includeDelegation = false): string {
  const delegation = includeDelegation
    ? `\n4. "delegate_task" — Delegate a self-contained task to another Omnecor node on the mesh. Provide "node" (a discoverable peer name) and "task" (the complete instruction); optional "label", "scope_path" (an explicit directory ON THE PEER), and "model". A full sub-agent runs it there. Requires user approval; end your turn after delegating and you will be re-prompted with the result when it finishes.`
    : "";
  const tools = `You are Omnecor's agentic assistant. You can take real actions by emitting exactly one JSON tool call wrapped in <tool_call> tags, then stopping so the harness can run it and return the result. Write any prose for the user BEFORE the tag.

Available actions:
1. "edit_file"  — Create or modify a file scoped to the active project. Provide "path" plus EITHER "content" (the full new file) OR "search" and "replace" (an exact, unique snippet to swap). Edits require user approval and are only written on approval.
2. "run_command" — Run a CLI command to completion. Provide "command" (string, never a shell line) and "args" (string array). Requires user approval. Use for quick commands whose output you need now.
3. "start_job"  — Start a long-running command (builds, downloads, training). Same fields as run_command plus an optional "label". It runs asynchronously; end your turn after starting it and you will be re-prompted with the result when it finishes.${delegation}
Any other action name is treated as an MCP tool call.

Rules:
- Emit at most ONE <tool_call> per message.
- Never wrap a tool call in extra prose after the tag.
- When you have completed the task, reply with your final answer and NO tool call.

Example:
<tool_call>
{"action":"edit_file","path":"src/index.ts","search":"const x = 1","replace":"const x = 2"}
</tool_call>`;
  return base ? `${base}\n\n=== TOOL INSTRUCTIONS ===\n${tools}` : tools;
}

/**
 * Parse a `<tool_call>` request out of a turn's full text — shared convention
 * with LocalSubAgentWorker, and the text protocol's decode(). Extraction only
 * requires the *opening* tag: `extractFirstJsonObject` finds the balanced `{…}`
 * object itself and ignores anything after it, so a properly closed
 * `<tool_call>{...}</tool_call>` and a grammar-guaranteed-valid
 * `<tool_call>{...}` with no closing tag (llama-server's native tier, see
 * AiProviderService.chatLocalLlm) both parse identically.
 */
export function parseToolCallText(text: string): { request?: ToolRequest; error?: string } {
  const tagIdx = text.indexOf(TOOL_TAG);
  if (tagIdx !== -1) {
    // Extract the first *balanced* JSON object — a brace-lazy regex
    // (`{[\s\S]*?}`) truncates at the first `}`, corrupting any tool call
    // with a nested object (e.g. MCP args).
    const json = extractFirstJsonObject(text.slice(tagIdx + TOOL_TAG.length));
    if (!json) return { error: "No JSON object found inside <tool_call>." };
    try {
      const obj = JSON.parse(json);
      if (obj && typeof obj.action === "string") return { request: obj as ToolRequest };
      return { error: "Missing string \"action\" field." };
    } catch (e) {
      return { error: `Invalid JSON (${(e as Error).message}).` };
    }
  }
  // Fallback: a raw ```json native-tool leak (best-effort; prose if unparsable).
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const json = extractFirstJsonObject(fenceMatch[1]);
    if (json) {
      try {
        const j = JSON.parse(json);
        if (j.name && j.arguments) return { request: { action: j.name, ...j.arguments } };
        if (typeof j.action === "string") return { request: j as ToolRequest };
      } catch {
        /* not a tool call — treat as prose */
      }
    }
  }
  return {};
}

/**
 * Extract the first balanced `{…}` JSON object from a string, respecting quoted
 * strings and escapes. Handles nested objects and trailing prose after the
 * object — where a lazy `{[\s\S]*?}` regex would truncate at the first `}`.
 * Returns null when no balanced object is present.
 */
export function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // unterminated
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", py: "py", json: "json",
  md: "md", css: "css", html: "html", sh: "sh", rs: "rs", go: "go",
  c: "c", cpp: "cpp", h: "c", java: "java", yml: "yaml", yaml: "yaml", sql: "sql",
};

/** Build a `FileDiff` with a syntax hint and line add/remove counts. */
export function buildFileDiff(before: string, after: string, filePath: string): FileDiff {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const { additions, deletions } = countLineChanges(before, after);
  const diff: FileDiff = { before, after, additions, deletions };
  const language = LANGUAGE_BY_EXT[ext];
  if (language) diff.language = language;
  return diff;
}

/**
 * Line add/remove counts via a longest-common-subsequence diff over lines.
 * Lines present only in `after` count as additions; only in `before` as deletions.
 */
export function countLineChanges(before: string, after: string): { additions: number; deletions: number } {
  // A single trailing newline is a line *terminator*, not an extra empty line —
  // "a\nb\n" is two lines. Strip one before splitting so counts match what a
  // diff tool (and the user) expect in the "+N/-M" box summary.
  const norm = (s: string) => (s.endsWith("\n") ? s.slice(0, -1) : s);
  const na = norm(before);
  const nb = norm(after);
  const a = na.length ? na.split("\n") : [];
  const b = nb.length ? nb.split("\n") : [];
  const m = a.length;
  const n = b.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const common = lcs[0][0];
  return { additions: n - common, deletions: m - common };
}

function normalizeJobKind(raw: unknown): JobBlock["kind"] {
  return raw === "build" || raw === "download" || raw === "process" ? raw : "other";
}

// Re-exported for callers that need the tool status vocabulary inline.
export type { ToolBlockStatus };
