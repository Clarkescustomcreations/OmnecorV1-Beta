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
import { publicProcedure, router } from "../_core/trpc.js";
import { honchoService } from "../phase2/services/HonchoService.js";

// All Honcho procedures use publicProcedure so they work in zero-login mode
// (the openId is provided by the client, which already knows its identity from
// the auth.me query or the zero-login sentinel).

export const honchoRouter = router({
  /** Sync one message to Honcho (fire-and-forget from the client). */
  addMessage: publicProcedure
    .input(z.object({
      openId: z.string().min(1).max(256),
      sessionId: z.string().min(1).max(256),
      role: z.enum(["user", "ai"]),
      content: z.string().max(200_000),
    }))
    .mutation(async ({ input }) => {
      await honchoService.addMessage(input.openId, input.sessionId, input.role, input.content);
      return { ok: true };
    }),

  /** Persist a /btw note as a long-term fact. */
  addFact: publicProcedure
    .input(z.object({
      openId: z.string().min(1).max(256),
      content: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input }) => {
      await honchoService.addFact(input.openId, input.content);
      return { ok: true };
    }),

  /** Retrieve recent facts to prepend to the system prompt. */
  getFacts: publicProcedure
    .input(z.object({
      openId: z.string().min(1).max(256),
      limit: z.number().int().min(1).max(50).optional(),
    }))
    .query(async ({ input }) => {
      return honchoService.getFacts(input.openId, input.limit ?? 20);
    }),
});
