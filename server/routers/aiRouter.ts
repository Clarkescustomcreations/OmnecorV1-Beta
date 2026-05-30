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
import { publicProcedure, router } from "../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { v4 as uuidv4 } from "uuid";
import {
  createChatSession,
  getChatSessions,
  getChatSession,
  getChatMessages,
  addChatMessage,
  updateChatSession,
} from "../db.js";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.string(),
});

const chatInputSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  messages: z.array(messageSchema),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
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
  discoverOllamaModels: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.discoverOllamaModels();
  }),

  // =========================================================================
  // Chat Persistence (D1)
  // =========================================================================

  createSession: publicProcedure
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

  getSessions: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      return await getChatSessions(input.projectId);
    }),

  getSession: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const session = await getChatSession(input.sessionId);
      if (!session) return null;
      const messages = await getChatMessages(input.sessionId);
      return { session, messages };
    }),

  saveMessage: publicProcedure
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
  summarizeAndPruneSession: publicProcedure
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
  chat: publicProcedure
    .input(chatInputSchema)
    .mutation(async ({ ctx, input }) => {
      const content = await ctx.services.aiProvider.chat(input);
      return { content };
    }),

  /**
   * Send a chat completion request (Streaming).
   * Emits chunks as they are generated via WebSockets/Subscriptions.
   */
  chatStream: publicProcedure
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

  scrape: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.services.scraper.scrape(input.url);
    }),

  // =========================================================================
  // Coding Context (references/coding)
  // =========================================================================

  getCodeContext: publicProcedure
    .input(z.object({ filepath: z.string(), symbols: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      return await ctx.services.codingContext.getContextSnippets(
        input.filepath,
        input.symbols
      );
    }),
});
