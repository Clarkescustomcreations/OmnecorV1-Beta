import { z } from "zod";
import { router, publicProcedure, protectedProcedure, cloudProcedure } from "../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { AiProviderService } from "../phase2/services/AiProviderService.js";
import { injectMapRagContext } from "../_core/ragContext.js";
import { assertProviderAllowedInMode } from "../_core/sovereign.js";

const chatInputSchema = z.object({
  providerId: z.enum(["system", "ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
  modelId: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  /** Active neural map — when set (and its enableAIContext is on), the map's
   *  indexed knowledge is retrieved and injected as system context. */
  ragMapId: z.string().optional(),
});

export const aiProviderRouter = router({
  getProviders: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.listProviders([]);
  }),

  discoverOllamaModels: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.discoverOllamaModels();
  }),

  chatStream: protectedProcedure
    .input(chatInputSchema)
    .subscription(({ ctx, input }) => {
      // Sovereign-mode gate: cloud providers blocked for air-gapped users. This
      // mixed local+cloud entry point can't be a blanket cloudProcedure without
      // killing local chat, so gate per-provider via the shared guard.
      assertProviderAllowedInMode(input.providerId, ctx.user?.executionMode);
      return observable<{ delta: string; done: boolean; totalTokens?: number }>(
        emit => {
          const svc = AiProviderService.getInstance();
          (async () => {
            // Read-side map RAG: inject the active map's indexed knowledge before
            // streaming. Local retrieval, so it runs even in Sovereign mode.
            const rag = await injectMapRagContext({
              mapId: input.ragMapId,
              userId: ctx.user?.id,
              messages: input.messages,
              systemPrompt: input.systemPrompt,
            });
            for await (const chunk of svc.streamChat(
              input,
              rag.messages,
              rag.systemPrompt
            )) {
              emit.next(chunk);
              if (chunk.done) {
                emit.complete();
                break;
              }
            }
          })().catch(err => emit.error(err));
        }
      );
    }),

  checkHealth: publicProcedure
    .input(
      z.object({
        providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
        modelId: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return AiProviderService.getInstance().checkHealth(input);
    }),

  discoverProviderModels: cloudProcedure
    .input(
      z.object({
        providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.aiProvider.discoverProviderModels(input.providerId);
    }),
});
