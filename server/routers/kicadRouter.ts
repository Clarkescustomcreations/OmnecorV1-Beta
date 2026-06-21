/**
 * @file server/routers/kicadRouter.ts
 * @description Omnecor — KiCad Integration tRPC Router
 *
 * Exposes KiCad PCB and schematic operations (DRC, ERC, Exports, BOM).
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { PCBWayService } from "../phase2/services/PCBWayService.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";
import { AuditLogService } from "../phase2/services/AuditLogService.js";
import { validatePath } from "../_core/security.js";
import { createLogger } from "../_core/logger.js";
import os from "os";
const log = createLogger("kicadRouter");
import path from "path";
import { spawn } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const kicadSchematicExportSchema = z.object({
  inputFile: z.string().min(1),
  outputDir: z.string().min(1),
  format: z.enum(["pdf", "svg", "dxf", "hpgl", "ps"]),
  pages: z.string().optional(),
});

const kicadGerberExportSchema = z.object({
  inputFile: z.string().min(1),
  outputDir: z.string().min(1),
  layers: z.array(z.string()).optional(),
});

const kicadDRCSchema = z.object({
  pcbPath: z.string().min(1),
});

const kicadERCSchema = z.object({
  schematicPath: z.string().min(1),
});

const kicadBOMSchema = z.object({
  inputFile: z.string().min(1),
  outputFile: z.string().min(1),
  format: z.enum(["csv", "xml"]).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const kicadRouter = router({
  /** Check KiCad installation status */
  status: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.kicad.checkInstallation();
  }),

  /**
   * Open a KiCad project/PCB/schematic file in the KiCad GUI as a detached process.
   * Accepts .kicad_pro, .kicad_pcb, or .kicad_sch files — or launches KiCad empty.
   * The spawned KiCad process is independent of the server and persists after response.
   */
  openProject: protectedProcedure
    .input(z.object({ filePath: z.string().optional() }))
    .mutation(async ({ input }) => {
      const kicadBin = process.env.KICAD_BIN || "kicad";
      const validatedPath = input.filePath ? await validatePath(input.filePath) : undefined;
      const args: string[] = validatedPath ? [validatedPath] : [];

      if (validatedPath) {
        const ext = path.extname(validatedPath).toLowerCase();
        const allowed = [".kicad_pro", ".kicad_pcb", ".kicad_sch"];
        if (!allowed.includes(ext)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid file type: ${ext}. KiCad accepts: ${allowed.join(", ")}`,
          });
        }
      }

      const proc = spawn(kicadBin, args, {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      if (proc.pid === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to launch KiCad GUI — is KiCad installed?",
        });
      }

      return { success: true, pid: proc.pid, file: validatedPath ?? null };
    }),

  /** Export schematic to PDF/SVG/DXF */
  exportSchematic: protectedProcedure
    .input(kicadSchematicExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedInput = await validatePath(input.inputFile);
        const validatedOutput = await validatePath(input.outputDir);
        return await ctx.services.kicad.exportSchematic({
          ...input,
          inputFile: validatedInput,
          outputDir: validatedOutput,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export PCB to Gerber files */
  exportGerbers: protectedProcedure
    .input(kicadGerberExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedInput = await validatePath(input.inputFile);
        const validatedOutput = await validatePath(input.outputDir);
        return await ctx.services.kicad.exportGerbers({
          ...input,
          inputFile: validatedInput,
          outputDir: validatedOutput,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Run Design Rule Check on PCB */
  runDRC: protectedProcedure
    .input(kicadDRCSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedPcb = await validatePath(input.pcbPath);
        return await ctx.services.kicad.runDRC(validatedPcb);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Run Electrical Rule Check on schematic */
  runERC: protectedProcedure
    .input(kicadERCSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedSchematic = await validatePath(input.schematicPath);
        return await ctx.services.kicad.runERC(validatedSchematic);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export PCB to 3D STEP file */
  exportSTEP: protectedProcedure
    .input(
      z.object({
        inputFile: z.string().min(1),
        outputFile: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedInput = await validatePath(input.inputFile);
        const validatedOutput = await validatePath(input.outputFile);
        return await ctx.services.kicad.exportSTEP({
          inputFile: validatedInput,
          outputFile: validatedOutput,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export Bill of Materials (BOM) from schematic */
  exportBOM: protectedProcedure
    .input(kicadBOMSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const validatedInput = await validatePath(input.inputFile);
        const validatedOutput = await validatePath(input.outputFile);
        return await ctx.services.kicad.generateBOM({
          ...input,
          inputFile: validatedInput,
          outputFile: validatedOutput,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),
  downloadBOM: protectedProcedure
    .input(z.object({ outputFile: z.string().default("bom.csv") }))
    .query(async ({ input }) => {
      try {
        const safePath = path.resolve(process.cwd(), path.basename(input.outputFile));
        const fs = await import("fs/promises");
        const content = await fs.readFile(safePath, "utf-8");
        return { content, filename: path.basename(input.outputFile) };
      } catch {
        return { content: null as string | null, filename: path.basename(input.outputFile) };
      }
    }),
  getQuote: protectedProcedure
    .input(z.object({ pcbPath: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const validatedPcb = await validatePath(input.pcbPath);
      return PCBWayService.getInstance().getQuote(validatedPcb);
    }),
  exportForManufacturing: protectedProcedure
    .input(z.object({ pcbPath: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const validatedPcb = await validatePath(input.pcbPath);
      const gerberDir = path.join(os.tmpdir(), "omnecor_gerbers");
      return ctx.services.kicad.exportGerbers({ inputFile: validatedPcb, outputDir: gerberDir });
    }),
  placeOrder: protectedProcedure
    .input(z.object({
      quoteId: z.string().min(1),
      shippingAddress: z.object({
        name: z.string(),
        address: z.string(),
        city: z.string(),
        country: z.string(),
        zipCode: z.string(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const approved = await HITLApprovalService.getInstance().requestApproval("kicad.placeOrder", {
        quoteId: input.quoteId,
        riskLevel: "high",
      }, "financial");
      if (!approved) throw new TRPCError({ code: "FORBIDDEN", message: "HITL approval denied for PCBWay order." });
      AuditLogService.getInstance().log({
        eventType: "pcbway_order_placed",
        actorId: ctx.user!.id,
        actorType: "user",
        procedure: "kicad.placeOrder",
        args: { quoteId: input.quoteId },
        result: null,
        ipAddress: ctx.req.ip ?? null,
        sessionId: null,
      }).catch((err) => log.error("[AuditLog] write failed — event lost", err));
      return PCBWayService.getInstance().placeOrder(input.quoteId, input.shippingAddress);
    }),
});
