/**
 * platformTokens — the single source of truth for OAuth token lifecycle on the
 * `platformAccounts` store (Gmail, cloud storage, and every connected social
 * platform).
 *
 * Two concerns live here, unified so background and request-time paths share one
 * implementation instead of the copy-pasted refresh blocks that existed before:
 *
 *  1. **At-rest encryption.** Access/refresh tokens are long-lived credentials
 *     and MUST NOT sit in the database as plaintext. They are sealed with
 *     AES-256-GCM (key derived from JWT_SECRET) as "v1:<ivHex>:<tagHex>:<cipherB64>".
 *     `decryptPlatformToken` transparently passes through any value WITHOUT the
 *     "v1:" prefix, so tokens written before this landed keep working and get
 *     re-sealed on their next refresh — a zero-downtime migration.
 *
 *  2. **Refresh.** `getFreshAccessToken` renews *pre-emptively* when a token is
 *     within the expiry-skew window; `refreshAndPersistAccount` renews
 *     *reactively* after a live 401. Both persist the rotated (re-encrypted)
 *     token back to `platformAccounts`. A definitive `invalid_grant` deactivates
 *     the account so the UI prompts a reconnect; transient failures leave it
 *     intact for the next attempt.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db.factory.js";
import { platformAccounts, type PlatformAccount } from "../../drizzle/schema.js";
import { ENV } from "../_core/env.js";
import { createLogger } from "../_core/logger.js";
import { refreshOAuthToken } from "./oauthClients.js";

const log = createLogger("PlatformTokens");

const ENC_PREFIX = "v1:";

// Renew a token this long before its real expiry so an in-flight request never
// races the boundary. Mirrors the skew used by the login-token helper.
const EXPIRY_SKEW_MS = 60 * 1000;

// ─── At-rest crypto ──────────────────────────────────────────────────────────

function tokenKey(): Buffer {
  return crypto.createHash("sha256").update(`${ENV.cookieSecret}:platform-account-token`).digest();
}

function warnNoSecret(): void {
  log.warn(
    "JWT_SECRET not set — platform OAuth tokens stored as plaintext. Set JWT_SECRET for encryption at rest."
  );
}

/** Seal a plaintext token for storage. Falls back to plaintext when no secret
 *  is configured (dev), warning so the condition is visible. */
export function encryptPlatformToken(plaintext: string): string {
  if (!ENV.cookieSecret) {
    warnNoSecret();
    return plaintext;
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("base64")}`;
}

/** Open a stored token. Any value without the "v1:" prefix is returned as-is
 *  (legacy plaintext, written before at-rest encryption existed). */
export function decryptPlatformToken(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext passthrough
  const [, ivHex, tagHex, cipherB64] = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

/** Decrypted access token for an account row. */
export function accountAccessToken(account: Pick<PlatformAccount, "oauthToken">): string {
  return decryptPlatformToken(account.oauthToken);
}

/** Decrypted refresh token for an account row, or "" when none is stored. */
export function accountRefreshToken(account: Pick<PlatformAccount, "oauthRefreshToken">): string {
  return decryptPlatformToken(account.oauthRefreshToken);
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

/** True when this account's access token is expired (or within the skew window). */
export function accountTokenExpiring(account: Pick<PlatformAccount, "tokenExpiresAt">): boolean {
  const expiresAt = account.tokenExpiresAt;
  if (!expiresAt) return false; // no known expiry → let the caller/reactive path decide
  return expiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now();
}

/** Whether a refresh error means the grant is dead (revoked / consent withdrawn)
 *  and the account should be deactivated, vs. a transient failure worth retrying. */
function isInvalidGrant(err: unknown): boolean {
  const boomStatus = (err as { output?: { statusCode?: number } })?.output?.statusCode;
  const data = (err as { data?: { payload?: { error?: string } } })?.data?.payload?.error;
  const msg = err instanceof Error ? err.message : String(err);
  return data === "invalid_grant" || /invalid_grant/i.test(msg) || boomStatus === 400 || boomStatus === 401;
}

/**
 * Force-refresh an account's access token and persist the rotated, re-encrypted
 * token. Re-reads the row by id first so a token rotated by a concurrent path
 * (or a pre-emptive refresh moments earlier) is never re-used stale.
 *
 * Returns the fresh plaintext access token, or null when refresh is impossible
 * (no refresh token) or failed. On a definitive `invalid_grant` the account is
 * deactivated so the UI surfaces a reconnect prompt.
 */
export async function refreshAndPersistAccount(
  account: Pick<PlatformAccount, "id" | "platform">
): Promise<string | null> {
  const db = await getDb();
  const [fresh] = await db
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.id, account.id))
    .limit(1);
  if (!fresh) return null;

  const refreshPlain = decryptPlatformToken(fresh.oauthRefreshToken);
  if (!refreshPlain) return null;

  try {
    const refreshed = await refreshOAuthToken(fresh.platform, refreshPlain);
    if (!refreshed.access_token) return null;

    await db
      .update(platformAccounts)
      .set({
        oauthToken: encryptPlatformToken(refreshed.access_token),
        oauthRefreshToken: encryptPlatformToken(refreshed.refresh_token || refreshPlain),
        tokenExpiresAt: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000)
          : fresh.tokenExpiresAt,
      })
      .where(eq(platformAccounts.id, fresh.id));

    log.info(`Refreshed ${fresh.platform} token (account ${fresh.id})`);
    return refreshed.access_token;
  } catch (err) {
    if (isInvalidGrant(err)) {
      await db
        .update(platformAccounts)
        .set({ isActive: 0 })
        .where(eq(platformAccounts.id, fresh.id));
      log.warn(`${fresh.platform} refresh token revoked (account ${fresh.id}) — deactivated; reconnect required`);
    } else {
      log.warn(
        `${fresh.platform} refresh failed transiently (account ${fresh.id}) — will retry`,
        err instanceof Error ? err.message : String(err)
      );
    }
    return null;
  }
}

/**
 * A valid access token for an account, refreshing pre-emptively when the stored
 * token is expiring. Falls back to the (decrypted) current token when there is
 * no refresh token or the refresh fails — the caller's own 401 handling then
 * takes over.
 */
export async function getFreshAccessToken(account: PlatformAccount): Promise<string> {
  if (!accountTokenExpiring(account)) return accountAccessToken(account);
  if (!account.oauthRefreshToken) return accountAccessToken(account);
  const refreshed = await refreshAndPersistAccount(account);
  return refreshed ?? accountAccessToken(account);
}
