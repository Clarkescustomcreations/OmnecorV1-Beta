import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { TRPCError } from "@trpc/server";
import { AiProviderService } from "../services/AiProviderService.js";

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
});

// Sovereign-mode gate: cloud providers are blocked for air-gapped users.
// Mirrors the per-provider guard in routers/aiRouter.ts (this mixed local+cloud
// entry point cannot be a blanket `cloudProcedure` without killing local chat).
const CLOUD_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "grok",
  "huggingface",
]);

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
      if (ctx.user?.executionMode === "sovereign" && CLOUD_PROVIDER_IDS.has(input.providerId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Sovereign mode: cloud provider "${input.providerId}" is disabled. Use a local provider (ollama, llamacpp).`,
        });
      }
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
        providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
        modelId: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return AiProviderService.getInstance().checkHealth(input);
    }),
});
