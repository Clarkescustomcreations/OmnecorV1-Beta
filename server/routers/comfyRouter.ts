/**
 * @file routers/comfyRouter.ts
 * @description Omnecor — ComfyUI Bridge tRPC Router
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { registerModelAsset } from "../db-models.js";
import path from "path";

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

  /**
   * Fetch the execution history for a queued prompt (raw ComfyUI payload).
   * Also surfaces the mesh outputs this prompt produced so the UI can decide
   * whether a "Save to 3D Library" action is available.
   */
  getHistory: protectedProcedure
    .input(z.object({ promptId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        const history = await ctx.services.comfy.getHistory(input.promptId);
        const meshOutputs = await ctx.services.comfy.listMeshOutputs(input.promptId);
        const done = Boolean(history?.[input.promptId]?.outputs);
        return { history, meshOutputs, meshCount: meshOutputs.length, done };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error).message,
        });
      }
    }),

  /**
   * Persist every glTF/GLB mesh a completed prompt produced into the shared 3D
   * model library so the desktop + mobile viewers can load it. Returns the saved
   * models (name/url/size). Throws NOT_FOUND if the prompt produced no meshes.
   */
  saveMeshToLibrary: protectedProcedure
    .input(
      z.object({
        promptId: z.string().min(1),
        /** Associate the saved mesh(es) with a neural map (null/omitted = global). */
        mapId: z.string().nullish(),
        /** Optionally link the mesh(es) to a specific PCB/schematic design project. */
        designProjectId: z.number().int().nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let saved;
      try {
        saved = await ctx.services.comfy.saveMeshesToLibrary(input.promptId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (error as Error).message,
        });
      }
      if (saved.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No 3D mesh (.glb/.gltf) found in this ComfyUI job's outputs. Use a workflow with a SaveGLB / mesh-export node.",
        });
      }
      // Record the map/PCB association for each saved mesh so it shows up in the
      // right project and the assistant can see it alongside the board.
      for (const mesh of saved) {
        const ext = path.extname(mesh.name).toLowerCase();
        await registerModelAsset({
          userId: ctx.user.id,
          fileName: mesh.name,
          name: path.basename(mesh.name, ext),
          format: ext === ".gltf" ? "gltf" : "glb",
          size: mesh.size,
          source: "comfy",
          mapId: input.mapId ?? null,
          designProjectId: input.designProjectId ?? null,
        });
      }
      return { saved, count: saved.length };
    }),
});
