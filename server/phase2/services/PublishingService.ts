/**
 * PublishingService — posts content to real social platforms.
 *
 * Replaces the previous DB-only shell (scheduling just flipped a status flag).
 * Each platform method makes the actual provider API call using the OAuth
 * token stored on the platformAccounts row, resolving any extra identifiers
 * (LinkedIn author URN, Facebook Page token/id, Instagram business id) at
 * publish time. On a 401 it transparently refreshes the token once.
 *
 * Returns { platformPostId, url } on success and throws a descriptive error on
 * failure — callers persist that to scheduledPosts.errorMessage / status.
 */
import { createLogger } from "../../_core/logger.js";
import { refreshOAuthToken } from "../../oauth/oauthClients.js";

const log = createLogger("PublishingService");

/**
 * Thrown when a platform rate-limits the request (HTTP 429, or a Graph API
 * rate-limit error code). Carries the number of seconds to wait before
 * retrying (parsed from `Retry-After` / `x-rate-limit-reset`, clamped to a sane
 * window) so the publish executor can reschedule rather than hard-fail — rate
 * limits are transient and self-resolving, unlike a 4xx auth/permission error.
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
  oauthToken: string;
  oauthRefreshToken?: string | null;
  accountMetadata?: unknown;
}

export interface PublishInput {
  content: string;
  /** Optional media URLs (required for Instagram, and for YouTube video upload). */
  mediaUrls?: string[];
  /** Optional title (used by YouTube). */
  title?: string;
}

export interface PublishResult {
  platformPostId: string;
  url: string;
  /** Updated token, when a refresh occurred — caller should persist it. */
  refreshedToken?: { accessToken: string; refreshToken?: string; expiresInSec?: number };
}

type Json = Record<string, unknown>;

export class PublishingService {
  private static instance: PublishingService | null = null;
  static getInstance(): PublishingService {
    if (!PublishingService.instance) PublishingService.instance = new PublishingService();
    return PublishingService.instance;
  }

  /** Publish to whichever platform the account belongs to. */
  async publish(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const platform = account.platform.toLowerCase();
    switch (platform) {
      case "twitter":
      case "x":
        return this.publishTwitter(account, input);
      case "linkedin":
        return this.publishLinkedIn(account, input);
      case "facebook":
        return this.publishFacebook(account, input);
      case "instagram":
        return this.publishInstagram(account, input);
      case "youtube":
        return this.publishYouTube(account, input);
      default:
        throw new Error(`Publishing not supported for platform "${account.platform}"`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Run a request with the account's token; on 401, refresh once (if a refresh
   * token exists) and retry. Returns the parsed JSON and, when refreshed, the
   * new token so the caller can persist it.
   */
  private async withAuth(
    account: PublishAccount,
    run: (token: string) => Promise<Response>,
  ): Promise<{ res: Response; refreshed?: PublishResult["refreshedToken"] }> {
    let res = await run(account.oauthToken);
    if (res.status !== 401 || !account.oauthRefreshToken) return { res };

    log.info(`Token expired for ${account.platform}, refreshing`);
    const refreshed = await refreshOAuthToken(account.platform, account.oauthRefreshToken);
    if (!refreshed.access_token) return { res };
    res = await run(refreshed.access_token);
    return {
      res,
      refreshed: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresInSec: refreshed.expires_in,
      },
    };
  }

  private async ensureOk(res: Response, platform: string): Promise<Json> {
    const text = await res.text();
    let body: Json = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const detail = JSON.stringify(body).slice(0, 500);
      // Treat HTTP 429 — and Meta Graph API rate-limit error codes (4 = app
      // rate limit, 17 = user rate limit, 32 = page rate limit, 613 = custom
      // rate limit), which Graph returns as HTTP 400 — as a transient rate
      // limit so the executor reschedules instead of marking the post failed.
      const graphCode = ((body.error as Json | undefined)?.code);
      const isGraphRateLimit = typeof graphCode === "number" && [4, 17, 32, 613].includes(graphCode);
      if (res.status === 429 || isGraphRateLimit) {
        throw new RateLimitError(platform, this.parseRetryAfter(res), `${platform} API rate limited (${res.status}): ${detail}`);
      }
      throw new Error(`${platform} API ${res.status}: ${detail}`);
    }
    return body;
  }

  /**
   * Seconds to wait before retrying a rate-limited request. Honors `Retry-After`
   * (delta-seconds or an HTTP date), then Twitter's `x-rate-limit-reset` (epoch
   * seconds), defaulting to 15 min. Clamped to [30 s, 6 h] so a bogus header
   * can't park a post for days or hammer the API instantly.
   */
  private parseRetryAfter(res: Response): number {
    const DEFAULT_SEC = 15 * 60;
    const clamp = (n: number): number => Math.min(6 * 60 * 60, Math.max(30, Math.round(n)));

    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) {
      const asSeconds = Number(retryAfter);
      if (Number.isFinite(asSeconds)) return clamp(asSeconds);
      const asDate = Date.parse(retryAfter);
      if (Number.isFinite(asDate)) return clamp((asDate - Date.now()) / 1000);
    }

    const reset = res.headers.get("x-rate-limit-reset"); // Twitter v2 — epoch seconds
    if (reset) {
      const epoch = Number(reset);
      if (Number.isFinite(epoch)) return clamp(epoch - Date.now() / 1000);
    }

    return DEFAULT_SEC;
  }

  // ── X / Twitter ──────────────────────────────────────────────────────────
  // POST https://api.twitter.com/2/tweets  { text }
  private async publishTwitter(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const { res, refreshed } = await this.withAuth(account, (token) =>
      fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.content }),
      }),
    );
    const body = await this.ensureOk(res, "Twitter");
    const id = (body.data as Json | undefined)?.id as string | undefined;
    if (!id) throw new Error("Twitter: no tweet id returned");
    return { platformPostId: id, url: `https://x.com/i/web/status/${id}`, refreshedToken: refreshed };
  }

  // ── LinkedIn ───────────────────────────────────────────────────────────────
  // Resolve author urn via /v2/me, then POST /v2/ugcPosts (UGC share).
  private async publishLinkedIn(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    // Resolve the member id → author URN.
    const meRes = await fetch("https://api.linkedin.com/v2/me", {
      headers: { Authorization: `Bearer ${account.oauthToken}` },
    });
    const me = await this.ensureOk(meRes, "LinkedIn(/me)");
    const personId = me.id as string | undefined;
    if (!personId) throw new Error("LinkedIn: could not resolve member id");
    const authorUrn = `urn:li:person:${personId}`;

    const payload = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: input.content },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const { res, refreshed } = await this.withAuth(account, (token) =>
      fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(payload),
      }),
    );
    const body = await this.ensureOk(res, "LinkedIn");
    const id = (body.id as string | undefined) ?? (res.headers.get("x-restli-id") ?? undefined);
    if (!id) throw new Error("LinkedIn: no post id returned");
    return { platformPostId: id, url: `https://www.linkedin.com/feed/update/${id}`, refreshedToken: refreshed };
  }

  // ── Facebook Page ────────────────────────────────────────────────────────
  // Resolve a managed Page (token + id) via /me/accounts, then POST /{page}/feed.
  private async publishFacebook(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const page = await this.resolveFacebookPage(account);
    const params = new URLSearchParams({ message: input.content, access_token: page.accessToken });
    const res = await fetch(`https://graph.facebook.com/v18.0/${page.id}/feed`, {
      method: "POST",
      body: params,
    });
    const body = await this.ensureOk(res, "Facebook");
    const id = body.id as string | undefined;
    if (!id) throw new Error("Facebook: no post id returned");
    return { platformPostId: id, url: `https://www.facebook.com/${id}` };
  }

  private async resolveFacebookPage(account: PublishAccount): Promise<{ id: string; accessToken: string }> {
    // Prefer a page pinned in account metadata; otherwise use the first managed page.
    const meta = (account.accountMetadata ?? {}) as Json;
    const res = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(account.oauthToken)}`,
    );
    const body = await this.ensureOk(res, "Facebook(/me/accounts)");
    const pages = (body.data as Array<Json> | undefined) ?? [];
    if (pages.length === 0) {
      throw new Error("Facebook: no managed Pages found for this account (a Page is required to publish).");
    }
    const pinnedId = meta.pageId as string | undefined;
    const page = (pinnedId ? pages.find((p) => p.id === pinnedId) : undefined) ?? pages[0];
    return { id: page.id as string, accessToken: page.access_token as string };
  }

  // ── Instagram (requires media; text-only is not supported by the API) ──────
  private async publishInstagram(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const imageUrl = input.mediaUrls?.[0];
    if (!imageUrl) {
      throw new Error("Instagram requires an image/video URL — the Graph API does not support text-only posts.");
    }
    const igUserId = await this.resolveInstagramUserId(account);
    // 1) Create a media container.
    const createParams = new URLSearchParams({
      image_url: imageUrl,
      caption: input.content,
      access_token: account.oauthToken,
    });
    const createRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media`, {
      method: "POST",
      body: createParams,
    });
    const created = await this.ensureOk(createRes, "Instagram(create)");
    const creationId = created.id as string | undefined;
    if (!creationId) throw new Error("Instagram: no creation id returned");
    // 2) Publish the container.
    const pubParams = new URLSearchParams({ creation_id: creationId, access_token: account.oauthToken });
    const pubRes = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
      method: "POST",
      body: pubParams,
    });
    const published = await this.ensureOk(pubRes, "Instagram(publish)");
    const id = published.id as string | undefined;
    if (!id) throw new Error("Instagram: no media id returned");
    return { platformPostId: id, url: `https://www.instagram.com/p/${id}` };
  }

  private async resolveInstagramUserId(account: PublishAccount): Promise<string> {
    const meta = (account.accountMetadata ?? {}) as Json;
    if (meta.instagramUserId) return meta.instagramUserId as string;
    // IG business account is attached to a Facebook Page.
    const page = await this.resolveFacebookPage(account);
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.accessToken)}`,
    );
    const body = await this.ensureOk(res, "Instagram(resolve)");
    const ig = (body.instagram_business_account as Json | undefined)?.id as string | undefined;
    if (!ig) throw new Error("Instagram: no business account linked to the connected Facebook Page.");
    return ig;
  }

  // ── YouTube (community/text posts are not exposed by the Data API) ─────────
  private async publishYouTube(_account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const hasVideo = input.mediaUrls?.some((u) => /\.(mp4|mov|webm|mkv|avi)$/i.test(u));
    if (!hasVideo) {
      throw new Error(
        "YouTube publishing requires a video file — the Data API does not support text-only community posts. " +
        "Attach a video to publish to YouTube.",
      );
    }
    // Video upload is a resumable, multi-step flow handled by the dedicated
    // YouTube uploader; routing here keeps the contract explicit rather than
    // silently succeeding.
    throw new Error("YouTube video upload is handled by the media uploader; text scheduling to YouTube is not applicable.");
  }
}
