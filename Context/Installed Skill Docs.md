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

## Installed Skill Registry

> Complete inventory of all installed skills, grouped by domain. Skills marked ⚠️ are installed but **not in scope** for Omnecor (see Library-Docs §5 exclusions note). The usage-guidance sections above govern when to reach for each skill.

### Styling
| Skill | Status |
|---|---|
| `tailwind-css-patterns` | ✅ Active |
| `tailwind-css` | ✅ Active |
| `tailwind-best-practices` | ✅ Active |

### React & Frontend
| Skill | Status |
|---|---|
| `react` | ✅ Active |
| `react-patterns` | ✅ Active |
| `react-flow-node-ts` | ✅ Active — ReactFlow nodes (SchematicEditor, PCBSchematicEditor) |
| `react-state-management` | ✅ Active |
| `transformers-js` | ✅ Active — in-browser ML only |

### State Management
| Skill | Status |
|---|---|
| `zustand` | ✅ Active |
| `zustand-typescript` | ✅ Active |
| `zustand-middleware` | ✅ Active |
| `zustand-store-ts` | ✅ Active |
| `zustand-advanced-patterns` | ✅ Active |
| `state-management` | ✅ Active |
| `testing` | ✅ Active |

### tRPC & API Layer
| Skill | Status |
|---|---|
| `trpc-router` | ✅ Active |
| `trpc-patterns` | ✅ Active |
| `react-query-setup` | ✅ Active — TanStack Query + tRPC client wiring |

### Database — Drizzle ORM / libSQL
| Skill | Status |
|---|---|
| `api-database-drizzle` | ✅ Active |
| `drizzle-orm-patterns` | ✅ Active |
| `drizzle-orm-expert` | ✅ Active |
| `drizzle-queries` | ✅ Active |
| `drizzle-best-practices` | ✅ Active |
| `drizzle-migrations` | ✅ Active |
| `drizzle-orm-d1` | ⚠️ Installed — D1/Cloudflare variant; Omnecor uses libSQL |
| `d1-drizzle-schema` | ⚠️ Installed — D1/Cloudflare variant; Omnecor uses libSQL |
| `neon-drizzle` | ⚠️ Installed — Neon/Postgres variant; Omnecor uses libSQL |
| `cloudflare-d1` | ⚠️ Installed — not applicable |

### SQL Reference (generic)
| Skill | Status |
|---|---|
| `sql` | ✅ Active |
| `sql-pro` | ✅ Active |
| `sql-expert` | ⚠️ Installed — generic SQL; use Drizzle skills for Omnecor queries |
| `sql-query` | ⚠️ Installed — generic SQL |
| `sql-generator` | ⚠️ Installed — generic SQL |
| `sql-databases` | ⚠️ Installed — generic SQL |
| `sql-research` | ⚠️ Installed — generic SQL |

### Input Validation
| Skill | Status |
|---|---|
| `zod-validation-expert` | ✅ Active |
| `zod-validation-utilities` | ✅ Active |
| `form-validation-with-zod` | ✅ Active |

### Auth & OAuth
| Skill | Status |
|---|---|
| `api-authentication` | ✅ Active — JWT, sessions, security headers |
| `oauth-expert` | ✅ Active — authorization-code flow, PKCE, token refresh |
| `oauth-implementation` | ✅ Active |
| `oauth` | ✅ Active — portless redirect-URI fixes |
| `oauth2` | ✅ Active |
| `google` | ✅ Active — Gmail, Calendar, Drive, userinfo |
| `microsoft` | ✅ Active — Graph `/me`, Entra ID |
| `entra-agent-id` | ✅ Active — agent OBO / Blueprint token exchange |
| `zoom-oauth` | ✅ Active |
| `zoom-rest-api` | ✅ Active |
| `arcgis-authentication` | ⚠️ Installed — not applicable to Omnecor |
| `openiddict-authorization` | ⚠️ Installed — not applicable to Omnecor |

### Better Auth (library)
| Skill | Status |
|---|---|
| `better-auth` | ✅ Active |
| `better-auth-setup` | ✅ Active |
| `better-auth-best-practices` | ✅ Active |
| `better-auth-python` | ✅ Active |
| `better-auth-expo` | ✅ Active |
| `better-auth-electron` | ✅ Active |

### Build Tooling
| Skill | Status |
|---|---|
| `vite` | ✅ Active — core config, plugin API. Note: skill doc covers Vite 8; project runs Vite 7 |
| `vite-patterns` | ✅ Active |
| `vite-development` | ✅ Active |
| `vite-build-tool` | ✅ Active |

### Mobile — Expo / React Native
| Skill | Status |
|---|---|
| `react-native-expo` | ✅ Active |
| `expo-modules` | ✅ Active |
| `expo-router` | ✅ Active |
| `expo-config` | ✅ Active |
| `expo-build` | ✅ Active |
| `expo-dev-client` | ✅ Active |
| `expo-deployment` | ✅ Active |
| `expo-updates` | ✅ Active |
| `expo-api-docs` | ✅ Active |
| `expo-api-routes` | ✅ Active |
| `expo-tailwind-setup` | ✅ Active |
| `upgrading-expo` | ✅ Active |
| `upgrading-react-native` | ✅ Active |
| `auth0-expo` | ✅ Active |
| `clerk-expo-patterns` | ✅ Active |

### Node.js / Electron / Tooling
| Skill | Status |
|---|---|
| `electron-node-upgrade` | ✅ Active |
| `node-inspect-debugger` | ✅ Active |
| `repo-healthcheck-node` | ✅ Active |
| `update-node-version` | ✅ Active |
| `clickhouse-js-node-coding` | ⚠️ Installed — ClickHouse not used in Omnecor |
| `clickhouse-js-node-troubleshooting` | ⚠️ Installed — ClickHouse not used in Omnecor |

### MCP & Integrations
| Skill | Status |
|---|---|
| `mcp-server-patterns` | ✅ Active |
| `seedance-2-0` | ✅ Active — Seedance 2.0 video via fal.ai (`falRouter`) |
| `wallet-apis` | ⚠️ Installed — generic wallet APIs; Omnecor uses Lithic directly |

### Built-in Omnecor Skills (project-specific)
| Skill | Purpose |
|---|---|
| `code-sweep` | Beta-readiness sweep across all 10 domains |
| `run-omnecor` | Launch + drive + screenshot the running app |
| `update-config` | Configure settings.json / hooks / permissions |
| `keybindings-help` | Customize keybindings.json |
| `verify` | Confirm a code change works in the real app |
| `code-review` | Review diff for bugs + simplification |
| `simplify` | Apply reuse/efficiency cleanups to changed code |
| `fewer-permission-prompts` | Reduce permission prompts via settings.json allowlist |
| `loop` | Run a command on a recurring interval |
| `schedule` | Create/manage scheduled cloud agent routines |
| `claude-api` | Anthropic SDK / model reference (load before any Claude/LLM code) |
| `architect` | Senior-engineer design plan before writing code |
| `review` | Verify feature matches plan + is production-ready |
| `imprint` | Extract UI patterns after building a component → UI-Registry |
| `remember` | Save/restore session context across conversations |
| `recover` | Resume a session or restore lost context |
| `security-review` | Security-focused code review |
| `run` | Launch and drive any project app |
| `init` | Initialize a CLAUDE.md for a new codebase |
| `find-skills` | Find relevant skills for a task |


Universal /home/linux/.agents/skills
  + electron
  + electron-api
  + electron-pro
  + xtream-electron
  + electron-development
  + electron-builder
  + desktop
  + electronics-sourcing
Claude Code /home/linux/.claude/skills
  + electron
  + electron-api
  + electron-pro
  + xtream-electron
  + electron-development
  + electron-builder
  + desktop
  + electronics-sourcing
Universal /home/linux/.agents/skills
  + install
  + windows-builder
  + install-duckdb
  + installing-skills
Claude Code /home/linux/.claude/skills
  + install
  + windows-builder
  + install-duckdb
  + installing-skills

