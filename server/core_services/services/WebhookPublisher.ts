/**
 * WebhookPublisher — publishes the "painful" social platforms (X/Twitter,
 * LinkedIn, Facebook, Instagram) through a self-hosted n8n workflow instead of
 * in-app OAuth API clients. (YouTube is intentionally out of scope — it needs
 * resumable video upload, not a text webhook post.)
 *
 * Why: those platforms require developer-app registration + review (Meta app
 * review, X paid API, LinkedIn Marketing approval) — the part that's genuinely a
 * nightmare to set up. n8n already holds the platform credentials (connected
 * once, via consumer OAuth in n8n's own UI), so Omnecor just fires one webhook
 * and lets n8n fan out. This collapses four bespoke API choreographies into a
 * single code path and removes the dev-app burden for exactly the platforms
 * that caused it.
 *
 * Contract — Omnecor POSTs to `${N8N_URL}/webhook/${path}`:
 *   { platform, content, mediaUrls?, title? }
 * and n8n's "Respond to Webhook" node returns synchronously:
 *   { ok: true,  platformPostId, url }                  // success
 *   { ok: false, error, retryAfterSec? }                // failure (rate limit → retryAfterSec)
 *
 * Sovereign safety: N8N_URL defaults to loopback (127.0.0.1), which keeps the
 * air-gap intact. Pointing it at a remote/cloud n8n is an external egress, so
 * in sovereign execution mode a non-loopback target is refused (fail closed).
 */
import { createLogger } from "../../_core/logger.js";
import { RateLimitError, type PublishInput, type PublishResult } from "./publishTypes.js";

const log = createLogger("WebhookPublisher");

/** Settings key holding the n8n Webhook node path (the bit after `/webhook/`). */
export const SOCIAL_WEBHOOK_PATH_KEY = "socialPublishWebhookPath";
/** Default n8n webhook path — matches the path baked into the shipped blueprint. */
export const DEFAULT_SOCIAL_WEBHOOK_PATH = "omnecor-social-publish";

export interface WebhookPublishOpts {
  /** n8n base URL, e.g. http://127.0.0.1:5678 (from ENV.n8nUrl). */
  n8nUrl: string;
  /** Webhook node path (from settings, defaults to DEFAULT_SOCIAL_WEBHOOK_PATH). */
  webhookPath: string;
  /** True when the publishing user is in sovereign (air-gapped) execution mode. */
  sovereign: boolean;
}

/** True when `urlStr`'s host is a loopback address (air-gap safe). */
export function isLoopbackUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export class WebhookPublisher {
  /** Publish one post for a webhook-routed platform via the n8n workflow. */
  async publish(
    platform: string,
    input: PublishInput,
    opts: WebhookPublishOpts,
  ): Promise<PublishResult> {
    const base = opts.n8nUrl.replace(/\/$/, "");

    // Air-gap guard: a sovereign user must not egress to a remote automation host.
    if (opts.sovereign && !isLoopbackUrl(base)) {
      throw new Error(
        `Sovereign mode: refusing to publish "${platform}" through a non-local n8n (${base}). ` +
        `Point N8N_URL at a local instance (http://127.0.0.1:5678) or disable sovereign mode.`,
      );
    }

    const url = `${base}/webhook/${encodeURIComponent(opts.webhookPath)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          content: input.content,
          ...(input.mediaUrls?.length ? { mediaUrls: input.mediaUrls } : {}),
          ...(input.title ? { title: input.title } : {}),
        }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not reach n8n at ${base} — is it running and is the "${opts.webhookPath}" workflow active? (${detail})`,
      );
    }

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

    // n8n returns 404 for an inactive/missing webhook path — surface it clearly.
    if (res.status === 404) {
      throw new Error(
        `n8n has no active "${opts.webhookPath}" webhook — import the Omnecor social-publish blueprint and activate the workflow.`,
      );
    }
    if (!res.ok) {
      throw new Error(`n8n webhook for "${platform}" failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    }

    // Workflow-level failure (the platform call inside n8n rejected).
    if (body.ok === false) {
      const retryAfterSec = typeof body.retryAfterSec === "number" ? body.retryAfterSec : undefined;
      const message = typeof body.error === "string" ? body.error : `Publishing "${platform}" via n8n failed`;
      if (retryAfterSec && retryAfterSec > 0) {
        throw new RateLimitError(platform, Math.min(6 * 60 * 60, Math.max(30, Math.round(retryAfterSec))), message);
      }
      throw new Error(message);
    }

    const platformPostId =
      (typeof body.platformPostId === "string" && body.platformPostId) ||
      (typeof body.id === "string" && body.id) ||
      "";
    const url_ = (typeof body.url === "string" && body.url) || "";
    if (!platformPostId && !url_) {
      throw new Error(
        `n8n accepted the "${platform}" post but returned no platformPostId/url — ` +
        `add a "Respond to Webhook" node returning { ok, platformPostId, url }.`,
      );
    }
    log.info(`Published "${platform}" via n8n`, { url: url_ });
    return { platformPostId: platformPostId || url_, url: url_ };
  }
}
