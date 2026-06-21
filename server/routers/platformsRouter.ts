import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { platformAccounts } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/**
 * Columns that are safe to return to the client. The OAuth access/refresh
 * tokens are intentionally omitted — they must never leave the server.
 */
const SAFE_ACCOUNT_COLUMNS = {
  id: platformAccounts.id,
  userId: platformAccounts.userId,
  platform: platformAccounts.platform,
  accountName: platformAccounts.accountName,
  tokenExpiresAt: platformAccounts.tokenExpiresAt,
  isActive: platformAccounts.isActive,
  lastSyncedAt: platformAccounts.lastSyncedAt,
  createdAt: platformAccounts.createdAt,
  updatedAt: platformAccounts.updatedAt,
};

export const platformsRouter = router({
  listAccounts: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const accounts = await db.select(SAFE_ACCOUNT_COLUMNS)
        .from(platformAccounts)
        .where(and(
          eq(platformAccounts.userId, ctx.user.id),
          eq(platformAccounts.isActive, 1),
        ));

      return accounts;
    }),
  getAccount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const result = await db.select(SAFE_ACCOUNT_COLUMNS)
        .from(platformAccounts)
        .where(and(
          eq(platformAccounts.id, input.accountId),
          eq(platformAccounts.userId, ctx.user.id),
        ))
        .limit(1);

      return result[0] || null;
    }),
  addAccount: protectedProcedure
    .input(z.object({
      platform: z.string(),
      accountName: z.string(),
      oauthToken: z.string(),
      oauthRefreshToken: z.string().optional(),
      accountMetadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [created] = await db.insert(platformAccounts).values({
        userId: ctx.user.id,
        platform: input.platform,
        accountName: input.accountName,
        oauthToken: input.oauthToken,
        oauthRefreshToken: input.oauthRefreshToken,
        accountMetadata: input.accountMetadata,
        isActive: 1,
      }).returning({ id: platformAccounts.id });

      return { success: true, accountId: created.id };
    }),
  updateAccount: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      oauthToken: z.string().optional(),
      oauthRefreshToken: z.string().optional(),
      tokenExpiresAt: z.date().optional(),
      isActive: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      await assertAccountOwnership(db, input.accountId, ctx.user.id);

      await db.update(platformAccounts)
        .set({
          ...(input.oauthToken && { oauthToken: input.oauthToken }),
          ...(input.oauthRefreshToken && { oauthRefreshToken: input.oauthRefreshToken }),
          ...(input.tokenExpiresAt && { tokenExpiresAt: input.tokenExpiresAt }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        })
        .where(and(
          eq(platformAccounts.id, input.accountId),
          eq(platformAccounts.userId, ctx.user.id),
        ));

      return { success: true };
    }),
  disconnectAccount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      await assertAccountOwnership(db, input.accountId, ctx.user.id);

      await db.update(platformAccounts)
        .set({ isActive: 0 })
        .where(and(
          eq(platformAccounts.id, input.accountId),
          eq(platformAccounts.userId, ctx.user.id),
        ));

      return { success: true };
    }),
});

/**
 * Throws FORBIDDEN unless the given account exists and belongs to the user.
 */
async function assertAccountOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  accountId: number,
  userId: number,
) {
  const existing = await db.select({ userId: platformAccounts.userId })
    .from(platformAccounts)
    .where(eq(platformAccounts.id, accountId))
    .limit(1);

  if (!existing.length || existing[0].userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}
