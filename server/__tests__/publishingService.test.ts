/**
 * PublishingService + WebhookPublisher — hybrid social publishing.
 *
 * Covers:
 *   WebhookPublisher.publish(): POSTs the n8n contract + maps synchronous result
 *   WebhookPublisher.publish(): ok:false → Error; ok:false + retryAfterSec → RateLimitError
 *   WebhookPublisher.publish(): 404 (inactive webhook) → descriptive error
 *   WebhookPublisher.publish(): sovereign + non-loopback n8n → fails closed (no fetch)
 *   WebhookPublisher.publish(): sovereign + loopback n8n → allowed
 *   isLoopbackUrl(): loopback hosts vs. remote hosts
 *   PublishingService.publish(): webhook platforms (twitter/x/linkedin/…) route to n8n
 *   PublishingService.publish(): Bluesky create-session → create-record, returns uri + url
 *   PublishingService.publish(): Mastodon POSTs /api/v1/statuses, returns id + url
 *   PublishingService.publish(): Discord webhook ?wait=true → message id; rejects non-webhook URL
 *   PublishingService.publish(): Telegram sendMessage → message_id; ok:false → Error; retry_after → RateLimitError
 *   PublishingService.publish(): unsupported platform → throws
 *   RateLimitError: carries platform + retryAfterSec
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  PublishingService,
  RateLimitError,
  WEBHOOK_PLATFORMS,
  NATIVE_PLATFORMS,
  type PublishAccount,
} from "../core_services/services/PublishingService.js";
import { WebhookPublisher, isLoopbackUrl } from "../core_services/services/WebhookPublisher.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<PublishAccount> = {}): PublishAccount {
  return { id: 1, platform: "twitter", oauthToken: "secret", oauthRefreshToken: null, ...overrides };
}

function makeJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  (PublishingService as any).instance = null;
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Platform set sanity ─────────────────────────────────────────────────────────

describe("platform routing sets", () => {
  it("routes the registration-heavy platforms through the webhook", () => {
    for (const p of ["twitter", "x", "linkedin", "facebook", "instagram"]) {
      expect(WEBHOOK_PLATFORMS.has(p)).toBe(true);
    }
  });
  it("does not route YouTube through the webhook (no text/community post API)", () => {
    expect(WEBHOOK_PLATFORMS.has("youtube")).toBe(false);
  });
  it("routes the registration-free platforms natively", () => {
    for (const p of ["bluesky", "mastodon", "discord", "telegram"]) {
      expect(NATIVE_PLATFORMS.has(p)).toBe(true);
    }
  });
});

// ── isLoopbackUrl ───────────────────────────────────────────────────────────────

describe("isLoopbackUrl", () => {
  it("treats localhost / 127.x / ::1 as loopback", () => {
    expect(isLoopbackUrl("http://127.0.0.1:5678")).toBe(true);
    expect(isLoopbackUrl("http://localhost:5678")).toBe(true);
    expect(isLoopbackUrl("http://127.1.2.3")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:5678")).toBe(true);
  });
  it("treats remote hosts as non-loopback", () => {
    expect(isLoopbackUrl("https://n8n.example.com")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.5:5678")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

// ── WebhookPublisher ────────────────────────────────────────────────────────────

describe("WebhookPublisher", () => {
  const opts = { n8nUrl: "http://127.0.0.1:5678", webhookPath: "omnecor-social-publish", sovereign: false };

  it("POSTs the contract to the n8n webhook and maps the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ ok: true, platformPostId: "tw-1", url: "https://x.com/i/web/status/tw-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WebhookPublisher().publish("twitter", { content: "hi" }, opts);

    expect(result).toEqual({ platformPostId: "tw-1", url: "https://x.com/i/web/status/tw-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:5678/webhook/omnecor-social-publish");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toMatchObject({ platform: "twitter", content: "hi" });
  });

  it("ok:false → Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ ok: false, error: "bad token" })));
    await expect(new WebhookPublisher().publish("linkedin", { content: "x" }, opts)).rejects.toThrow(/bad token/);
  });

  it("ok:false + retryAfterSec → RateLimitError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ ok: false, error: "slow down", retryAfterSec: 120 })));
    try {
      await new WebhookPublisher().publish("twitter", { content: "x" }, opts);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSec).toBe(120);
    }
  });

  it("404 (inactive webhook) → descriptive error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({}, 404)));
    await expect(new WebhookPublisher().publish("twitter", { content: "x" }, opts)).rejects.toThrow(/no active.*webhook|import.*blueprint/i);
  });

  it("missing platformPostId AND url → error (telling the user to add Respond node)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ ok: true })));
    await expect(new WebhookPublisher().publish("twitter", { content: "x" }, opts)).rejects.toThrow(/Respond to Webhook/i);
  });

  it("sovereign + non-loopback n8n → fails closed without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new WebhookPublisher().publish("twitter", { content: "x" }, { n8nUrl: "https://cloud.example.com", webhookPath: "p", sovereign: true }),
    ).rejects.toThrow(/Sovereign/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sovereign + loopback n8n → allowed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ ok: true, platformPostId: "id1", url: "u" })));
    const result = await new WebhookPublisher().publish("twitter", { content: "x" }, { ...opts, sovereign: true });
    expect(result.platformPostId).toBe("id1");
  });
});

// ── PublishingService dispatch → webhook ────────────────────────────────────────

describe("PublishingService.publish — webhook platforms", () => {
  it("twitter routes to the local n8n webhook by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true, platformPostId: "t1", url: "https://x.com/t1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await PublishingService.getInstance().publish(makeAccount({ platform: "twitter" }), { content: "hello" });

    expect(result.platformPostId).toBe("t1");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/webhook/");
  });

  it("'x' alias also routes to the webhook", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ ok: true, platformPostId: "t2", url: "u" })));
    const result = await PublishingService.getInstance().publish(makeAccount({ platform: "x" }), { content: "hi" });
    expect(result.platformPostId).toBe("t2");
  });
});

// ── PublishingService — Bluesky ─────────────────────────────────────────────────

describe("PublishingService.publish — Bluesky", () => {
  it("creates a session then a post record and returns uri + profile url", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ accessJwt: "jwt", did: "did:plc:abc" }))
      .mockResolvedValueOnce(makeJsonResponse({ uri: "at://did:plc:abc/app.bsky.feed.post/xyz", cid: "c" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await PublishingService.getInstance().publish(
      makeAccount({ platform: "bluesky", oauthToken: "app-pw", accountMetadata: { identifier: "me.bsky.social" } }),
      { content: "skeet" },
    );

    expect(result.platformPostId).toBe("at://did:plc:abc/app.bsky.feed.post/xyz");
    expect(result.url).toBe("https://bsky.app/profile/me.bsky.social/post/xyz");
    const [sessionUrl] = fetchMock.mock.calls[0]!;
    expect(String(sessionUrl)).toContain("com.atproto.server.createSession");
    const [recordUrl] = fetchMock.mock.calls[1]!;
    expect(String(recordUrl)).toContain("com.atproto.repo.createRecord");
  });

  it("throws when identifier metadata is missing", async () => {
    await expect(
      PublishingService.getInstance().publish(makeAccount({ platform: "bluesky", accountMetadata: {} }), { content: "x" }),
    ).rejects.toThrow(/identifier/i);
  });
});

// ── PublishingService — Mastodon ────────────────────────────────────────────────

describe("PublishingService.publish — Mastodon", () => {
  it("POSTs /api/v1/statuses and returns id + url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ id: "108", url: "https://mastodon.social/@me/108" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await PublishingService.getInstance().publish(
      makeAccount({ platform: "mastodon", oauthToken: "tok", accountMetadata: { instanceUrl: "https://mastodon.social" } }),
      { content: "toot" },
    );

    expect(result.platformPostId).toBe("108");
    expect(result.url).toBe("https://mastodon.social/@me/108");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://mastodon.social/api/v1/statuses");
  });

  it("maps HTTP 429 to RateLimitError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ error: "slow" }, 429, { "retry-after": "60" })));
    try {
      await PublishingService.getInstance().publish(
        makeAccount({ platform: "mastodon", accountMetadata: { instanceUrl: "https://m.example" } }),
        { content: "x" },
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSec).toBe(60);
    }
  });
});

// ── PublishingService — Discord ─────────────────────────────────────────────────

describe("PublishingService.publish — Discord", () => {
  it("POSTs to the webhook with ?wait=true and returns the message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ id: "msg-1", channel_id: "chan-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await PublishingService.getInstance().publish(
      makeAccount({ platform: "discord", oauthToken: "https://discord.com/api/webhooks/1/abc" }),
      { content: "hello" },
    );

    expect(result.platformPostId).toBe("msg-1");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("wait=true");
  });

  it("rejects a non-webhook URL", async () => {
    await expect(
      PublishingService.getInstance().publish(
        makeAccount({ platform: "discord", oauthToken: "https://example.com/not-a-webhook" }),
        { content: "x" },
      ),
    ).rejects.toThrow(/webhook URL/i);
  });
});

// ── PublishingService — Telegram ────────────────────────────────────────────────

describe("PublishingService.publish — Telegram", () => {
  it("sendMessage returns message_id and a t.me url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeJsonResponse({ ok: true, result: { message_id: 42, chat: { username: "mychannel" } } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await PublishingService.getInstance().publish(
      makeAccount({ platform: "telegram", oauthToken: "123:ABC", accountMetadata: { chatId: "@mychannel" } }),
      { content: "ping" },
    );

    expect(result.platformPostId).toBe("42");
    expect(result.url).toBe("https://t.me/mychannel/42");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/bot123:ABC/sendMessage");
  });

  it("uses sendPhoto when a media URL is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true, result: { message_id: 7, chat: {} } }));
    vi.stubGlobal("fetch", fetchMock);
    await PublishingService.getInstance().publish(
      makeAccount({ platform: "telegram", oauthToken: "t", accountMetadata: { chatId: "1" } }),
      { content: "cap", mediaUrls: ["https://img/x.jpg"] },
    );
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/sendPhoto");
  });

  it("ok:false → Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ ok: false, description: "chat not found" })));
    await expect(
      PublishingService.getInstance().publish(
        makeAccount({ platform: "telegram", oauthToken: "t", accountMetadata: { chatId: "1" } }),
        { content: "x" },
      ),
    ).rejects.toThrow(/chat not found/i);
  });

  it("retry_after → RateLimitError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeJsonResponse({ ok: false, description: "Too Many Requests", parameters: { retry_after: 45 } }, 429),
    ));
    try {
      await PublishingService.getInstance().publish(
        makeAccount({ platform: "telegram", oauthToken: "t", accountMetadata: { chatId: "1" } }),
        { content: "x" },
      );
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterSec).toBe(45);
    }
  });
});

// ── Unsupported + RateLimitError class ──────────────────────────────────────────

describe("PublishingService.publish — unsupported platform", () => {
  it("throws for an unknown platform", async () => {
    await expect(
      PublishingService.getInstance().publish(makeAccount({ platform: "myspace" }), { content: "x" }),
    ).rejects.toThrow(/not supported.*myspace/i);
  });
});

describe("RateLimitError", () => {
  it("carries name, platform, and retryAfterSec", () => {
    const err = new RateLimitError("Telegram", 300, "rate limited");
    expect(err.name).toBe("RateLimitError");
    expect(err.platform).toBe("Telegram");
    expect(err.retryAfterSec).toBe(300);
    expect(err).toBeInstanceOf(Error);
  });
});
