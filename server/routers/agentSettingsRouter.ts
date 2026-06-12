import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { postingScheduleConfig } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const agentSettingsRouter = router({
  getScheduleConfig: protectedProcedure
    .input(z.object({ platform: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const conditions = input.platform
        ? and(eq(postingScheduleConfig.userId, ctx.user.id), eq(postingScheduleConfig.platform, input.platform))
        : eq(postingScheduleConfig.userId, ctx.user.id);

      const configs = await db.select()
        .from(postingScheduleConfig)
        .where(conditions);

      return configs;
    }),
  updateScheduleConfig: protectedProcedure
    .input(z.object({
      platform: z.string(),
      postsPerDay: z.number().optional(),
      autoApprove: z.number().optional(),
      optimalPostingTimes: z.array(z.string()).optional(),
      timezone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "Database not available" };
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const existing = await db.select()
        .from(postingScheduleConfig)
        .where(and(
          eq(postingScheduleConfig.userId, ctx.user.id),
          eq(postingScheduleConfig.platform, input.platform)
        ))
        .limit(1);

      if (existing.length) {
        await db.update(postingScheduleConfig)
          .set({
            ...(input.postsPerDay !== undefined && { postsPerDay: input.postsPerDay }),
            ...(input.autoApprove !== undefined && { autoApprove: input.autoApprove }),
            ...(input.optimalPostingTimes && { optimalPostingTimes: input.optimalPostingTimes }),
            ...(input.timezone && { timezone: input.timezone }),
          })
          .where(and(
            eq(postingScheduleConfig.userId, ctx.user.id),
            eq(postingScheduleConfig.platform, input.platform)
          ));
      } else {
        await db.insert(postingScheduleConfig).values({
          userId: ctx.user.id,
          platform: input.platform,
          postsPerDay: input.postsPerDay || 1,
          autoApprove: input.autoApprove || 0,
          optimalPostingTimes: input.optimalPostingTimes,
          timezone: input.timezone || "UTC",
        });
      }

      return { success: true };
    }),
});
