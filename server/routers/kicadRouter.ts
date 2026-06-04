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
import os from "os";
import path from "path";

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

  /** Export schematic to PDF/SVG/DXF */
  exportSchematic: publicProcedure
    .input(kicadSchematicExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.kicad.exportSchematic(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export PCB to Gerber files */
  exportGerbers: publicProcedure
    .input(kicadGerberExportSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.kicad.exportGerbers(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Run Design Rule Check on PCB */
  runDRC: publicProcedure
    .input(kicadDRCSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.kicad.runDRC(input.pcbPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Run Electrical Rule Check on schematic */
  runERC: publicProcedure
    .input(kicadERCSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.kicad.runERC(input.schematicPath);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export PCB to 3D STEP file */
  exportSTEP: publicProcedure
    .input(
      z.object({
        inputFile: z.string().min(1),
        outputFile: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.kicad.exportSTEP(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Export Bill of Materials (BOM) from schematic */
  exportBOM: publicProcedure
    .input(kicadBOMSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.kicad.generateBOM(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  getQuote: protectedProcedure
    .input(z.object({ pcbPath: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return PCBWayService.getInstance().getQuote(input.pcbPath);
    }),

  exportForManufacturing: protectedProcedure
    .input(z.object({ pcbPath: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const gerberDir = path.join(os.tmpdir(), "omnecor_gerbers");
      return ctx.services.kicad.exportGerbers({ inputFile: input.pcbPath, outputDir: gerberDir });
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
      });
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
      }).catch(() => {});
      return PCBWayService.getInstance().placeOrder(input.quoteId, input.shippingAddress);
    }),
});
