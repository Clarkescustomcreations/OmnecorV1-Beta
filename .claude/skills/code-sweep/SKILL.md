---
name: code-sweep
description: Exhaustive beta-readiness code sweep for the Omnecor HMCI AI Workstation. Scans 10 domains (TypeScript, database, routers, security, frontend, UI/design tokens, mobile APK, dependencies, mock/stub, architecture) for violations of the Context/ standards, then fixes them with a verification gate. Use when asked to run a code sweep, audit the codebase, find bugs/stubs/violations before a build, harden the app, or hunt for things "code-sweep misses".
---

# Code-Sweep Skill

Exhaustive beta-readiness sweep for the **Omnecor HMCI AI Workstation**. It scans **10 domains** for concrete violations of the project's own standards (the `Context/*.md` files + `CLAUDE.md`), fixes them in order of severity, and refuses to pass until the verification gate is green.

This skill is **standards-grounded, not generic**. Every check below maps to a written rule in:
- `Context/Code-Standards.md` · `Context/Architecture.md` · `Context/UI-Rules.md` · `Context/UI-Tokens.md` · `Context/Library-Docs.md` · `CLAUDE.md`

> **Mindset:** Assume something *is* broken. A clean grep is a result to verify, not a finish line. The user demands fully built, real features — flag every stub, shell, placeholder, and silent mutation, even when it "looks intentional." When unsure whether a finding is real, read the surrounding code before logging or fixing it.

## Usage

```
/code-sweep                 # full 10-domain sweep
/code-sweep <domain>        # scope to one domain
/code-sweep quick           # scan + report only, no fixes (triage pass)
/code-sweep verify          # just run the verification gate
```

Domains: `typescript` · `database` · `routers` · `security` · `frontend` · `ui` · `mobile` · `dependencies` · `mock` · `architecture`

## Pre-Flight (always do this first)

1. **Read prior context:** Read `Context/Progress-Tracker.md` — it is the **single source of truth** for what work is left, what is intentionally deferred, and what is known-broken. Carry forward its outstanding items so you don't re-flag intentionally-incomplete work (e.g. the social discovery + publishing pipeline is a known shell; Phase-28 stubs) and reconcile every finding against it (genuinely unfinished vs. actually broken).
2. **Capture the baseline** (so you can prove improvement at the end):
   ```bash
   pnpm exec tsc --noEmit 2>&1 | tail -5          # error count baseline
   pnpm audit --prod 2>&1 | tail -20              # vuln baseline
   ```
3. **Scope exclusions:** Never scan or "fix" `node_modules/`, `dist/`, `build/`, `.git/`, `**/__pycache__/`, `drizzle/migrations/` (generated), `*.min.*`, or any pulled reference-clone / `Manus` folders. Per AGENTS.md, delete leftover reference-clone dirs once their code is integrated — flag any you find.

## The 10 Domains

Each domain lists the **rule** (with its source), a **detection** recipe, and the **fix**. Run greps from the repo root. `rg` (ripgrep) is preferred; fall back to `grep -rn`.

### 1. `typescript` — Type safety & build integrity
**Source:** Code-Standards §1.1, CLAUDE.md (`pnpm check`).
- `tsc --noEmit` must report **0 errors**. This is the hard gate.
- Hunt: `: any`, `as any`, `<any>`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, non-null `!.` abuse, implicit-any params, `Function`/`Object` types, unchecked `JSON.parse(...)` results, `// eslint-disable`.
  ```bash
  rg -n ':\s*any\b|as any|<any>|@ts-(ignore|nocheck|expect-error)' server client shared --glob '!**/*.test.ts'
  ```
- Fix: replace `any` with a real interface/`unknown`+narrowing/`$inferSelect`/`$inferInsert`. Never silence with `@ts-ignore` — fix the type. Props must have an explicit `interface` (Code-Standards §1.1).

### 2. `database` — Drizzle / libSQL correctness
**Source:** Code-Standards §3, Architecture §6, Library-Docs §2, CLAUDE.md (DB section).
- **MySQL-legacy ban (critical):** any `(result as any)[0]?.insertId`, `.insertId`, `result.insertId`, or row-index id parsing → silently returns `id: 0` under SQLite. Must use `.returning({ id: <table>.id })`.
  ```bash
  rg -n 'insertId|lastInsertRowid|\[0\]\?\.\s*id|as any\)\[0\]' server
  ```
- Upserts must be `.onConflictDoUpdate({ target, set })` — flag MySQL `ON DUPLICATE KEY` / `onDuplicateKeyUpdate`.
- SQLite mapping: enums = `text({ enum: [...] })`, timestamps = `integer({ mode: "timestamp" })`, JSON = `text({ mode: "json" })`. Flag `timestamp(` / `datetime(` / `mysqlTable` / `pgTable` / `serial(` / `json(` (mysql-core) in `drizzle/schema.ts`.
- `getDb()` is **async and never null** — flag `getDb()` used without `await`, and any `if (!db)` null guard left over from the old nullable engine.
- Raw SQL: flag `db.execute(` / `sql\`...\`` string-interpolated user input — prefer the query builder.
- After any schema edit, remind: `pnpm build:push` to regenerate migrations.

### 3. `routers` — tRPC procedure correctness
**Source:** Code-Standards §2, Architecture §6.4, CLAUDE.md (procedure tiers).
- **Procedure-tier audit (critical).** For every procedure in `server/routers/` (42 routers) and the two legacy routers in `server/phase2/routers/`:
  - Any procedure that calls an external cloud API (`fetch(`, OpenAI/Anthropic/Fal/RunPod/Vast/ElevenLabs/OpenArt SDK calls) **must** be `cloudProcedure`, not `protectedProcedure` — otherwise Sovereign mode leaks. Cross-reference the service it calls.
    ```bash
    rg -n 'protectedProcedure' server/routers server/phase2/routers -l | xargs rg -ln 'fetch\(|openai|anthropic|fal\.|runpod|elevenlabs'
    ```
  - Config-mutating / log-deleting / mesh-credential procedures must be `admin`/`ownerProcedure`.
  - Every `.query`/`.mutation` must have a Zod `.input(...)` (Code-Standards §4.3) unless genuinely input-less. Flag procedures taking raw args with no schema.
- **All routers must import from `server/_core/trpc.ts`** (shared `TrpcContext`). Flag any local `initTRPC` re-init.
- **Singleton access:** use `ctx.services.<svc>` — flag `<Service>.getInstance()` / `new <Service>(` inside routers (Code-Standards §2.2, Architecture §6.5).
- **No silent mutations:** every insert/update/delete must `return` the changed object **or** broadcast a WS event. Flag mutations that `await db...` then `return { success: true }` / `return;` with no payload and no WS broadcast (Code-Standards §5.3, Architecture §6.7).
- **Stubs / dead endpoints:** procedures that `return []` / `return null` / `throw new Error("not implemented")` / `// TODO` bodies. Confirm against Progress-Tracker before flagging as a bug vs. known-deferred.
- Hardcoded URLs/ports/secrets in routers → move to env / `paths.ts`.

### 4. `security` — Vulnerabilities (escalate, never hand-wave)
**Source:** Code-Standards §4, Architecture, CLAUDE.md env vars.
- **RCE (critical):** `child_process.exec(` / `execSync(` with template-string interpolation. Must be `spawn(cmd, [args])` with an array (Code-Standards §4.1).
  ```bash
  rg -n 'exec(Sync)?\(\s*`|exec(Sync)?\([^,)]*\$\{' server packaging
  ```
- **Path traversal:** user-supplied FS paths not passed through `validatePath` (Code-Standards §4.2). Flag `fs.*`/`readFile`/`writeFile`/`rm`/`createReadStream` on a request-derived path with no `validatePath` nearby.
- **Hardcoded secrets:** API keys, tokens, `JWT_SECRET` defaults, `OMMESH_SECRET`, private keys committed in source.
  ```bash
  rg -n '(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*["\x27][A-Za-z0-9_\-]{16,}' server client shared packaging
  ```
- **Auth bypass:** `ZERO_LOGIN_MODE` paths reachable in prod; `publicProcedure` on anything that mutates state or reads another user's data.
- **Injection:** unparameterized SQL, `eval(`, `new Function(`, `dangerouslySetInnerHTML`, unsanitized `innerHTML`.
- **CORS / rate-limit:** `origin: "*"` with credentials; mutation endpoints with no rate limiting; missing helmet/CSP.
- **Mobile creds (critical):** secrets in `@react-native-async-storage/async-storage` — must be Expo `SecureStore` (Code-Standards §4.4).
  ```bash
  rg -n 'AsyncStorage' packaging/android | rg -i 'key|token|secret|password'
  ```
- **Prompt injection:** user content concatenated into system prompts without going through `PromptSanitizer`.
- Treat every security finding as HIGH+ until proven otherwise. Fix carefully and re-verify `tsc`.

### 5. `frontend` — React 19 SPA integrity
**Source:** Code-Standards §1, §5.1; Architecture §6.1; CLAUDE.md (frontend).
- **DB isolation (critical):** no component/hook/page may import `drizzle/schema`, call `getDb()`, or import from `server/`. 
  ```bash
  rg -n "from ['\"](.*/)?(drizzle/schema|server/|@/.*getDb)" client/src
  rg -n 'getDb\(' client/src
  ```
- **Named exports only:** flag `export default function`/`export default class` in `client/src/components` and `client/src/pages` (Code-Standards §1.1).
- **Lazy + boundary:** every page route in `App.tsx` must be `React.lazy()` and wrapped via `withBoundary()`/`RouteBoundary`. Flag eager page imports or routes missing a boundary.
- **Data fetching:** server data must go through `trpc.*.useQuery/useMutation` — flag raw `fetch(`/`axios` to the API from components, and server state stuffed into Zustand (Zustand is transient shell state only).
- **Hooks correctness:** missing `queryKey` deps, `useEffect` with missing deps that fetch, broken/renamed tRPC hook paths (won't typecheck — catch in domain 1 too).
- Debug artifacts: `console.log`/`console.debug` left in, `debugger;`, commented-out JSX blocks.

### 6. `ui` — Design tokens & accessibility
**Source:** AGENTS.md "Rules That Never Change", UI-Rules, UI-Tokens.
- **No hardcoded colors (critical rule):** no hex literals, no raw Tailwind color classes (`bg-blue-500`, `text-red-600`, etc.) in web client — must use semantic tokens (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `--accent-*`).
  ```bash
  rg -n '#[0-9a-fA-F]{3,8}\b' client/src --glob '!**/*.css'
  rg -n '\b(bg|text|border|ring|from|to|via)-(red|blue|green|gray|slate|zinc|yellow|purple|cyan|indigo|emerald|rose)-[0-9]{2,3}' client/src
  ```
- **Hover/cursor:** interactive elements need a hover transition (`transition-colors`/`duration-200`) and `cursor-pointer` (UI-Rules §1, §4).
- **Overflow safety:** long-text containers need `.card-content-safe` / `break-words` / `max-w-full` (UI-Rules §3.2).
- **Semantic structure:** pages should use `<header>/<main>/<section>/<aside>`, not all-`<div>` (UI-Rules §5.2).
- **Unique IDs:** interactive buttons/inputs/toggles need a descriptive `id="..."` for E2E (UI-Rules §5.2).
- **Heading hierarchy:** `h1` = `text-4xl font-bold tracking-tight`, etc. — flag skipped levels or wrong sizing.
- **Primitives reuse:** flag re-implemented buttons/dialogs/selects that should use `components/ui/*` (Code-Standards §1.1).

### 7. `mobile` — Android APK companion
**Source:** UI-Rules §6, UI-Tokens §5, Library-Docs §4. Scope: `packaging/android/omnecor-hq/`.
- **No oklch in RN:** React Native can't parse `oklch()` — colors must be the hex fallbacks from `theme.config.js`. Flag `oklch(` anywhere under `packaging/android`.
- **SafeAreaView:** every root screen wrapped in `SafeAreaView` from `react-native-safe-area-context` (UI-Rules §6.1).
- **Touch targets:** interactive elements ≥ `48dp`; adjacent items ≥ `8dp` gap (UI-Rules §6.2).
- **Portrait reflow:** multi-pane web layouts must reflow to `flex-col` (UI-Rules §6.1).
- **Haptics:** success/warning/error actions should trigger `Haptics.notificationAsync(...)` (UI-Rules §6.3).
- **SecureStore:** see domain 4 — no plaintext creds in AsyncStorage.
- **Version drift:** mobile tRPC should be aligned to backend `11.8.0`; mobile Tailwind v3 + NativeWind — confirm against Library-Docs §4 matrix.

### 8. `dependencies` — Supply chain & drift
**Source:** Library-Docs §4, CLAUDE.md (pnpm rules).
- `pnpm outdated` + `pnpm audit` — log every vuln with severity. Drive `pnpm audit` toward **0** (see the `finish-electron-security` skill for the Electron toolchain leg).
- **Overrides location (critical):** all pins/overrides live in `pnpm-workspace.yaml` — flag any `pnpm.overrides` / `resolutions` written into a `package.json` (pnpm 10 ignores them in workspaces).
  ```bash
  rg -n '"(overrides|resolutions)"|"pnpm"\s*:' package.json packaging/*/package.json
  ```
- **Version-drift matrix:** React (Electron 18 vs root/mobile 19), tRPC (mobile 11.17 vs backend 11.8), Tailwind (v4 web/electron vs v3 mobile). Confirm against Library-Docs §4.1 action plan.
- CommonJS-in-ESM: `require(`/`module.exports` in `.ts`/ESM files; missing `.js` extensions on relative server imports (NodeNext).
- Unused deps (`depcheck`-style: in `package.json` but never imported) and phantom deps (imported but not declared).

### 9. `mock` — Stubs, shells & placeholders (the user's #1 complaint)
**Source:** project memory "No stub features", "Omnecor audit".
- Real-vs-stub sweep across **prod paths** (exclude `*.test.ts`, `__tests__`, fixtures):
  ```bash
  rg -in 'mock|fake|dummy|placeholder|stub|lorem ipsum|hardcoded|sample data|TODO|FIXME|XXX|HACK|not implemented|coming soon|under construction|return \[\]\s*;?\s*//' server client shared --glob '!**/*.test.*' --glob '!**/__tests__/**'
  ```
- In-memory "stores" pretending to be persistence (a `Map`/array module-global that should be a DB table).
- Functions that return canned/constant data instead of computing it; UI wired to fake arrays instead of `useQuery`.
- Known shells to **verify status** against Progress-Tracker (don't blindly "fix" deferred work, but do report it): social **discovery** + **publishing** pipeline, anything tagged Phase 28.
- For each finding decide: **(a)** real bug → fix; **(b)** intentionally deferred → log in "Remaining Known Issues"; **(c)** genuine stub the user wants built → flag prominently for a decision (don't silently leave it).

### 10. `architecture` — Boundaries & conventions
**Source:** Architecture §6 (Hard Rules), Library-Docs §1.
- **UI-logic isolation:** no `import ... react`/JSX/DOM/styling in `server/`, services, or `python_bridges` (headless only).
  ```bash
  rg -n "from ['\"]react|react-dom" server
  ```
- **Path aliasing:** no deep relative imports escaping a sub-project (`../../../`) — use `@/`, `@shared/`, `@assets/`.
  ```bash
  rg -n "from ['\"]\.\./\.\./\.\./" client/src
  ```
- **Single entry point:** `server/_core/index.ts` is the only bootstrap — flag stray `app.listen(` / second Express servers.
- **Singleton rule:** services instantiated once in `_core`/`phase2/services`, reached via `ctx.services` (see domain 3).
- **MCP-first:** flag custom puppeteer/playwright installs or raw scrapers where an MCP server (`puppeteer`, `sqlite`, `filesystem`, `git`) should be used (Library-Docs §1).
- **No silent mutations** (cross-cuts domain 3).

## Execution Workflow

1. **Pre-flight** (above): read prior sweep + Progress-Tracker, capture baselines, set exclusions.
2. **Scan.** For a full sweep, launch the domains in parallel as **Haiku 4.5** background agents (`model: "haiku"`, `run_in_background: true`), grouped to ~3 agents so each owns a few domains:
   - Agent A → `typescript`, `database`, `routers`
   - Agent B → `security`, `frontend`, `architecture`
   - Agent C → `ui`, `mobile`, `dependencies`, `mock`
   Give each agent its domain rules + exact greps above, the exclusion list, and instruct it to **read the surrounding code before reporting** (file path + line + severity + one-line fix proposal). For a single-domain or `quick` run, scan inline yourself.
3. **Triage.** As results arrive, record each into `Context/Progress-Tracker.md` immediately, grouped by severity using the rubric below. De-dupe against items already tracked there.
4. **Fix, by severity.**
   - **Security findings → escalate to an Opus 4.8 agent** with exact paths/lines/context. Never self-patch a vuln casually; fix root cause, then re-verify.
   - Non-security CRITICAL/HIGH → fix directly (you are the fixing model). Read the file first, make **minimal targeted** changes — no opportunistic refactors. Batch by file, run `tsc` after each batch.
   - MEDIUM/LOW → fix if cheap and safe; otherwise log to "Remaining Known Issues".
   - **Stubs the user wants real** → if the fix is large/ambiguous, surface it for a decision rather than shipping another half-build.
5. **Verification gate (must pass before declaring done):**
   ```bash
   pnpm exec tsc --noEmit      # 0 errors — HARD gate
   pnpm test                   # run suite; no new failures
   pnpm build                  # bundles cleanly (full sweeps)
   pnpm audit --prod           # vuln count must not increase; ideally 0
   ```
   If any gate regresses vs. the baseline, fix or revert before finishing.
6. **Report.** Update `Context/Progress-Tracker.md` (mark fixed items resolved, log new outstanding/deferred ones) and give the user: counts found/fixed/deferred per domain, the before/after baseline (tsc errors, audit vulns), and a short list of decisions you need from them.

## Severity Rubric

| Severity | Meaning | Examples |
|---|---|---|
| **CRITICAL** | Breaks the build, leaks secrets, RCE, data-loss, Sovereign-mode bypass | `tsc` error, `exec(\`...${x}\`)`, `insertId` → id:0, `cloudProcedure` missing on cloud call, secret in source |
| **HIGH** | Wrong behavior, security weakness, broken isolation | path traversal w/o `validatePath`, getDb() in client, silent mutation, AsyncStorage creds |
| **MEDIUM** | Standards violation, drift, latent bug | `any` types, hardcoded color class, default export component, version drift, missing Zod input |
| **LOW** | Polish | console.log, missing `id`, missing hover transition, naming |

## Tracking File — `Context/Progress-Tracker.md` (source of truth)

`Context/Progress-Tracker.md` is the **single source of truth for work left to be done** — there is no separate sweep log. Record sweep results into it (append a dated "Code-Sweep" section; respect its existing structure and headings, don't clobber unrelated content). Capture: run timestamp & scope · **baseline vs. final metrics** (tsc errors, audit vulns) · findings grouped by severity (file:line + fix) · fixes-applied (file | issue | fix | model) · security escalations · **verification gate checklist** · outstanding / deferred items (so the next run reconciles against them). Mark items resolved as you fix them so the tracker always reflects true remaining work.

## Notes & Guardrails

- **Don't fix what's intentionally deferred.** Reconcile every "stub" finding against `Context/Progress-Tracker.md` and the carried-forward deferred table before touching it.
- **Read before you flag, read before you fix.** Greps produce false positives (a color class inside a code-string, an `any` in a `.d.ts`, an `exec` with a constant). Confirm in-file.
- **Minimal diffs.** This is a sweep, not a rewrite. No drive-by refactors; no new abstractions.
- **Security is non-negotiable:** every domain-4 finding gets logged and fixed or explicitly accepted by the user — never silently dropped.
- **Agents need Bash/grep perms.** If background agents hit permission errors, run `/update-config` to allow `Bash(rg *)`, `Bash(grep *)`, `Bash(find *)`, `Bash(pnpm *)`.
- **Clean up reference clones.** Per AGENTS.md, delete integrated shallow-clone/`Manus` dirs; flag any left behind.
- The hard floor for "done": `pnpm exec tsc --noEmit` = **0 errors** and no regression in `pnpm audit`.
