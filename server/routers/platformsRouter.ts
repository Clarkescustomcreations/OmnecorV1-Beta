import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { platformAccounts } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env.js";
import { encryptPlatformToken } from "../oauth/platformTokens.js";
import { getSetting, setSetting } from "../core_services/services/SettingsService.js";
import {
  SOCIAL_WEBHOOK_PATH_KEY,
  DEFAULT_SOCIAL_WEBHOOK_PATH,
  isLoopbackUrl,
} from "../core_services/services/WebhookPublisher.js";

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

      // Connect is idempotent per (user, platform): re-connecting refreshes the
      // existing row (and reactivates it) rather than leaving an orphaned
      // isActive:0 duplicate behind from a prior disconnect.
      const [existing] = await db.select({ id: platformAccounts.id })
        .from(platformAccounts)
        .where(and(
          eq(platformAccounts.userId, ctx.user.id),
          eq(platformAccounts.platform, input.platform),
        ))
        .limit(1);

      if (existing) {
        await db.update(platformAccounts)
          .set({
            accountName: input.accountName,
            oauthToken: encryptPlatformToken(input.oauthToken),
            oauthRefreshToken: input.oauthRefreshToken
              ? encryptPlatformToken(input.oauthRefreshToken)
              : undefined,
            accountMetadata: input.accountMetadata,
            isActive: 1,
          })
          .where(eq(platformAccounts.id, existing.id));
        return { success: true, accountId: existing.id };
      }

      const [created] = await db.insert(platformAccounts).values({
        userId: ctx.user.id,
        platform: input.platform,
        accountName: input.accountName,
        oauthToken: encryptPlatformToken(input.oauthToken),
        oauthRefreshToken: input.oauthRefreshToken
          ? encryptPlatformToken(input.oauthRefreshToken)
          : undefined,
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
          ...(input.oauthToken && { oauthToken: encryptPlatformToken(input.oauthToken) }),
          ...(input.oauthRefreshToken && { oauthRefreshToken: encryptPlatformToken(input.oauthRefreshToken) }),
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

  /**
   * Publishing routing — which platforms go through the n8n webhook (dev-app
   * registration required) vs. publish natively, plus the live webhook config.
   * Drives the Platforms tab so the UI renders the correct connect flow per
   * platform and can warn when a sovereign install points n8n at a remote host.
   */
  getPublishingRouting: protectedProcedure.query(({ ctx }) => {
    const webhookPath = getSetting(SOCIAL_WEBHOOK_PATH_KEY, DEFAULT_SOCIAL_WEBHOOK_PATH);
    const n8nUrl = ENV.n8nUrl.replace(/\/$/, "");
    const loopback = isLoopbackUrl(n8nUrl);
    const sovereign = ctx.user?.executionMode === "sovereign";
    return {
      webhook: {
        n8nUrl,
        webhookPath,
        webhookUrl: `${n8nUrl}/webhook/${webhookPath}`,
        isLoopback: loopback,
        /** True when this sovereign install would refuse webhook egress (remote n8n). */
        sovereignBlocked: sovereign && !loopback,
      },
    };
  }),

  /**
   * Set the n8n webhook path (the segment after `/webhook/`). Server-wide
   * config, so owner/admin only. Empty restores the shipped-blueprint default.
   */
  setWebhookPath: adminProcedure
    .input(z.object({ webhookPath: z.string().trim().max(200) }))
    .mutation(({ input }) => {
      const path = input.webhookPath.replace(/^\/+|\/+$/g, "") || DEFAULT_SOCIAL_WEBHOOK_PATH;
      setSetting(SOCIAL_WEBHOOK_PATH_KEY, path);
      return { success: true, webhookPath: path };
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
