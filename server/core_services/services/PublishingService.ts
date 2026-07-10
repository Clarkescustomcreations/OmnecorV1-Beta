/**
 * PublishingService — posts content to real social platforms, split by how
 * painful the platform is to set up:
 *
 *  • Webhook-routed (X/Twitter, LinkedIn, Facebook, Instagram) — the platforms
 *    that require developer-app registration + review. These are published
 *    through a self-hosted n8n workflow (see WebhookPublisher), so n8n holds the
 *    credentials and Omnecor never touches their OAuth dev apps. (YouTube is not
 *    included — it needs resumable video upload, handled by the media uploader,
 *    not a text webhook post.)
 *
 *  • Native (Bluesky, Mastodon, Discord, Telegram) — registration-free
 *    platforms reachable with a single authenticated request. These publish
 *    directly from here, keeping the air-gap intact (no third party involved).
 *
 * Returns { platformPostId, url } on success and throws a descriptive error on
 * failure — callers persist that to scheduledPosts.errorMessage / status. A
 * RateLimitError signals a transient, self-resolving failure so the executor
 * reschedules instead of marking the post failed.
 */
import { createLogger } from "../../_core/logger.js";
import { ENV } from "../../_core/env.js";
import { getSetting } from "./SettingsService.js";
import {
  WebhookPublisher,
  SOCIAL_WEBHOOK_PATH_KEY,
  DEFAULT_SOCIAL_WEBHOOK_PATH,
} from "./WebhookPublisher.js";
import {
  RateLimitError,
  WEBHOOK_PLATFORMS,
  NATIVE_PLATFORMS,
  type PublishAccount,
  type PublishInput,
  type PublishResult,
} from "./publishTypes.js";

// Re-export shared types/sets so existing importers keep their import path.
export {
  RateLimitError,
  WEBHOOK_PLATFORMS,
  NATIVE_PLATFORMS,
  type PublishAccount,
  type PublishInput,
  type PublishResult,
};

const log = createLogger("PublishingService");

type Json = Record<string, unknown>;

export class PublishingService {
  private static instance: PublishingService | null = null;
  static getInstance(): PublishingService {
    if (!PublishingService.instance) PublishingService.instance = new PublishingService();
    return PublishingService.instance;
  }

  private readonly webhook = new WebhookPublisher();

  /** Publish to whichever platform the account belongs to. */
  async publish(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const platform = account.platform.toLowerCase();

    if (WEBHOOK_PLATFORMS.has(platform)) {
      return this.webhook.publish(platform, input, {
        n8nUrl: ENV.n8nUrl,
        webhookPath: getSetting(SOCIAL_WEBHOOK_PATH_KEY, DEFAULT_SOCIAL_WEBHOOK_PATH),
        sovereign: input.sovereign === true,
      });
    }

    switch (platform) {
      case "bluesky":
        return this.publishBluesky(account, input);
      case "mastodon":
        return this.publishMastodon(account, input);
      case "discord":
        return this.publishDiscord(account, input);
      case "telegram":
        return this.publishTelegram(account, input);
      default:
        throw new Error(`Publishing not supported for platform "${account.platform}"`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ensureOk(res: Response, platform: string): Promise<Json> {
    const text = await res.text();
    let body: Json = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const detail = JSON.stringify(body).slice(0, 500);
      if (res.status === 429) {
        throw new RateLimitError(platform, this.parseRetryAfter(res), `${platform} API rate limited (429): ${detail}`);
      }
      throw new Error(`${platform} API ${res.status}: ${detail}`);
    }
    return body;
  }

  /**
   * Seconds to wait before retrying a rate-limited request. Honors `Retry-After`
   * (delta-seconds or an HTTP date), then an `x-rate-limit-reset` epoch header,
   * defaulting to 15 min. Clamped to [30 s, 6 h] so a bogus header can't park a
   * post for days or hammer the API instantly.
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

    const reset = res.headers.get("x-rate-limit-reset"); // epoch seconds
    if (reset) {
      const epoch = Number(reset);
      if (Number.isFinite(epoch)) return clamp(epoch - Date.now() / 1000);
    }

    return DEFAULT_SEC;
  }

  private meta(account: PublishAccount): Json {
    return (account.accountMetadata ?? {}) as Json;
  }

  // ── Bluesky (AT Protocol) ──────────────────────────────────────────────────
  // Auth: create a session from identifier + app password, then create a post
  // record. oauthToken holds the app password; metadata holds { identifier, service }.
  private async publishBluesky(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const meta = this.meta(account);
    const identifier = meta.identifier as string | undefined;
    if (!identifier) throw new Error("Bluesky: account identifier (handle/email) is required in account metadata.");
    const service = ((meta.service as string | undefined) ?? "https://bsky.social").replace(/\/$/, "");

    const sessionRes = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password: account.oauthToken }),
    });
    const session = await this.ensureOk(sessionRes, "Bluesky(session)");
    const accessJwt = session.accessJwt as string | undefined;
    const did = session.did as string | undefined;
    if (!accessJwt || !did) throw new Error("Bluesky: authentication failed (no session token returned).");

    const postRes = await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessJwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: did,
        collection: "app.bsky.feed.post",
        record: { $type: "app.bsky.feed.post", text: input.content, createdAt: new Date().toISOString() },
      }),
    });
    const body = await this.ensureOk(postRes, "Bluesky");
    const uri = body.uri as string | undefined;
    if (!uri) throw new Error("Bluesky: no post uri returned.");
    const rkey = uri.split("/").pop() ?? "";
    return { platformPostId: uri, url: `https://bsky.app/profile/${identifier}/post/${rkey}` };
  }

  // ── Mastodon ───────────────────────────────────────────────────────────────
  // oauthToken = access token; metadata.instanceUrl = the home instance.
  private async publishMastodon(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const meta = this.meta(account);
    const instance = (meta.instanceUrl as string | undefined)?.replace(/\/$/, "");
    if (!instance) throw new Error("Mastodon: instanceUrl is required in account metadata (e.g. https://mastodon.social).");

    const res = await fetch(`${instance}/api/v1/statuses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.oauthToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: input.content }),
    });
    const body = await this.ensureOk(res, "Mastodon");
    const id = body.id as string | undefined;
    if (!id) throw new Error("Mastodon: no status id returned.");
    const url = (body.url as string | undefined) ?? `${instance}/@me/${id}`;
    return { platformPostId: id, url };
  }

  // ── Discord (incoming webhook) ─────────────────────────────────────────────
  // oauthToken = the channel's incoming webhook URL. `?wait=true` makes Discord
  // return the created message so we can record its id.
  private async publishDiscord(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const webhookUrl = account.oauthToken;
    if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
      throw new Error("Discord: a channel webhook URL (https://discord.com/api/webhooks/…) is required.");
    }
    const sep = webhookUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${webhookUrl}${sep}wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input.content }),
    });
    const body = await this.ensureOk(res, "Discord");
    const id = body.id as string | undefined;
    const channelId = body.channel_id as string | undefined;
    const guildId = body.guild_id as string | undefined;
    if (!id) throw new Error("Discord: no message id returned (was ?wait=true honored?).");
    // A valid Discord jump link is /channels/{guild}/{channel}/{message}. A
    // webhook execute response often omits guild_id, and a 2-segment link 404s,
    // so only build the URL when both ids are present — otherwise leave it empty
    // (platformPostId is authoritative).
    const url = guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}/${id}` : "";
    return { platformPostId: id, url };
  }

  // ── Telegram (Bot API) ─────────────────────────────────────────────────────
  // oauthToken = bot token; metadata.chatId = target chat/channel (@name or id).
  // Returns 200 with { ok:false } on error; 429 carries parameters.retry_after.
  private async publishTelegram(account: PublishAccount, input: PublishInput): Promise<PublishResult> {
    const meta = this.meta(account);
    const chatId = meta.chatId as string | number | undefined;
    if (chatId === undefined || chatId === "") {
      throw new Error("Telegram: chatId is required in account metadata (@channel or numeric id).");
    }
    const image = input.mediaUrls?.[0];
    const method = image ? "sendPhoto" : "sendMessage";
    const payload = image
      ? { chat_id: chatId, photo: image, caption: input.content }
      : { chat_id: chatId, text: input.content };

    const res = await fetch(`https://api.telegram.org/bot${account.oauthToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: Json = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

    if (body.ok !== true) {
      const retryAfter = ((body.parameters as Json | undefined)?.retry_after) as number | undefined;
      const desc = (body.description as string | undefined) ?? `HTTP ${res.status}`;
      if (res.status === 429 || (retryAfter && retryAfter > 0)) {
        throw new RateLimitError("Telegram", Math.min(6 * 60 * 60, Math.max(30, Math.round(retryAfter ?? 900))), `Telegram rate limited: ${desc}`);
      }
      throw new Error(`Telegram API: ${desc}`);
    }

    const result = (body.result ?? {}) as Json;
    const messageId = result.message_id;
    if (messageId === undefined) throw new Error("Telegram: no message_id returned.");
    // Public message link: @username channels → t.me/<name>/<id>; supergroups/
    // channels with a -100… numeric id → t.me/c/<internal>/<id>; private chats
    // have no public link (leave url empty — platformPostId is authoritative).
    const username = ((result.chat as Json | undefined)?.username) as string | undefined;
    let url = "";
    if (username) {
      url = `https://t.me/${username}/${messageId}`;
    } else {
      const supergroup = String(chatId).match(/^-100(\d+)$/);
      if (supergroup) url = `https://t.me/c/${supergroup[1]}/${messageId}`;
    }
    log.info("Published to Telegram", { messageId });
    return { platformPostId: String(messageId), url };
  }
}
