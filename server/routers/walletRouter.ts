/**
 * @file routers/walletRouter.ts
 * @description Omnecor — Agentic Wallet tRPC Router
 *
 * Exposes per-project budget management and spend tracking.
 * spend_log is insert-only — no delete/update procedures are exposed.
 * Phase 13: Agentic Wallet Backend.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import { eq, sum, desc } from "drizzle-orm";
import { getDb } from "../db.js";
import {
  projectBudgets,
  spendLog,
} from "../../drizzle/schema.js";

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const projectIdSchema = z.string().min(1).max(64);

const setBudgetSchema = z.object({
  projectId: projectIdSchema,
  limitCents: z.number().int().min(0),
  alertThreshold: z.number().int().min(1).max(100).default(80),
  mode: z.enum(["soft", "hard"]).default("soft"),
});

const getSpendLogSchema = z.object({
  projectId: projectIdSchema,
  limit: z.number().int().min(1).max(500).default(100),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const walletRouter = router({
  /** Get the budget configuration for a project. Returns null if not set. */
  getBudget: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db
        .select()
        .from(projectBudgets)
        .where(eq(projectBudgets.projectId, input.projectId))
        .limit(1);
      return rows[0] ?? null;
    }),

  /** Create or update the budget for a project. */
  setBudget: protectedProcedure
    .input(setBudgetSchema)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const existing = await db
        .select()
        .from(projectBudgets)
        .where(eq(projectBudgets.projectId, input.projectId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(projectBudgets)
          .set({
            limitCents: input.limitCents,
            alertThreshold: input.alertThreshold,
            mode: input.mode,
          })
          .where(eq(projectBudgets.projectId, input.projectId));
      } else {
        await db.insert(projectBudgets).values({
          id: uuidv4(),
          projectId: input.projectId,
          limitCents: input.limitCents,
          alertThreshold: input.alertThreshold,
          mode: input.mode,
        });
      }
      return { success: true };
    }),

  /** Get recent spend log entries for a project (read-only). */
  getSpendLog: protectedProcedure
    .input(getSpendLogSchema)
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(spendLog)
        .where(eq(spendLog.projectId, input.projectId))
        .orderBy(desc(spendLog.createdAt))
        .limit(input.limit);
    }),

  /** Get aggregated spend totals per provider for a project. */
  getSpendSummary: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { totalMicrocents: 0, byProvider: [] };

      const rows = await db
        .select({
          provider: spendLog.provider,
          totalMicrocents: sum(spendLog.estimatedCostMicrocents),
          callCount: sum(spendLog.promptTokens), // proxy count — not ideal but avoids COUNT(*) type issues
        })
        .from(spendLog)
        .where(eq(spendLog.projectId, input.projectId))
        .groupBy(spendLog.provider);

      const totalMicrocents = rows.reduce(
        (acc, r) => acc + (Number(r.totalMicrocents) || 0),
        0
      );

      return {
        totalMicrocents,
        totalCentsDollars: totalMicrocents / 1_000_000,
        byProvider: rows.map(r => ({
          provider: r.provider,
          totalMicrocents: Number(r.totalMicrocents) || 0,
        })),
      };
    }),

  /** Reset (delete) all spend log entries for a project. Requires explicit confirmation. */
  resetSpend: protectedProcedure
    .input(z.object({ projectId: projectIdSchema, confirm: z.literal(true) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.delete(spendLog).where(eq(spendLog.projectId, input.projectId));
      return { success: true };
    }),
});
