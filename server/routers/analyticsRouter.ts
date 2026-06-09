import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { postAnalytics, scheduledPosts, platformAccounts } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const analyticsRouter = router({
  getPlatformSummary: protectedProcedure
    .input(z.object({}).optional())
    .query(async () => {
      const db = await getDb();
      if (!db) return [];

      const accounts = await db.select()
        .from(platformAccounts)
        .where(eq(platformAccounts.isActive, 1));

      const summaries = await Promise.all(
        accounts.map(async (account) => {
          const analytics = await db.select()
            .from(postAnalytics)
            .where(eq(postAnalytics.scheduledPostId, account.id))
            .orderBy(desc(postAnalytics.lastUpdatedAt))
            .limit(100);

          const totalImpressions = analytics.reduce((sum, a) => sum + (a.impressions || 0), 0);
          const totalLikes = analytics.reduce((sum, a) => sum + (a.likes || 0), 0);
          const totalShares = analytics.reduce((sum, a) => sum + (a.shares || 0), 0);
          const totalComments = analytics.reduce((sum, a) => sum + (a.comments || 0), 0);

          return {
            platform: account.platform,
            accountName: account.accountName,
            totalImpressions,
            totalLikes,
            totalShares,
            totalComments,
            totalReach: analytics.reduce((sum, a) => sum + (a.reach || 0), 0),
            totalClicks: analytics.reduce((sum, a) => sum + (a.clicks || 0), 0),
          };
        })
      );

      return summaries;
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  getPostAnalytics: protectedProcedure
    .input(z.object({ scheduledPostId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const result = await db.select()
        .from(postAnalytics)
        .where(eq(postAnalytics.scheduledPostId, input.scheduledPostId))
        .limit(1);

      return result[0] || null;
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  updateAnalytics: protectedProcedure
    .input(z.object({
      scheduledPostId: z.number(),
      impressions: z.number().optional(),
      likes: z.number().optional(),
      shares: z.number().optional(),
      comments: z.number().optional(),
      reach: z.number().optional(),
      clicks: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "Database not available" };

      const existing = await db.select()
        .from(postAnalytics)
        .where(eq(postAnalytics.scheduledPostId, input.scheduledPostId))
        .limit(1);

      if (existing.length) {
        await db.update(postAnalytics)
          .set({
            ...(input.impressions !== undefined && { impressions: input.impressions }),
            ...(input.likes !== undefined && { likes: input.likes }),
            ...(input.shares !== undefined && { shares: input.shares }),
            ...(input.comments !== undefined && { comments: input.comments }),
            ...(input.reach !== undefined && { reach: input.reach }),
            ...(input.clicks !== undefined && { clicks: input.clicks }),
          })
          .where(eq(postAnalytics.scheduledPostId, input.scheduledPostId));
      }

      return { success: true };
    }),
});
