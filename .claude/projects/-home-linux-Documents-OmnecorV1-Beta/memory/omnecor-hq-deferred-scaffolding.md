---
name: omnecor-hq-deferred-scaffolding
description: RESOLVED — the Omnecor HQ mobile app's dead server/drizzle scaffolding was deleted; plus a retry helper the MAIN project still lacks
metadata:
  type: project
---

The Omnecor HQ mobile app lives at `packaging/android/omnecor-hq/` (Expo/React Native, a registered pnpm workspace). It is a standalone remote-control companion app for the main Omnecor PC app — NOT meant to be folded into the main client/server tree. See [[omnecor-hq-app-intent]].

**RESOLVED (2026-06-13, this session — user authorized "resolve in whichever way makes the apk work best"):**
- Deleted the dead `server/`, `drizzle/`, duplicate `shared/` folders, `drizzle.config.ts`, and the obsolete `tests/auth.logout.test.ts` (it only tested the deleted stub router). They were an older fork of the starter template; nothing in `app/`/`hooks/`/`lib/` imported them at runtime.
- The one type-only consumer (`lib/trpc.ts`: `import type { AppRouter } from "@/server/routers"`) now points at a new self-contained `lib/_core/app-router.ts` (a minimal `initTRPC` router with the superjson transformer). The desktop's real 40-router `AppRouter` CANNOT be imported here — mobile's stricter tsconfig re-type-checks the entire server source (express/drizzle/node) and explodes; a bundled `.d.ts` hits tRPC "cannot be named" (TS2883/TS4023) errors. Runtime is unaffected: every real PC call already goes through the untyped HTTP helpers `trpcQuery`/`trpcMutate` in `lib/_core/trpc-fetch.ts`, so connection stability never depended on the type.
- Pruned now-dead deps from mobile package.json: `drizzle-orm`, `mysql2`, `express`, `jose`, `cookie`, `dotenv`, `axios` (deps) and `drizzle-kit`, `esbuild`, `tsx`, `vitest`, `concurrently`, `@types/express`, `@types/cookie` (devDeps). Removed stale scripts `dev:server`, `build`, `start`, `db:push`; `dev` now just runs Metro. Removed the `@shared/*` tsconfig path. `pnpm check` (tsc --noEmit) stays clean.

**Still-open improvement for the MAIN project (unrelated to the now-deleted mobile copy):** the main project's `server/_core/llm.ts` LACKS an exponential-backoff retry helper (`fetchWithBackoff`: ~4 retries, equal-jitter, honors `retry-after`). The mobile copy that had it is gone, but the resilience idea is still worth hand-grafting into main's provider-aware `invoke()` (main uses AiProviderService + FORGE_API_KEY/gemini-2.5-flash defaults — don't copy wholesale, adapt).
