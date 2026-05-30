import { z } from "zod";
import { router, publicProcedure } from "../../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { AiProviderService } from "../services/AiProviderService.js";

const chatInputSchema = z.object({
  providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok"]),
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
});

export const aiProviderRouter = router({
  getProviders: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.listProviders([]);
  }),

  discoverOllamaModels: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.discoverOllamaModels();
  }),

  chatStream: publicProcedure
    .input(chatInputSchema)
    .subscription(({ input }) => {
      return observable<{ delta: string; done: boolean; totalTokens?: number }>(
        emit => {
          const svc = AiProviderService.getInstance();
          (async () => {
            for await (const chunk of svc.streamChat(
              input,
              input.messages,
              input.systemPrompt
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
        providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok"]),
        modelId: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return AiProviderService.getInstance().checkHealth(input);
    }),
});
