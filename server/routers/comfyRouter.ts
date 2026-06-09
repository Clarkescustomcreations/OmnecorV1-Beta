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
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
