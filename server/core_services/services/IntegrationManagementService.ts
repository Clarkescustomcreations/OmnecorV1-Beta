/**
 * @file server/core_services/services/IntegrationManagementService.ts
 * @description Integration health checks, lifecycle management, and token refresh
 *
 * Provides unified health monitoring for both OAuth-based integrations (via platformAccounts)
 * and token-based integrations (via integrationsRouter's local store).
 */

import { createLogger } from "../../_core/logger.js";
import { ENV } from "../../_core/env.js";

const log = createLogger("integrationManagement");

export type IntegrationStatus = "connected" | "disconnected" | "error" | "checking";

export interface IntegrationHealth {
  id: string; // e.g. "github", "notion", "slack", "google_drive", "twitter", "linkedin"
  name: string;
  status: IntegrationStatus;
  lastCheckedAt: string;
  errorMessage?: string;
  tokenExpiresAt?: string;
  scopes?: string[];
}

interface CacheEntry {
  health: IntegrationHealth;
  timestamp: number;
}

/**
 * In-memory cache with TTL (60 seconds) to avoid hammering external APIs
 * during rapid consecutive health checks (e.g., page load refetch loops).
 */
const healthCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCacheKey(userId: string, integrationId: string): string {
  return `${userId}:${integrationId}`;
}

function getCachedHealth(userId: string, integrationId: string): IntegrationHealth | null {
  const key = getCacheKey(userId, integrationId);
  const entry = healthCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    healthCache.delete(key);
    return null;
  }
  return entry.health;
}

function setCachedHealth(userId: string, integrationId: string, health: IntegrationHealth): void {
  const key = getCacheKey(userId, integrationId);
  healthCache.set(key, { health, timestamp: Date.now() });
}

/**
 * Verify OAuth token validity by checking expiry and existence.
 * External API calls are avoided; we only check local token state.
 */
async function verifyOAuthToken(
  token: string | undefined,
  tokenExpiresAt: Date | null | undefined,
): Promise<{ valid: boolean; expiresAt?: string; error?: string }> {
  if (!token) {
    return { valid: false, error: "Token not found" };
  }

  if (tokenExpiresAt) {
    const now = new Date();
    if (now >= tokenExpiresAt) {
      return {
        valid: false,
        error: "Token expired",
        expiresAt: tokenExpiresAt.toISOString(),
      };
    }
    return { valid: true, expiresAt: tokenExpiresAt.toISOString() };
  }

  // No expiry info, assume valid
  return { valid: true };
}

/**
 * Verify API key presence in environment variables.
 * No external calls; just check if the key is set and non-empty.
 */
function verifyApiKey(keyEnvVar: string): { valid: boolean; error?: string } {
  const value = process.env[keyEnvVar];
  if (!value || value.trim() === "") {
    return { valid: false, error: `Environment variable ${keyEnvVar} not set` };
  }
  return { valid: true };
}

export class IntegrationManagementService {
  /**
   * List all integrations for a user with their current health status.
   *
   * Checks:
   *   - OAuth-based (platformAccounts table): status depends on token existence + expiry
   *   - API-key-based (from integrationsRouter's local store): status depends on env var
   *   - Disconnected: no entry in either store
   */
  async listIntegrations(
    userId: string,
    db: any, // TrpcContext's db (always a live instance)
  ): Promise<IntegrationHealth[]> {
    const integrations: IntegrationHealth[] = [];

    // OAuth-based integrations from platformAccounts. getDb() always returns a
    // live instance; the try/catch tolerates any DB error.
    try {
      const { platformAccounts } = await import("../../../drizzle/schema.js");
      const { eq } = await import("drizzle-orm");

      const accounts = await db
        .select()
        .from(platformAccounts)
        .where(eq(platformAccounts.userId, Number(userId)));

      for (const account of accounts) {
        const isActive = account.isActive === 1;
        const status: IntegrationStatus = isActive
          ? account.oauthToken ? "connected" : "disconnected"
          : "disconnected";

        integrations.push({
          id: account.platform,
          name: this.getPlatformDisplayName(account.platform),
          status,
          lastCheckedAt: new Date().toISOString(),
          tokenExpiresAt: account.tokenExpiresAt?.toISOString(),
        });
      }
    } catch (err) {
      log.warn("Failed to load platformAccounts:", err instanceof Error ? err.message : String(err));
    }

    // Local token-based integrations (from integrationsRouter store)
    const localIntegrations = this.getLocalIntegrations();
    for (const integ of localIntegrations) {
      // Only add if not already in list (OAuth takes precedence)
      if (!integrations.find(i => i.id === integ.id)) {
        integrations.push(integ);
      }
    }

    return integrations;
  }

  /**
   * Check health of a single integration.
   * Uses cache to avoid rapid re-checks.
   */
  async checkHealth(
    integrationId: string,
    userId: string,
    db: any,
  ): Promise<IntegrationHealth> {
    // Check cache first
    const cached = getCachedHealth(userId, integrationId);
    if (cached) {
      log.debug(`Health cache hit for ${integrationId}`);
      return cached;
    }

    let health: IntegrationHealth;

    // Check OAuth-based first. getDb() always returns a live instance; the
    // try/catch tolerates any DB error.
    try {
      const { platformAccounts } = await import("../../../drizzle/schema.js");
      const { eq, and } = await import("drizzle-orm");

      const account = await db
        .select()
        .from(platformAccounts)
        .where(and(
          eq(platformAccounts.userId, Number(userId)),
          eq(platformAccounts.platform, integrationId),
        ))
        .limit(1);

      if (account.length > 0) {
        const acc = account[0];
        const tokenCheck = await verifyOAuthToken(
          acc.oauthToken,
          acc.tokenExpiresAt,
        );

        health = {
          id: integrationId,
          name: this.getPlatformDisplayName(integrationId),
          status: tokenCheck.valid ? "connected" : "error",
          lastCheckedAt: new Date().toISOString(),
          errorMessage: tokenCheck.error,
          tokenExpiresAt: tokenCheck.expiresAt,
        };
        setCachedHealth(userId, integrationId, health);
        return health;
      }
    } catch (err) {
      log.warn(
        `Failed to check OAuth health for ${integrationId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Check local token-based
    const localInteg = this.getLocalIntegration(integrationId);
    if (localInteg) {
      health = {
        ...localInteg,
        lastCheckedAt: new Date().toISOString(),
      };
    } else {
      health = {
        id: integrationId,
        name: this.getPlatformDisplayName(integrationId),
        status: "disconnected",
        lastCheckedAt: new Date().toISOString(),
      };
    }

    setCachedHealth(userId, integrationId, health);
    return health;
  }

  /**
   * Refresh an OAuth token using the stored refresh_token (standard OAuth2
   * refresh_token grant against the platform's token endpoint, via
   * `refreshOAuthToken` in server/oauth/oauthClients.ts). The new access
   * token, rotated refresh token (when issued), and expiry are persisted.
   */
  async refreshToken(
    integrationId: string,
    userId: string,
    db: any,
  ): Promise<{ success: boolean; message: string; tokenExpiresAt?: string }> {

    try {
      const { platformAccounts } = await import("../../../drizzle/schema.js");
      const { eq, and } = await import("drizzle-orm");

      const account = await db
        .select()
        .from(platformAccounts)
        .where(and(
          eq(platformAccounts.userId, Number(userId)),
          eq(platformAccounts.platform, integrationId),
        ))
        .limit(1);

      if (account.length === 0) {
        return { success: false, message: `${integrationId} not connected` };
      }

      const acc = account[0];
      if (!acc.oauthRefreshToken) {
        return {
          success: false,
          message: "No refresh token available. Please reconnect.",
        };
      }

      // Perform the OAuth2 refresh_token grant via the shared helper: it
      // decrypts the stored refresh token, hits the provider's token endpoint,
      // and persists the rotated credentials re-encrypted at rest. A definitive
      // invalid_grant deactivates the account there so the UI prompts reconnect.
      const { refreshAndPersistAccount } = await import("../../oauth/platformTokens.js");
      const newAccessToken = await refreshAndPersistAccount(acc);
      if (!newAccessToken) {
        return {
          success: false,
          message: `${integrationId} token refresh failed. Please reconnect.`,
        };
      }

      // Re-read the persisted expiry for the response.
      const [updated] = await db
        .select({ tokenExpiresAt: platformAccounts.tokenExpiresAt })
        .from(platformAccounts)
        .where(eq(platformAccounts.id, acc.id))
        .limit(1);
      const tokenExpiresAt = updated?.tokenExpiresAt ?? null;

      log.info(`Token refreshed for ${integrationId} (user ${userId})`);

      // Clear cache to force re-check on next health check
      const key = getCacheKey(userId, integrationId);
      healthCache.delete(key);

      return {
        success: true,
        message: `${integrationId} token refreshed`,
        tokenExpiresAt: tokenExpiresAt ? tokenExpiresAt.toISOString() : undefined,
      };
    } catch (err) {
      log.error(
        `Failed to refresh token for ${integrationId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return {
        success: false,
        message: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Disconnect (remove) an integration.
   * For OAuth: mark isActive=0 in platformAccounts.
   * For local tokens: no-op (managed by integrationsRouter).
   */
  async disconnectIntegration(
    integrationId: string,
    userId: string,
    db: any,
  ): Promise<{ success: boolean; message: string }> {

    try {
      const { platformAccounts } = await import("../../../drizzle/schema.js");
      const { eq, and } = await import("drizzle-orm");

      const account = await db
        .select()
        .from(platformAccounts)
        .where(and(
          eq(platformAccounts.userId, Number(userId)),
          eq(platformAccounts.platform, integrationId),
        ))
        .limit(1);

      if (account.length > 0) {
        await db
          .update(platformAccounts)
          .set({ isActive: 0 })
          .where(and(
            eq(platformAccounts.userId, Number(userId)),
            eq(platformAccounts.platform, integrationId),
          ));

        // Clear cache
        const key = getCacheKey(userId, integrationId);
        healthCache.delete(key);

        log.info(`Disconnected ${integrationId} for user ${userId}`);
        return { success: true, message: `${integrationId} disconnected` };
      }

      return { success: false, message: `${integrationId} not found` };
    } catch (err) {
      log.error(
        `Failed to disconnect ${integrationId}:`,
        err instanceof Error ? err.message : String(err),
      );
      return {
        success: false,
        message: `Disconnect failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Get all local (token-based) integrations.
   * Maps API key environment variables to IntegrationHealth.
   */
  private getLocalIntegrations(): IntegrationHealth[] {
    const local: IntegrationHealth[] = [];

    // Check API-key-based services
    const keyBasedServices: Array<{
      id: string;
      name: string;
      envVar: string;
    }> = [
      { id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY" },
      { id: "anthropic", name: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
      { id: "elevenlabs", name: "ElevenLabs", envVar: "ELEVENLABS_API_KEY" },
      { id: "gemini", name: "Gemini", envVar: "GEMINI_API_KEY" },
      { id: "fal_ai", name: "Fal AI", envVar: "FAL_API_KEY" },
      { id: "honcho", name: "Honcho", envVar: "HONCHO_API_KEY" },
      { id: "huggingface", name: "Hugging Face", envVar: "HUGGINGFACE_API_KEY" },
    ];

    for (const svc of keyBasedServices) {
      const keyCheck = verifyApiKey(svc.envVar);
      local.push({
        id: svc.id,
        name: svc.name,
        status: keyCheck.valid ? "connected" : "disconnected",
        lastCheckedAt: new Date().toISOString(),
        errorMessage: keyCheck.error,
      });
    }

    return local;
  }

  /**
   * Get a single local integration by ID.
   */
  private getLocalIntegration(integrationId: string): IntegrationHealth | null {
    const locals = this.getLocalIntegrations();
    return locals.find(i => i.id === integrationId) ?? null;
  }

  /**
   * Map integration ID to display name.
   */
  private getPlatformDisplayName(platform: string): string {
    const names: Record<string, string> = {
      github: "GitHub",
      notion: "Notion",
      slack: "Slack",
      google_drive: "Google Drive",
      dropbox: "Dropbox",
      onedrive: "OneDrive",
      twitter: "Twitter / X",
      linkedin: "LinkedIn",
      instagram: "Instagram",
      tiktok: "TikTok",
      facebook: "Facebook",
      youtube: "YouTube",
      openai: "OpenAI",
      anthropic: "Anthropic",
      elevenlabs: "ElevenLabs",
      gemini: "Google Gemini",
      fal_ai: "Fal AI",
      honcho: "Honcho",
      huggingface: "Hugging Face",
    };
    return names[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
  }
}

export const integrationManagementService = new IntegrationManagementService();
