/**
 * Shared publishing types + platform routing sets.
 *
 * Extracted from PublishingService so WebhookPublisher can depend on these
 * without importing PublishingService (which imports WebhookPublisher) — i.e.
 * to break the import cycle. PublishingService re-exports everything here for
 * back-compat, so existing `from "./PublishingService.js"` imports keep working.
 */

/** Platforms published through the n8n webhook workflow (dev-app registration required). */
export const WEBHOOK_PLATFORMS = new Set(["twitter", "x", "linkedin", "facebook", "instagram"]);
/** Platforms published natively from here (registration-free, single request). */
export const NATIVE_PLATFORMS = new Set(["bluesky", "mastodon", "discord", "telegram"]);

/**
 * Thrown when a platform rate-limits the request (HTTP 429, or a provider's
 * rate-limit error code). Carries the number of seconds to wait before retrying
 * so the publish executor can reschedule rather than hard-fail.
 */
export class RateLimitError extends Error {
  constructor(
    public readonly platform: string,
    public readonly retryAfterSec: number,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface PublishAccount {
  id: number;
  platform: string;
  /** Native-platform secret: Bluesky app password, Mastodon token, Discord webhook URL, Telegram bot token. Sentinel for webhook platforms. */
  oauthToken: string;
  oauthRefreshToken?: string | null;
  /** Per-platform extras: { identifier, service } / { instanceUrl } / { chatId } / { routing: "n8n" }. */
  accountMetadata?: unknown;
}

export interface PublishInput {
  content: string;
  /** Optional media URLs (Instagram requires one; Telegram/Discord/Bluesky use the first). */
  mediaUrls?: string[];
  /** Optional title — forwarded to the n8n webhook payload for platforms that accept one; unused by the native publishers. */
  title?: string;
  /** True when the publishing user is in sovereign mode — gates non-local webhook egress. */
  sovereign?: boolean;
}

export interface PublishResult {
  platformPostId: string;
  url: string;
  /** Updated token, when a refresh occurred — caller should persist it. (Native platforms don't refresh.) */
  refreshedToken?: { accessToken: string; refreshToken?: string; expiresInSec?: number };
}
