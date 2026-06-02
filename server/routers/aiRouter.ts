/**
 * @file server/routers/aiRouter.ts
 * @description Omnecor — AI Provider tRPC Router
 *
 * Exposes the AiProviderService via tRPC.
 * Provides procedures for:
 *   - Getting available AI providers and their health
 *   - Discovering local Ollama models
 *   - Sending chat completion requests (blocking and streaming)
 */

import { z } from "zod";
import { publicProcedure, router, protectedProcedure } from "../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { v4 as uuidv4 } from "uuid";
import {
  createChatSession,
  getChatSessions,
  getChatSession,
  getChatMessages,
  addChatMessage,
  updateChatSession,
} from "../db.factory.js";
import { validatePath } from "../_core/security.js";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.string().max(200_000),
});

const chatInputSchema = z.object({
  providerId: z.string()
    .min(1, "Provider ID required")
    .max(64, "Provider ID too long")
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid provider ID format"),

  modelId: z.string()
    .min(1, "Model ID required")
    .max(256, "Model ID too long"),

  messages: z.array(messageSchema).min(1).max(500),

  // Raw API keys from clients are accepted only for user-configured providers.
  // They are never stored or logged (audit middleware redacts them).
  apiKey: z.string().max(512).optional(),

  baseUrl: z.string()
    .url("Invalid URL format")
    .max(256)
    .refine((url) => {
      try {
        const { protocol, hostname } = new URL(url);
        if (protocol !== "http:" && protocol !== "https:") return false;
        const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (h === "localhost") return false;
        if (/^127\./.test(h)) return false;
        if (/^10\./.test(h)) return false;
        if (/^192\.168\./.test(h)) return false;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
        if (/^169\.254\./.test(h)) return false;
        if (h === "::1" || h === "0:0:0:0:0:0:0:1") return false;
        if (/^f[cd][0-9a-f]{2}:/i.test(h)) return false;
        return true;
      } catch {
        return false;
      }
    }, "URL must point to a public, non-private address")
    .optional(),

  systemPrompt: z.string().max(32_000).optional(),

  maxTokens: z.number()
    .int("Must be integer")
    .min(1)
    .max(128_000)
    .optional(),

  temperature: z.number()
    .min(0, "Temperature must be ≥ 0")
    .max(2, "Temperature must be ≤ 2")
    .optional(),

  isFictionMode: z.boolean().optional(),
});

const createSessionSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  systemPrompt: z.string().optional(),
});

const saveMessageSchema = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.string(),
  tokenCount: z.number().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const aiRouter = router({
  /**
   * Get a list of supported AI providers and their health status.
   */
  getProviders: publicProcedure.query(async ({ ctx }) => {
    const providers = [
      { id: "ollama", name: "Ollama" },
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
      { id: "gemini", name: "Gemini" },
      { id: "forge", name: "Forge" },
    ];

    return providers;
  }),

  /**
   * Discover available local Ollama models.
   */
  discoverOllamaModels: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.discoverOllamaModels();
  }),

  // =========================================================================
  // Chat Persistence (D1)
  // =========================================================================

  createSession: protectedProcedure
    .input(createSessionSchema)
    .mutation(async ({ input }) => {
      const sessionId = uuidv4();
      await createChatSession({
        id: sessionId,
        projectId: input.projectId,
        title: input.title,
        providerId: input.providerId,
        modelId: input.modelId,
        systemPrompt: input.systemPrompt || null,
      });
      return { sessionId };
    }),

  getSessions: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      return await getChatSessions(input.projectId);
    }),

  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const session = await getChatSession(input.sessionId);
      if (!session) return null;
      const messages = await getChatMessages(input.sessionId);
      return { session, messages };
    }),

  saveMessage: protectedProcedure
    .input(saveMessageSchema)
    .mutation(async ({ input }) => {
      const messageId = uuidv4();
      await addChatMessage({
        id: messageId,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        tokenCount: input.tokenCount || null,
      });
      // Optionally update the session updatedAt timestamp
      await updateChatSession(input.sessionId, {});
      return { messageId };
    }),

  // =========================================================================
  // Context Pruning & Episodic Memory (D2 & D3)
  // =========================================================================

  /**
   * Summarize a chat session and consolidate it into Episodic Memory (VectorDB).
   * This handles Context Pruning by creating a dense representation of past context.
   */
  summarizeAndPruneSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        projectId: z.string().min(1),
        providerId: z.string().min(1),
        modelId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getChatSession(input.sessionId);
      if (!session) throw new Error("Session not found");

      const messages = await getChatMessages(input.sessionId);
      if (messages.length === 0)
        return { success: false, reason: "No messages to summarize" };

      // Format messages into a script for the AI to summarize
      const transcript = messages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");

      const summaryPrompt = `
You are an expert archivist. Please summarize the following conversation transcript.
Focus on the core intent, key decisions made, code changes discussed, and any outstanding tasks.
Produce a concise, dense summary. Then, list 3-5 key insights as bullet points.

TRANSCRIPT:
${transcript}
      `.trim();

      // Call AI to generate summary
      const summaryContent = await ctx.services.aiProvider.chat({
        providerId: input.providerId,
        modelId: input.modelId,
        messages: [{ role: "user", content: summaryPrompt }],
        maxTokens: 1000,
      });

      // Extract bullet points (Insights) vs main body if possible, or just pass full content
      const insightsMatch = summaryContent.match(/- (.*)/g);
      const keyInsights = insightsMatch
        ? insightsMatch.map(i => i.replace("- ", "").trim())
        : [];

      // Consolidate to Long-Term Memory (Episodic)
      if (ctx.services.memoryArchitect.isOnline()) {
        await ctx.services.memoryArchitect.consolidateEpisodic(
          input.projectId,
          input.sessionId,
          summaryContent,
          keyInsights
        );
      }

      return { success: true, summary: summaryContent, keyInsights };
    }),

  // =========================================================================
  // Chat Execution
  // =========================================================================

  /**
   * Send a chat completion request (Blocking).
   * Returns the full content once generation is complete.
   */
  chat: protectedProcedure
    .input(chatInputSchema)
    .mutation(async ({ ctx, input }) => {
      const content = await ctx.services.aiProvider.chat(input);
      return { content };
    }),

  /**
   * Send a chat completion request (Streaming).
   * Emits chunks as they are generated via WebSockets/Subscriptions.
   */
  chatStream: protectedProcedure
    .input(chatInputSchema)
    .subscription(({ ctx, input }) => {
      return observable(emit => {
        const stream = ctx.services.aiProvider.streamChat(input);
        (async () => {
          for await (const chunk of stream) {
            emit.next(chunk);
            if (chunk.done) {
              emit.complete();
              break;
            }
          }
        })().catch(err => {
          emit.error(err);
        });

        return () => {
          // Cleanup logic if needed
        };
      });
    }),

  // =========================================================================
  // Web Scraping & RAG (references/scraping)
  // =========================================================================

  scrape: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.services.scraper.scrape(input.url);
    }),

  // =========================================================================
  // Coding Context (references/coding)
  // =========================================================================

  getCodeContext: protectedProcedure
    .input(z.object({ filepath: z.string(), symbols: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const resolved = await validatePath(input.filepath);
      return await ctx.services.codingContext.getContextSnippets(
        resolved,
        input.symbols
      );
    }),
});
