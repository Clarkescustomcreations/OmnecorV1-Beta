---
name: run-omnecor
description: Build, run, and drive Omnecor. Use when asked to start Omnecor, run its dev server, build it, take a screenshot of its UI, test the chat page, or interact with the running app.
---

Omnecor is a React + Express/tRPC web app served on port 3000. Drive it via
`.claude/skills/run-omnecor/driver.mjs` — a Playwright script that launches
headless Chromium against the production server and takes screenshots.

All paths below are relative to the repo root.

## Prerequisites

```bash
# Playwright's Chromium is already bundled with VS Code on this machine:
# /home/linux/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome
# No apt-get required.
```

Runtime: Node 24, pnpm 10 (both available globally).

## Setup

```bash
pnpm install
```

Required env vars (must be set **before** `pnpm build` — Vite bakes them in):

```bash
export VITE_OAUTH_PORTAL_URL=http://localhost:9999   # dummy OK for local smoke
export VITE_APP_ID=omnecor-local                     # dummy OK for local smoke
export VITE_WS_URL=ws://localhost:3000               # optional, defaults gracefully
```

Production server also needs:

```bash
export OAUTH_SERVER_URL=http://localhost:9999        # prevents server crash on missing URL
```

## Build

```bash
VITE_OAUTH_PORTAL_URL=http://localhost:9999 \
VITE_APP_ID=omnecor-local \
pnpm build
```

Output: `dist/public/` (frontend) + `dist/index.js` (server).

## Run (agent path)

**1. Start the production server** (rate-limit-safe — single bundled request per page):

```bash
OAUTH_SERVER_URL=http://localhost:9999 \
NODE_ENV=production \
node dist/index.js > /tmp/omnecor.log 2>&1 &

# Poll until ready
timeout 20 bash -c 'until curl -sf http://localhost:3000/ -o /dev/null; do sleep 1; done'
echo "ready"
```

**2. Run the smoke driver** (takes screenshots, checks for JS errors):

```bash
node .claude/skills/run-omnecor/driver.mjs
```

Screenshots land in `/tmp/omnecor-shots/`:
- `01-home.png` — dashboard / landing
- `02-chat.png` — chat interface (ConversationList, model selector, input toolbar)
- `03-model-hub.png` — model management page

**Stop the server:**

```bash
pkill -f "node dist/index.js"
```

**Env overrides for the driver:**

| var | default | purpose |
|---|---|---|
| `OMNECOR_URL` | `http://localhost:3000` | server base URL |
| `SHOT_DIR` | `/tmp/omnecor-shots` | where screenshots land |

## Run (human / dev path)

Dev server (HMR, no build needed):

```bash
pnpm dev   # → http://localhost:3000 — stop with Ctrl-C
```

Note: **do not use the dev server with the smoke driver** — Vite serves each
ES module as a separate HTTP request (~100+ per page load), instantly hitting
the express-rate-limit of 100 req/60s and getting 429s. Use the production
build for headless testing.

## Test

```bash
pnpm test   # vitest — 177 tests across 9 files, ~3s
```

## Gotchas

- **`VITE_OAUTH_PORTAL_URL` must be set before `pnpm build`**, not at runtime.
  Vite embeds `import.meta.env.VITE_*` at build time. If it's missing, the
  frontend throws `TypeError: Invalid URL` immediately on load (React error
  boundary catches it). Setting the env var to a dummy `http://localhost:9999`
  is enough — the OAuth portal is never contacted in local dev.

- **Express rate limiter fires during Vite dev mode.** The limiter is
  `app.use(rateLimit({ windowMs: 60_000, max: 100 }))` applied to all routes.
  A single Vite page load makes 100+ requests (one per source file via HMR).
  Use the **production build** for agent testing.

- **WebSocket 400 errors are expected in local dev.** The app connects to
  `ws://localhost:3000/api/trpc` and `/ws` — both fail without a real Ollama
  or ChromaDB instance. The UI degrades gracefully; screenshots are not affected.

- **Chromium binary path is machine-specific.** The driver hardcodes
  `/home/linux/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`.
  If this machine's Playwright version differs, update the path:
  `find ~/.cache/ms-playwright -name chrome | head -1`

- **MySQL/Drizzle connection errors on startup are expected** without a live DB.
  The server logs `DrizzleQueryError` for token refresh — the app runs in a
  degraded state but serves the UI fine.

## Troubleshooting

- **Screenshot is blank/white**: The React app didn't hydrate. Increase the
  `waitForTimeout(3000)` in `driver.mjs` or check for a `TypeError` in the
  console output — likely `VITE_OAUTH_PORTAL_URL` was not set before build.

- **`EADDRINUSE :3000`**: A previous server is still running.
  `pkill -f "node dist/index"` before restarting.

- **`ERR_MODULE_NOT_FOUND` for playwright-core**: The VS Code install provides
  it at `/usr/share/code/resources/app/node_modules/playwright-core/index.mjs`.
  If that path is missing, install with `npm install -g playwright` and update
  the import path in `driver.mjs`.
