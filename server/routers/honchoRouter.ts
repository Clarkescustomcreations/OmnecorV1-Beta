/**
 * @file server/routers/honchoRouter.ts
 * @description Omnecor — Honcho Memory tRPC Router
 *
 * Exposes the HonchoService via tRPC so the Chat frontend can:
 *   - Sync messages to persistent session memory
 *   - Store /btw facts for long-term retention
 *   - Retrieve facts to inject into the system prompt
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { honchoService } from "../phase2/services/HonchoService.js";

export const honchoRouter = router({
  /** Sync one message to Honcho (fire-and-forget from the client). */
  addMessage: protectedProcedure
    .input(z.object({
      openId: z.string().min(1).max(256),
      sessionId: z.string().min(1).max(256),
      role: z.enum(["user", "ai"]),
      content: z.string().max(200_000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.openId !== input.openId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "openId mismatch" });
      }
      await honchoService.addMessage(input.openId, input.sessionId, input.role, input.content);
      return { ok: true };
    }),

  /** Persist a /btw note as a long-term fact. */
  addFact: protectedProcedure
    .input(z.object({
      openId: z.string().min(1).max(256),
      content: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.openId !== input.openId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "openId mismatch" });
      }
      await honchoService.addFact(input.openId, input.content);
      return { ok: true };
    }),

  /** Retrieve recent facts to prepend to the system prompt. */
  getFacts: protectedProcedure
    .input(z.object({
      openId: z.string().min(1).max(256),
      limit: z.number().int().min(1).max(50).optional(),
    }))
    .query(async ({ input, ctx }) => {
      if (ctx.user.openId !== input.openId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "openId mismatch" });
      }
      return honchoService.getFacts(input.openId, input.limit ?? 20);
    }),
});
