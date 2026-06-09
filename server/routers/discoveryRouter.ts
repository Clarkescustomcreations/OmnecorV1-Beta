import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { discoveredArticles } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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

      // Placeholder: In a real implementation, this would fetch from RSS feeds, APIs, etc.
      // For now, just return a count of newly created articles
      const articles = await db.select()
        .from(discoveredArticles)
        .where(eq(discoveredArticles.isProcessed, 0))
        .limit(input.limit);

      return {
        success: true,
        articlesAdded: articles.length,
        articles,
      };
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
