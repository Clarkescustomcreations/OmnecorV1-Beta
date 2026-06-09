import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { scheduledPosts, curatedPosts, platformAccounts } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const schedulingRouter = router({
  listScheduledPosts: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const posts = await db.select({
        id: scheduledPosts.id,
        curatedPostId: scheduledPosts.curatedPostId,
        platformAccountId: scheduledPosts.platformAccountId,
        scheduledAt: scheduledPosts.scheduledAt,
        publishedAt: scheduledPosts.publishedAt,
        status: scheduledPosts.status,
        errorMessage: scheduledPosts.errorMessage,
        platformPostId: scheduledPosts.platformPostId,
        createdAt: scheduledPosts.createdAt,
        updatedAt: scheduledPosts.updatedAt,
        content: curatedPosts.content,
        platform: curatedPosts.platform,
      })
        .from(scheduledPosts)
        .leftJoin(curatedPosts, eq(curatedPosts.id, scheduledPosts.curatedPostId))
        .orderBy(desc(scheduledPosts.scheduledAt))
        .limit(input.limit);
      return posts;
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  schedulePost: protectedProcedure
    .input(z.object({
      curatedPostId: z.number(),
      platformAccountId: z.number(),
      scheduledAt: z.date(),
      autoPublish: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "Database not available in local mode", postId: input.curatedPostId };

      await db.insert(scheduledPosts).values({
        curatedPostId: input.curatedPostId,
        platformAccountId: input.platformAccountId,
        scheduledAt: input.scheduledAt,
        status: "scheduled",
      });

      return {
        success: true,
        postId: input.curatedPostId,
      };
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  reschedulePost: protectedProcedure
    .input(z.object({
      scheduledPostId: z.number(),
      newScheduledAt: z.date(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "Database not available in local mode" };

      await db.update(scheduledPosts)
        .set({ scheduledAt: input.newScheduledAt })
        .where(eq(scheduledPosts.id, input.scheduledPostId));

      return { success: true };
    }),
  createDirectPost: protectedProcedure
    .input(z.object({
      platformAccountId: z.number(),
      content: z.string().min(1).max(5000),
      scheduledAt: z.date(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "Database unavailable in offline mode" };

      const [{ id: newCuratedId }] = await db.insert(curatedPosts).values({
        platform: "direct",
        content: input.content,
        status: "approved",
      }).$returningId();

      await db.insert(scheduledPosts).values({
        curatedPostId: newCuratedId,
        platformAccountId: input.platformAccountId,
        scheduledAt: input.scheduledAt,
        status: "scheduled",
      });

      return { success: true };
    }),
  cancelPost: protectedProcedure
    .input(z.object({ scheduledPostId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { success: false };

      await db.update(scheduledPosts)
        .set({ status: "cancelled" })
        .where(eq(scheduledPosts.id, input.scheduledPostId));

      return { success: true };
    }),
});
