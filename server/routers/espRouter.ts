/**
 * @file server/routers/espRouter.ts
 * @description Omnecor — ESP Microcontroller Integration tRPC Router
 *
 * Exposes esptool operations (detection, flashing, erasing, reading).
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";

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
  detectPorts: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.esp.detectPorts();
  }),

  /** Get chip information from connected device */
  getChipInfo: publicProcedure
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
  flash: publicProcedure
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
  erase: publicProcedure
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
  read: publicProcedure
    .input(
      z.object({
        port: z.string().min(1),
        outputFile: z.string().min(1),
        size: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const jobId = await ctx.services.esp.readFlash(input);
        return { success: true, jobId };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
    }),
});
