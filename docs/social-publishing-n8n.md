# Social publishing — hybrid (native + n8n)

Omnecor publishes scheduled posts two ways, split by how painful the platform is
to set up:

| Path | Platforms | How credentials are held |
|---|---|---|
| **Native** (direct from Omnecor) | Bluesky, Mastodon, Discord, Telegram | A single secret stored on the connected account (app password / access token / webhook URL / bot token). No developer app. |
| **Webhook → n8n** | X (Twitter), LinkedIn, Facebook, Instagram | n8n holds the OAuth credentials. You connect each account **once inside n8n**, so Omnecor never registers a developer app for these. |

The native path keeps the air-gap intact. The webhook path stays air-gap-safe too
**as long as n8n runs locally** — `N8N_URL` defaults to `http://127.0.0.1:5678`.

## Why route the "painful four" through n8n

X, LinkedIn, Facebook and Instagram all require developer-app registration and
review (Meta app review, X's paid API, LinkedIn Marketing approval). n8n already
ships managed OAuth integrations for them, so you log in with a normal account
instead of building and getting an app approved. One code path in Omnecor
(`WebhookPublisher`) replaces four bespoke API clients.

> **YouTube** is intentionally *not* a webhook target. It has no text/community
> post API — publishing means a resumable video upload of an actual file, which
> doesn't fit a text scheduler. Scheduling a YouTube post returns a clear
> "not supported" error rather than pretending to work.

> The shipped blueprint is a **starting point**, not a turnkey workflow. After
> importing, open each node, attach its credential, and **send a test** to
> confirm the response shape before you activate. Instagram in particular needs a
> connected Facebook Page with a linked IG business account and an image in
> `mediaUrls[0]` (the Graph API rejects text-only posts).

## One-time setup (≈ 2 minutes)

1. **Run n8n locally.** Default expected at `http://127.0.0.1:5678`. To point
   elsewhere, set `N8N_URL`. (A *non-loopback* `N8N_URL` is refused in
   **sovereign** execution mode — see below.)
2. **Import the blueprint.** In Omnecor: *Agent Networking → Platforms →
   Publish via n8n → Download n8n blueprint*. In n8n: *Workflows → Import from
   File* and select `omnecor-social-publish.blueprint.json`.
   (Served at `/n8n/omnecor-social-publish.blueprint.json`; source lives at
   `client/public/n8n/`.)
3. **Connect each platform node + test.** Open *Post to X*, *Post to LinkedIn*,
   *Post to Facebook*, and the *IG: …* nodes. Pick or create the matching n8n
   OAuth2 credential and authorize (consumer login, no developer app), then use
   each node's **Test step** to confirm it posts and returns an id before
   activating. The LinkedIn branch resolves the author URN via *LinkedIn: get me*;
   the Instagram branch resolves the IG business account, creates a media
   container, then publishes it.
4. **Activate the workflow.** Its Webhook node path must match the **Webhook
   path** field in Omnecor (default `omnecor-social-publish`).
5. **Enable platforms in Omnecor.** *Publish via n8n →* click **Enable via n8n**
   for each platform you connected. That registers a lightweight platform
   account so you can schedule posts against it.

## The contract

Omnecor POSTs to `${N8N_URL}/webhook/${webhookPath}`:

```json
{ "platform": "twitter", "content": "…", "mediaUrls": ["…"], "title": "…" }
```

n8n's **Respond to Webhook** node returns synchronously so Omnecor records the
real result (no async callback needed):

```json
{ "ok": true, "platformPostId": "1790…", "url": "https://x.com/i/web/status/1790…" }
```

On failure return `{ "ok": false, "error": "…" }`. For a transient rate limit add
`"retryAfterSec": 900` and Omnecor reschedules the post instead of failing it.

## Sovereign mode

Sovereign (air-gapped) users may publish, but Omnecor **refuses to egress to a
remote n8n**: if `N8N_URL` is not a loopback address and the publishing user is
sovereign, the webhook publish fails closed with a clear message. Keep n8n local
(`http://127.0.0.1:5678`) to publish in sovereign mode, or switch the user out of
sovereign mode.

## Native platform fields

| Platform | Stored secret (`oauthToken`) | Metadata |
|---|---|---|
| Bluesky | App password | `{ identifier, service }` |
| Mastodon | Access token | `{ instanceUrl }` |
| Discord | Channel webhook URL | — |
| Telegram | Bot token | `{ chatId }` |
