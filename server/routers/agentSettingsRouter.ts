import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { postingScheduleConfig } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const agentSettingsRouter = router({
  getScheduleConfig: protectedProcedure
    .input(z.object({ platform: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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
      optimalPostingTimes: z.any().optional(),
      timezone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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

  updateBotTheme: protectedProcedure
    .input(z.object({ theme: z.string() }))
    .mutation(async () => {
      // Placeholder: Store theme in settings or env
      // For now, just return success
      return { success: true };
    }),

  updateDiscoveryKeywords: protectedProcedure
    .input(z.object({ keywords: z.array(z.string()) }))
    .mutation(async () => {
      // Placeholder: Store keywords for discovery process
      // For now, just return success
      return { success: true };
    }),
});
