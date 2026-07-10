import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../db.factory.js";
import { discoveredDatasetItems, curatedTrainingExamples } from "../../drizzle/schema.js";
import { isSovereignMode } from "../_core/sovereign.js";
import { getSetting } from "../core_services/services/SettingsService.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("datasetRouter");

export const datasetRouter = router({
  discoverSources: protectedProcedure
    .input(
      z.object({
        projectId: z.string().nullable(),
        sourceType: z.enum(["local", "online_search"]),
        queryOrPath: z.string().min(1),
        limit: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { projectId, sourceType, queryOrPath, limit } = input;
      let count = 0;

      if (sourceType === "online_search") {
        if (isSovereignMode(ctx.user.executionMode) && !getSetting("sovereignBlockAiOnly", false)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sovereign mode: online search discovery is disabled. Enable 'block AI providers only' in Settings to allow web scraping.",
          });
        }
        count = await ctx.services.datasetDiscovery.discoverOnline(projectId, queryOrPath, limit);
      } else if (sourceType === "local") {
        count = await ctx.services.datasetDiscovery.discoverLocal(projectId, queryOrPath, limit);
      }

      return { success: true, count };
    }),

  listUnprocessedSources: protectedProcedure
    .input(
      z.object({
        projectId: z.string().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const conditions = [eq(discoveredDatasetItems.isProcessed, 0)];

      if (input.projectId !== undefined) {
        if (input.projectId === null) {
          conditions.push(isNull(discoveredDatasetItems.projectId));
        } else {
          conditions.push(eq(discoveredDatasetItems.projectId, input.projectId));
        }
      }

      const items = await db
        .select()
        .from(discoveredDatasetItems)
        .where(and(...conditions));

      return items;
    }),

  curateSourceItem: protectedProcedure
    .input(
      z.object({
        itemId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const success = await ctx.services.datasetCuration.curateItem(
        input.itemId,
        ctx.user.id,
        ctx.user.executionMode
      );
      if (!success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to curate source item. Make sure an inference provider is available.",
        });
      }
      return { success: true };
    }),

  listCuratedExamples: protectedProcedure
    .input(
      z.object({
        projectId: z.string().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const conditions = [];

      if (input.projectId !== undefined) {
        if (input.projectId === null) {
          conditions.push(isNull(curatedTrainingExamples.projectId));
        } else {
          conditions.push(eq(curatedTrainingExamples.projectId, input.projectId));
        }
      }

      const query = db.select().from(curatedTrainingExamples);
      const items = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;

      return items;
    }),

  updateCuratedExample: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        instruction: z.string().optional(),
        input: z.string().nullable().optional(),
        output: z.string().optional(),
        status: z.enum(["pending_review", "approved", "rejected"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...updates } = input;

      const [existing] = await db
        .select()
        .from(curatedTrainingExamples)
        .where(eq(curatedTrainingExamples.id, id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Curated example not found" });
      }

      const updateData: Partial<typeof curatedTrainingExamples.$inferInsert> = {
        ...updates,
        updatedAt: new Date(),
      };

      await db
        .update(curatedTrainingExamples)
        .set(updateData)
        .where(eq(curatedTrainingExamples.id, id));

      const [updated] = await db
        .select()
        .from(curatedTrainingExamples)
        .where(eq(curatedTrainingExamples.id, id))
        .limit(1);

      return updated;
    }),

  compileDataset: protectedProcedure
    .input(
      z.object({
        projectId: z.string().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const filePath = await ctx.services.datasetCuration.compileDataset(input.projectId);
      return { success: true, filePath };
    }),
});
