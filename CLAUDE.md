# CLAUDE.md

> ## ⛔ Build Complete, Fix Now — standing directive (2026-06-22)
> **No half-built features. No deferred scope.** Build every feature to be the best it
> can be, end-to-end, the first time. If while working you find a problem or security
> risk — however small — **fix it now**; do not save it for a "later pass." Deferring
> scope grows a never-ending TODO list and forces rediscovery of known gaps during slow
> (~40-min) package builds and testing — a waste of time. "Out of scope / follow-on /
> later" is **not** an acceptable resolution for anything the feature genuinely needs,
> nor for any defect you have already found. Surface trade-offs, then build it fully.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot-reload server + Vite dev frontend on same port)
pnpm dev

# Type-check (no emit)
pnpm check

# Run all tests
pnpm test

# Run all tests with a V8 coverage report (text summary + html + lcov in
# coverage/). Enforces the ratcheting thresholds in vitest.config.ts — raise
# them as new suites land; never lower them.
pnpm test:coverage

# Run a single test file
pnpm vitest run server/__tests__/redaction.test.ts

# Production build (Vite + esbuild bundle)
pnpm build

# Run production build
pnpm start

# Database: regenerate SQL from a schema change, then apply (dev iteration)
pnpm build:push

# Database: apply pending migrations only, no regenerate (prod/CI, before `pnpm start`)
pnpm db:migrate

# Format code
pnpm format
```

**Package manager:** pnpm only. All dependency overrides and security pins live in `pnpm-workspace.yaml` — never in `package.json`'s `pnpm` field (pnpm 10 ignores it in workspaces).

**Migrations — three paths, one system.** All three apply the same generated migrations in `drizzle/migrations/`; they differ only in *when* and *whether they also regenerate*:
- `pnpm build:push` (`drizzle-kit generate && migrate`) — **dev**: after editing `drizzle/schema.ts`, regenerate the SQL files, then apply them.
- `pnpm db:migrate` (`server/scripts/migrate.ts`) — **prod/CI**: apply already-generated migrations explicitly before `pnpm start`. Does *not* regenerate.
- `server/db.ts` `init()` auto-`migrate()` — **runtime fallback**: applies pending migrations on first DB connect (non-fatal — a failure logs a warning and boot continues). `db:migrate` is the explicit, fail-loud alternative to relying on this.

**Tests.** Vitest, files matched by `*.test.ts` under `server/`, `client/`, `packaging/`. Route-level (tRPC) tests drive the real `appRouter.createCaller(ctx)` rather than mocking the route. Shared helpers live in `server/__tests__/_helpers/trpcHarness.ts`: `createTestDb()` spins up an in-memory libSQL DB with the **real** schema + migrations (FK cascade on) so ownership filters/upserts/cascades actually execute; `seedUser()` and `makeContext(user, db, services?)` build the context. For routers that call the `db.factory` *helper functions* (e.g. `getChatSession`) rather than `getDb()`, mock those helpers directly (see `aiRouter.test.ts`); for routers that call `getDb()`, redirect it via `vi.mock("../db.factory.js", …)` (see `chatRouter.test.ts`). Stub `AuditLogService` in route tests so the audit middleware doesn't touch the real file DB.

## Architecture

### Server

`server/_core/index.ts` is the **only** entry point. It bootstraps a single Express + tRPC server:
- tRPC API at `/api/trpc`
- WebSocket at `/ws` (same HTTP server via upgrade)
- Static files / Vite dev server for the frontend
- Health check at `/health`

All tRPC routers are composed in `server/routers.ts` into a single `appRouter`. Routers all live in `server/routers/` and must import from `server/_core/trpc.ts` — they share a single `TrpcContext`. (Three routers — `agentRouter`, `aiProviderRouter`, `modelMarketplaceRouter` — were relocated here from the now-empty `server/phase2/routers/`; the services they call still live in `server/phase2/services/`.)

**tRPC procedure types** (from `server/_core/trpc.ts`):
- `publicProcedure` — unauthenticated
- `protectedProcedure` — requires session; auto-logs to audit trail
- `cloudProcedure` — protected + blocked when user is in `sovereign` execution mode
- `adminProcedure` — requires `admin` or `owner` role
- `ownerProcedure` — requires `owner` role

### Database

**Single unified engine: libSQL / SQLite** (Drizzle ORM). One schema, one dialect, works in every mode:
- **Local (default):** an embedded file database (`~/.omnecor/data/omnecor.db`) — zero-infra, air-gappable Sovereign mode. No external DB required.
- **Networked / multi-node:** set `LIBSQL_URL` (or `TURSO_DATABASE_URL`) + `LIBSQL_AUTH_TOKEN` to use a libsql/Turso endpoint or embedded replicas.

The **single schema** lives in `drizzle/schema.ts` (`sqlite-core`). `server/db.ts` owns the connection: `getDb()` **always returns a live drizzle instance** (never null) and applies generated migrations (`drizzle/migrations/`) on first connect. `server/db.factory.ts` re-exports `db.ts` and is the canonical import path. Use `getDb()` freely in routers — there is no MySQL-only tier anymore.

Use Drizzle's query builder (not raw SQL) and `$inferSelect`/`$inferInsert` for types. After changing the schema, run `pnpm build:push` (drizzle-kit generate + migrate) to produce a new migration. SQLite caveats: enums are `text({ enum: [...] })`, timestamps are `integer({ mode: "timestamp" })` (→ `Date`), JSON is `text({ mode: "json" })`; upserts use `.onConflictDoUpdate({ target, set })` and inserts return ids via `.returning({ id })`.

### Frontend

React 19 SPA at `client/src/`. Pages are lazy-loaded via `App.tsx` using `wouter` for routing. Each page is wrapped in a `RouteBoundary` (per-route error isolation).

**Path aliases** (vite.config.ts):
- `@/` → `client/src/`
- `@shared/` → `shared/`
- `@assets/` → `attached_assets/`

**State**: Zustand store at `client/src/lib/store/app.store.ts`. Global state for WS status, execution mode, command palette, sidebar persistence.

**Data fetching**: tRPC + TanStack Query. The `AppRouter` type from `server/routers.ts` drives full end-to-end type safety.

### Shared

`shared/` contains types and constants used by both server and client:
- `shared/types.ts` — shared domain types
- `shared/const.ts` — cookie name, error codes, timeouts
- `shared/hitl.ts` — Human-in-the-Loop event types

### Optional Python Microservices

These run as separate processes and are proxied by the tRPC routers. All are optional; the app degrades gracefully when they're offline:

| Service | Default port | Router |
|---|---|---|
| Whisper STT | 8001 | `voiceRouter` |
| TTS / Kokoro | 8002 | `voiceRouter` |
| RVC voice | 8003 | `voiceRouter` |
| Fal AI bridge | 8004 | `falRouter` |
| Valet Router inference | 8010 | `valetRouter` |
| RecursiveMAS bridge | 8011 | `agentRouter` |
| llama.cpp bridge | 8013 | `aiRouter` |
| ComfyUI | 8188 | `comfyRouter` |

### OMMESH

`server/ommesh/` is the distributed LAN node discovery layer. `MeshNode` advertises itself over mDNS/Bonjour. Two authentication layers:

- **Mobile node registration** — guarded by `OMMESH_SECRET` (timing-safe SHA-256 comparison; fails closed when the secret is unset).
- **Cross-node inference** — `server/ommesh/core/MeshServer.ts` listens on `MESH_PORT` (3001) as a strict-mTLS HTTPS endpoint. Only CA-signed peers connect (`requestCert + rejectUnauthorized + TLSv1.3`). Each peer's certificate fingerprint is pinned at trust-time so a valid CA-signed cert from an unknown peer is still rejected. Sovereign-mode guard prevents cloud providers from tunnelling through mesh routing. Nodes without provisioned certs skip the mTLS listener but can still participate in mDNS discovery.

### Electron / Desktop

`packaging/electron-app/` is a separate pnpm workspace package for the Electron desktop build. It is independent of the web build.

## Key Environment Variables

Copy `.env.example` to `.env`. Critical ones for local dev:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Session cookie signing (required in production) |
| `LIBSQL_URL` | libsql/Turso endpoint for networked mode (omit for local embedded SQLite) |
| `LIBSQL_AUTH_TOKEN` | Auth token for the libsql/Turso endpoint |
| `SQLITE_PATH` | Override the local embedded DB file path |
| `ZERO_LOGIN_MODE=true` | Skip auth — all requests become local admin. **Never expose to network.** |
| `OLLAMA_URL` | Local Ollama instance (default: `http://localhost:11434`) |
| `ANTHROPIC_API_KEY` | Claude API access |
| `OPENAI_API_KEY` | OpenAI access |
| `OMMESH_SECRET` | Shared secret for mobile node registration; fail-closed when unset |
| `VALET_AUTO_START` | Set to `false` to prevent the Valet Router from auto-starting |
| `SESSION_TTL_MS` | Session JWT + cookie lifetime in ms (default: one year; set `604800000` for 7 days on network installs) |

## Execution Modes

Users have an `executionMode` stored on their DB record:
- `sovereign` — air-gapped; `cloudProcedure` calls throw FORBIDDEN
- `scrapper` — default; cloud calls allowed with spend tracking
- `big_spender` — higher spend limits

## Adding a New tRPC Router

1. Create `server/routers/myRouter.ts`, importing `router` and the appropriate procedure type from `server/_core/trpc.ts`.
2. Register it in `server/routers.ts` under a new namespace key.
3. Use `cloudProcedure` for any procedure that calls an external cloud API so Sovereign mode is enforced automatically.
