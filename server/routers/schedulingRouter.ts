import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { scheduledPosts, curatedPosts, platformAccounts } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const schedulingRouter = router({
  listScheduledPosts: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const posts = await db.select()
        .from(scheduledPosts)
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(scheduledPosts)
        .set({ scheduledAt: input.newScheduledAt })
        .where(eq(scheduledPosts.id, input.scheduledPostId));

      return { success: true };
    }),

  cancelPost: protectedProcedure
    .input(z.object({ scheduledPostId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(scheduledPosts)
        .set({ status: "cancelled" })
        .where(eq(scheduledPosts.id, input.scheduledPostId));

      return { success: true };
    }),
});
