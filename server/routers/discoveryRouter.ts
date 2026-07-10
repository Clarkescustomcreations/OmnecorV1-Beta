import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { discoveredArticles } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ArticleDiscoveryService } from "../core_services/services/ArticleDiscoveryService.js";

export const discoveryRouter = router({
  listUnprocessed: protectedProcedure
    .input(z.object({
      projectId: z.string().optional(),
      limit: z.number().default(10),
    }))
    .query(async ({ input }) => {
      const db = await getDb();

      const whereConditions = [
        eq(discoveredArticles.isProcessed, 0),
      ];

      if (input.projectId) {
        whereConditions.push(eq(discoveredArticles.projectId, input.projectId));
      }

      const articles = await db.select()
        .from(discoveredArticles)
        .where(and(...whereConditions))
        .orderBy(desc(discoveredArticles.fetchedAt))
        .limit(input.limit);

      return articles;
    }),
  fetchArticles: protectedProcedure
    .input(z.object({
      source: z.string().optional(),
      limit: z.number().default(10),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();

      // Actually pull and ingest fresh articles from RSS/Atom feeds.
      const added = await ArticleDiscoveryService.getInstance().discover(input.source, input.limit);

      // Return the latest unprocessed set (includes the rows just ingested).
      const articles = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.isProcessed, 0))
        .orderBy(desc(discoveredArticles.fetchedAt))
        .limit(input.limit);

      return {
        success: true,
        articlesAdded: added.length,
        articles,
      };
    }),
  getArticle: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();

      const result = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.id, input.articleId))
        .limit(1);

      return result[0] || null;
    }),
  markAsProcessed: protectedProcedure
    .input(z.object({ articleId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();

      await db.update(discoveredArticles)
        .set({ isProcessed: 1 })
        .where(eq(discoveredArticles.id, input.articleId));

      return { success: true };
    }),
});
