/**
 * @file routers/comfyRouter.ts
 * @description Omnecor — ComfyUI Bridge tRPC Router
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";

export const comfyRouter = router({
  /**
   * Queue a prompt/workflow to ComfyUI
   */
  queuePrompt: publicProcedure
    .input(z.object({
      prompt: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.comfy.queuePrompt(input.prompt);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error).message,
        });
      }
    }),

  /**
   * Get the current ComfyUI queue
   */
  getQueue: publicProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.services.comfy.getQueue();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: (error as Error).message,
      });
    }
  }),

  /**
   * Get ComfyUI system stats
   */
  getSystemStats: publicProcedure.query(async ({ ctx }) => {
    try {
      return await ctx.services.comfy.getSystemStats();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: (error as Error).message,
      });
    }
  }),

  /**
   * Interrupt current ComfyUI execution
   */
  interrupt: publicProcedure.mutation(async ({ ctx }) => {
    try {
      await ctx.services.comfy.interrupt();
      return { success: true };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: (error as Error).message,
      });
    }
  }),

  /**
   * Clear ComfyUI queue
   */
  clearQueue: publicProcedure.mutation(async ({ ctx }) => {
    try {
      await ctx.services.comfy.clearQueue();
      return { success: true };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: (error as Error).message,
      });
    }
  }),
});
