# AGENTS.md — Omnecor V1-Beta
# Read this file completely before touching anything else.

---

## Mandatory Reading Order

Read every file in this exact sequence before writing a single line of code.
Do not skip. Do not reorder. Each file builds on the last.

1. `Context/Project-Overview.md` — What Omnecor is, who it's for, all 15 pages explained
2. `Context/Architecture.md` — Stack, folder map, system boundaries, execution modes
3. `Context/UI-Tokens.md` — Design token system (OKLCH palette, spacing, typography)
4. `Context/UI-Rules.md` — Visual rules that must never be broken
5. `Context/UI-Registry.md` — Every component ever built and its current status
6. `Context/Code-Standards.md` — TypeScript, React, tRPC, DB, and security conventions
7. `Context/Library-Docs.md` — Project-specific library usage rules
8. `Context/Build-Plan.md` — The 5-phase, 27-feature roadmap (current phase and feature)
9. `Context/Progress-Tracker.md` — What is done, what is in progress, what is next
10. `Context/Installed Skill Docs.md` — All installed skills and when to use them

Only after completing this list should you open any source file.

---

## Available Skills — Always Use Them

Skills are pre-built reasoning workflows. Using them is not optional for their trigger
conditions. Improvising in their domain costs more tokens and produces worse results.

### `/architect`
**Trigger:** Before building any new feature, service, router, or component.

Think through what you are about to build like a senior engineer before writing any
code. Surfaces decisions, aligns on architecture, and produces a clear implementation
plan that is confirmed before anything starts.

This is a thinking session, not a grilling session. Collaborative, not adversarial.

### `/remember`
**Trigger:** At the end of every session AND at the start of every session.

AI has no memory between sessions. This skill fixes that.

- `/remember save` — at session end: compress what matters into `memory.md`
  (what was built, decisions made, problems solved, current state, next task)
- `/remember restore` — at session start: restore full context and confirm before
  continuing

The `memory.md` format is: What was built / Decisions made / Problems solved /
Current state / Next session starts with / Open questions. Preserve this structure.

### `/review`
**Trigger:** After completing any feature or making any significant change.

Verify what was built is correct — not just that it works. Reviews in three layers:
plan alignment, system integrity, and production readiness. Reports issues clearly so
the developer decides what to fix.

Working and correct are not the same thing.

### `/recover`
**Trigger:** When something is broken and one fix attempt has already failed.

Not every problem is a bug. Not every bug needs debugging. Diagnoses which type of
failure you are dealing with before deciding how to respond:

- Targeted fix — isolated problem, find root cause, fix precisely
- Hard reset — polluted session, stop patching, start fresh
- Rethink — wrong foundation, no amount of debugging helps

If the same problem persists after one correction attempt: stop immediately, use
`/recover`. Do not keep patching.

### `/imprint`
**Trigger:** After building any UI component.

Extract the visual patterns that matter for consistency and save them to
`Context/UI-Registry.md` so every component built after this one matches what came
before.

- `/imprint` — capture from the most recently built component
- `/imprint [file]` — capture from a specific file
- `/imprint audit` — scan the entire codebase, find conflicts, establish baseline

---

## Rules That Never Change

These are absolute. No exceptions, no "just this once."

### Process Rules

- **Work through Features and Phases in order.** Never skip ahead. The order exists
  because later features depend on earlier ones being correct.
- **Update `Context/Progress-Tracker.md` after every Feature completion.** Mark the
  checkbox, add the date, note what files were changed.
- **Update `Context/UI-Registry.md` after every UI component built or modified.**
  Use `/imprint` to do this automatically.
- **Run `pnpm check` and `pnpm test` after every change.** Target: 0 TypeScript
  errors, all tests passing. Do not commit work that breaks either gate.
- **Before any third-party library:** load its installed skill first, then read
  `Context/Library-Docs.md` for project-specific usage rules.
- **When unsure:** ask questions rather than guessing. One clarifying question is
  cheaper than an hour of wrong implementation.
- **Do not reinvent the wheel:** pull shallow git clones of known working reference
  code to integrate. Delete unused reference code and leftover files when done.
- **Search before guessing:** if a known working solution exists, find it. Do not
  guess at API shapes, library method signatures, or configuration formats.

### Style Rules

- **Never use hardcoded hex values** anywhere in the codebase. Use design tokens from
  `Context/UI-Tokens.md` and the CSS variables defined in `client/src/Globals.css`.
- **Never use raw Tailwind color classes** (e.g. `text-blue-500`, `bg-gray-900`).
  Use semantic token classes only (e.g. `text-foreground`, `bg-card`, `text-accent`).
  The only legitimate exceptions are: `EmbeddedTerminal` (xterm theme), `ThreeViewer`
  and `SchematicEditor`, `EnhancedPCBEditor`, `PCBSchematicEditor` (Three.js/ReactFlow require direct values), `WebPreview`
  (sandboxed iframe), `PCBViewer3D` (Three.js material hex integer — CSS vars cannot
  be injected into a `0xRRGGBB` integer), `MeshTopologyGraph` (Canvas API — `ctx.fillStyle`
  cannot read CSS vars; values documented to match UI-Tokens.md equivalents), and brand-identity
  SVG logos in `SetupWizard` (Google/Microsoft official brand palettes are legally required to
  be exact). All other hex literals are violations.
- **Named exports only** for React components. Never `export default function`.
- **Explicit prop interfaces** on every component. Never `any` or implicit typing.

### Safety Rules

- **Never use `child_process.exec` with string interpolation.** This is RCE. Always
  use `spawn` or `execFile` with argument arrays.
- **All user-supplied file paths must go through `validatePath`** from
  `server/_core/security.ts` before any filesystem operation.
- **Never store credentials in AsyncStorage on mobile.** Use `expo-secure-store`
  (Android KeyStore / iOS Keychain).
- **`cloudProcedure` is mandatory** for any procedure that calls an external API
  (OpenAI, Anthropic, Gemini, Fal, RunPod, etc.). Using `protectedProcedure` for
  an external call silently bypasses Sovereign mode enforcement.
- **No silent mutations.** Every mutation must either return a payload or broadcast
  a WebSocket event. The global `MutationCache.onError` surfaces all failures — do
  not add local `onError: () => {}` overrides that swallow errors.
- **No silent `.catch(() => {})` blocks** on audit log writes or any server-side
  async operation. Use `.catch((e) => console.warn(...))` at minimum.

---

## Critical Schema & Import Rules

These are the rules most likely to cause subtle bugs if violated. They are not
in the TypeScript compiler's reach — you must know them.

### Database

- **`getDb()` never returns null.** The `if (!db)` null-guards scattered in older
  files (`db-pcb.ts` etc.) are dead branches from before the DB unification. Do not
  add new ones. Do not copy the pattern.
- **All primary keys in this schema are integers.** When writing Zod input schemas
  for any procedure that accepts an ID, use `z.number()`, never `z.string()`.
  Example: `scheduledPostId: z.number()` not `scheduledPostId: z.string()`.
- **Canonical DB import is `server/db.factory.ts`**, not `server/db.ts` directly.
  Always: `import { getDb } from "../db.factory.js"`.
- **Never use `(result as any)[0]?.insertId`.** This is a MySQL-only pattern. Use
  Drizzle's `.returning({ id: table.id })` and read `rows[0].id`.
- **Schema types:** enums → `text({ enum: [...] })`, timestamps →
  `integer({ mode: "timestamp" })`, JSON → `text({ mode: "json" })`.
- **Upserts** use `.onConflictDoUpdate({ target, set })`. Not MySQL `ON DUPLICATE KEY`.
- **After any schema change:** run `pnpm build:push` (drizzle-kit generate + migrate)
  to produce a new migration file. Never hand-edit migration files.

### tRPC Procedure Tiers

Use the correct tier. Wrong tier = either a security hole or a broken Sovereign mode.

| Tier | When to use |
|---|---|
| `publicProcedure` | Unauthenticated bootstrap only (Setup Wizard, health checks) |
| `protectedProcedure` | Standard authenticated user actions |
| `cloudProcedure` | **Any** call to an external API. Blocks in Sovereign mode. |
| `adminProcedure` | Config changes, credential rotation, log deletion |
| `ownerProcedure` | Owner-only operations |

Import all from `server/_core/trpc.ts`. The legacy `server/phase2/routers/trpc.ts`
shim was deleted — do not recreate it.

### Router Registration

A router that is not registered in `server/routers.ts` does not exist at runtime.
Before assessing any router's security posture, confirm it appears in `routers.ts`.
The `server/phase2/routers/` directory contains legacy duplicates — some have been
deleted, some remain registered. Check `routers.ts` first, always.

### Frontend Imports

- Path alias `@/` maps to `client/src/`. Use it for all internal imports.
- Path alias `@shared/` maps to `shared/`. Use it for shared types and constants.
- All page components in `App.tsx` must be `React.lazy()` loaded and wrapped in
  `withBoundary()` for error isolation. Do not add eagerly loaded pages.
- Zustand store: `client/src/lib/store/app.store.ts`. Global shell state only
  (WS status, sidebar, notifications). Server data belongs in tRPC + TanStack Query.

### Mobile (Android APK — `packaging/android/omnecor-hq/`)

- **WebSockets on mobile cannot attach cookies.** The APK uses `?token=` query
  parameter on the WS URL to authenticate. See `getAuthedWsUrl()`.
- **Use `Pressable` from `@/components/pressable`** (the cssInterop'd
  gesture-handler wrapper), not bare React Native `Pressable`.
- **Release APK required for production.** The debug APK does not bundle JS — it
  requires a Metro dev server. Use `pnpm apk:release` for a real device build.
- **nanoid Metro fix is permanent.** The `metro.config.js` intercepts
  `moduleName === "nanoid"` → `index.browser.js`. Do not remove or work around this.
- **`OMMESH_SECRET` must be set in `.env`** before mobile node registration works
  properly. Without it, nodes are accepted with a warning — this is a security gap.

### Python Bridges

- Python bridges run as separate processes on ports 8001–8188. The Node server
  proxies to them and degrades gracefully when they are offline. Never assume a bridge
  is running — always handle the unreachable case.
- **`bonjour` must be imported statically**, not via dynamic `import()`:
  `import bonjour from "bonjour"` — the CJS `export =` module pattern requires
  the static import for `moduleResolution: bundler` to resolve the synthetic default.
- **Python binary is platform-aware.** Use `PYTHON_SCRIPTS.pythonBin` from
  `config/index.ts` — not hardcoded `python3`. On Windows this resolves to `python`.

---

## Known Gotchas (Learn From These — Don't Repeat Them)

Every entry here is a real problem that was hit and solved in this codebase.

| Problem | Root Cause | Solution |
|---|---|---|
| `crypto.randomFillSync is not a function` in APK | nanoid uses Node crypto API in Metro | Metro config intercepts nanoid → `index.browser.js` |
| `libcdsprpc.so not found` on Android | llama.rn tries to use Hexagon DSP | `patches/llama.rn.patch` forces `hasHexagon=false` |
| Duplicate-React crash in Electron (`useContext of null`) | Electron bundled its own React copy alongside app's | Bump electron-app to React `^19.2.1` to match root |
| `bonjour` CJS dynamic import type error | `import()` doesn't resolve CJS `export =` synthetic default | Use static `import bonjour from "bonjour"` |
| `ENV.port` does not exist | `env.ts` exports specific named vars, no generic `.port` | Use `parseInt(process.env.PORT ?? "3000", 10)` directly |
| `"systemMetrics"` not in ServerMessage union | New WS message type added to server but not to shared type | Add new WS message types to the `ServerMessage` union in `shared/` |
| `VoiceService` speaker wav path throws | `streamDialogue()` passed a path VoiceService couldn't resolve | `streamDialogue()` bypasses VoiceService — call TTS server directly |
| `crewai` step_callback `TypeError` | Older crewai versions don't support `step_callback` | Guard with `try/except` around step_callback assignment |
| Session abort on schema drift at boot | Server threw on failed auto-migration | Migration changed to non-fatal (warns + continues). Run `pnpm db:migrate` explicitly before deploy |
| `(result as any)[0]?.insertId` returning 0 | MySQL-only pattern, SQLite returns nothing there | Use `.returning({ id: table.id })` everywhere |
| Hardcoded `/home/linux/...` path in SetupWizard | Developer machine path baked into default | Use `os.homedir()` for all home-relative defaults |
| `oauth.ts` importing `db.ts` directly | Bypassed the DB factory isolation | Always import from `db.factory.ts` |
| `execSync openssl "..."` shell string | RCE vulnerability | `execFileSync` with arg array |
| `if (!db)` null-guards failing silently | Pre-unification pattern, `getDb()` now always returns live instance | Remove guards, don't add new ones |
| `ManusDialog.tsx` template-brand leftover | Unused component from original template, zero importers | Deleted — do not recreate |
| Phase2 router duplicates confusing security assessment | `server/phase2/routers/` had stale copies of live routers | Deleted 6 dead files — always check `routers.ts` registration first |
| `pnpm/action-setup@v4` CI fail | Both `version:` in workflow and `packageManager` in package.json were set | Remove `version:` from workflow — let action read `packageManager` field |
| Node 18 tests failing in CI | `globalThis.crypto.getRandomValues` undefined in Node 18 Vitest | Dropped Node 18 from matrix; use Node 22+ and 24+ only |
| Integration OAuth creds ignored / "Missing OAuth credentials" despite Settings wizard | `oauthClients.ts` captured `process.env.*` once at module load | Resolve per-call via `SettingsService.getSecret(settingsKey, envVar)` — env→settings-file precedence, like AI keys. Never re-capture env at module load |
| OAuth callback never lands in packaged desktop app | Redirect URI hardcoded `localhost:5173`; backend listens on `:37291` | Build it from one source: `getRedirectUri()` = `PUBLIC_URL` or `http://localhost:${OMNECOR_PORT\|\|PORT\|\|3000}`. Desktop is spawned with `PORT=37291` |
| Gmail/email header injection via subject | Free-text header interpolated raw into RFC-2822 | Strip `[\r\n]` from header values (see `gmailRouter.encodeHeaderValue`); RFC-2047 base64 encoded-word for non-ASCII |

---

## Verification Gates

Every session must end with all of these passing. Do not close a session with
broken gates — fix them first or document exactly why they cannot be fixed now.

```bash
pnpm check          # 0 TypeScript errors (root workspace)
pnpm test           # all passing (count grows as features land)
pnpm build          # Clean production build
pnpm audit --prod   # 0 known vulnerabilities
```

Additionally for any session touching the APK workspace:
```bash
cd packaging/android/omnecor-hq
pnpm check          # 0 TypeScript errors in mobile workspace
```

---

## Phase & Feature Tracking

Current state as of last session: **Phase 4 ✅ Complete. Phase 5 active.**

Features are numbered F1–F27 across 5 phases. Always work in order.
The current feature is recorded in `Context/Progress-Tracker.md` under
"🚦 Current Status". Do not start F(n+1) until F(n) is marked complete and
`pnpm check` + `pnpm test` are both green.

After completing any Feature:
1. Mark its checkbox in `Context/Progress-Tracker.md`
2. Add a brief "Done:" note with the files changed
3. Run `/review`
4. Run `/imprint` if any UI was changed
5. Run `pnpm check && pnpm test` and confirm gates pass
6. Run `/remember save` before ending the session

---

## When Something Goes Wrong

**After one failed fix attempt:** Stop. Use `/recover`. Do not continue patching.

**If you are unsure about a field name, method signature, or API shape:**
Do not guess. Either read the source file that defines it, or search online for
the known working pattern. A guess that compiles is often worse than a guess that
fails — it introduces a silent bug.

**If a TypeScript error seems impossible to fix:** Check whether you are editing
the right file. Several routers existed as both a live version (`server/routers/`)
and a now-deleted phase2 duplicate. Confirm the file you are editing is actually
imported somewhere in `server/routers.ts`.

**If tests fail after your change:** Run `pnpm vitest run <specific-test-file>` to
isolate. Do not run the full suite repeatedly while guessing — read the failure.

---

## Installed Skills Reference

The following skills are available in `.claude/skills/` and `.agents/skills/`.
Load the relevant skill before working in its domain.

| Domain | Skills |
|---|---|
| Tailwind CSS | `tailwind-css`, `tailwind-css-patterns`, `tailwind-best-practices` |
| React | `react`, `react-patterns` |
| Vite | `vite`, `vite-patterns`, `vite-development`, `vite-build-tool` |
| tRPC | `trpc-router`, `trpc-patterns`, `trpc-type-safety`, `react-query-setup` |
| Zod | `zod`, `zod-validation-expert`, `zod-validation-utilities`, `form-validation-with-zod` |
| Drizzle ORM | `drizzle-orm-patterns`, `drizzle-orm-expert`, `drizzle-migrations`, `drizzle-queries`, `drizzle-best-practices` |
| OAuth | `oauth-expert`, `oauth-implementation`, `oauth2`, `api-authentication` |
| Expo / React Native | `expo-modules`, `expo-build`, `expo-config`, `expo-dev-client`, `react-native-expo`, `expo-deployment` |
| Zustand | `zustand`, `zustand-typescript`, `zustand-middleware`, `zustand-advanced-patterns`, `zustand-store-ts`, `react-state-management` |
| Node.js | `node-inspect-debugger`, `repo-healthcheck-node` |
| SQL | `sql-pro`, `sql-expert`, `drizzle-queries` |
| Auth | `better-auth`, `better-auth-setup`, `better-auth-integrations` |

Load task-specific skill docs from `Context/Installed Skill Docs.md` for full
usage details on any skill listed above.