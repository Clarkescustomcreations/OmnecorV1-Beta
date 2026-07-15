/**
 * @file server/core_services/services/AiProviderService.ts
 * @description Omnecor — AI Provider Service
 *
 * Orchestrates requests to various AI providers (Ollama, OpenAI, Anthropic, Gemini).
 * Implements streaming, token handling, and provider-specific formatting.
 *
 * This service acts as the "Valet Router" engine, selecting the best model
 * for a given task based on configuration or budget.
 */

import path from "path";
import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";
import { ValetRouterService, type RoutingMode } from "./ValetRouterService.js";
import { LocalLlmRuntimeService } from "./LocalLlmRuntimeService.js";

const log = createLogger("AiProvider");
// PromptSanitizer imported dynamically to avoid hard dep (Phase 22 parallel work)
import { meshNode } from "../../ommesh/core/MeshNode.js";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.factory.js";
import { spendLog, projectBudgets, walletAlertLog } from "../../../drizzle/schema.js";
import { and, eq, gt } from "drizzle-orm";
import { calculateCostMicrocents } from "../config/providerPricing.js";
import { SettingsService } from "./SettingsService.js";
import { resolveOllamaUrl } from "./ollamaUrl.js";
import { NotificationService } from "../../_core/NotificationService.js";
import { type PeerInfo } from "../../ommesh/core/DiscoveryService.js";
import {
  TOOL_CALL_TAG,
  buildLocalLlmToolGrammarSchema,
  buildLocalLlmToolReminder,
  openAiToolsToAnthropic,
  type OpenAiToolSchema,
} from "./toolSchemas.js";

/**
 * Build a human-useful error from a failed provider HTTP response. Surfaces the
 * provider's actual error message (e.g. "credit balance too low",
 * "insufficient_quota") instead of the opaque `statusText` ("Bad Request"),
 * so the user sees an actionable reason. Only called on the !response.ok path,
 * so consuming the body here is safe.
 */
async function describeHttpError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const j = JSON.parse(body);
    const msg =
      j?.error?.message ??
      (typeof j?.error === "string" ? j.error : undefined) ??
      j?.message;
    if (typeof msg === "string" && msg.trim()) return `${response.status} — ${msg.trim()}`;
  } catch { /* body wasn't JSON */ }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
  return snippet ? `${response.status} — ${snippet}` : `${response.status} ${response.statusText}`;
}

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export interface Message {
  role: Role;
  content: string;
}

export interface ChatInput {
  providerId: string;
  modelId: string;
  messages: Message[];
  /** OpenAI-compatible tool schemas — set only by the agentic runner's native
   *  tool protocol (Model-Fabric Phase 2). Absent → no `tools` param is sent
   *  and no provider attempts native tool-calling for this turn. */
  tools?: OpenAiToolSchema[];
  /** Whether the caller wants native (structured) tool-calling attempted for
   *  this turn rather than the text `<tool_call>` convention. Curated/static
   *  per model (Model-Fabric Decision 2/lmstudio-js finding) — never probed
   *  live. Defaults to false (text protocol) when unset. */
  supportsNativeTools?: boolean;
  apiKey?: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  isFictionMode?: boolean;
  projectId?: string;  // for Agentic Wallet budget tracking
  sessionId?: string;  // for spend log correlation
  routingMode?: RoutingMode;
  modelPath?: string;
  userId?: number;        // required for moe_chain DB config lookup
  executionMode?: string; // required for Sovereign mode enforcement in cloud chain steps
  meshOrigin?: boolean;   // request arrived over OMMESH — never re-offload it to another peer
  /** Model-Fabric Phase 5 — pin mesh routing to a specific OMMESH peer (the
   *  node id from a `mesh-peer` catalog entry the caller selected), bypassing
   *  `selectPeerNode`'s VRAM-weighted auto-scorer. Unset → auto-select as
   *  before. Equal to the local node's own id → force local execution even
   *  when a peer would otherwise out-score it. */
  targetNodeId?: string;
}

/** A single native (structured) tool call, normalized across providers —
 * OpenAI/Anthropic/Ollama all report tool calls differently on the wire;
 * every provider implementation assembles its own format into this shape. */
export interface NativeToolCall {
  id?: string;
  name: string;
  /** JSON-encoded arguments string (parse for the object) — kept as a raw
   *  string because streaming providers deliver it as incremental fragments
   *  that are only guaranteed valid JSON once fully assembled. */
  arguments: string;
}

export interface ChatChunk {
  content: string;
  delta: string;
  done: boolean;
  totalTokens?: number;
  /**
   * Model reasoning ("thinking") delta, when the provider streams it in a field
   * separate from `content` (Ollama ≥0.9 `message.thinking`, OpenAI-compatible
   * `delta.reasoning` / `reasoning_content`). Routed to a collapsible reasoning
   * block by the agentic runner; never counted toward `content`/token totals.
   */
  thinking?: string;
  /** Fully-assembled native tool call(s), attached only to the terminal
   *  (`done: true`) chunk once a provider's streamed fragments are complete. */
  toolCalls?: NativeToolCall[];
}

/**
 * Conservative token ceiling for the local fallback model. When a hard budget
 * cap forces local inference, a conversation estimated above this many tokens
 * is treated as too large to fit a typical local context window, so we block
 * with a clear message instead of silently truncating or overflowing.
 */
const LOCAL_CONTEXT_TOKEN_BUDGET = 8000;

/** Network timeout for a streaming chat completion (long-running). */
const CHAT_NETWORK_TIMEOUT_MS = 300_000; // 5 minutes
/** Providers eligible for OMMESH federated offload — local compute only. */
const MESH_ROUTABLE_PROVIDERS = new Set(["ollama", "llamacpp"]);
/**
 * Per-model Ollama "thinking" capability, probed once via /api/show and cached
 * process-wide (keyed `baseUrl::model`). Passing `think:true` to a model that
 * doesn't support it 400s, so we gate the request on this.
 */
const ollamaThinkingCache = new Map<string, boolean>();
/** Network timeout for quick model-discovery calls. */
const DISCOVERY_TIMEOUT_MS = 10_000; // 10 seconds

class SignalAsyncQueue<T> {
  private queue: T[] = [];
  private resolver: (() => void) | null = null;
  private closed = false;

  push(item: T) {
    this.queue.push(item);
    if (this.resolver) {
      this.resolver();
      this.resolver = null;
    }
  }

  close() {
    this.closed = true;
    if (this.resolver) {
      this.resolver();
      this.resolver = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.closed || this.queue.length > 0) {
      if (this.queue.length === 0) {
        await new Promise<void>(r => { this.resolver = r; });
      }
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
    }
  }
}

export class AiProviderService {
  private static instance: AiProviderService;

  private constructor() {}

  public static getInstance(): AiProviderService {
    if (!AiProviderService.instance) {
      AiProviderService.instance = new AiProviderService();
    }
    return AiProviderService.instance;
  }

  /**
   * Raise an agentic-wallet notification once per (project, level) per session.
   * Persisted in DB so alerts don't re-fire after restart.
   */
  private async raiseWalletAlert(projectId: string, userId: string, level: "threshold" | "over", body: string): Promise<void> {
    try {
      const db = await getDb();
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7-day dedup window
      const existing = await db.select().from(walletAlertLog).where(
        and(eq(walletAlertLog.userId, userId), eq(walletAlertLog.alertType, level), gt(walletAlertLog.sentAt, since))
      ).limit(1);

      if (existing.length > 0) return;
      if (level === "threshold") {
        const overAlert = await db.select().from(walletAlertLog).where(
          and(eq(walletAlertLog.userId, userId), eq(walletAlertLog.alertType, "over"), gt(walletAlertLog.sentAt, since))
        ).limit(1);
        if (overAlert.length > 0) return;
      }

      await db.insert(walletAlertLog).values({ id: uuidv4(), userId, alertType: level });
    } catch {
      // Non-critical — fire the notification anyway
    }
    NotificationService.getInstance().notify({
      kind: "wallet",
      title: level === "over" ? "Budget limit reached" : "Budget warning",
      body,
      href: "/wallet",
      data: { projectId, level },
    });
  }

  /**
   * Helper to get provider API key, preferring dynamic settings over env.
   */
  private getProviderKey(providerId: string, inputKey?: string): string {
    if (inputKey) return inputKey;

    const settings = SettingsService.getInstance();
    switch (providerId.toLowerCase()) {
      case "openai":
        return settings.getSecret("openaiApiKey", ENV.openaiApiKey);
      case "anthropic":
        return settings.getSecret("anthropicApiKey", ENV.anthropicApiKey);
      case "gemini":
        return settings.getSecret("geminiApiKey", ENV.geminiApiKey);
      case "grok":
        return settings.getSecret("xaiApiKey", ENV.xaiApiKey);
      case "huggingface":
        return settings.getSecret("huggingfaceApiKey", ENV.huggingfaceApiKey);
      case "elevenlabs":
        return settings.getSecret("elevenLabsApiKey", ENV.elevenLabsApiKey);
      case "falai":
        return settings.getSecret("falaiApiKey", ENV.falaiApiKey);
      case "forge":
        return settings.getSecret("forgeApiKey", ENV.forgeApiKey);
      default:
        return "";
    }
  }

  /**
   * Whether a cloud provider has a usable API key configured (env or dynamic
   * settings) — without exposing the key itself. Used by ModelCatalogService
   * (Model-Fabric Phase 3) to decide whether it's worth calling
   * `discoverProviderModels` for a given cloud provider at all.
   */
  public hasProviderKey(providerId: string): boolean {
    return !!this.getProviderKey(providerId);
  }

  private getProviderBaseUrl(providerId: string, inputUrl?: string): string {
    if (inputUrl) return inputUrl;
    const settings = SettingsService.getInstance();
    const key = `${providerId.toUpperCase()}_BASE_URL`;
    return settings.getSecret(key, settings.getSecret(`${providerId}BaseUrl`, ""));
  }

  private getOllamaUrl(inputUrl?: string): string {
    // Delegate to the single shared resolver so inference and every status/probe
    // path (system.aiProviders / detectHardware / checkDependencies) agree on the
    // endpoint. See ollamaUrl.ts for the resolution order.
    return resolveOllamaUrl(inputUrl);
  }

  /**
   * Main entry point for chat completions.
   */
  async chat(input: ChatInput): Promise<string> {
    const chunks: string[] = [];
    await this.chatStream(input, chunk => {
      chunks.push(chunk.content);
    });
    return chunks.join("");
  }

  /**
   * Single-model local completion on Omnecor's own managed `llama-server`
   * runtime (Model-Fabric). Hot-swaps to `modelId`/`modelPath` via
   * `LocalLlmRuntimeService.ensureModelLoaded` and generates through the raw
   * template-free `/completion` endpoint, returning the full text (and
   * streaming to `onChunk` when supplied).
   *
   * Unlike the public `chat()`/`streamChat()` path this deliberately bypasses
   * Valet routing AND the local sub-agent Try-Fail-Fix harness — the caller
   * wants a plain single-model generation, not a tool loop. Used by
   * `MoeChainService` for per-step chain execution: each step is one model, and
   * the runtime's swap between steps replaces the old bridge's unload/preWarm.
   */
  async completeLocal(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    return this.chatLocalLlm({ ...input, providerId: "llamacpp" }, onChunk);
  }

  /**
   * Async generator for streaming chat completions.
   */
  async *streamChat(
    input: ChatInput,
    messages?: Message[],
    systemPrompt?: string
  ): AsyncGenerator<ChatChunk> {
    const chatInput = { ...input };
    if (messages) chatInput.messages = messages;
    if (systemPrompt) chatInput.systemPrompt = systemPrompt;

    // Sub-Agent Harness Auto-Wrap:
    // If auto-routing is off (api_direct) or if Valet routed to sub_agent_harness,
    // and the model is local, wrap it in the sub-agent harness loop, UNLESS we are already inside it.
    const isLocalProvider = chatInput.providerId === "ollama" || chatInput.providerId === "llamacpp";
    if (
      isLocalProvider &&
      chatInput.routingMode !== "sub_agent_internal" &&
      (chatInput.routingMode === "api_direct" || chatInput.routingMode === "sub_agent_harness")
    ) {
      log.info("[SubAgent Wrap] Intercepting local model execution to run through Try-Fail-Fix harness");
      const { LocalSubAgentWorker } = await import("./LocalSubAgentWorker.js");
      const userMessage = [...chatInput.messages].reverse().find(m => m.role === "user")?.content ?? "Execute task";
      const result = await LocalSubAgentWorker.getInstance().executeTask({
        goal: userMessage,
        providerId: chatInput.providerId,
        modelId: chatInput.modelId,
        maxRetries: 3
      });
      yield { content: result, delta: result, done: true };
      return;
    }

    // Workstation Optimization — apply GPU Bypass if enabled
    const settings = SettingsService.getInstance().getSettings();
    if (settings.gpuBypass && chatInput.providerId === "ollama") {
      // In a real Ollama environment, we might need to set an env var or 
      // use a specific model tag. For now, we log the bypass.
      log.info("[Workstation] GPU Bypass active — forcing CPU inference for Ollama");
      // Future: add num_gpu: 0 to Ollama options if supported via API
    }
    if (chatInput.projectId) {
      // Set inside the try when a hard cap is hit but the conversation is too
      // large to safely continue on a local model. Acted on AFTER the non-fatal
      // try/catch, so a genuine block reaches the user while a mere budget
      // *lookup* failure stays non-fatal and never blocks the call.
      let budgetBlockMessage: string | null = null;
      try {
        const db = await getDb();
        const { eq, sum } = await import("drizzle-orm");
        const { spendLog: spendLogTable } = await import("../../../drizzle/schema.js");

        const budgetRows = await db
          .select()
          .from(projectBudgets)
          .where(eq(projectBudgets.projectId, chatInput.projectId))
          .limit(1);

        const budget = budgetRows[0];
        if (budget && budget.limitCents > 0) {
          const spentRows = await db
            .select({ total: sum(spendLogTable.estimatedCostMicrocents) })
            .from(spendLogTable)
            .where(eq(spendLogTable.projectId, chatInput.projectId));

          const spentMicrocents = Number(spentRows[0]?.total ?? 0);
          const spentCents = spentMicrocents / 1_000_000;
          const pct = (spentCents / budget.limitCents) * 100;

          // Agentic Wallet alerts → Notifications feed (deduped per level).
          const alertUserId = chatInput.sessionId ?? chatInput.projectId;
          if (pct >= 100) {
            void this.raiseWalletAlert(chatInput.projectId, alertUserId, "over",
              `Budget reached: $${spentCents.toFixed(2)} of $${budget.limitCents} on this project.`);
          } else if (pct >= (budget.alertThreshold ?? 80)) {
            void this.raiseWalletAlert(chatInput.projectId, alertUserId, "threshold",
              `Budget ${Math.round(pct)}% used: $${spentCents.toFixed(2)} of $${budget.limitCents}.`);
          }

          if (spentCents >= budget.limitCents && budget.mode === "hard") {
            // Hard cap reached. Prefer a local model so spend stops without
            // dropping the request. If the history is too large for a local
            // context window we can't safely downgrade — record a block to act
            // on below, and never fall through to the paid cloud provider.
            const estTokens = chatInput.messages.reduce(
              (acc, m) => acc + Math.ceil(m.content.length / 4),
              0,
            );
            if (estTokens > LOCAL_CONTEXT_TOKEN_BUDGET) {
              budgetBlockMessage =
                "Cloud budget exhausted for this project, and the conversation history is too large to continue on a local model. Clear the history or start a new branch to keep going locally.";
            } else {
              // Auto-downgrade to a locally-available model — never silently
              // drop the request or keep billing the cloud provider. Prefers
              // the Omnecor-owned local runtime (no Ollama requirement); falls
              // back to Ollama only if it actually has a pulled model.
              const fallback = await this.pickLocalFallbackProvider();
              if (fallback) {
                chatInput.providerId = fallback.providerId;
                chatInput.modelId = fallback.modelId;
                chatInput.apiKey = undefined;
              } else {
                budgetBlockMessage =
                  "Cloud budget exhausted for this project, and no local model is available to fall back to " +
                  "(no Omnecor local runtime model loaded and no Ollama models pulled). Add a .gguf model or " +
                  "run 'ollama pull <model>' to enable local fallback.";
              }
            }
          }
        }
      } catch (err) {
        // Non-fatal — a budget *lookup* failure must never break the AI call.
        log.warn("[AiProviderService] budget pre-flight failed:", err);
      }

      if (budgetBlockMessage) {
        // Deliver in-band as a terminal chunk so it renders in the chat bubble
        // and the stream completes cleanly, then stop (no cloud call).
        const msg = `Error: ${budgetBlockMessage}`;
        yield { content: msg, delta: msg, done: true };
        return;
      }
    }

    if (chatInput.isFictionMode) {
      const fictionPrompt: Message = {
        role: "system",
        content:
          "You are in Fiction Mode. Maintain a narrative, creative tone and prioritize immersive, imaginative descriptions.",
      };
      chatInput.messages = [fictionPrompt, ...chatInput.messages];
    }

    // Valet pre-routing: consult the Valet Router for routing decisions
    // Only if not api_direct mode and valet is configured
    const routingMode = chatInput.routingMode;
    if (routingMode !== "api_direct") {
      try {
        const valetDecision = await ValetRouterService.getInstance().route({
          task: chatInput.messages[chatInput.messages.length - 1]?.content?.slice(0, 500) ?? "chat",
          preferredMode: routingMode ?? "main_api",
          availableProviders: [chatInput.providerId],
          taskType: "chat",
        });
        // Log the routing decision but don't override the explicit providerId
        // (the decision informs future multi-API routing phases)
        if (process.env.NODE_ENV === "development") {
          log.debug(`ValetRouter decision: ${valetDecision.mode} → ${valetDecision.primaryProvider} (confidence: ${valetDecision.confidence})`);
        }
      } catch {
        // Valet routing is advisory — never block chat on routing failure
      }
    }

    // Prompt sanitizer integration (Phase 22)
    try {
      const { PromptSanitizer } = await import("./PromptSanitizer.js");
      const sanitized = PromptSanitizer.getInstance().sanitizeMessages(chatInput.messages);
      if (sanitized.anyFlagged) {
        log.warn("[PromptSanitizer] Injection attempt detected:", sanitized.violations);
      }
      chatInput.messages = sanitized.messages as typeof chatInput.messages;
    } catch {
      // PromptSanitizer not yet available — skip silently
    }

    const providerId = chatInput.providerId.toLowerCase();

    // Per-request inference telemetry — logged before dispatch so the model,
    // budget context, and request size are captured even if the call throws.
    log.info("AI inference dispatch", {
      provider: providerId,
      model: chatInput.modelId,
      maxTokens: chatInput.maxTokens ?? null,
      messageCount: chatInput.messages.length,
      projectId: chatInput.projectId ?? null,
      sessionId: chatInput.sessionId ?? null,
      routingMode: chatInput.routingMode ?? null,
      fictionMode: !!chatInput.isFictionMode,
    });

    // High-performance Signal-driven Async Queue for chunks
    const queue = new SignalAsyncQueue<ChatChunk>();
    // Track whether a terminal (done) chunk was emitted and whether the
    // producer errored, so we can guarantee completion and gate spend logging.
    let terminalEmitted = false;
    let streamError: unknown = null;

    const onChunk = (chunk: { content: string; done?: boolean; thinking?: string; totalTokens?: number; toolCalls?: NativeToolCall[] }) => {
      const item: ChatChunk = {
        content: chunk.content,
        delta: chunk.content,
        done: !!chunk.done,
      };
      if (chunk.thinking) item.thinking = chunk.thinking;
      if (typeof chunk.totalTokens === "number") item.totalTokens = chunk.totalTokens;
      if (chunk.toolCalls?.length) item.toolCalls = chunk.toolCalls;
      if (item.done) terminalEmitted = true;
      queue.push(item);
      if (chunk.done) queue.close();
    };

    const promise = (async () => {
      try {
        // ── MoE Chain execution ─────────────────────────────────────────────
        // moe_chain / moe_chain_omesh: load the user's chain config from DB
        // and run steps sequentially through MoeChainService.
        if (chatInput.routingMode === "moe_chain" || chatInput.routingMode === "moe_chain_omesh") {
          const userId = chatInput.userId;
          if (!userId) throw new Error("MoE chain requires userId — ensure the router passes ctx.user.id.");

          // moe_chain_omesh: attempt OMMESH dispatch first; if a peer takes the
          // task, return immediately. If no peer is available (or the offload
          // attempt fails), fall through to the local MoE chain below. Never
          // re-offload a request that already arrived over the mesh. Exception:
          // when the caller explicitly pinned a peer (targetNodeId), a failed
          // offload must surface as a real error, not silently execute the
          // chain somewhere the user didn't choose — see the sibling comment
          // on the federated-routing check below for why.
          if (chatInput.routingMode === "moe_chain_omesh" && !chatInput.meshOrigin) {
            try {
              const peer = await this.selectPeerNode(chatInput);
              if (peer) {
                await this.routeToPeer(peer, chatInput, onChunk);
                return;
              }
            } catch (err) {
              if (chatInput.targetNodeId) throw err;
              log.warn("[AiProviderService] moe_chain_omesh offload failed — running local chain", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          const db = await getDb();
          const { moeChainConfigs } = await import("../../../drizzle/schema.js") as typeof import("../../../drizzle/schema.js");
          const { eq, and, inArray } = await import("drizzle-orm");

          // Fetch both chain configs in one query, then pick the chain that has at
          // least one ENABLED step (preferring local). Selecting on step count
          // alone would let a scanned-but-disabled local chain shadow a configured
          // cloud chain and throw "no active steps".
          const rows = await db
            .select()
            .from(moeChainConfigs)
            .where(and(
              eq(moeChainConfigs.userId, userId),
              inArray(moeChainConfigs.chainType, ["local", "cloud"]),
            ));

          const hasEnabled = (r: typeof moeChainConfigs.$inferSelect | undefined) =>
            !!r && (r.steps ?? []).some(s => s.enabled);
          const localRow = rows.find(r => r.chainType === "local");
          const cloudRow = rows.find(r => r.chainType === "cloud");

          let chainRow: (typeof moeChainConfigs.$inferSelect) | undefined;
          let chainType: "local" | "cloud" = "local";
          if (hasEnabled(localRow)) {
            chainRow = localRow;
            chainType = "local";
          } else if (hasEnabled(cloudRow)) {
            chainRow = cloudRow;
            chainType = "cloud";
          }

          if (!chainRow) {
            throw new Error(
              "MoE chain not configured. Run /MOE-Chain in chat to set up your chain, " +
              "or go to Settings → Valet Router → MoE Chain to add models (and enable at least one step)."
            );
          }

          const { MoeChainService } = await import("./MoeChainService.js") as typeof import("./MoeChainService.js");

          // Get task category from the Valet's last routing decision (advisory)
          let taskCategory: string | undefined;
          try {
            const valetDecision = await ValetRouterService.getInstance().route({
              task: chatInput.messages[chatInput.messages.length - 1]?.content?.slice(0, 500) ?? "chat",
              preferredMode: "moe_chain",
              availableProviders: [],
              taskType: "chat",
            });
            taskCategory = valetDecision.category;
          } catch { /* Valet offline — all steps run */ }

          await MoeChainService.getInstance().execute(
            chainRow.steps,
            chainType,
            {
              messages: chatInput.messages,
              taskCategory,
              maxTokensPerStep: chatInput.maxTokens ?? 512,
              temperature: chatInput.temperature,
              apiKey: chatInput.apiKey,
              baseUrl: chatInput.baseUrl,
              executionMode: chatInput.executionMode,
              // Threaded so cloud chain steps log spend / enforce budgets per step.
              projectId: chatInput.projectId,
              sessionId: chatInput.sessionId,
              userId: chatInput.userId,
            },
            onChunk,
          );
          return;
        }

        // ── Federated Routing Check (OMMESH) ────────────────────────────────
        // Local-compute providers only (the mesh never carries cloud calls),
        // and never re-offload a request that already arrived over the mesh —
        // re-running the routing decision on the executing node forwards the
        // job again (A→B→C…) whenever a peer's telemetry out-scores it.
        //
        // Auto-routed (no targetNodeId): a failed offload is a transient
        // scoring/connectivity hiccup — silently retry locally, same as always.
        // Pinned (targetNodeId set, Model-Fabric Phase 5/6): the user picked
        // THIS specific peer's model in the catalog picker. Silently executing
        // elsewhere on failure would run a possibly-nonexistent-locally model
        // id under a different model's identity with no indication the pin
        // was never honored — surface the failure instead so it's actionable.
        if (!chatInput.meshOrigin && MESH_ROUTABLE_PROVIDERS.has(providerId)) {
          try {
            const peer = await this.selectPeerNode(chatInput);
            if (peer) {
              await this.routeToPeer(peer, chatInput, onChunk);
              return;
            }
          } catch (err) {
            if (chatInput.targetNodeId) throw err;
            log.warn("[AiProviderService] mesh offload failed — executing locally", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        switch (providerId) {
          case "ollama":
            await this.chatOllama(chatInput, onChunk);
            break;
          case "openai":
            await this.chatOpenAI(chatInput, onChunk);
            break;
          case "anthropic":
            await this.chatAnthropic(chatInput, onChunk);
            break;
          case "gemini":
            await this.chatGemini(chatInput, onChunk);
            break;
          case "grok":
            await this.chatGrok(chatInput, onChunk);
            break;
          case "forge":
            await this.chatForge(chatInput, onChunk);
            break;
          case "huggingface":
            await this.chatHuggingFace(chatInput, onChunk);
            break;
          case "llamacpp":
            await this.chatLocalLlm(chatInput, onChunk);
            break;
          default:
            throw new Error(`Unsupported provider: ${providerId}`);
        }
      } catch (err) {
        // Deliver the error in-band as a terminal chunk so it renders in the
        // chat bubble and the stream still completes cleanly, rather than
        // throwing out of the generator and surfacing only via onError.
        streamError = err;
        log.warn("[AiProviderService] stream producer error:", err);
        const message = err instanceof Error ? err.message : String(err);
        if (!terminalEmitted) onChunk({ content: `Error: ${message}`, done: true });
      } finally {
        // Guarantee a terminal chunk on every path so the consumer's for-await
        // always observes completion and the client never hangs open.
        if (!terminalEmitted) onChunk({ content: "", done: true });
        queue.close();
      }
    })();

    let completionChars = 0;
    for await (const item of queue) {
      completionChars += item.delta?.length ?? 0;
      yield item;
      if (item.done) break;
    }
    await promise;

    // Agentic Wallet — log spend only after a *successful* stream completes.
    // A failed request (delivered as an in-band error chunk above) recorded no
    // real provider usage, so it must not be billed against the budget.
    if (chatInput.projectId && !streamError) {
      const promptTokens = chatInput.messages.reduce(
        (acc, m) => acc + Math.ceil(m.content.length / 4),
        0
      );
      // Use totalTokens from last chunk if available; otherwise estimate from chars
      const completionTokens = Math.ceil(completionChars / 4);
      void this.logSpend({
        projectId: chatInput.projectId,
        provider: chatInput.providerId,
        modelId: chatInput.modelId,
        promptTokens,
        completionTokens,
        sessionId: chatInput.sessionId,
      });
    }
  }

  /**
   * Legacy callback-based streaming (kept for internal use).
   */
  private async chatStream(
    input: ChatInput,
    onChunk: (chunk: ChatChunk) => void
  ): Promise<void> {
    for await (const chunk of this.streamChat(input)) {
      onChunk(chunk);
    }
  }

  /**
   * List available AI providers.
   */
  public listProviders(filter: string[] = []): any[] {
    const providers = [
      { id: "ollama", name: "Ollama (Local)", status: "online" },
      { id: "openai", name: "OpenAI", status: "online" },
      { id: "anthropic", name: "Anthropic", status: "online" },
      { id: "gemini", name: "Google Gemini", status: "online" },
      { id: "grok", name: "xAI Grok", status: "online" },
      { id: "huggingface", name: "Hugging Face", status: "online" },
      { id: "forge", name: "Forge API", status: "online" },
      {
        id: "llamacpp",
        name: "llama.cpp (Local)",
        // Reflects the managed runtime's last-known health-check result
        // (not a live probe) — unlike the other entries, this one can
        // genuinely be offline (no binary/model found).
        status: LocalLlmRuntimeService.getInstance().isReady() ? "online" : "offline",
      },
    ];
    return filter.length > 0
      ? providers.filter(p => filter.includes(p.id))
      : providers;
  }

  /**
   * Estimate the cost of an AI API call in microcents.
   * Returns 0 for local providers (ollama, forge).
   */
  public estimateCost(
    provider: string,
    modelId: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    return calculateCostMicrocents(provider, modelId, promptTokens, completionTokens);
  }

  /**
   * Insert an immutable spend record and emit a budget:spend WebSocket event.
   * Called after every successful AI API call completion.
   */
  private async logSpend(params: {
    projectId: string;
    provider: string;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    sessionId?: string;
  }): Promise<void> {
    const costMicrocents = calculateCostMicrocents(
      params.provider,
      params.modelId,
      params.promptTokens,
      params.completionTokens
    );

    try {
      const db = await getDb();
      await db.insert(spendLog).values({
        id: uuidv4(),
        projectId: params.projectId,
        provider: params.provider,
        modelId: params.modelId,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        estimatedCostMicrocents: costMicrocents,
        sessionId: params.sessionId ?? null,
      });
    } catch (err) {
      // Non-fatal — spend logging must never break the AI call
      log.warn("[AiProviderService] logSpend failed:", err);
    }

    // Emit real-time budget:spend event to all connected clients
    const { getWsInstance } = await import("../websocket/WebSocketServer.js");
    const ws = getWsInstance();
    if (ws) {
      ws.broadcastAll("budget:spend", {
        projectId: params.projectId,
        provider: params.provider,
        modelId: params.modelId,
        costMicrocents,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
      });
    }
    log.info("spend logged", {
      projectId: params.projectId,
      provider: params.provider,
      model: params.modelId,
      costMicrocents,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
    });
  }

  /**
   * Check health of a provider.
   */
  public async checkHealth(input: {
    providerId: string;
    modelId: string;
  }): Promise<{ status: string; latency?: number }> {
    const start = Date.now();
    try {
      // Very minimal health check - just a tiny prompt
      await this.chat({
        ...input,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 1,
      });
      return { status: "online", latency: Date.now() - start };
    } catch (e) {
      return { status: "offline" };
    }
  }

  /**
   * Ask the mesh routing engine whether a discovered peer out-scores this
   * node for the request. Returns the winning peer, or null when the local
   * node should execute.
   *
   * Model-Fabric Phase 5: `input.targetNodeId` — set when the caller selected
   * a specific `mesh-peer` catalog entry — pins routing to that exact peer
   * instead of the VRAM-weighted auto-scorer. Picking "qwen2.5:7b on DadsPC"
   * from the catalog is a promise that it runs on DadsPC, not whichever peer
   * happens to out-score it this turn. A pin to the local node's own id forces
   * local execution. A pin to a peer that isn't currently discoverable throws
   * — the caller (`streamChat`) already wraps this in a try/catch that falls
   * back to local execution and logs the failure, the same resilience
   * treatment a transient auto-routed peer failure gets.
   */
  private async selectPeerNode(input: ChatInput): Promise<PeerInfo | null> {
    const peers = meshNode.getDiscovery().getPeers();

    if (input.targetNodeId) {
      if (input.targetNodeId === meshNode.getIdentity().id) return null;
      const pinned = peers.find(p => p.name === input.targetNodeId);
      if (!pinned) {
        throw new Error(`Mesh peer "${input.targetNodeId}" is not currently discoverable — is it online?`);
      }
      return pinned;
    }

    const promptLength = input.messages.reduce((acc, m) => acc + m.content.length, 0);
    const decision = await meshNode.getRouting().decide(input.messages[input.messages.length - 1]?.content || "", {
      model: input.modelId,
      tokens: promptLength
    });

    if (decision.targetNodeId === meshNode.getIdentity().id) return null;

    return peers.find(p => p.name === decision.targetNodeId) ?? null;
  }

  /**
   * Execute the chat on a mesh peer over the strict-mTLS inference channel
   * (CA-signed certs + pinned fingerprint — never plain HTTP). The full
   * message history rides along in options; older peers that predate
   * `options.messages` fall back to the flattened prompt.
   *
   * Deliberately does NOT forward `input.tools`/`input.supportsNativeTools`:
   * the wire protocol here (`executeOnPeer` → the peer's `executeLocal` →
   * `AiProviderService.chat()`) returns a flattened `{content}` string, not a
   * streamed `ChatChunk` — there is no field to carry a structured
   * `toolCalls[]` back even if the peer's model produced one. Native
   * (structured) tool-calling can only work end-to-end for a turn that stays
   * on this node; a mesh-peer turn must stay on the text `<tool_call>`
   * protocol (the universal floor, carried in `systemPrompt`, which IS
   * forwarded below). `ModelCatalogService` enforces the precondition by
   * hardcoding `nativeTools: false` on every `mesh-peer` catalog entry — if
   * that default is ever loosened, this method needs real toolCalls-over-mesh
   * plumbing added, not just `tools` appended to the options bag.
   */
  private async routeToPeer(
    peer: PeerInfo,
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    if (input.supportsNativeTools) {
      log.warn(
        "[AiProviderService] Mesh-peer turn requested native tool-calling, but the mesh wire " +
          "protocol cannot carry a structured toolCalls result back — proceeding without native " +
          "tools. This should not happen: ModelCatalogService always tags mesh-peer catalog " +
          "entries supportsNativeTools:false."
      );
    }
    const prompt = input.messages[input.messages.length - 1]?.content || "";
    const result = await meshNode.executeOnPeer(peer, prompt, {
      providerId: input.providerId,
      model: input.modelId,
      systemPrompt: input.systemPrompt,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      messages: input.messages,
    });
    onChunk?.({ content: result.content, delta: result.content, done: true });
    return result.content;
  }

  // ─── Provider Implementations ──────────────────────────────────────────────

  private async chatForge(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const apiKey = input.apiKey || ENV.forgeApiKey;
    if (!apiKey) throw new Error("FORGE_API_KEY not configured");

    const baseUrl =
      input.baseUrl ||
      (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0
        ? `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`
        : "https://forge.manus.im/v1/chat/completions");

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.modelId || "gemini-2.5-flash",
        messages: input.messages,
        stream: !!onChunk,
      }),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Forge error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data.choices[0].message.content;
    }

    return this.handleStream(
      response,
      line => {
        if (line === "[DONE]") return { content: "", done: true };
        const parsed = JSON.parse(line);
        return {
          content: parsed.choices[0]?.delta?.content || "",
          done: false,
        };
      },
      onChunk,
      "data: "
    );
  }

  private async chatHuggingFace(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const apiKey = this.getProviderKey("huggingface", input.apiKey);
    if (!apiKey) throw new Error("Hugging Face API key not configured");

    const customUrl = this.getProviderBaseUrl("huggingface", input.baseUrl);
    const baseUrl = customUrl
      ? (customUrl.endsWith("/chat/completions") ? customUrl : `${customUrl.replace(/\/$/, "")}/chat/completions`)
      : "https://api-inference.huggingface.co/v1/chat/completions";

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        stream: !!onChunk,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Hugging Face error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data.choices[0].message.content;
    }

    return this.handleStream(
      response,
      line => {
        if (line === "[DONE]") return { content: "", done: true };
        const parsed = JSON.parse(line);
        return {
          content: parsed.choices[0]?.delta?.content || "",
          done: false,
        };
      },
      onChunk,
      "data: "
    );
  }

  private async chatOllama(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const baseUrl = this.getOllamaUrl(input.baseUrl);
    // Ask thinking-capable models to stream reasoning in the separate `thinking`
    // field (Ollama ≥0.9) so it can be routed to a collapsible block instead of
    // dropped. Only requested when the model supports it (Ollama 400s otherwise)
    // and only for the streaming path — internal one-shot calls don't need it.
    const think = !!onChunk && (await this.modelSupportsThinking(baseUrl, input.modelId));
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        stream: !!onChunk,
        tools: input.tools,
        ...(think ? { think: true } : {}),
        options: {
          num_predict: input.maxTokens,
          temperature: input.temperature,
        },
      }),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      let content = data.message.content || "";
      if (data.message.tool_calls && data.message.tool_calls.length > 0) {
        // Shim native tools to our string format for LocalSubAgentWorker
        for (const tc of data.message.tool_calls) {
          const fn = tc.function;
          if (fn) {
            content += `\n<tool_call>\n${JSON.stringify({ action: fn.name, ...fn.arguments }, null, 2)}\n</tool_call>\n`;
          }
        }
      }
      return content;
    }

    return this.handleStream(
      response,
      line => {
        const parsed = JSON.parse(line);
        const result: { content: string; done: boolean; thinking?: string; totalTokens?: number; toolCalls?: NativeToolCall[] } = {
          content: parsed.message?.content || "",
          done: !!parsed.done,
        };
        if (parsed.message?.thinking) result.thinking = parsed.message.thinking;
        if (Array.isArray(parsed.message?.tool_calls) && parsed.message.tool_calls.length > 0) {
          const calls: NativeToolCall[] = parsed.message.tool_calls
            .map((tc: { id?: string; function?: { name?: string; arguments?: unknown } }) => ({
              id: tc.id,
              name: tc.function?.name ?? "",
              arguments: typeof tc.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments ?? {}),
            }))
            .filter((tc: NativeToolCall) => !!tc.name);
          if (calls.length) result.toolCalls = calls;
        }
        if (parsed.done) {
          // Ollama's terminal object carries real token accounting; report the
          // generated-token count (eval_count) as the turn total, falling back
          // to the prompt count when a model omits eval_count.
          const evalCount = typeof parsed.eval_count === "number" ? parsed.eval_count : 0;
          const promptCount = typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : 0;
          const total = evalCount || promptCount;
          if (total) result.totalTokens = total;
        }
        return result;
      },
      onChunk
    );
  }

  /**
   * Format the full system+messages history as a ChatML prompt string. Used
   * ONLY as a fallback when llama-server's own `/apply-template` endpoint is
   * unavailable (see renderLocalLlmPrompt) — ChatML is a reasonable universal
   * default (it's what the proven qwen2.5 text `<tool_call>` protocol was
   * validated against) but is WRONG for plenty of real models: confirmed live
   * against a Llama-3.2 GGUF, whose actual trained format is
   * `<|start_header_id|>role<|end_header_id|>...<|eot_id|>`, not ChatML.
   */
  private buildLocalLlmPrompt(input: ChatInput, extraSystemText?: string): string {
    const OPEN = "<|im_start|>";
    const CLOSE = "<|im_end|>";
    const turns: string[] = [];

    // Same fallback convention as chatAnthropic/chatGemini: an explicit
    // systemPrompt wins; otherwise fall back to a role:"system" message.
    const baseSystem = input.systemPrompt ?? input.messages.find(m => m.role === "system")?.content;
    const systemContent = [baseSystem, extraSystemText].filter(Boolean).join("\n\n");
    if (systemContent) turns.push(`${OPEN}system\n${systemContent}${CLOSE}`);

    for (const m of input.messages) {
      if (m.role === "system") continue; // folded into the system turn above
      // ChatML has no universal tool/function role; the text `<tool_call>`
      // protocol already represents tool results as role:"user" messages
      // (ChatAgentRunner), so map any stray tool/function role the same way.
      const role = m.role === "assistant" ? "assistant" : "user";
      turns.push(`${OPEN}${role}\n${m.content}${CLOSE}`);
    }

    // Leave the assistant turn open for the model to continue.
    turns.push(`${OPEN}assistant\n`);
    return turns.join("\n");
  }

  /**
   * Render the system+messages history using the LOADED MODEL'S OWN chat
   * template, via llama-server's `POST /apply-template` — it runs the exact
   * same jinja templating `/v1/chat/completions` would, but only returns the
   * rendered prompt string (no inference), so the actual generation can still
   * go through the raw, template-free `/completion` endpoint (Omnecor keeps
   * full ownership of the prompt/tool content; only the turn-delimiter
   * *wrapping* is delegated to the model's own template — that's a
   * per-model formatting detail, not "the cubicle" the runtime rewrite
   * exists to escape). Confirmed live: a Llama-3.2 GGUF's real template uses
   * `<|start_header_id|>`, nothing like the ChatML fallback below — a single
   * hardcoded format would silently degrade every model not trained on it.
   * Falls back to buildLocalLlmPrompt (built locally, no round-trip) if the
   * endpoint errors or the binary is old enough not to have it — the caller
   * uses `usedFallback` to decide whether a ChatML stop-string safety net is
   * needed (the model's own template correctly bounds generation via its real
   * EOS token; a hardcoded ChatML guess does not, so it needs the guard).
   */
  private async renderLocalLlmPrompt(
    baseUrl: string,
    input: ChatInput,
    extraSystemText?: string
  ): Promise<{ prompt: string; usedFallback: boolean }> {
    const baseSystem = input.systemPrompt ?? input.messages.find(m => m.role === "system")?.content;
    const systemContent = [baseSystem, extraSystemText].filter(Boolean).join("\n\n");
    const oaiMessages = [
      ...(systemContent ? [{ role: "system", content: systemContent }] : []),
      ...input.messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
    ];

    try {
      const res = await fetch(`${baseUrl}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: oaiMessages }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.prompt === "string" && data.prompt) return { prompt: data.prompt, usedFallback: false };
      }
    } catch (err) {
      log.warn("[AiProviderService] /apply-template failed — falling back to ChatML prompt", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { prompt: this.buildLocalLlmPrompt(input, extraSystemText), usedFallback: true };
  }

  /**
   * Omnecor-owned local runtime (Model-Fabric Phase 1) — streams from the
   * managed llama-server subprocess via its raw, template-free `/completion`
   * endpoint. Preserves full system+message-role structure (rendered with the
   * loaded model's own chat template, see renderLocalLlmPrompt) and streams
   * real deltas, unlike the old one-shot message-flattening path this
   * replaces.
   */
  private async chatLocalLlm(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const runtime = LocalLlmRuntimeService.getInstance();
    // Model-Fabric Phase 8: hot-swap to the requested model. The catalog sends
    // the index id as `modelId` (a raw file path may arrive as `modelPath`);
    // `ensureModelLoaded` no-ops when it's already warm, else swaps the managed
    // llama-server over to it. An unknown id falls back to the loaded/default.
    const target = input.modelPath || input.modelId;
    const ready = await runtime.ensureModelLoaded(target);
    if (!ready) {
      throw new Error(
        "Local LLM runtime not available — no llama-server binary or .gguf model was found. " +
          "Install llama.cpp (https://github.com/ggml-org/llama.cpp) and place a .gguf model " +
          "under the app's models directory (or set LOCAL_LLM_MODEL_PATH), then retry."
      );
    }

    // Native-tools upgrade (Model-Fabric Phase 2): llama-server's raw
    // `/completion` endpoint has no `tools` param (Phase 1 deliberately kept it
    // off the chat/template path — see file header), so its "native" tier isn't
    // OpenAI-shaped tool_calls. It's the same `<tool_call>` marker the text
    // protocol already uses, but grammar-guaranteed valid JSON: `json_schema`
    // compiles to a GBNF grammar and `grammar_lazy` + `grammar_triggers` apply
    // it only once the model emits the trigger word, so prose flows freely
    // until then. Verified against llama.cpp's real request schema
    // (tools/server/server-schema.cpp, tools/server/server-common.h) in the
    // Model-Fabric reference clone — not a guess at the wire format.
    const useNativeTools = !!(input.supportsNativeTools && input.tools?.length);
    const toolReminder = useNativeTools ? buildLocalLlmToolReminder(input.tools!) : undefined;
    const baseUrl = runtime.getBaseUrl();
    const { prompt, usedFallback } = await this.renderLocalLlmPrompt(baseUrl, input, toolReminder);

    const baseBody: Record<string, unknown> = {
      prompt,
      stream: !!onChunk,
      n_predict: input.maxTokens ?? -1,
      temperature: input.temperature ?? 0.7,
      // The model's own template (the normal path) correctly bounds
      // generation via its real EOS/EOT token — no stop string needed. The
      // ChatML fallback is a guess at the model's format, so a model that
      // wasn't trained on it could run right past "<|im_end|>" as plain
      // text; force a stop there so it can't ramble past the turn boundary.
      ...(usedFallback ? { stop: ["<|im_end|>"] } : {}),
      // Reuse the KV cache across agentic turns: ChatAgentRunner resends
      // the growing message history every turn, and only the tail changes.
      cache_prompt: true,
    };
    const nativeToolsBody: Record<string, unknown> | undefined = useNativeTools
      ? {
          ...baseBody,
          json_schema: buildLocalLlmToolGrammarSchema(input.tools!),
          grammar_lazy: true,
          // COMMON_GRAMMAR_TRIGGER_TYPE_WORD = 1 (common/common.h) — a
          // multi-token trigger phrase is matched as a literal word, not
          // resolved to a single preserved token (that path is only taken
          // when the phrase tokenizes to exactly one token).
          grammar_triggers: [{ type: 1, value: TOOL_CALL_TAG }],
        }
      : undefined;

    let response = await fetch(`${baseUrl}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nativeToolsBody ?? baseBody),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok && nativeToolsBody) {
      // An older/rebuilt llama-server without json_schema+grammar_triggers
      // support 400s on the extra fields — degrade to the plain request
      // rather than hard-failing the turn. The reminder text is still in the
      // prompt, so the model can still emit `<tool_call>`; ChatAgentRunner's
      // native-protocol decode already falls back to text parsing when no
      // structured tool call comes back (the same stray-tag safety net).
      log.warn("[AiProviderService] llama-server rejected the grammar-constrained tool request — retrying without it", {
        status: response.status,
      });
      response = await fetch(`${baseUrl}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseBody),
        signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
      });
    }

    if (!response.ok) {
      throw new Error(`Local LLM runtime error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data.content ?? "";
    }

    return this.handleStream(
      response,
      line => {
        const parsed = JSON.parse(line);
        return { content: parsed.content ?? "", done: !!parsed.stop };
      },
      onChunk,
      "data: "
    );
  }

  private async chatOpenAI(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const apiKey = this.getProviderKey("openai", input.apiKey);
    if (!apiKey) throw new Error("OpenAI API Key not configured");

    const customUrl = this.getProviderBaseUrl("openai", input.baseUrl);
    const baseUrl = customUrl ? (customUrl.endsWith("/chat/completions") ? customUrl : `${customUrl.replace(/\/$/, "")}/chat/completions`) : "https://api.openai.com/v1/chat/completions";
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        stream: !!onChunk,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}),
      }),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      const msg = data.choices[0].message;
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        // Non-streaming callers only get a plain string back — shim native
        // tool calls into the same text convention Ollama's non-streaming
        // path uses, so a caller of `chat()` never silently drops them.
        return (msg.content || "") + this.shimToolCallsToText(msg.tool_calls);
      }
      return msg.content;
    }

    const toolCallAcc = new Map<number, { id?: string; name: string; args: string }>();
    return this.handleStream(
      response,
      line => {
        if (line === "[DONE]") return { content: "", done: true, toolCalls: this.finalizeToolCallAcc(toolCallAcc) };
        const parsed = JSON.parse(line);
        // Defensive: the trailing/usage chunk can carry an empty `choices` array.
        const delta = parsed.choices?.[0]?.delta ?? {};
        const result: { content: string; done: boolean; thinking?: string; toolCalls?: NativeToolCall[] } = {
          content: delta.content || "",
          done: false,
        };
        // Reasoning models expose their thinking on a side field (OpenRouter
        // `reasoning`, vLLM/DeepSeek `reasoning_content`) — a pure read of a
        // field the server already sends, so it can't affect a server that
        // doesn't. Token usage is intentionally NOT requested via
        // stream_options here: a strict OpenAI-compatible endpoint could reject
        // the unknown field, and the client already falls back to an estimate.
        const reasoning = delta.reasoning ?? delta.reasoning_content;
        if (typeof reasoning === "string" && reasoning) result.thinking = reasoning;
        // Native tool-call deltas arrive fragmented by `index` — the function
        // name usually lands whole on the first fragment, while `arguments`
        // streams as incremental JSON-string chunks that only parse once fully
        // assembled (hence accumulating here rather than parsing per-delta).
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls as Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>) {
            const idx = tc.index ?? 0;
            const entry = toolCallAcc.get(idx) ?? { id: tc.id, name: "", args: "" };
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (typeof tc.function?.arguments === "string") entry.args += tc.function.arguments;
            toolCallAcc.set(idx, entry);
          }
        }
        // Carry the latest assembled snapshot on every line, not just "[DONE]"
        // — a non-compliant proxy or an abrupt connection drop can end the
        // stream without ever sending the sentinel, and `handleStream`'s
        // post-loop fallback only forwards whatever `toolCalls` was last set
        // to. Without this, an already-fully-assembled tool call would be
        // silently discarded instead of surfaced.
        if (toolCallAcc.size > 0) result.toolCalls = this.finalizeToolCallAcc(toolCallAcc);
        return result;
      },
      onChunk,
      "data: "
    );
  }

  private async chatGrok(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const apiKey = this.getProviderKey("grok", input.apiKey);
    if (!apiKey) throw new Error("xAI API Key not configured");

    const customUrl = this.getProviderBaseUrl("grok", input.baseUrl);
    const baseUrl = customUrl ? (customUrl.endsWith("/chat/completions") ? customUrl : `${customUrl.replace(/\/$/, "")}/chat/completions`) : "https://api.x.ai/v1/chat/completions";
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.modelId || "grok-beta",
        messages: input.messages,
        stream: !!onChunk,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`xAI Grok error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data.choices[0].message.content;
    }

    return this.handleStream(
      response,
      line => {
        if (line === "[DONE]") return { content: "", done: true };
        const parsed = JSON.parse(line);
        return {
          content: parsed.choices[0]?.delta?.content || "",
          done: false,
        };
      },
      onChunk,
      "data: "
    );
  }

  private async chatAnthropic(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const apiKey = this.getProviderKey("anthropic", input.apiKey);
    if (!apiKey) throw new Error("Anthropic API Key not configured");

    const customUrl = this.getProviderBaseUrl("anthropic", input.baseUrl);
    const baseUrl = customUrl ? (customUrl.endsWith("/v1/messages") ? customUrl : `${customUrl.replace(/\/$/, "")}/v1/messages`) : "https://api.anthropic.com/v1/messages";
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages.filter(m => m.role !== "system"),
        system:
          input.systemPrompt ||
          input.messages.find(m => m.role === "system")?.content,
        stream: !!onChunk,
        max_tokens: input.maxTokens || 4096,
        temperature: input.temperature,
        ...(input.tools?.length ? { tools: openAiToolsToAnthropic(input.tools) } : {}),
      }),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Anthropic error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      // Concatenate every text block — Anthropic can interleave more than one
      // (e.g. around a tool_use block); taking only the first would silently
      // drop the rest.
      const text = (data.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === "text")
        .map(b => b.text ?? "")
        .join("");
      const toolUseBlocks = (data.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>)
        .filter(b => b.type === "tool_use");
      if (toolUseBlocks.length) {
        // Non-streaming callers only get a plain string back — shim native
        // tool calls into the text convention so they're never silently lost.
        return text + this.shimToolCallsToText(
          toolUseBlocks.map(b => ({ function: { name: b.name, arguments: b.input ?? {} } }))
        );
      }
      return text;
    }

    // `tool_use` blocks stream as content_block_start (id + name) →
    // content_block_delta (`input_json_delta` fragments of the arguments JSON)
    // → content_block_stop, addressed by the shared `index` across all content
    // blocks in the message (text blocks share the same index space).
    const toolUseAcc = new Map<number, { id?: string; name: string; args: string }>();
    // Carry the latest assembled snapshot on every line, not just
    // `message_stop` — an abrupt connection drop can end the stream without
    // that terminal event, and `handleStream`'s post-loop fallback only
    // forwards whatever `toolCalls` was last set to. Without this, an
    // already-fully-assembled tool call would be silently discarded.
    const snapshot = () => (toolUseAcc.size > 0 ? this.finalizeToolCallAcc(toolUseAcc) : undefined);
    return this.handleStream(
      response,
      line => {
        const parsed = JSON.parse(line);
        if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
          toolUseAcc.set(parsed.index, { id: parsed.content_block.id, name: parsed.content_block.name ?? "", args: "" });
          return { content: "", done: false, toolCalls: snapshot() };
        }
        if (parsed.type === "content_block_delta") {
          if (parsed.delta?.type === "input_json_delta") {
            const entry = toolUseAcc.get(parsed.index);
            if (entry) entry.args += parsed.delta.partial_json ?? "";
            return { content: "", done: false, toolCalls: snapshot() };
          }
          return { content: parsed.delta?.text ?? "", done: false, toolCalls: snapshot() };
        }
        if (parsed.type === "message_stop") {
          return { content: "", done: true, toolCalls: snapshot() };
        }
        // Other events (content_block_stop, message_delta/ping, ...) carry no
        // content of their own — still surface the latest snapshot so it
        // isn't lost if one of these happens to be the last line before an
        // abrupt close.
        return { content: "", done: false, toolCalls: snapshot() };
      },
      onChunk,
      "data: "
    );
  }

  private async chatGemini(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const apiKey = this.getProviderKey("gemini", input.apiKey);
    if (!apiKey) throw new Error("Gemini API Key not configured");

    const customUrl = this.getProviderBaseUrl("gemini", input.baseUrl) || "https://generativelanguage.googleapis.com";
    // `alt=sse` is required for streaming: without it Gemini returns one
    // pretty-printed multi-line JSON array, which a per-line parser silently
    // drops in full — the stream "completes" with zero chunks and no error.
    // With it, every event is a single-line `data: {...}` the parser handles.
    const baseUrl = `${customUrl.replace(/\/$/, "")}/v1beta/models/${input.modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Simplistic Gemini mapping
    const contents = input.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // Add system instruction if present
    const systemMessage =
      input.systemPrompt ||
      input.messages.find(m => m.role === "system")?.content;
    const systemInstruction = systemMessage
      ? { parts: [{ text: systemMessage }] }
      : undefined;

    const body: any = { contents };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (input.maxTokens || input.temperature !== undefined) {
      body.generationConfig = {
        maxOutputTokens: input.maxTokens,
        temperature: input.temperature,
      };
    }

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_NETWORK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Gemini error: ${await describeHttpError(response)}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data[0]?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // Gemini streaming: the REST API (alt=sse) sends SSE lines ("data: {...}").
    // The non-SSE path sends a JSON array chunked over the wire.
    // We handle both: strip the "data: " SSE prefix when present, then try to
    // parse each line as a complete GeminiChunk JSON object.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    const processLine = (raw: string) => {
      const line = raw.startsWith("data: ") ? raw.slice(6) : raw;
      const trimmed = line.trim();
      if (!trimmed || trimmed === "[" || trimmed === "]" || trimmed === ",") return;
      // Strip trailing comma from array-format streaming
      const jsonStr = trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed;
      try {
        const chunk = JSON.parse(jsonStr) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullContent += text;
          onChunk({ content: text, delta: text, done: false });
        }
      } catch {
        // Incomplete or non-JSON line — silently skip
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    }

    if (buffer.trim()) processLine(buffer);

    onChunk({ content: "", delta: "", done: true });
    return fullContent;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async handleStream(
    response: Response,
    parser: (line: string) => { content: string; done: boolean; thinking?: string; totalTokens?: number; toolCalls?: NativeToolCall[] },
    onChunk: (chunk: ChatChunk) => void,
    prefix: string = ""
  ): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";
    let lastTokens: number | undefined; // carried to the terminal chunk
    let lastToolCalls: NativeToolCall[] | undefined; // carried to the terminal chunk

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        let cleanLine = line.trim();
        if (!cleanLine) continue;
        if (prefix && cleanLine.startsWith(prefix)) {
          cleanLine = cleanLine.slice(prefix.length);
        }

        try {
          const { content, done: isDone, thinking, totalTokens, toolCalls } = parser(cleanLine);
          if (typeof totalTokens === "number") lastTokens = totalTokens;
          if (toolCalls?.length) lastToolCalls = toolCalls;
          // Reasoning deltas carry no `content` — forward them with an empty
          // delta so they never inflate the completion-token estimate.
          if (content || thinking) {
            if (content) fullContent += content;
            onChunk({ content, delta: content, thinking, done: false });
          }
          if (isDone) {
            onChunk({ content: "", delta: "", done: true, totalTokens: lastTokens, toolCalls: lastToolCalls });
            return fullContent;
          }
        } catch (e) {
          // Ignore parse errors for partial lines
        }
      }
    }

    onChunk({ content: "", delta: "", done: true, totalTokens: lastTokens, toolCalls: lastToolCalls });
    return fullContent;
  }

  /** Shim a native structured tool call array into the text `<tool_call>`
   *  convention — used by non-streaming callers (`chat()`) that only return a
   *  plain string, so a native tool call never gets silently dropped just
   *  because the caller can't see the structured `toolCalls` channel. */
  private shimToolCallsToText(
    toolCalls: Array<{ function?: { name?: string; arguments?: string | Record<string, unknown> } }>
  ): string {
    let out = "";
    for (const tc of toolCalls) {
      const fn = tc.function;
      if (!fn?.name) continue;
      let args: Record<string, unknown> = {};
      if (typeof fn.arguments === "string") {
        try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch { /* leave empty */ }
      } else if (fn.arguments) {
        args = fn.arguments;
      }
      out += `\n${TOOL_CALL_TAG}\n${JSON.stringify({ action: fn.name, ...args }, null, 2)}\n</tool_call>\n`;
    }
    return out;
  }

  /** Assemble accumulated streaming tool-call fragments (see chatOpenAI /
   *  chatAnthropic) into the normalized `NativeToolCall[]` shape once a turn's
   *  stream ends. Returns undefined when nothing was ever accumulated. */
  private finalizeToolCallAcc(
    acc: Map<number, { id?: string; name: string; args: string }>
  ): NativeToolCall[] | undefined {
    if (acc.size === 0) return undefined;
    const calls = Array.from(acc.values())
      .filter((v) => !!v.name)
      .map((v) => ({ id: v.id, name: v.name, arguments: v.args }));
    return calls.length ? calls : undefined;
  }

  /**
   * Pick a local provider+model to downgrade a request to when a hard spend
   * cap is hit. Ollama is optional (Model-Fabric Decision 1: "Omnecor-owned
   * runtime primary, Ollama optional") — prefers the managed local runtime
   * when it has a model loaded, and only falls back to Ollama if it actually
   * has at least one pulled model (proof it's both reachable and usable, not
   * just configured). Returns null when neither is available, so the caller
   * can block with a clear message instead of downgrading to an unreachable
   * provider.
   */
  private async pickLocalFallbackProvider(): Promise<{ providerId: string; modelId: string } | null> {
    const runtime = LocalLlmRuntimeService.getInstance();
    const localModelPath = runtime.getModelPath();
    if (runtime.isReady() && localModelPath) {
      return {
        providerId: "llamacpp",
        modelId: runtime.getLoadedModelId() ?? path.basename(localModelPath),
      };
    }
    const ollamaModels = await this.discoverOllamaModels();
    if (ollamaModels.length > 0) {
      return { providerId: "ollama", modelId: await this.pickLocalFallbackModel() };
    }
    return null;
  }

  /**
   * Public wrapper over `pickLocalFallbackProvider` (same precedent as
   * `hasProviderKey`). Mesh-Delegation's `SubAgentHostService` uses it to
   * resolve the peer's default model when a spawn request doesn't name one.
   */
  async getLocalFallbackProvider(): Promise<{ providerId: string; modelId: string } | null> {
    return this.pickLocalFallbackProvider();
  }

  /**
   * Discover available local Ollama models.
   */
  /**
   * Pick a locally-available Ollama model to downgrade to when a hard budget
   * cap forces local inference. Prefers an explicit `localFallbackModel`
   * setting, then a model the user has actually pulled (so the downgrade can't
   * fail on a missing tag), and only falls back to a default tag if discovery
   * yields nothing.
   */
  private async pickLocalFallbackModel(): Promise<string> {
    const configured = SettingsService.getInstance().get<string>("localFallbackModel", "");
    if (configured) return configured;
    try {
      const models = await this.discoverOllamaModels();
      const first = models.find((m) => typeof m?.name === "string" && m.name)?.name;
      if (first) return first as string;
    } catch {
      // Discovery failed — fall through to the default tag.
    }
    return "llama3.2:latest";
  }

  async discoverOllamaModels(): Promise<any[]> {
    const baseUrl = this.getOllamaUrl();
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  }

  /**
   * Whether an Ollama model supports native reasoning (its /api/show
   * `capabilities` list includes "thinking"). Probed once per `baseUrl::model`
   * and cached process-wide, since passing `think:true` to a non-thinking model
   * makes Ollama 400. A transient probe failure returns false without caching so
   * the next turn can retry.
   */
  private async modelSupportsThinking(baseUrl: string, model: string): Promise<boolean> {
    const key = `${baseUrl}::${model}`;
    const cached = ollamaThinkingCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        ollamaThinkingCache.set(key, false);
        return false;
      }
      const data = await res.json();
      const caps: unknown = data?.capabilities;
      const supports = Array.isArray(caps) && caps.includes("thinking");
      ollamaThinkingCache.set(key, supports);
      return supports;
    } catch {
      return false; // transient — don't cache; retry next turn
    }
  }

  /**
   * Discover available models for a given provider via its live API.
   */
  async discoverProviderModels(
    providerId: string,
    customApiKey?: string,
    customBaseUrl?: string
  ): Promise<Array<{ id: string; name: string }>> {
    const apiKey = this.getProviderKey(providerId, customApiKey);
    if (!apiKey && providerId !== "ollama" && providerId !== "llamacpp") {
      throw new Error(`API key for ${providerId} is not configured.`);
    }

    try {
      if (providerId === "openai") {
        const customUrl = this.getProviderBaseUrl("openai", customBaseUrl) || "https://api.openai.com";
        const baseUrl = `${customUrl.replace(/\/$/, "")}/v1/models`;
        const res = await fetch(baseUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`OpenAI models fetch failed: ${res.status}`);
        const data = (await res.json()) as { data: Array<{ id: string }> };
        return (data.data ?? []).map((m) => ({ id: m.id, name: m.id }));
      }

      if (providerId === "anthropic") {
        const customUrl = this.getProviderBaseUrl("anthropic", customBaseUrl) || "https://api.anthropic.com";
        const baseUrl = `${customUrl.replace(/\/$/, "")}/v1/models`;
        const res = await fetch(baseUrl, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Anthropic models fetch failed: ${res.status}`);
        const data = (await res.json()) as { data: Array<{ id: string; display_name?: string }> };
        return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
      }

      if (providerId === "gemini") {
        const customUrl = this.getProviderBaseUrl("gemini", customBaseUrl) || "https://generativelanguage.googleapis.com";
        const baseUrl = `${customUrl.replace(/\/$/, "")}/v1beta/models?key=${apiKey}`;
        const res = await fetch(baseUrl, {
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Gemini models fetch failed: ${res.status}`);
        const data = (await res.json()) as { models?: Array<{ name: string; displayName?: string }> };
        return (data.models ?? []).map((m) => {
          const id = m.name.startsWith("models/") ? m.name.substring("models/".length) : m.name;
          return { id, name: m.displayName ?? id };
        });
      }

      if (providerId === "grok") {
        const customUrl = this.getProviderBaseUrl("grok", customBaseUrl) || "https://api.x.ai";
        const baseUrl = `${customUrl.replace(/\/$/, "")}/v1/models`;
        const res = await fetch(baseUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Grok models fetch failed: ${res.status}`);
        const data = (await res.json()) as { data: Array<{ id: string }> };
        return (data.data ?? []).map((m) => ({ id: m.id, name: m.id }));
      }

      if (providerId === "huggingface") {
        const baseUrl = `https://huggingface.co/api/models?pipeline_tag=text-generation&sort=downloads&direction=-1&limit=25`;
        const res = await fetch(baseUrl, {
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HuggingFace models fetch failed: ${res.status}`);
        const data = (await res.json()) as Array<{ id: string }>;
        return data.map((m) => ({ id: m.id, name: m.id }));
      }
    } catch (err: any) {
      log.error(`[discoverProviderModels] Failed to fetch models for ${providerId}:`, err);
      throw new Error(`Failed to fetch models for ${providerId}: ${err.message || err}`);
    }

    return [];
  }
}
