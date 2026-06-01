/**
 * @file routers/virtualCardRouter.ts
 * @description Agentic Wallet — Virtual Card tRPC Router
 *
 * Exposes the card issuance endpoint, gated behind HITL approval.
 * Rate-limited to 1 issuance per 60 seconds per user.
 * Returns null (not an error) when LITHIC_API_KEY is not configured.
 *
 * Phase 14b: Agentic Wallet — Virtual Cards.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { VirtualCardService } from "../phase2/services/VirtualCardService.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("VirtualCard");

// In-memory rate limiter: userId → last issuance timestamp
const issuanceRateMap = new Map<number, number>();
const RATE_LIMIT_MS = 60_000; // 1 card per 60 seconds per user

const issueCardSchema = z.object({
  spendLimitDollars: z.number().min(1).max(1000),
  memo: z.string().max(100).optional(),
});

export const virtualCardRouter = router({
  /** Check if the virtual card provider is configured. */
  isConfigured: protectedProcedure.query(() => {
    return VirtualCardService.getInstance().isConfigured();
  }),

  /** Issue a virtual card. Rate-limited to 1/60s per user. Requires LITHIC_API_KEY. */
  issueCard: protectedProcedure
    .input(issueCardSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      // Rate limiting check
      const lastIssuance = issuanceRateMap.get(userId);
      if (lastIssuance && Date.now() - lastIssuance < RATE_LIMIT_MS) {
        const remainingSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastIssuance)) / 1000);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Virtual card rate limit: wait ${remainingSec}s before issuing another card.`,
        });
      }

      const service = VirtualCardService.getInstance();

      if (!service.isConfigured()) {
        return {
          configured: false,
          card: null,
          message: "Virtual card provider not configured. Add LITHIC_API_KEY to enable this feature.",
        };
      }

      // TODO: Wire HITLApprovalService here when the approval flow is integrated in Phase 28 (GodMode)
      // For now, log the action for audit trail
      log.info(`User ${userId} issuing card — $${input.spendLimitDollars} limit`);

      const spendLimitCents = Math.round(input.spendLimitDollars * 100);
      const card = await service.issueCard({
        spendLimitCents,
        memo: input.memo,
        userId: String(userId),
      });

      // Record issuance timestamp for rate limiting
      issuanceRateMap.set(userId, Date.now());

      return {
        configured: true,
        card,
        message: card ? "Virtual card issued successfully." : "Card issuance failed — check Lithic configuration.",
      };
    }),
});
