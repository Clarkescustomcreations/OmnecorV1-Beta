# Installed Skill Docs — Usage Reference

> When to load each installed skill and why. Load the relevant skill *before*
> working in its domain (per AGENTS.md "Available Skills — Always Use Them").
> The raw `ctx7` install log is preserved below this section as the install record.

## Vite — build tooling (`vite.config.ts`, bundling, dev server)

This project runs **Vite 7 (Rollup)**. Rolldown / `rolldownOptions` is Vite 8 — do
not use it here. Chunk splitting uses `build.rollupOptions.output.manualChunks`.

| Skill | Load when |
|---|---|
| `vite` | Core config (`defineConfig`, `loadEnv`, aliases), plugin API, library/SSR mode, and any Vite-version question (note: skill doc is Vite 8 — cross-check against our v7). |
| `vite-patterns` | Practical config recipes: env vars, proxy, dependency pre-bundling, `manualChunks` chunk splitting, build optimization. |
| `vite-development` | HMR, fast-build, and production-asset optimization concerns. |
| `vite-build-tool` | General build-tool reference fallback. |

**Project touchpoints:** [vite.config.ts](file:///home/linux/Documents/OmnecorV1-Beta/vite.config.ts)
(manualChunks: `vendor-three` / `vendor-charts` / `vendor-flow` / `vendor-radix` /
`vendor-data` / `vendor-react` / `vendor-codemirror` / `vendor-icons`),
`chunkSizeWarningLimit: 1100`. Gate: `pnpm build` must emit **0 over-limit chunk warnings**.

## tRPC — API layer (routers, procedures, client wiring)

This project runs **tRPC v11**. All procedures import from `server/_core/trpc.ts`
and use the project's tier system (`publicProcedure` / `protectedProcedure` /
`cloudProcedure` / `adminProcedure` / `ownerProcedure`) — see AGENTS.md
"tRPC Procedure Tiers". A router only exists if registered in `server/routers.ts`.

| Skill | Load when |
|---|---|
| `trpc-router` | Creating or modifying a router, adding procedures, server-side endpoint shape. |
| `trpc-patterns` | General tRPC structure, middleware, context, error handling patterns. |
| `trpc-type-safety` | End-to-end inference issues, `inferInput`/`inferOutput`, input-schema typing. |
| `react-query-setup` | Client side: `@trpc/tanstack-react-query`, `useTRPC()`, `queryOptions`/`mutationOptions`, and `queryClient.invalidateQueries` invalidation. |

**Project touchpoints:** [server/routers.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers.ts),
`server/routers/*`, `server/_core/trpc.ts`. Reminder: integer PKs → `z.number()`
in input schemas; `cloudProcedure` is mandatory for any external-API call.

## Zustand — client state

Global *shell* state only (WS status, sidebar, notifications) lives in
[client/src/lib/store/app.store.ts](file:///home/linux/Documents/OmnecorV1-Beta/client/src/lib/store/app.store.ts).
Server data belongs in tRPC + TanStack Query, **not** Zustand.

| Skill | Load when |
|---|---|
| `zustand` | Creating/modifying a store, slices, basic TS typing, SSR concerns. |
| `zustand-typescript` | Curried `create`, `StateCreator`, typed selectors and middleware mutators. |
| `zustand-middleware` | `persist`, `devtools`, `immer`, or custom middleware. |
| `zustand-advanced-patterns` | Transient updates, selector subscriptions, store composition, perf tuning. |
| `zustand-store-ts` | Scaffolding a store that follows the established project pattern. |
| `react-state-management` | Choosing between local/Zustand/React Query for a given piece of state. |

**Project touchpoints:** `client/src/lib/store/app.store.ts`, plus feature stores
under `client/src/lib/stores/` (e.g. `brainMapStore.ts`, `visualControlStore.ts`).

## OAuth 2.0 — third-party / social sign-in

Generic OAuth 2.0 / OIDC authorization. Provider-specific emulator skills
(`google`, `microsoft`, `zoom-oauth`, `arcgis-authentication`, `entra-agent-id`,
`openiddict-authorization`) also exist — load those only for that specific provider.
Note: the `oauth` skill (portless local-dev redirect URIs) is **not** a general
OAuth 2.0 skill — do not reach for it for flow/token work; use `oauth-expert`.

| Skill | Load when |
|---|---|
| `oauth-expert` | Authorization-code flow, PKCE, token refresh/rotation, OIDC — the primary OAuth 2.0 reference. |
| `oauth-implementation` | Implementing an end-to-end OAuth flow (initiation → callback → token exchange → storage). |
| `oauth2` | Framework-level concepts: flows, grant types, scopes, provider integration. |
| `api-authentication` | Broader API auth (JWT, API keys, sessions) when OAuth is one piece of a larger auth design. |

**Project touchpoints:** [server/_core/oauth.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/oauth.ts)
(double-submit `social_oauth_state` CSRF cookie; the `/api/oauth/callback/:platform`
Express handler is session-bound), plus `oauthRouter`. Reminder: any procedure that
calls an external provider API must use `cloudProcedure`, not `protectedProcedure`.

---

## Raw install log (`ctx7 skills search`)

🧟V-I-S:~$ npx ctx7 skills search tailwind css
Need to install the following packages:
ctx7@0.5.2
Ok to proceed? (y) y
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 22 skill(s)

? Select skills to install:
                                                                               P
opularity   Trust
❯◯  1. tailwind-css (/bobmatnyc/claude-mpm-skills)                             ★
★☆☆         High
? Select skills to install:
                                                                               P
opularity   Trust
 ◯  1. tailwind-css (/bobmatnyc/claude-mpm-skills)                             ★
★☆☆         High
❯◯  2. tailwind-css-patterns (/giuseppe-trisciuoglio/developer-kit)            ★
★☆☆         High
✔ Select skills to install: tailwind-css-patterns

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
✔ Installed 1 skill(s)

Claude Code /home/linux/.claude/skills
  + tailwind-css-patterns

🧟V-I-S:~$ npx ctx7 skills search tailwind css
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 22 skill(s)

✔ Select skills to install: tailwind-css, tailwind-css-patterns, tailwind-best-practices

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
✔ Installed 3 skill(s)

Claude Code /home/linux/.claude/skills
  + tailwind-css
  + tailwind-css-patterns
  + tailwind-best-practices

🧟V-I-S:~$ npx ctx7 skills search React
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 17 skill(s)

✔ Select skills to install: react, react:components, react-patterns

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
⚠ Failed to download react:components: No files found in skills/react-components
✔ Installed 2 skill(s)

Claude Code /home/linux/.claude/skills
  + react
  + react:components
  + react-patterns

🧟V-I-S:~$ npx ctx7 skills search better Auth
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 23 skill(s)

✔ Select skills to install: better-auth

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
✔ Installed 1 skill(s)

Claude Code /home/linux/.claude/skills
  + better-auth

🧟V-I-S:~$ npx ctx7 skills search better Auth
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 19 skill(s)

✔ Select skills to install: better-auth-setup, better-auth-integrations, better-auth-plugins

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
✔ Installed 3 skill(s)

Claude Code /home/linux/.claude/skills
  + better-auth-setup
  + better-auth-integrations
  + better-auth-plugins

🧟V-I-S:~$ npx ctx7 skills search better Auth
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 20 skill(s)

✔ Select skills to install: better-auth-best-practices, better-auth-python, better-auth-expo, better-auth-electron

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
✔ Installed 4 skill(s)

Claude Code /home/linux/.claude/skills
  + better-auth-best-practices
  + better-auth-python
  + better-auth-expo
  + better-auth-electron

🧟V-I-S:~$ npx ctx7 skills search SQL Alchemy
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 19 skill(s)

✔ Select skills to install: sql-pro, sql-database-assistant, sql, sql-expert, sql-query, sql-generator, sql-databases, sql-research

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
⚠ Failed to download sql-database-assistant: No files found in engineering/sql-database-assistant
✔ Installed 7 skill(s)

Claude Code /home/linux/.claude/skills
  + sql-pro
  + sql-database-assistant
  + sql
  + sql-expert
  + sql-query
  + sql-generator
  + sql-databases
  + sql-research

🧟V-I-S:~$ npx ctx7 skills search Drizzle ORM
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 30 skill(s)

✔ Select skills to install: drizzle-orm, drizzle-orm-patterns, drizzle-orm-expert, drizzle-orm-d1, drizzle-migrations, bun drizzle integration, cloudflare-d1, neon-drizzle, b
etter-auth-setup, d1-drizzle-schema, api-database-drizzle, drizzle-queries, drizzle-best-practices

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
⚠ Failed to download drizzle-orm: No files found in skills/drizzle-orm
⚠ Failed to install bun drizzle integration: Unsafe skill name: "bun drizzle integration"
✔ Installed 11 skill(s)

Claude Code /home/linux/.claude/skills
  + drizzle-orm
  + drizzle-orm-patterns
  + drizzle-orm-expert
  + drizzle-orm-d1
  + drizzle-migrations
  + bun drizzle integration
  + cloudflare-d1
  + neon-drizzle
  + better-auth-setup
  + d1-drizzle-schema
  + api-database-drizzle
  + drizzle-queries
  + drizzle-best-practices

🧟V-I-S:~$ npx ctx7 skills search Oauth 2.0
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 26 skill(s)

✔ Select skills to install: oauth-implementation, zoom-rest-api, api-authentication, entra-agent-id, microsoft, google, zoom-oauth, oauth-social-login, arcgis-authentication,
 api-authentication, openiddict-authorization, oauth2

✔ Install to detected location(s)?
/home/linux/.claude/skills Yes
⚠ Failed to download oauth-social-login: No files found in drift%20v1%20depreciated/skills/oauth-social-login
✔ Installed 11 skill(s)

Claude Code /home/linux/.claude/skills
  + oauth-implementation
  + zoom-rest-api
  + api-authentication
  + entra-agent-id
  + microsoft
  + google
  + zoom-oauth
  + oauth-social-login
  + arcgis-authentication
  + api-authentication
  + openiddict-authorization
  + oauth2

🧟V-I-S:~$ npx ctx7 skills search Expo SDK
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 26 skill(s)

✔ Select skills to install: upgrading-expo, expo-modules, expo-api-docs, expo-updates, expo-build, auth0-expo, expo-router, expo-config, expo-dev-client, expo-api-routes, cle
rk-expo-patterns, expo-tailwind-setup, react-native-expo, expo-deployment, upgrading-react-native

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
✔ Installed 15 skill(s)

Universal /home/linux/.agents/skills
  + upgrading-expo
  + expo-modules
  + expo-api-docs
  + expo-updates
  + expo-build
  + auth0-expo
  + expo-router
  + expo-config
  + expo-dev-client
  + expo-api-routes
  + clerk-expo-patterns
  + expo-tailwind-setup
  + react-native-expo
  + expo-deployment
  + upgrading-react-native
Claude Code /home/linux/.claude/skills
  + upgrading-expo
  + expo-modules
  + expo-api-docs
  + expo-updates
  + expo-build
  + auth0-expo
  + expo-router
  + expo-config
  + expo-dev-client
  + expo-api-routes
  + clerk-expo-patterns
  + expo-tailwind-setup
  + react-native-expo
  + expo-deployment
  + upgrading-react-native

🧟V-I-S:~$ 

🧟V-I-S:~$ npx ctx7 skills search Zod
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 19 skill(s)

✔ Select skills to install: zod, zod-validation-expert, zod-validation-utilities, mcp-server-patterns, wallet-apis, form-validation-with-zod

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
⚠ Failed to download zod: No files found in skills/zod
✔ Installed 5 skill(s)

Universal /home/linux/.agents/skills
  + zod
  + zod-validation-expert
  + zod-validation-utilities
  + mcp-server-patterns
  + wallet-apis
  + form-validation-with-zod
Claude Code /home/linux/.claude/skills
  + zod
  + zod-validation-expert
  + zod-validation-utilities
  + mcp-server-patterns
  + wallet-apis
  + form-validation-with-zod

🧟V-I-S:~$ npx ctx7 skills search Node.js
Warning: Skill commands are deprecated and will stop working in the next major release.


✔ Found 18 skill(s)

✔ Select skills to install: clickhouse-js-node-coding, clickhouse-js-node-troubleshooting, node-inspect-debugger, electron-node-upgrade, repo-healthcheck-node, sentry-node-sd
k, update-node-version, developing-genkit-js, transformers-js

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
⚠ Failed to download developing-genkit-js: No files found in skills/developing-genkit-js
✔ Installed 8 skill(s)

Universal /home/linux/.agents/skills
  + clickhouse-js-node-coding
  + clickhouse-js-node-troubleshooting
  + node-inspect-debugger
  + electron-node-upgrade
  + repo-healthcheck-node
  + sentry-node-sdk
  + update-node-version
  + developing-genkit-js
  + transformers-js
Claude Code /home/linux/.claude/skills
  + clickhouse-js-node-coding
  + clickhouse-js-node-troubleshooting
  + node-inspect-debugger
  + electron-node-upgrade
  + repo-healthcheck-node
  + sentry-node-sdk
  + update-node-version
  + developing-genkit-js
  + transformers-js

🧟V-I-S:~$ 


✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
✔ Installed 8 skill(s)

Universal /home/linux/.agents/skills
  + zustand
  + zustand-typescript
  + zustand-middleware
  + zustand-store-ts
  + zustand-advanced-patterns
  + state-management
  + testing
  + react-state-management
Claude Code /home/linux/.claude/skills
  + zustand
  + zustand-typescript
  + zustand-middleware
  + zustand-store-ts
  + zustand-advanced-patterns
  + state-management
  + testing
  + react-state-management

🧟V-I-S:~$ 

✔ Select skills to install: vite, vite-react, vite-patterns, vite-development, vite-build-tool

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
⚠ Failed to download vite-react: No files found in plugins/bknd-skills/skills/vite-react
✔ Installed 4 skill(s)

Universal /home/linux/.agents/skills
  + vite
  + vite-react
  + vite-patterns
  + vite-development
  + vite-build-tool
Claude Code /home/linux/.claude/skills
  + vite
  + vite-react
  + vite-patterns
  + vite-development
  + vite-build-tool

🧟V-I-S:~$ 


✔ Select skills to install: trpc-patterns, trpc-router, trpc-type-safety, zod-validation-expert, cli-backend-testing, api-patterns, react-query-setup

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
⚠ Failed to download cli-backend-testing: No files found in .agents/skills/cli-backend-testing
⚠ Failed to download api-patterns: No files found in .agent/skills/api-patterns
✔ Installed 5 skill(s)

Universal /home/linux/.agents/skills
  + trpc-patterns
  + trpc-router
  + trpc-type-safety
  + zod-validation-expert
  + cli-backend-testing
  + api-patterns
  + react-query-setup
Claude Code /home/linux/.claude/skills
  + trpc-patterns
  + trpc-router
  + trpc-type-safety
  + zod-validation-expert
  + cli-backend-testing
  + api-patterns
  + react-query-setup

🧟V-I-S:~$ 


✔ Found 24 skill(s)

✔ Select skills to install: zustand, zustand-typescript, zustand-middleware, zustand-store-ts, zustand-advanced-patterns, react-state-management, react-flow-node-ts

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
✔ Installed 7 skill(s)

Universal /home/linux/.agents/skills
  + zustand
  + zustand-typescript
  + zustand-middleware
  + zustand-store-ts
  + zustand-advanced-patterns
  + react-state-management
  + react-flow-node-ts
Claude Code /home/linux/.claude/skills
  + zustand
  + zustand-typescript
  + zustand-middleware
  + zustand-store-ts
  + zustand-advanced-patterns
  + react-state-management
  + react-flow-node-ts

🧟V-I-S:~$ 



✔ Select skills to install: oauth, zoom-rest-api, api-authentication, oauth, entra-agent-id, microsoft, google, zoom-oauth, oauth-expert, seedance-2-0

✔ Install to detected location(s)?
/home/linux/.agents/skills
/home/linux/.claude/skills Yes
✔ Installed 10 skill(s)

Universal /home/linux/.agents/skills
  + oauth
  + zoom-rest-api
  + api-authentication
  + oauth
  + entra-agent-id
  + microsoft
  + google
  + zoom-oauth
  + oauth-expert
  + seedance-2-0
Claude Code /home/linux/.claude/skills
  + oauth
  + zoom-rest-api
  + api-authentication
  + oauth
  + entra-agent-id
  + microsoft
  + google
  + zoom-oauth
  + oauth-expert
  + seedance-2-0

🧟V-I-S:~$ 
