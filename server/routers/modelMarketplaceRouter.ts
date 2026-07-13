import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { ModelMarketplaceService } from "../core_services/services/ModelMarketplaceService.js";

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
   * List the downloadable `.gguf` files in a Hugging Face repo (each quant, with
   * its real size) so the user can pick the one that fits their hardware.
   */
  listRepoFiles: protectedProcedure
    .input(z.object({ repoId: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const files = await ModelMarketplaceService.getInstance().listRepoFiles(input.repoId);
      return { repoId: input.repoId, files };
    }),

  /**
   * Download a chosen Hugging Face GGUF into the local models dir for Omnecor's
   * own runtime. Non-blocking — returns a tracking id; poll `downloadStatus`.
   * Not Sovereign-gated: a model download is a network fetch, not AI inference,
   * and an air-gapped user still needs local models to run.
   */
  downloadModel: protectedProcedure
    .input(z.object({
      repoId: z.string().min(1).max(200),
      // Repo-relative path to the .gguf (may include a subfolder), e.g.
      // "Q4_K_M/model.gguf"; the service validates + flattens it to a basename.
      filePath: z.string().min(1).max(300),
      sizeBytes: z.number().int().nonnegative().default(0),
    }))
    .mutation(async ({ input }) => {
      return ModelMarketplaceService.getInstance().startHuggingFaceDownload(
        input.repoId,
        input.filePath,
        input.sizeBytes,
      );
    }),

  /**
   * Download a WHOLE Hugging Face base-model repo (config + tokenizer +
   * safetensors) into the base-models dir for offline fine-tuning in the LLM
   * Builder. Non-blocking — returns a tracking id; poll `downloadStatus`, then
   * point the trainer at the returned `destPath`. Not Sovereign-gated (a
   * download is a fetch, not inference).
   */
  downloadBaseModel: protectedProcedure
    .input(z.object({ repoId: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      return ModelMarketplaceService.getInstance().startBaseModelDownload(input.repoId);
    }),

  /** Poll the progress/result of a single download. */
  downloadStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return ModelMarketplaceService.getInstance().getDownloadStatus(input.id);
    }),

  /** All active + recently-finished downloads (for the tab's progress list). */
  downloads: protectedProcedure
    .query(async () => {
      return { downloads: ModelMarketplaceService.getInstance().listDownloads() };
    }),
});
