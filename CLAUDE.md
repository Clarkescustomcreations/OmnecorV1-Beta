# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot-reload server + Vite dev frontend on same port)
pnpm dev

# Type-check (no emit)
pnpm check

# Run all tests
pnpm test

# Run a single test file
pnpm vitest run server/__tests__/redaction.test.ts

# Production build (Vite + esbuild bundle)
pnpm build

# Run production build
pnpm start

# Database migrations (generate + migrate)
pnpm build:push

# Format code
pnpm format
```

**Package manager:** pnpm only. All dependency overrides and security pins live in `pnpm-workspace.yaml` — never in `package.json`'s `pnpm` field (pnpm 10 ignores it in workspaces).

## Architecture

### Server

`server/_core/index.ts` is the **only** entry point. It bootstraps a single Express + tRPC server:
- tRPC API at `/api/trpc`
- WebSocket at `/ws` (same HTTP server via upgrade)
- Static files / Vite dev server for the frontend
- Health check at `/health`

All tRPC routers are composed in `server/routers.ts` into a single `appRouter`. Routers live in `server/routers/` (primary) with two legacy routers still in `server/phase2/routers/` (`agentRouter`, `aiProviderRouter`). All routers must import from `server/_core/trpc.ts` — they share a single `TrpcContext`.

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

`server/ommesh/` is the distributed LAN node discovery layer. `MeshNode` advertises itself over mDNS/Bonjour. Nodes authenticate with a shared `OMMESH_SECRET`.

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

## Execution Modes

Users have an `executionMode` stored on their DB record:
- `sovereign` — air-gapped; `cloudProcedure` calls throw FORBIDDEN
- `scrapper` — default; cloud calls allowed with spend tracking
- `big_spender` — higher spend limits

## Adding a New tRPC Router

1. Create `server/routers/myRouter.ts`, importing `router` and the appropriate procedure type from `server/_core/trpc.ts`.
2. Register it in `server/routers.ts` under a new namespace key.
3. Use `cloudProcedure` for any procedure that calls an external cloud API so Sovereign mode is enforced automatically.
