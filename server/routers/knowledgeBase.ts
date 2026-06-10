/**
 * @file server/routers/knowledgeBase.ts
 * @description Omnecor — Knowledge Base & Memory tRPC Router
 *
 * Exposes the MemoryArchitectService (Layer 2 Long-Term Memory) via tRPC.
 * Provides procedures for:
 *   - Ingesting directories/files into project memory
 *   - Semantic search across project knowledge
 *   - Context retrieval for AI prompt augmentation
 *   - Memory consolidation (episodic → long-term)
 *   - Collection management (stats, deletion)
 *
 * The MemoryArchitectService wraps VectorDBService (ChromaDB) and adds
 * domain-specific chunking, metadata, and retrieval logic.
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc.js";
import { validatePath } from "../_core/security.js";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────
const projectIdSchema = z.object({ projectId: z.string().min(1) });
const ingestDirectorySchema = z.object({
  projectId: z.string().min(1),
  directoryPath: z.string().min(1),
  recursive: z.boolean().optional(),
});
const ingestDocumentSchema = z.object({
  projectId: z.string().min(1),
  documentId: z.string().min(1),
  text: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
});
const searchSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().optional(),
});
const retrieveContextSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1),
  maxTokens: z.number().int().optional(),
});
const consolidateSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  summary: z.string().min(1),
  keyInsights: z.array(z.string()),
});

export const knowledgeBaseRouter = router({
  /**
   * Check if the Memory Architect (ChromaDB) is online and operational.
   * Returns status without throwing — useful for UI health indicators.
   */
  status: publicProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.services.memoryArchitect.getStatus();
    } catch {
      return {
        online: false,
        chromaUrl: process.env.CHROMA_URL || "http://localhost:8000",
        initialized: false,
      };
    }
  }),

  /**
   * Delete a project's memory collection entirely.
   */
  deleteCollection: protectedProcedure
    .input(projectIdSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.services.memoryArchitect.isOnline()) return { success: false };
      await ctx.services.memoryArchitect.deleteCollection(input.projectId);
      return { success: true };
    }),

  /**
   * Ingest an entire directory into a project's long-term memory.
   * Recursively walks the directory, chunks text files, and stores
   * vector embeddings in the project's isolated ChromaDB collection.
   *
   * This is the primary mechanism for the "Add Folder as Knowledge Base"
   * feature in the Settings panel.
   */
  ingestDirectory: protectedProcedure
    .input(ingestDirectorySchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.services.memoryArchitect.isOnline()) {
        return {
          success: false,
          error: "Memory layer offline — ensure ChromaDB is running",
          filesProcessed: 0,
          chunksStored: 0,
          errors: [],
          durationMs: 0,
        };
      }

      const resolvedPath = await validatePath(input.directoryPath);

      const result = await ctx.services.memoryArchitect.ingestDirectory(
        input.projectId,
        resolvedPath,
        input.recursive
      );

      return {
        success: result.errors.length === 0,
        ...result,
      };
    }),

  /**
   * Ingest a single text document into project memory.
   * Useful for adding notes, summaries, or external content.
   */
  ingestDocument: protectedProcedure
    .input(ingestDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.services.memoryArchitect.isOnline()) {
        return { success: false, error: "Memory layer offline" };
      }

      await ctx.services.memoryArchitect.ingestDocument(
        input.projectId,
        input.documentId,
        input.text,
        input.metadata || {}
      );

      return { success: true };
    }),

  /**
   * Semantic search across a project's long-term memory.
   * Returns ranked results with source file paths and relevance scores.
   */
  search: protectedProcedure.input(searchSchema).query(async ({ ctx, input }) => {
    if (!ctx.services.memoryArchitect.isOnline()) return [];

    return ctx.services.memoryArchitect.search(
      input.projectId,
      input.query,
      input.limit
    );
  }),

  /**
   * Retrieve context-relevant memory for AI prompt augmentation.
   * This is called by the Valet Router before sending prompts to AI models,
   * injecting relevant long-term knowledge into the working context.
   *
   * Returns a formatted string ready for prompt injection.
   */
  retrieveContext: protectedProcedure
    .input(retrieveContextSchema)
    .query(async ({ ctx, input }) => {
      if (!ctx.services.memoryArchitect.isOnline())
        return { context: "", tokenEstimate: 0 };

      const context = await ctx.services.memoryArchitect.retrieveContext(
        input.projectId,
        input.prompt,
        input.maxTokens
      );

      // Approximate token count (1 token ≈ 4 chars)
      const tokenEstimate = Math.ceil(context.length / 4);

      return { context, tokenEstimate };
    }),

  /**
   * Consolidate a conversation summary into long-term memory.
   * Bridges Layer 3 (Episodic/conversation history) → Layer 2 (Long-Term).
   * Called when a conversation session ends or at periodic intervals.
   */
  consolidate: protectedProcedure
    .input(consolidateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.services.memoryArchitect.isOnline()) {
        return { success: false, error: "Memory layer offline" };
      }

      await ctx.services.memoryArchitect.consolidateEpisodic(
        input.projectId,
        input.conversationId,
        input.summary,
        input.keyInsights
      );

      return { success: true };
    }),

  /**
   * Ensure a project's memory collection exists.
   * Called when creating a new project or opening one for the first time.
   */
  ensureProject: protectedProcedure
    .input(projectIdSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.services.memoryArchitect.isOnline()) {
        return { success: false, collectionName: null };
      }

      const collectionName =
        await ctx.services.memoryArchitect.ensureProjectMemory(input.projectId);
      return { success: true, collectionName };
    }),
});
