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
import { meshNode } from "../../ommesh/core/MeshNode.js";

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

  public static getInstance(): AiProviderService {
    if (!AiProviderService.instance) {
      AiProviderService.instance = new AiProviderService();
    }
    return AiProviderService.instance;
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

    if (chatInput.isFictionMode) {
      const fictionPrompt: Message = {
        role: "system",
        content:
          "You are in Fiction Mode. Maintain a narrative, creative tone and prioritize immersive, imaginative descriptions.",
      };
      chatInput.messages = [fictionPrompt, ...chatInput.messages];
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
          default:
            throw new Error(`Unsupported provider: ${providerId}`);
        }
      } catch (err) {
        onChunk({ content: `Error: ${(err as Error).message}`, done: true });
      } finally {
        onChunk({ content: "", done: true });
      }
    })();

    for await (const item of queue) {
      yield item;
      if (item.done) break;
    }
    await promise;
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
      { id: "forge", name: "Forge API", status: "online" },
    ];
    return filter.length > 0
      ? providers.filter(p => filter.includes(p.id))
      : providers;
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

    const peers = meshNode.getDiscovery().getPeers() as any[];
    return peers.find(p => p.id === decision.targetNodeId);
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

  private async chatOllama(
    input: ChatInput,
    onChunk?: (chunk: ChatChunk) => void
  ): Promise<string> {
    const baseUrl = input.baseUrl || ENV.ollamaUrl || "http://localhost:11434";
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
    const apiKey = input.apiKey || ENV.openaiApiKey;
    if (!apiKey) throw new Error("OpenAI API Key not configured");

    const baseUrl =
      input.baseUrl || "https://api.openai.com/v1/chat/completions";
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
    const apiKey = input.apiKey || ENV.xaiApiKey;
    if (!apiKey) throw new Error("xAI API Key not configured");

    const baseUrl = input.baseUrl || "https://api.x.ai/v1/chat/completions";
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
    const apiKey = input.apiKey || ENV.anthropicApiKey;
    if (!apiKey) throw new Error("Anthropic API Key not configured");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
    const apiKey = input.apiKey || ENV.geminiApiKey;
    if (!apiKey) throw new Error("Gemini API Key not configured");

    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${input.modelId}:streamGenerateContent?key=${apiKey}`;

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

    // Gemini stream is a continuous JSON array `[ {...}, {...} ]`.
    // The fetch API receives chunks that might break in the middle of JSON objects.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Try to extract complete JSON objects from the buffer array format
      // Format is roughly: `[\n{\n  "candidates": [...]\n},\n{\n...`

      // Basic regex to find JSON objects that look like Gemini responses
      const regex = /{[^{}]*"candidates"[^{}]*}/g;
      // Note: This regex is overly simplistic for real-world nested JSON.
      // For robust Gemini streaming, it's safer to handle it line by line
      // or use a proper streaming JSON parser. Since Gemini returns a JSON array,
      // we can try splitting by lines and looking for "text": "..."

      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep the last incomplete line in buffer

      for (const line of lines) {
        // Very simplistic extraction of text from Gemini's streaming output lines
        const match = line.match(/"text":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        if (match) {
          try {
            // Unescape the JSON string value
            const content = JSON.parse(`"${match[1]}"`);
            fullContent += content;
            onChunk({ content, delta: content, done: false });
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    // Process any remaining buffer
    const match = buffer.match(/"text":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (match) {
      try {
        const content = JSON.parse(`"${match[1]}"`);
        fullContent += content;
        onChunk({ content, delta: content, done: false });
      } catch (e) {}
    }

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
    const baseUrl = ENV.ollamaUrl || "http://localhost:11434";
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
