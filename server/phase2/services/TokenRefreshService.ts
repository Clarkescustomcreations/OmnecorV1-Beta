import { getDb } from "../../db.factory.js";
import { integrations } from "../../../drizzle/schema.js";
import { SecurityService } from "./SecurityService.js";
import { ENV } from "../../_core/env.js";
import { lt, and, isNotNull, eq } from "drizzle-orm";

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
      console.error("[TokenRefresh] Initial check failed:", err)
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
        console.error(`[TokenRefresh] Failed to refresh ${integration.provider}:`, err)
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

    const refreshToken = Buffer.from(integration.refreshToken, "base64").toString("utf-8");

    let newAccessToken: string;
    let newRefreshToken: string | undefined;
    let expiresAt: Date | undefined;

    if (provider === "notion") {
      const response = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${ENV.notionClientId}:${ENV.notionClientSecret}`
          ).toString("base64")}`,
        },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });

      if (!response.ok) {
        await db.delete(integrations).where(eq(integrations.provider, provider));
        console.warn(`[TokenRefresh] ${provider} token revoked — integration cleared`);
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
      const testRes = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${refreshToken}` },
      });
      const data = await testRes.json() as { ok: boolean };
      if (!data.ok) {
        await db.delete(integrations).where(eq(integrations.provider, provider));
        console.warn(`[TokenRefresh] Slack token revoked — integration cleared`);
      }
      return; 
    } else {
      return;
    }

    const updateData: Partial<typeof integrations.$inferInsert> = {
      accessToken: Buffer.from(newAccessToken).toString("base64"),
      expiresAt: expiresAt ?? null,
    };

    if (newRefreshToken) {
      updateData.refreshToken = Buffer.from(newRefreshToken).toString("base64");
    }

    await db.update(integrations).set(updateData).where(
      eq(integrations.provider, provider)
    );

    console.info(`[TokenRefresh] Refreshed ${provider} token successfully`);
  }
}
