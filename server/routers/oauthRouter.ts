import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db.factory.js";
import { platformAccounts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  getOAuthAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserProfile,
} from "../oauth/oauthClients";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import crypto from "crypto";
import {
  saveOAuthState,
  getOAuthState,
  deleteOAuthState,
  OAUTH_STATE_TTL,
} from "../_core/oauth.js";

// Providers supported by the authorization-code flow: social platforms plus
// cloud storage providers. The cloud providers reuse the same generic flow
// (state + PKCE + /api/oauth/callback/:platform) as the social platforms.
const SUPPORTED_OAUTH_PROVIDERS = [
  "twitter",
  "linkedin",
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  // Cloud storage
  "google_drive",
  "dropbox",
  "onedrive",
] as const;

export const oauthRouter = router({
  getAuthorizationUrl: protectedProcedure
    .input(z.object({ platform: z.enum(SUPPORTED_OAUTH_PROVIDERS) }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user?.id) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User must be authenticated",
          });
        }

        const state = nanoid(32);

        // PKCE: generate a per-request verifier/challenge pair.
        const codeVerifier = crypto.randomBytes(32).toString("base64url");
        const codeChallenge = crypto
          .createHash("sha256")
          .update(codeVerifier)
          .digest("base64url");

        await saveOAuthState(state, {
          platform: input.platform,
          userId: ctx.user.id,
          codeVerifier,
        });

        const authUrl = await getOAuthAuthorizationUrl(
          input.platform,
          "",
          state,
          codeChallenge
        );

        return { authUrl, state };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to generate OAuth URL for ${input.platform}: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  handleCallback: protectedProcedure
    .input(
      z.object({
        platform: z.enum(SUPPORTED_OAUTH_PROVIDERS),
        code: z.string(),
        state: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user?.id) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User must be authenticated",
          });
        }

        // Verify state
        const stateData = await getOAuthState(input.state);
        if (
          !stateData ||
          stateData.platform !== input.platform ||
          stateData.userId !== ctx.user.id ||
          Date.now() - stateData.timestamp > OAUTH_STATE_TTL
        ) {
          await deleteOAuthState(input.state);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid OAuth state",
          });
        }
        await deleteOAuthState(input.state);

        // Exchange code for token (PKCE verifier passed through when present)
        const tokenResponse = await exchangeCodeForToken(
          input.platform,
          input.code,
          "",
          stateData.codeVerifier
        );

        // Fetch user profile
        const profile = await fetchUserProfile(
          input.platform,
          tokenResponse.access_token
        );

        // Save to database
        const db = await getDb();
        if (!db) {
          return {
            success: false,
            accountName: "Offline Account",
            platform: input.platform,
            error: "Database not available in local mode",
          };
        }

        const accountName =
          (profile.name ||
            profile.username ||
            profile.login ||
            "Connected Account") as string;

        await db.insert(platformAccounts).values({
          userId: ctx.user.id,
          platform: input.platform,
          accountName,
          oauthToken: tokenResponse.access_token,
          oauthRefreshToken: tokenResponse.refresh_token || undefined,
          tokenExpiresAt: tokenResponse.expires_in
            ? new Date(Date.now() + tokenResponse.expires_in * 1000)
            : undefined,
          accountMetadata: profile,
          isActive: 1,
        });

        return {
          success: true,
          accountName,
          platform: input.platform,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `OAuth callback failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
  disconnectAccount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false, error: "Database not available in local mode" };

      const account = await db
        .select()
        .from(platformAccounts)
        .where(eq(platformAccounts.id, input.accountId))
        .limit(1);

      if (!account.length || account[0].userId !== ctx.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await db
        .update(platformAccounts)
        .set({ isActive: 0 })
        .where(eq(platformAccounts.id, input.accountId));

      return { success: true };
    }),
});
