# Local Testing — Authenticated Sessions Without Friction

How to get an authenticated session for local development and automated tests,
and what each option actually gives you. Read the
[background](#background-the-zero-login-discrepancy) first if you've ever been
confused about whether zero-login blocks cloud calls — that confusion was a real
docs/code discrepancy, now fixed.

There are **three** ways to get a session. Pick by what you're testing:

| Option | Real login flow? | Cloud calls work? | Best for |
|---|---|---|---|
| **Zero-login** (`ZERO_LOGIN_MODE=true`) | No (bypasses auth) | Only if `ZERO_LOGIN_EXECUTION_MODE` ≠ `sovereign` | Fastest path; UI/feature work that doesn't care about the login flow |
| **A — Emulated OAuth** | Yes (full Google/Microsoft flow, fake provider) | Yes (session is real, scrapper by default) | Testing the actual sign-in + session/redirect flow locally |
| **B — Seed script** | No (mints a cookie directly) | Yes | Headless/automated tests (Playwright, curl) that need a token instantly |

---

## Background: the zero-login discrepancy

Until 2026-06-21 the code hardcoded the zero-login local-admin user to
`executionMode: "scrapper"` (cloud **allowed**), while the README, the
execution-modes doc, and the in-app banner all claimed zero-login "auto-enforces
Sovereign Mode" (cloud **blocked**). Code and docs said opposite things, so
nobody could trust which mode a zero-login session was really in — the root of a
lot of "is cloud supposed to work here?" testing confusion.

**Resolution:** the zero-login execution mode is now controlled by
`ZERO_LOGIN_EXECUTION_MODE`, which **defaults to `sovereign`** (true air-gap,
cloud blocked — matching how zero-login is marketed for classified/offline use).
The flag is authoritative: it overrides any value previously persisted on the
`local-zero-login` user, and the in-app banner now reports the *actual* mode.

```bash
# Air-gapped (default): cloud inference blocked
ZERO_LOGIN_MODE=true

# Testing: allow spend-tracked cloud calls under the local-admin session
ZERO_LOGIN_MODE=true
ZERO_LOGIN_EXECUTION_MODE=scrapper      # or big_spender
```

> Remember: `.env` is read once at startup via `dotenv/config`, so **restart the
> dev server after editing it.** A stale `tsx watch` holding `:3000` will keep
> serving the old env — kill it first (`fuser -k 3000/tcp`).

---

## Prerequisites for A and B

Both real-session paths sign a JWT that the server verifies on every request.
`verifySession()` rejects a token whose `appId` **or** `name` is empty, so two
`.env` values must be set (they already are in `.env.example`):

```bash
JWT_SECRET=<any non-empty secret>   # server signs + verifies sessions with this
VITE_APP_ID=omnecor-local-dev       # becomes the token's appId; must be non-empty
```

The session cookie is `app_session_id` (`SameSite=Strict`, `httpOnly`).

---

## Option A — Emulated OAuth (real login flow, fake provider)

Tests the *real* Google/Microsoft sign-in + callback + session flow without real
credentials or hitting real provider APIs. Uses the local OAuth/OIDC emulators
from the `google` and `microsoft` skills.

The app's OAuth routes (`server/_core/oauth.ts`) point at the emulator when
`GOOGLE_EMULATOR_URL` / `MICROSOFT_EMULATOR_URL` is set, and at real Google /
Microsoft otherwise (production default unchanged).

### 1. Launch an emulator

```bash
npx emulate --service google       # → http://localhost:4002
# and/or
npx emulate --service microsoft    # → http://localhost:4005
```

### 2. Configure `.env` and restart the dev server

```bash
# Do NOT set ZERO_LOGIN_MODE — it skips OAuth route registration entirely.
GOOGLE_CLIENT_ID=my-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-secret
GOOGLE_EMULATOR_URL=http://localhost:4002

MICROSOFT_CLIENT_ID=example-client-id
MICROSOFT_CLIENT_SECRET=example-client-secret
MICROSOFT_EMULATOR_URL=http://localhost:4005
```

(You can instead paste the client ID/secret into **Settings → Social Login** —
`SettingsService.getSecret` takes precedence over the env vars.)

### 3. Tell the emulator about the redirect URI

The emulator enforces `redirect_uri` only when OAuth clients are seeded. Seed a
client whose `redirect_uris` includes the app's callback (the app derives it from
the request host):

```
http://localhost:3000/api/oauth/google/callback
http://localhost:3000/api/oauth/microsoft/callback
```

### 4. Sign in

Open the app and click **Sign in with Google / Microsoft** (or hit
`/api/oauth/google/login`). The emulator shows a user picker; choosing a seeded
account redirects back to the callback, which mints a normal `app_session_id`
cookie — a real session with `executionMode: "scrapper"` (cloud allowed).

> Endpoint mapping (skill defaults): Google `…/o/oauth2/v2/auth`,
> `…/oauth2/token`, `…/oauth2/v2/userinfo`; Microsoft `…/oauth2/v2.0/authorize`,
> `…/oauth2/v2.0/token`, `…/v1.0/me`.

---

## Option B — Seed script (headless session token)

Mints a valid session cookie directly against the local DB — no UI, no OAuth
round-trip. Ideal for Playwright/curl. The script is **git-ignored** (it mints
owner sessions and must never ship); its full source is below so it can be
recreated. It refuses to run under `NODE_ENV=production`.

### Run it

```bash
# Defaults: openId local:dev-tester, role owner, executionMode scrapper
pnpm tsx server/scripts/dev-seed-user.ts

# Customize:
pnpm tsx server/scripts/dev-seed-user.ts --name "QA Bot" --role admin --mode big_spender
```

It prints the `app_session_id=<jwt>` cookie plus ready-to-paste curl and
Playwright snippets. Run the dev server with **`ZERO_LOGIN_MODE` unset** — when
zero-login is on, the server ignores cookies entirely and the seeded session has
no effect.

### Source (`server/scripts/dev-seed-user.ts`)

```ts
import "dotenv/config";
import { ENV } from "../_core/env.js";
import { sdk } from "../_core/sdk.js";
import { upsertUser, getUserByOpenId } from "../db.factory.js";
import { COOKIE_NAME } from "../../shared/const.js";

type Role = "viewer" | "user" | "admin" | "owner";
type Mode = "sovereign" | "scrapper" | "big_spender";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    }
  }
  return out;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("[dev-seed-user] Refusing to run with NODE_ENV=production. Local dev only.");
    process.exit(1);
  }
  if (!ENV.cookieSecret) {
    console.error("[dev-seed-user] JWT_SECRET is not set.");
    process.exit(1);
  }
  if (!ENV.appId) {
    console.error("[dev-seed-user] VITE_APP_ID is not set (verifySession rejects empty appId).");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const openId = args.openid ?? "local:dev-tester";
  const name = args.name ?? "Dev Tester";
  const role = (args.role as Role) ?? "owner";
  const mode = (args.mode as Mode) ?? "scrapper";

  await upsertUser({
    openId, name, email: null, loginMethod: "local",
    role, executionMode: mode, lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId(openId);
  const sessionToken = await sdk.createSessionToken(openId, { name });

  console.log(`${COOKIE_NAME}=${sessionToken}`);
  console.log(`user id ${user?.id}, role ${role}, mode ${mode}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

(The committed copy in the repo is the authoritative, fully-commented version
with the curl/Playwright output; this is the minimal recreate-able core.)

---

## Which should I use?

- **Just need to be logged in to click around** → zero-login (default sovereign;
  add `ZERO_LOGIN_EXECUTION_MODE=scrapper` if you need cloud).
- **Testing the login/redirect/session flow itself** → Option A.
- **Automated headless tests needing a token now** → Option B.
