import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc.js";
import { ModelMarketplaceService } from "../services/ModelMarketplaceService.js";

export const modelMarketplaceRouter = router({
  /**
   * Search marketplace across all sources (Ollama + HuggingFace)
   */
  search: protectedProcedure
    .input(z.object({
      query: z.string().max(256).default(""),
      source: z.enum(["all", "ollama", "huggingface"]).default("all"),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const service = ModelMarketplaceService.getInstance();

      if (input.source === "ollama") {
        const models = await service.searchOllama(input.query, input.limit);
        return { models, total: models.length };
      }

      if (input.source === "huggingface") {
        const models = await service.searchHuggingFace(input.query, input.limit);
        return { models, total: models.length };
      }

      // "all"
      const models = await service.searchAll(input.query, input.limit);
      return { models, total: models.length };
    }),

  /**
   * Get curated featured models (no network calls)
   */
  featured: protectedProcedure
    .query(async () => {
      const service = ModelMarketplaceService.getInstance();
      const models = service.getHotModels();
      return { models, total: models.length };
    }),

  /**
   * Pull a model from Ollama registry
   * Delegates to ollamaRouter.pullModel — we reuse that mutation.
   * The client should handle the actual mutation call.
   */
  pullOllama: protectedProcedure
    .input(z.object({
      modelName: z.string().min(1).max(256),
    }))
    .mutation(async ({ ctx }) => {
      // This procedure accepts the model name but doesn't directly call Ollama.
      // The client is responsible for calling trpc.ollama.pullModel after this.
      // Alternatively, we could proxy to ollamaFetch here, but the pattern
      // in ollamaRouter is to use fire-and-forget fetch. For consistency,
      // we delegate back to the client.
      return {
        success: true,
        message: "Call trpc.ollama.pullModel to initiate the pull.",
      };
    }),
});
