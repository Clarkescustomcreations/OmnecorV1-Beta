/**
 * @file server/routers/blenderRouter.ts
 * @description Omnecor — Blender Integration tRPC Router
 *
 * Exposes Blender headless operations (script execution, rendering, exports).
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const blenderScriptSchema = z.object({
  scriptPath: z.string().min(1),
  blendFile: z.string().optional(),
  outputDir: z.string().optional(),
  label: z.string().optional(),
});

const blenderRenderSchema = z.object({
  blendFile: z.string().optional(),
  outputPath: z.string().optional(),
  label: z.string().optional(),
});

const blenderExportSchema = z.object({
  blendFile: z.string().min(1),
  outputPath: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const blenderRouter = router({
  /** Check Blender installation status */
  status: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.blender.checkInstallation();
  }),

  /** Execute a Python script inside Blender's headless environment */
  executeScript: protectedProcedure
    .input(blenderScriptSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedPath = await validatePath(input.scriptPath);
        const jobId = await ctx.services.blender.executeScript({
          ...input,
          scriptPath: validatedPath,
        });
        return { success: true, jobId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Render the current Blender scene to an image file */
  render: protectedProcedure
    .input(blenderRenderSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedBlend = input.blendFile
          ? await validatePath(input.blendFile)
          : undefined;
        const jobId = await ctx.services.blender.render(
          validatedBlend,
          input.outputPath,
          input.label
        );
        return {
          success: true,
          jobId,
          wsChannel: `hardware:${jobId}`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export a .blend file to another format (GLB, FBX, OBJ, STL) */
  export: protectedProcedure
    .input(blenderExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedBlend = await validatePath(input.blendFile);
        const jobId = await ctx.services.blender.exportFile(
          validatedBlend,
          input.outputPath
        );
        return { success: true, jobId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),
});
