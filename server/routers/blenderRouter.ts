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
import { PATHS } from "../_core/paths.js";
import { PYTHON_SCRIPTS } from "../phase2/config/index.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

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
  /** When true, write the export into the shared model library so the 3D viewers can load it. */
  toLibrary: z.boolean().optional(),
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

  /**
   * Open a .blend file (or a blank scene) in the Blender GUI as a detached process.
   * The spawned Blender process is independent of the server and persists after the
   * response is sent.
   */
  openFile: protectedProcedure
    .input(z.object({ filePath: z.string().optional() }))
    .mutation(async ({ input }) => {
      const blenderBin: string = PYTHON_SCRIPTS.blenderBin;
      const args: string[] = input.filePath ? [input.filePath] : [];

      const proc = spawn(blenderBin, args, {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      if (proc.pid === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to launch Blender GUI — is Blender installed?",
        });
      }

      return { success: true, pid: proc.pid, file: input.filePath ?? null };
    }),

  /** Export a .blend file to another format (GLB, FBX, OBJ, STL) */
  export: protectedProcedure
    .input(blenderExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedBlend = await validatePath(input.blendFile);
        // When toLibrary is set, force the output into the shared model library
        // (basename only) so it's immediately listable + servable to the viewers.
        const outputPath = input.toLibrary
          ? path.join(PATHS.models, path.basename(input.outputPath))
          : input.outputPath;
        const jobId = await ctx.services.blender.exportFile(
          validatedBlend,
          outputPath
        );
        return { success: true, jobId, outputPath };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /**
   * List 3D models (.glb/.gltf) in the shared model library. Each entry includes
   * a range-capable HTTP URL the three.js viewers (desktop + mobile) can load.
   */
  listModels: protectedProcedure.query(async () => {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(PATHS.models);
    } catch {
      return []; // library dir not created yet — no models
    }
    const models = await Promise.all(
      entries
        .filter((f) => /\.(glb|gltf)$/i.test(f))
        .map(async (name) => {
          let size = 0;
          try {
            size = (await fs.stat(path.join(PATHS.models, name))).size;
          } catch { /* ignore stat failure */ }
          return { name, url: `/media/model/${encodeURIComponent(name)}`, size };
        })
    );
    return models.sort((a, b) => a.name.localeCompare(b.name));
  }),
});
