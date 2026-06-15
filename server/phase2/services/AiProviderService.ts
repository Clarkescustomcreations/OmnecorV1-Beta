/**
 * @file server/phase2/services/AiProviderService.ts
 * @description Omnecor — AI Provider Service
 *
 * Orchestrates requests to various AI providers (Ollama, OpenAI, Anthropic, Gemini).
 * Implements streaming, token handling, and provider-specific formatting.
 *
 * This service acts as the "Valet Router" engine, selecting the best model
 * for a given task based on configuration or budget.
 */

import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";
import { ValetRouterService, type RoutingMode } from "./ValetRouterService.js";

const log = createLogger("AiProvider");
// PromptSanitizer imported dynamically to avoid hard dep (Phase 22 parallel work)
import { meshNode } from "../../ommesh/core/MeshNode.js";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.factory.js";
import { spendLog, projectBudgets } from "../../../drizzle/schema.js";
import { calculateCostMicrocents } from "../config/providerPricing.js";
import { SettingsService } from "./SettingsService.js";
import { NotificationService } from "../../_core/NotificationService.js";
import { type PeerInfo } from "../../ommesh/core/DiscoveryService.js";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export interface Message {
  role: Role;
  content: string;
}

export interface ChatInput {
  providerId: string;
  modelId: string;
  messages: Message[];
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
}

export interface ChatChunk {
  content: string;
  delta: string;
  done: boolean;
  totalTokens?: number;
}

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

  /** Per-project wallet-alert levels already raised, to avoid repeat spam. */
  private walletAlertsSent = new Map<string, "threshold" | "over">();

  public static getInstance(): AiProviderService {
    if (!AiProviderService.instance) {
      AiProviderService.instance = new AiProviderService();
    }
    return AiProviderService.instance;
  }

  /**
   * Raise an agentic-wallet notification once per (project, level). "over"
   * supersedes "threshold" so the user gets at most two alerts per budget run.
   */
  private raiseWalletAlert(projectId: string, level: "threshold" | "over", body: string): void {
    if (this.walletAlertsSent.get(projectId) === level) return;
    if (level === "threshold" && this.walletAlertsSent.get(projectId) === "over") return;
    this.walletAlertsSent.set(projectId, level);
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

  private getProviderBaseUrl(providerId: string, inputUrl?: string): string {
    if (inputUrl) return inputUrl;
    const settings = SettingsService.getInstance();
    const key = `${providerId.toUpperCase()}_BASE_URL`;
    return settings.getSecret(key, settings.getSecret(`${providerId}BaseUrl`, ""));
  }

  private getOllamaUrl(inputUrl?: string): string {
    if (inputUrl) return inputUrl;
    const settings = SettingsService.getInstance();
    return settings.getSecret("OLLAMA_BASE_URL", settings.getSecret("ollamaUrl", ENV.ollamaUrl || "http://localhost:11434"));
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

    // Workstation Optimization — apply GPU Bypass if enabled
    const settings = SettingsService.getInstance().getSettings();
    if (settings.gpuBypass && chatInput.providerId === "ollama") {
      // In a real Ollama environment, we might need to set an env var or 
      // use a specific model tag. For now, we log the bypass.
      log.info("[Workstation] GPU Bypass active — forcing CPU inference for Ollama");
      // Future: add num_gpu: 0 to Ollama options if supported via API
    }
    if (chatInput.projectId) {
      try {
        const db = await getDb();
        if (db) {
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
            if (pct >= 100) {
              this.raiseWalletAlert(chatInput.projectId, "over",
                `Budget reached: $${spentCents.toFixed(2)} of $${budget.limitCents} on this project.`);
            } else if (pct >= (budget.alertThreshold ?? 80)) {
              this.raiseWalletAlert(chatInput.projectId, "threshold",
                `Budget ${Math.round(pct)}% used: $${spentCents.toFixed(2)} of $${budget.limitCents}.`);
            }

            if (spentCents >= budget.limitCents && budget.mode === "hard") {
              // Auto-downgrade to Ollama — never silently drop the request
              chatInput.providerId = "ollama";
              chatInput.modelId = "llama3.2:latest";
              chatInput.apiKey = undefined;
            }
          }
        }
      } catch (err) {
        // Non-fatal — budget check must never break the AI call
        console.warn("[AiProviderService] budget pre-flight failed:", err);
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
        console.warn("[PromptSanitizer] Injection attempt detected:", sanitized.violations);
      }
      chatInput.messages = sanitized.messages as typeof chatInput.messages;
    } catch {
      // PromptSanitizer not yet available — skip silently
    }

    const providerId = chatInput.providerId.toLowerCase();

    // High-performance Signal-driven Async Queue for chunks
    const queue = new SignalAsyncQueue<ChatChunk>();

    const onChunk = (chunk: { content: string; done?: boolean }) => {
      const item = {
        content: chunk.content,
        delta: chunk.content,
        done: !!chunk.done,
      };
      queue.push(item);
      if (chunk.done) queue.close();
    };

    const promise = (async () => {
      try {
        // Federated Routing Check
        if (await this.shouldOffload(chatInput)) {
          const peer = await this.selectPeerNode(chatInput);
          if (peer) {
            await this.routeToPeer(peer, chatInput, onChunk);
            return;
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
          case "llamacpp": {
            const { LlamaCppService } = await import("./LlamaCppService.js") as typeof import("./LlamaCppService.js");
            const modelPath = chatInput.modelPath ?? "";
            if (!modelPath) throw new Error("modelPath required for llamacpp provider");
            const text = await LlamaCppService.getInstance().generate(
              chatInput.messages.map((m: any) => m.content).join("\n"),
              modelPath,
            );
            onChunk({ content: text, done: false });
            break;
          }
          default:
            throw new Error(`Unsupported provider: ${providerId}`);
        }
      } catch (err) {
        onChunk({ content: `Error: ${(err as Error).message}`, done: true });
      } finally {
        onChunk({ content: "", done: true });
      }
    })();

    let completionChars = 0;
    for await (const item of queue) {
      completionChars += item.delta?.length ?? 0;
      yield item;
      if (item.done) break;
    }
    await promise;

    // Agentic Wallet — log spend after stream completes
    if (chatInput.projectId) {
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
      { id: "llamacpp", name: "llama.cpp (Local)", status: "online" },
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
      if (db) {
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
      }
    } catch (err) {
      // Non-fatal — spend logging must never break the AI call
      console.warn("[AiProviderService] logSpend failed:", err);
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
    console.info(
      `[AiProviderService] spend logged: project=${params.projectId} ` +
      `provider=${params.provider} model=${params.modelId} ` +
      `cost=${costMicrocents} microcents`
    );
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

  private async shouldOffload(input: ChatInput): Promise<boolean> {
    // Decision based on prompt length or explicit request
    const promptLength = input.messages.reduce((acc, m) => acc + m.content.length, 0);
    const decision = await meshNode.getRouting().decide(input.messages[input.messages.length - 1]?.content || "", {
      model: input.modelId,
      tokens: promptLength
    });

    return decision.targetNodeId !== meshNode.getIdentity().id;
  }

  private async selectPeerNode(input: ChatInput): Promise<any> {
    const promptLength = input.messages.reduce((acc, m) => acc + m.content.length, 0);
    const decision = await meshNode.getRouting().decide(input.messages[input.messages.length - 1]?.content || "", {
      model: input.modelId,
      tokens: promptLength
    });

    if (decision.targetNodeId === meshNode.getIdentity().id) return null;

    const peers = meshNode.getDiscovery().getPeers();
    return peers.find(p => p.name === decision.targetNodeId);
  }

  // ... rest of the private chat methods remain the same ...

  private async routeToPeer(
    peer: any,
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const address = peer.addresses?.[0] || peer.address;
    const port = peer.port || 3000;
    const url = `http://${address}:${port}/api/trpc/ai.chat`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: input }),
    });

    if (!response.ok)
      throw new Error(`Federated routing failed: ${response.statusText}`);

    if (onChunk) {
      // If the peer doesn't support streaming via tRPC over HTTP easily, 
      // we might just get the full response here.
      const data = await response.json();
      const content = data.result.data.content || data.result.data;
      onChunk({ content, delta: content, done: true });
      return content;
    }

    const data = await response.json();
    return data.result.data.content || data.result.data;
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
    });

    if (!response.ok) {
      throw new Error(`Forge error: ${response.statusText}`);
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
    });

    if (!response.ok) {
      throw new Error(`Hugging Face error: ${response.statusText}`);
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
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        stream: !!onChunk,
        options: {
          num_predict: input.maxTokens,
          temperature: input.temperature,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data.message.content;
    }

    return this.handleStream(
      response,
      line => {
        const parsed = JSON.parse(line);
        return {
          content: parsed.message?.content || "",
          done: parsed.done,
        };
      },
      onChunk
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
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.statusText}`);
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
    });

    if (!response.ok) {
      throw new Error(`xAI Grok error: ${response.statusText}`);
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
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic error: ${response.statusText}`);
    }

    if (!onChunk) {
      const data = await response.json();
      return data.content[0].text;
    }

    return this.handleStream(
      response,
      line => {
        const parsed = JSON.parse(line);
        if (parsed.type === "content_block_delta") {
          return { content: parsed.delta.text, done: false };
        }
        if (parsed.type === "message_stop") {
          return { content: "", done: true };
        }
        return { content: "", done: false };
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
    const baseUrl = `${customUrl.replace(/\/$/, "")}/v1beta/models/${input.modelId}:streamGenerateContent?key=${apiKey}`;

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
    });

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.statusText}`);
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
    parser: (line: string) => { content: string; done: boolean },
    onChunk: (chunk: ChatChunk) => void,
    prefix: string = ""
  ): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

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
          const { content, done: isDone } = parser(cleanLine);
          if (content) {
            fullContent += content;
            onChunk({ content, delta: content, done: false });
          }
          if (isDone) {
            onChunk({ content: "", delta: "", done: true });
            return fullContent;
          }
        } catch (e) {
          // Ignore parse errors for partial lines
        }
      }
    }

    onChunk({ content: "", delta: "", done: true });
    return fullContent;
  }

  /**
   * Discover available local Ollama models.
   */
  async discoverOllamaModels(): Promise<any[]> {
    const baseUrl = this.getOllamaUrl();
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  }
}
