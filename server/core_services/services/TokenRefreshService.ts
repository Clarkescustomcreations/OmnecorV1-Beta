import { getDb } from "../../db.factory.js";
import { platformAccounts, type PlatformAccount } from "../../../drizzle/schema.js";
import { ENV } from "../../_core/env.js";
import { and, lt, isNotNull, eq } from "drizzle-orm";
import { createLogger } from "../../_core/logger.js";
import { refreshAndPersistAccount } from "../../oauth/platformTokens.js";

const log = createLogger("TokenRefresh");

// Sweep cadence and how far ahead of expiry a token is renewed. The window is
// wider than the interval so a token can never slip past its expiry unnoticed
// between two sweeps.
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15 min
const RENEW_WINDOW_MS = 30 * 60 * 1000; // renew when < 30 min of life remains

/**
 * Background service that keeps connected OAuth integrations alive by
 * pre-emptively renewing their access tokens before they expire.
 *
 * It sweeps the `platformAccounts` store — the real, populated token store used
 * by Gmail, cloud storage, and every connected social platform — refreshing any
 * active account that has a refresh token and is within the renewal window. The
 * per-account refresh, re-encryption, and revoked-grant handling all live in the
 * shared `platformTokens` helper, so this service and the request-time
 * (reactive 401) paths share one implementation.
 */
export class TokenRefreshService {
  private static instance: TokenRefreshService;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  static getInstance(): TokenRefreshService {
    if (!TokenRefreshService.instance) {
      TokenRefreshService.instance = new TokenRefreshService();
    }
    return TokenRefreshService.instance;
  }

  start(): void {
    if (this.intervalHandle) return;
    if (!ENV.cookieSecret) {
      log.warn(
        "JWT_SECRET not set — platform OAuth tokens are stored as plaintext. Set JWT_SECRET for encryption at rest."
      );
    }
    this.intervalHandle = setInterval(() => {
      this.checkExpiring().catch(err =>
        log.error("Token-expiry sweep failed", { error: (err as Error)?.message })
      );
    }, SWEEP_INTERVAL_MS);
    this.checkExpiring().catch(err =>
      log.error("Initial token-expiry sweep failed", { error: (err as Error)?.message })
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Manually refresh every active, refreshable account for a platform right now
   * (the Security panel "force refresh" action). Scoped to a single user when
   * `userId` is supplied.
   */
  async forceRefresh(platform: string, userId?: number): Promise<void> {
    const db = await getDb();
    const conditions = [
      eq(platformAccounts.platform, platform),
      eq(platformAccounts.isActive, 1),
      isNotNull(platformAccounts.oauthRefreshToken),
    ];
    if (userId !== undefined) conditions.push(eq(platformAccounts.userId, userId));

    const rows = await db.select().from(platformAccounts).where(and(...conditions));
    for (const account of rows) {
      await this.refreshOne(account);
    }
  }

  private async checkExpiring(): Promise<void> {
    const db = await getDb();
    const soonExpiry = new Date(Date.now() + RENEW_WINDOW_MS);

    const expiring = await db
      .select()
      .from(platformAccounts)
      .where(
        and(
          eq(platformAccounts.isActive, 1),
          isNotNull(platformAccounts.oauthRefreshToken),
          isNotNull(platformAccounts.tokenExpiresAt),
          lt(platformAccounts.tokenExpiresAt, soonExpiry)
        )
      );

    let renewed = 0;
    for (const account of expiring) {
      if (await this.refreshOne(account)) renewed++;
    }
    if (renewed > 0) log.info(`Pre-emptively renewed ${renewed} OAuth token(s)`);
  }

  private async refreshOne(account: PlatformAccount): Promise<boolean> {
    // refreshAndPersistAccount never throws (it logs + returns null on failure),
    // but guard anyway so one bad account can't abort the whole sweep.
    const token = await refreshAndPersistAccount(account).catch(err => {
      log.error(`Failed to refresh ${account.platform} (account ${account.id})`, {
        error: (err as Error)?.message,
      });
      return null;
    });
    return token !== null;
  }
}
