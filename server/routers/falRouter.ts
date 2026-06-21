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
import { router, publicProcedure, protectedProcedure, cloudProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// In-Process Image Gallery
// Persists generated images for the lifetime of the server process.
// Capped at 100 entries (oldest evicted first).
// ---------------------------------------------------------------------------

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  createdAt: string;
}

const IMAGE_GALLERY_CAP = 100;
const imageGallery: GeneratedImage[] = [];

function addToGallery(img: GeneratedImage): void {
  imageGallery.unshift(img);
  if (imageGallery.length > IMAGE_GALLERY_CAP) imageGallery.length = IMAGE_GALLERY_CAP;
}

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
  /** List previously generated images (most recent first, process-lifetime). */
  listImages: protectedProcedure.query(async (): Promise<GeneratedImage[]> => {
    return imageGallery;
  }),

  /** Generate an image via the Fal.ai Flux endpoint and add to the gallery. */
  generateImage: cloudProcedure
    .input(z.object({ prompt: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<GeneratedImage> => {
      try {
        const url = await ctx.services.fal.generateCharacter(input.prompt);
        const img: GeneratedImage = {
          id: Date.now().toString(),
          url,
          prompt: input.prompt,
          createdAt: new Date().toISOString(),
        };
        addToGallery(img);
        return img;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Image generation failed: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Generate a character image using Flux/Fal.ai.
   */
  generateCharacter: cloudProcedure
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
  generateVideo: cloudProcedure
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
