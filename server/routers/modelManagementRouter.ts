/**
 * @file server/routers/modelManagementRouter.ts
 * @description Omnecor — Model Management Router
 *
 * tRPC router for model registry CRUD, lifecycle management, and provider sync.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { ModelManagementService } from "../core_services/services/ModelManagementService.js";
import { TRPCError } from "@trpc/server";
import { createLogger } from "../_core/logger.js";
import { validatePath } from "../_core/security.js";

const log = createLogger("modelManagement");

export const modelManagementRouter = router({
  /**
   * List all registered models.
   */
  list: protectedProcedure.query(async () => {
    try {
      const models = await ModelManagementService.getInstance().listModels();
      return { models };
    } catch (err) {
      log.error("Failed to list models:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to list models",
      });
    }
  }),

  /**
   * List models for a specific provider.
   */
  listByProvider: protectedProcedure
    .input(z.object({ provider: z.string().min(1).max(50) }))
    .query(async ({ input }) => {
      try {
        const models = await ModelManagementService.getInstance().listModelsByProvider(input.provider);
        return { models };
      } catch (err) {
        log.error(`Failed to list models for provider ${input.provider}:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list models for provider ${input.provider}`,
        });
      }
    }),

  /**
   * Get a single model by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(256) }))
    .query(async ({ input }) => {
      try {
        const model = await ModelManagementService.getInstance().getModel(input.id);
        return { model };
      } catch (err) {
        log.error(`Failed to get model ${input.id}:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to get model ${input.id}`,
        });
      }
    }),

  /**
   * Register (add or update) a model in the registry.
   */
  register: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1).max(256),
        name: z.string().min(1).max(256),
        provider: z.enum(["ollama", "openai", "anthropic", "huggingface", "llamacpp", "custom"]),
        version: z.string().min(1).max(100),
        quantization: z.string().max(50).optional(),
        filePath: z.string().max(1024).optional(),
        sizeGb: z.number().positive().optional(),
        isActive: z.boolean().default(false),
        metadata: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // A model weight path must resolve inside an allowed directory before it
        // is persisted to the registry (and later loaded by the inference bridge).
        const filePath = input.filePath
          ? await validatePath(input.filePath)
          : undefined;
        const registered = await ModelManagementService.getInstance().registerModel({
          id: input.id,
          name: input.name,
          provider: input.provider,
          version: input.version,
          quantization: input.quantization,
          filePath,
          sizeGb: input.sizeGb,
          isActive: input.isActive,
          metadata: input.metadata,
        });
        return { model: registered };
      } catch (err) {
        log.error(`Failed to register model ${input.id}:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to register model: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * Unregister (remove) a model from the registry.
   */
  unregister: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      try {
        const success = await ModelManagementService.getInstance().unregisterModel(input.id);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Model not found: ${input.id}`,
          });
        }
        return { unregistered: true, id: input.id };
      } catch (err) {
        log.error(`Failed to unregister model ${input.id}:`, err);
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to unregister model: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * Set a model as active for its provider.
   * Automatically deactivates any other active model for the same provider.
   */
  setActive: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      try {
        const model = await ModelManagementService.getInstance().setActiveModel(input.id);
        if (!model) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Model not found: ${input.id}`,
          });
        }
        return { model, message: `Set ${model.name} as active for ${model.provider}` };
      } catch (err) {
        log.error(`Failed to set active model ${input.id}:`, err);
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to set active model: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * Sync current Ollama models into the registry.
   * Called periodically (from client or background job) to keep registry in sync.
   */
  syncFromOllama: protectedProcedure
    .input(
      z.object({
        models: z.array(
          z.object({
            name: z.string(),
            size: z.number(),
            digest: z.string().optional(),
            modified_at: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await ModelManagementService.getInstance().syncFromOllama(input.models);
        return {
          synced: true,
          count: input.models.length,
          message: `Synced ${input.models.length} Ollama models into registry`,
        };
      } catch (err) {
        log.error("Failed to sync Ollama models:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to sync Ollama models: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * Mark a model as used (updates lastUsedAt timestamp).
   * Called after a successful model invocation.
   */
  markUsed: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      try {
        await ModelManagementService.getInstance().markModelUsed(input.id);
        return { marked: true, id: input.id };
      } catch (err) {
        log.error(`Failed to mark model used: ${input.id}:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to mark model used: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * Get registry statistics.
   */
  stats: protectedProcedure.query(async () => {
    try {
      const stats = await ModelManagementService.getInstance().getStats();
      return { stats };
    } catch (err) {
      log.error("Failed to get model stats:", err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get model statistics",
      });
    }
  }),

  /**
   * Query Ollama /api/ps for currently loaded models with VRAM usage.
   */
  getRunningModels: protectedProcedure.query(async () => {
    const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
    try {
      const res = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { models: [] };
      const data = await res.json() as { models?: unknown[] };
      return { models: data.models ?? [] };
    } catch {
      return { models: [] };
    }
  }),
});
