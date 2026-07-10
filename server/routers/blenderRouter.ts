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
import { PYTHON_SCRIPTS } from "../core_services/config/index.js";
import {
  registerModelAsset,
  listModelAssets,
  assignModelAsset,
  deleteModelAsset,
  getMapDesignContext,
} from "../db-models.js";
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
  /** Associate the exported model with a neural map (null/omitted = global). */
  mapId: z.string().nullish(),
  /** Optionally link the model to a specific PCB/schematic design project. */
  designProjectId: z.number().int().nullish(),
  /** Display name for the library entry (defaults to the file's basename). */
  name: z.string().optional(),
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
        const validatedOutput = input.outputPath
          ? await validatePath(input.outputPath)
          : undefined;
        const jobId = await ctx.services.blender.render(
          validatedBlend,
          validatedOutput,
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
      const validatedPath = input.filePath ? await validatePath(input.filePath) : undefined;
      const args: string[] = validatedPath ? [validatedPath] : [];

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

      return { success: true, pid: proc.pid, file: validatedPath ?? null };
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
        const validatedOutputPath = await validatePath(outputPath);
        const jobId = await ctx.services.blender.exportFile(
          validatedBlend,
          validatedOutputPath
        );
        // Register the library association up-front. The GLB is written by the
        // async Blender job; the row simply won't surface in listModels until the
        // file lands on disk, so there's no premature/broken entry.
        if (input.toLibrary) {
          const fileName = path.basename(validatedOutputPath);
          const ext = path.extname(fileName).toLowerCase();
          if (ext === ".glb" || ext === ".gltf") {
            await registerModelAsset({
              userId: ctx.user.id,
              fileName,
              name: input.name ?? path.basename(fileName, ext),
              format: ext === ".glb" ? "glb" : "gltf",
              source: "blender",
              mapId: input.mapId ?? null,
              designProjectId: input.designProjectId ?? null,
            });
          }
        }
        return { success: true, jobId, outputPath: validatedOutputPath };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /**
   * List 3D models (.glb/.gltf) in the shared model library. Each entry includes
   * a range-capable HTTP URL the three.js viewers (desktop + mobile) can load,
   * plus its association (mapId, linked PCB project, source). Files on disk with
   * no registry row are treated as global (mapId null).
   *
   * When `mapId` is provided, only that map's models plus global models are
   * returned — this is the real, FK-backed replacement for name-substring
   * matching, so a project's housing meshes stay scoped to the project.
   */
  listModels: protectedProcedure
    .input(z.object({ mapId: z.string().nullish() }).optional())
    .query(async ({ ctx, input }) => {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(PATHS.models);
      } catch {
        return []; // library dir not created yet — no models
      }
      // Association metadata for this user's models, keyed by fileName.
      const assets = await listModelAssets(ctx.user.id);
      const assetByFile = new Map(assets.map((a) => [a.fileName, a]));

      const models = await Promise.all(
        entries
          .filter((f) => /\.(glb|gltf)$/i.test(f))
          .map(async (fileName) => {
            let size = 0;
            try {
              size = (await fs.stat(path.join(PATHS.models, fileName))).size;
            } catch { /* ignore stat failure */ }
            const asset = assetByFile.get(fileName);
            return {
              // `name` stays the filename for backward compatibility (viewers key
              // on it); `displayName` is the friendly label.
              name: fileName,
              fileName,
              displayName: asset?.name ?? path.basename(fileName, path.extname(fileName)),
              url: `/media/model/${encodeURIComponent(fileName)}`,
              size,
              mapId: asset?.mapId ?? null,
              designProjectId: asset?.designProjectId ?? null,
              source: asset?.source ?? "upload",
            };
          })
      );

      const filterMapId = input?.mapId ?? null;
      const scoped = filterMapId
        ? models.filter((m) => m.mapId === filterMapId || m.mapId === null)
        : models;
      return scoped.sort((a, b) => a.name.localeCompare(b.name));
    }),

  /**
   * Re-assign a library model to a map and/or PCB design project (or clear
   * either). This is how a housing mesh gets bound to the board it encloses.
   */
  assignModel: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1),
        mapId: z.string().nullish(),
        designProjectId: z.number().int().nullish(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Reject anything that isn't a bare filename (no traversal).
      if (input.fileName !== path.basename(input.fileName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file name." });
      }
      const patch: { mapId?: string | null; designProjectId?: number | null; name?: string } = {};
      if ("mapId" in input) patch.mapId = input.mapId ?? null;
      if ("designProjectId" in input) patch.designProjectId = input.designProjectId ?? null;
      if (input.name !== undefined) patch.name = input.name;

      let updated = await assignModelAsset(ctx.user.id, input.fileName, patch);
      // If the file exists on disk but has no registry row yet (e.g. an older
      // upload), create one so the association sticks.
      if (!updated) {
        const full = path.join(PATHS.models, input.fileName);
        const exists = await fs.access(full).then(() => true).catch(() => false);
        if (!exists) throw new TRPCError({ code: "NOT_FOUND", message: "Model not found in library." });
        const ext = path.extname(input.fileName).toLowerCase();
        if (ext !== ".glb" && ext !== ".gltf") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Not a 3D model file." });
        }
        updated = await registerModelAsset({
          userId: ctx.user.id,
          fileName: input.fileName,
          name: input.name ?? path.basename(input.fileName, ext),
          format: ext === ".glb" ? "glb" : "gltf",
          source: "upload",
          mapId: input.mapId ?? null,
          designProjectId: input.designProjectId ?? null,
        });
      }
      return updated;
    }),

  /** Delete a model from the library — removes both the on-disk file and its row. */
  deleteModel: protectedProcedure
    .input(z.object({ fileName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (input.fileName !== path.basename(input.fileName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file name." });
      }
      await deleteModelAsset(ctx.user.id, input.fileName);
      await fs.unlink(path.join(PATHS.models, input.fileName)).catch(() => {});
      return { success: true };
    }),

  /**
   * Combined design context for a map: every linked 3D model plus the latest
   * PCB/schematic design of each of the map's projects, as structured data and a
   * ready-to-inject text summary. This is what lets the assistant see a project's
   * 3D housing and its board together.
   */
  getMapDesignContext: protectedProcedure
    .input(z.object({ mapId: z.string().nullish() }))
    .query(async ({ ctx, input }) => {
      return getMapDesignContext(ctx.user.id, input.mapId ?? null);
    }),
});
