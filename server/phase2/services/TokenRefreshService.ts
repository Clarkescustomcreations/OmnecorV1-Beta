import crypto from "crypto";
import { getDb } from "../../db.factory.js";
import { integrations } from "../../../drizzle/schema.js";
import { ENV } from "../../_core/env.js";
import { lt, and, isNotNull, eq } from "drizzle-orm";
import { resilientFetch } from "../../_core/resilientFetch.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("TokenRefresh");

const REFRESH_TIMEOUT_MS = 15_000;

// ─── Token-at-rest crypto ────────────────────────────────────────────────────
// OAuth refresh/access tokens are long-lived credentials and MUST be encrypted
// at rest (not merely base64-encoded). We use AES-256-GCM with a key derived
// from JWT_SECRET. Stored format: "v1:<ivHex>:<authTagHex>:<cipherB64>".
// Legacy values (plain base64, no "v1:" prefix) are still decodable for
// backward compatibility and get re-encrypted on the next refresh.

const ENC_PREFIX = "v1:";

function tokenKey(): Buffer {
  // Derive a stable 32-byte key from the app's JWT secret.
  return crypto.createHash("sha256").update(`${ENV.cookieSecret}:oauth-token`).digest();
}

export function encryptToken(plaintext: string): string {
  // If no secret is configured (dev/sqlite), fall back to legacy base64 so the
  // flow still works — but warn once.
  if (!ENV.cookieSecret) {
    warnNoSecret();
    return Buffer.from(plaintext).toString("base64");
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  if (stored.startsWith(ENC_PREFIX)) {
    const [, ivHex, tagHex, cipherB64] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  }
  // Legacy plain-base64 token.
  return Buffer.from(stored, "base64").toString("utf-8");
}

let _warnedNoSecret = false;
function warnNoSecret(): void {
  if (_warnedNoSecret) return;
  _warnedNoSecret = true;
  log.warn("JWT_SECRET not set — OAuth tokens stored with weak base64 obfuscation. Set JWT_SECRET for encryption at rest.");
}

export class TokenRefreshService {
  private static instance: TokenRefreshService;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  static getInstance(): TokenRefreshService {
    if (!TokenRefreshService.instance) {
      TokenRefreshService.instance = new TokenRefreshService();
    }
    return TokenRefreshService.instance;
  }

  private async getDbInstance() {
    return await getDb();
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.checkExpiring(), 15 * 60 * 1000);
    this.checkExpiring().catch(err =>
      log.error("Initial check failed", { error: (err as Error)?.message })
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async forceRefresh(provider: string): Promise<void> {
    await this.refreshProvider(provider);
  }

  private async checkExpiring(): Promise<void> {
    const db = await this.getDbInstance();
    if (!db) return;

    const soonExpiry = new Date(Date.now() + 30 * 60 * 1000);

    const expiring = await db
      .select()
      .from(integrations)
      .where(
        and(
          lt(integrations.expiresAt, soonExpiry),
          isNotNull(integrations.refreshToken)
        )
      );

    for (const integration of expiring) {
      await this.refreshProvider(integration.provider).catch(err =>
        log.error(`Failed to refresh ${integration.provider}`, { error: (err as Error)?.message })
      );
    }
  }

  private async refreshProvider(provider: string): Promise<void> {
    const db = await this.getDbInstance();
    if (!db) return;

    const [integration] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.provider, provider))
      .limit(1);

    if (!integration?.refreshToken) return;

    let refreshToken: string;
    try {
      refreshToken = decryptToken(integration.refreshToken);
    } catch (err) {
      // Corrupted/undecryptable token — clear it so the user re-auths.
      await db.delete(integrations).where(eq(integrations.provider, provider));
      log.warn(`${provider} refresh token could not be decrypted — integration cleared`);
      return;
    }

    let newAccessToken: string;
    let newRefreshToken: string | undefined;
    let expiresAt: Date | undefined;

    if (provider === "notion") {
      let response: Response;
      try {
        response = await resilientFetch("https://api.notion.com/v1/oauth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(
              `${ENV.notionClientId}:${ENV.notionClientSecret}`
            ).toString("base64")}`,
          },
          body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
          circuitKey: "notion-oauth",
          timeoutMs: REFRESH_TIMEOUT_MS,
        });
      } catch (err) {
        // Network/timeout — leave the integration intact so a later cycle retries.
        log.error(`${provider} refresh request failed (network/timeout)`, { error: (err as Error)?.message });
        return;
      }

      if (!response.ok) {
        // 4xx (invalid_grant) means the token is revoked → clear. 5xx is
        // transient → keep and retry next cycle.
        if (response.status >= 400 && response.status < 500) {
          await db.delete(integrations).where(eq(integrations.provider, provider));
          log.warn(`${provider} token revoked (${response.status}) — integration cleared`);
        } else {
          log.warn(`${provider} refresh transient error ${response.status} — will retry`);
        }
        return;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      newAccessToken = data.access_token;
      newRefreshToken = data.refresh_token;
      expiresAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined;

    } else if (provider === "slack") {
      let testRes: Response;
      try {
        testRes = await resilientFetch("https://slack.com/api/auth.test", {
          headers: { Authorization: `Bearer ${refreshToken}` },
          circuitKey: "slack-oauth",
          timeoutMs: REFRESH_TIMEOUT_MS,
        });
      } catch (err) {
        log.error(`slack token check failed (network/timeout)`, { error: (err as Error)?.message });
        return;
      }
      const data = await testRes.json() as { ok: boolean };
      if (!data.ok) {
        await db.delete(integrations).where(eq(integrations.provider, provider));
        log.warn(`Slack token revoked — integration cleared`);
      }
      return;
    } else {
      return;
    }

    const updateData: Partial<typeof integrations.$inferInsert> = {
      accessToken: encryptToken(newAccessToken),
      expiresAt: expiresAt ?? null,
    };

    if (newRefreshToken) {
      updateData.refreshToken = encryptToken(newRefreshToken);
    }

    await db.update(integrations).set(updateData).where(
      eq(integrations.provider, provider)
    );

    log.info(`Refreshed ${provider} token successfully`);
  }
}
