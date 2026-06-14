import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { discoveredArticles } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ArticleDiscoveryService } from "../phase2/services/ArticleDiscoveryService.js";

export const discoveryRouter = router({
  listUnprocessed: protectedProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const articles = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.isProcessed, 0))
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
      if (!db) return { success: false, articlesAdded: 0, articles: [] };

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
      if (!db) return null;

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
      if (!db) return { success: false };

      await db.update(discoveredArticles)
        .set({ isProcessed: 1 })
        .where(eq(discoveredArticles.id, input.articleId));

      return { success: true };
    }),
});
