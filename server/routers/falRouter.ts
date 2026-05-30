/**
 * @file routers/falRouter.ts
 * @description Omnecor — Fal.ai (OpenArt) AI Bridge tRPC Router
 *
 * Exposes tRPC endpoints for:
 *  - Character generation (Flux)
 *  - Video cloning (MiniMax Subject Reference)
 *
 * Architecture Notes:
 *  - Routes requests to the Python-based `fal_bridge.py` service.
 *  - Follows the standardized `ctx.services.fal` service pattern.
 *
 * UNIFIED: This router imports from the main _core/trpc.ts stack.
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const generateCharacterSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  loraPath: z.string().optional(),
});

const generateVideoSchema = z.object({
  imageUrl: z.string().min(1, "Character image URL is required"),
  prompt: z.string().min(1, "Video prompt is required"),
});

// ---------------------------------------------------------------------------
// Router Definition
// ---------------------------------------------------------------------------

export const falRouter = router({
  /**
   * Stub for listing generated images.
   */
  listImages: publicProcedure.query(async () => {
    return [];
  }),

  /**
   * Stub for generating an image.
   */
  generateImage: publicProcedure
    .input(z.object({ prompt: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Stub implementation
      return { id: Date.now().toString(), url: "", prompt: input.prompt };
    }),

  /**
   * Generate a character image using Flux/Fal.ai.
   */
  generateCharacter: publicProcedure
    .input(generateCharacterSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.fal.generateCharacter(
          input.prompt,
          input.loraPath
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Character generation failed: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Generate a video clone from a character image and prompt using MiniMax/Fal.ai.
   */
  generateVideo: publicProcedure
    .input(generateVideoSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.fal.generateVideo(
          input.imageUrl,
          input.prompt
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Video generation failed: ${(error as Error).message}`,
        });
      }
    }),
});
