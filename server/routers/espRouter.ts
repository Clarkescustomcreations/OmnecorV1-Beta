/**
 * @file server/routers/espRouter.ts
 * @description Omnecor — ESP Microcontroller Integration tRPC Router
 *
 * Exposes esptool operations (detection, flashing, erasing, reading).
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";

// ─────────────────────────────────────────────────────────────────────────────
// Input Schemas
// ─────────────────────────────────────────────────────────────────────────────

const espFlashSchema = z.object({
  port: z.string().min(1),
  firmwarePath: z.string().min(1),
  baud: z.number().int().min(9600).max(4000000).optional(),
  chip: z
    .enum(["esp32", "esp32s2", "esp32s3", "esp32c3", "esp8266"])
    .optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const espRouter = router({
  /** Check esptool installation status */
  status: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.esp.checkInstallation();
  }),

  /** Detect connected serial ports */
  detectPorts: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.esp.detectPorts();
  }),

  /** Get chip information from connected device */
  getChipInfo: protectedProcedure
    .input(z.object({ port: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.esp.getChipInfo(input.port);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Flash firmware to ESP device */
  flash: protectedProcedure
    .input(espFlashSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await ctx.services.esp.flashFirmware(input);
        return { success: true, jobId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Erase ESP flash memory */
  erase: protectedProcedure
    .input(z.object({ port: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await ctx.services.esp.eraseFlash(input.port);
        return { success: true, jobId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),

  /** Read ESP flash memory to a file */
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  read: protectedProcedure
    .input(
      z.object({
        port: z.string().min(1),
        outputFile: z.string().min(1),
        size: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const safeOutputFile = await validatePath(input.outputFile);
        const jobId = await ctx.services.esp.readFlash({ ...input, outputFile: safeOutputFile });
        return { success: true, jobId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),
});
