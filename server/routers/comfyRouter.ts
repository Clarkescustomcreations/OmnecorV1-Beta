/**
 * @file routers/comfyRouter.ts
 * @description Omnecor — ComfyUI Bridge tRPC Router
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";

export const comfyRouter = router({
  /**
   * Queue a prompt/workflow to ComfyUI
   */
  queuePrompt: protectedProcedure
    .input(z.object({
      prompt: z.record(z.string(), z.unknown()),
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
  getQueue: protectedProcedure.query(async ({ ctx }) => {
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
  getSystemStats: protectedProcedure.query(async ({ ctx }) => {
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
  interrupt: protectedProcedure.mutation(async ({ ctx }) => {
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
  clearQueue: protectedProcedure.mutation(async ({ ctx }) => {
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
