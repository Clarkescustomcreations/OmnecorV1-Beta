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
import { router, protectedProcedure, externalServiceProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { VirtualCardService, CardOperationError, type LithicTransaction } from "../core_services/services/VirtualCardService.js";
import { HITLApprovalService } from "../core_services/services/HITLApprovalService.js";
import { createLogger } from "../_core/logger.js";
import { getDb } from "../db.factory.js";
import { virtualCards } from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";

const log = createLogger("VirtualCard");

// In-memory rate limiter: userId → last issuance timestamp
const issuanceRateMap = new Map<number, number>();
const RATE_LIMIT_MS = 60_000; // 1 card per 60 seconds per user

const issueCardSchema = z.object({
  spendLimitDollars: z.number().min(1).max(1000),
  memo: z.string().max(100).optional(),
  projectId: z.string().optional(),
});

export const virtualCardRouter = router({
  /** Check if the virtual card provider is configured. */
  isConfigured: protectedProcedure.query(() => {
    return VirtualCardService.getInstance().isConfigured();
  }),

  /** Get card metadata from local DB (no PAN — safe for display). */
  getCard: protectedProcedure
    .input(z.object({ cardToken: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(virtualCards)
        .where(and(eq(virtualCards.token, input.cardToken), eq(virtualCards.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
      return {
        token: row.token,
        lastFour: row.lastFour,
        expMonth: row.expMonth,
        expYear: row.expYear,
        status: row.status,
        spendLimitCents: row.spendLimitCents,
        memo: row.memo,
      };
    }),

  /** Decrypt and return the full PAN for display (short-lived, never logged). */
  revealCardPan: externalServiceProcedure
    .input(z.object({ cardToken: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const service = VirtualCardService.getInstance();
      const pan = await service.revealPan(input.cardToken, ctx.user.id);
      if (!pan) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found or provider not configured" });
      return { pan };
    }),

  /** List the 25 most-recent transactions for a card via the Lithic API. */
  listTransactions: externalServiceProcedure
    .input(z.object({ cardToken: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const service = VirtualCardService.getInstance();
      const transactions: LithicTransaction[] = await service.listTransactions(input.cardToken, ctx.user.id);
      return transactions;
    }),

  /** List issued virtual cards for the user. */
  listCards: protectedProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      // Never return encryptedCredentials / ivHex / authTagHex — the encrypted
      // PAN blob must never leave the server. Project safe columns only.
      const safeColumns = {
        id: virtualCards.id,
        token: virtualCards.token,
        projectId: virtualCards.projectId,
        memo: virtualCards.memo,
        lastFour: virtualCards.lastFour,
        expMonth: virtualCards.expMonth,
        expYear: virtualCards.expYear,
        spendLimitCents: virtualCards.spendLimitCents,
        status: virtualCards.status,
        createdAt: virtualCards.createdAt,
        updatedAt: virtualCards.updatedAt,
      } as const;
      if (input.projectId) {
        return db
          .select(safeColumns)
          .from(virtualCards)
          .where(
            and(
              eq(virtualCards.userId, ctx.user.id),
              eq(virtualCards.projectId, input.projectId)
            )
          );
      }
      return db
        .select(safeColumns)
        .from(virtualCards)
        .where(eq(virtualCards.userId, ctx.user.id));
    }),

  /** Issue a virtual card. Rate-limited to 1/60s per user. Requires LITHIC_API_KEY. */
  issueCard: externalServiceProcedure
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

      // HITL approval gate — suspend until a human approves or rejects.
      // The procedure blocks here until an administrator responds, or until the
      // 5-minute timeout fires (auto-reject). No card is issued without approval.
      log.info(`User ${userId} requesting card issuance approval — $${input.spendLimitDollars} limit`);

      const hitl = HITLApprovalService.getInstance();
      const approved = await Promise.race([
        hitl.requestApproval("virtualCard.issueCard", {
          userId,
          spendLimitDollars: input.spendLimitDollars,
          memo: input.memo,
          riskNote:
            "This action issues a real virtual credit card charged against the Lithic account.",
        }, "financial"),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5 * 60 * 1000)
        ),
      ]).catch((err: unknown) => {
        if (err instanceof Error && err.message === "timeout") {
          throw new TRPCError({
            code: "TIMEOUT",
            message: "Card issuance approval timed out after 5 minutes.",
          });
        }
        throw err;
      });

      if (!approved) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Card issuance rejected by administrator.",
        });
      }

      log.info(`Card issuance approved for user ${userId} — $${input.spendLimitDollars} limit`);

      const spendLimitCents = Math.round(input.spendLimitDollars * 100);
      let card;
      try {
        card = await service.issueCard({
          spendLimitCents,
          memo: input.memo,
          userId: String(userId),
          projectId: input.projectId,
        });
      } catch (err) {
        // CardOperationError carries only a safe, redacted message (the raw
        // processor response was already logged internally). Never leak details.
        if (err instanceof CardOperationError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: err.message });
        }
        throw err;
      }

      // Record issuance timestamp for rate limiting
      issuanceRateMap.set(userId, Date.now());

      return {
        configured: true,
        card,
        message: card ? "Virtual card issued successfully." : "Card issuance failed — check Lithic configuration.",
      };
    }),
});
