import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { scheduledPosts, curatedPosts, platformAccounts } from "../../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { publishScheduledPostIds } from "../phase2/services/publishExecutor.js";

export const schedulingRouter = router({
  listScheduledPosts: protectedProcedure
    .input(z.object({
      projectId: z.string().optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const conditions = [];
      if (input.projectId) {
        conditions.push(eq(scheduledPosts.projectId, input.projectId));
      }
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
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(scheduledPosts.scheduledAt))
        .limit(input.limit);
      return posts;
    }),
  schedulePost: protectedProcedure
    .input(z.object({
      curatedPostId: z.number(),
      platformAccountId: z.number(),
      scheduledAt: z.date(),
      autoPublish: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();

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
  reschedulePost: protectedProcedure
    .input(z.object({
      scheduledPostId: z.number(),
      newScheduledAt: z.date(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();

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

      const [{ id: newCuratedId }] = await db.insert(curatedPosts).values({
        platform: "direct",
        content: input.content,
        status: "approved",
      }).returning({ id: curatedPosts.id });

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

      await db.update(scheduledPosts)
        .set({ status: "cancelled" })
        .where(eq(scheduledPosts.id, input.scheduledPostId));

      return { success: true };
    }),
  retryPost: protectedProcedure
    .input(z.object({ scheduledPostId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      // Verify the post exists and belongs to the calling user (ownership flows
      // through the connected platform account → platformAccounts.userId).
      const [post] = await db
        .select({
          id: scheduledPosts.id,
          ownerId: platformAccounts.userId,
        })
        .from(scheduledPosts)
        .leftJoin(platformAccounts, eq(platformAccounts.id, scheduledPosts.platformAccountId))
        .where(eq(scheduledPosts.id, input.scheduledPostId))
        .limit(1);

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scheduled post not found" });
      }
      if (post.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This post does not belong to you" });
      }

      // Reset to scheduled + clear the prior error, then publish immediately
      // (publishScheduledPostIds writes the real published/failed outcome back).
      await db
        .update(scheduledPosts)
        .set({ status: "scheduled", errorMessage: null })
        .where(eq(scheduledPosts.id, input.scheduledPostId));

      const [outcome] = await publishScheduledPostIds([input.scheduledPostId]);
      const ok = !!outcome?.ok;
      const rescheduled = !ok && !!outcome?.rateLimited;
      return {
        success: ok || rescheduled,
        status: ok ? "published" : rescheduled ? "rescheduled" : "failed",
        retryAt: outcome?.retryAt,
      };
    }),
  publishNow: protectedProcedure
    .input(z.object({ postIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      // Actually publish to the connected platforms (X/LinkedIn/Facebook/IG),
      // writing real outcomes (published/failed + platformPostId/errorMessage).
      const outcomes = await publishScheduledPostIds(input.postIds);
      const published = outcomes.filter((o) => o.ok);
      const rescheduled = outcomes.filter((o) => !o.ok && o.rateLimited);
      const failed = outcomes.filter((o) => !o.ok && !o.rateLimited);
      return {
        // Rate-limited posts are auto-rescheduled, not failures.
        success: failed.length === 0,
        publishedCount: published.length,
        rescheduledCount: rescheduled.length,
        failedCount: failed.length,
        results: outcomes,
      };
    }),
});
