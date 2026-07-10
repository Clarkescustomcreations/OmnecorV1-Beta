import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, externalServiceProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.factory.js";
import { platformAccounts } from "../../drizzle/schema.js";
import { isPlatformConfigured } from "../oauth/oauthClients.js";
import { getFreshAccessToken, refreshAndPersistAccount } from "../oauth/platformTokens.js";
import { createLogger } from "../_core/logger.js";

const log = createLogger("GmailRouter");

/**
 * Encode a header value safely:
 *  - strip CR/LF so an attacker cannot inject extra headers (e.g. a hidden Bcc)
 *    via a crafted subject — same hardening as auditRouter's log sanitizer;
 *  - wrap non-ASCII as an RFC 2047 base64 encoded-word so unicode subjects
 *    (emoji, accents) survive instead of producing a malformed raw header.
 */
function encodeHeaderValue(value: string): string {
  const stripped = value.replace(/[\r\n]+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  const isAscii = /^[\x00-\x7F]*$/.test(stripped);
  if (isAscii) return stripped;
  return `=?UTF-8?B?${Buffer.from(stripped, "utf-8").toString("base64")}?=`;
}

/** Build a base64url-encoded RFC 2822 message for the Gmail send endpoint. */
export function buildRawMessage(opts: {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
}): string {
  const headers = [
    `To: ${encodeHeaderValue(opts.to)}`,
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${opts.html ? "text/html" : "text/plain"}; charset="UTF-8"`,
  ];
  const message = `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
  return Buffer.from(message, "utf-8").toString("base64url");
}

/** Fetch the user's active, connected Gmail account row (most recent first). */
async function getActiveGmailAccount(userId: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(platformAccounts)
    .where(
      and(
        eq(platformAccounts.userId, userId),
        eq(platformAccounts.platform, "gmail"),
        eq(platformAccounts.isActive, 1),
      ),
    )
    .orderBy(desc(platformAccounts.id))
    .limit(1);
  return rows[0] ?? null;
}

export const gmailRouter = router({
  /**
   * Configuration + connection status for the Gmail integration. Never returns
   * tokens or secrets — booleans only — so it is safe as a plain query the UI
   * polls to decide whether to show "Connect" vs "Send".
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const configured = isPlatformConfigured("gmail");
    const account = ctx.user?.id ? await getActiveGmailAccount(ctx.user.id) : null;
    return {
      configured,
      connected: Boolean(account),
      accountName: account?.accountName ?? null,
    };
  }),

  /**
   * Send an email through the connected Gmail account. Uses externalServiceProcedure
   * to respect Sovereign Mode restrictions on outbound network integration calls.
   */
  sendEmail: externalServiceProcedure
    .input(
      z.object({
        to: z.string().email(),
        subject: z.string().min(1).max(998),
        body: z.string().min(1),
        html: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isPlatformConfigured("gmail")) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Gmail OAuth client is not configured. Add the Gmail client ID/secret in Settings → Accounts → Service Connections.",
        });
      }

      const account = await getActiveGmailAccount(ctx.user.id);
      if (!account) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No Gmail account connected. Connect one in Integrations first.",
        });
      }

      const raw = buildRawMessage(input);
      const endpoint =
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

      const send = (token: string) =>
        fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        });

      // Pre-emptively renew if the stored token is within the expiry window,
      // then send. On a live 401 refresh once and retry. Both paths persist the
      // rotated (re-encrypted) token via the shared platform-token helpers.
      let res = await send(await getFreshAccessToken(account));

      if (res.status === 401 && account.oauthRefreshToken) {
        log.info("Gmail token expired, refreshing");
        const refreshed = await refreshAndPersistAccount(account);
        if (refreshed) res = await send(refreshed);
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Gmail API ${res.status}: ${detail}`,
        });
      }

      const data = (await res.json()) as { id?: string; threadId?: string };
      return { success: true, messageId: data.id ?? null, threadId: data.threadId ?? null };
    }),
});
