# Beta Code Sweep — Production Readiness Audit

**Date:** 2026-06-12
**Branch:** `claude/production-readiness-audit-f38749`
**Scope:** Full 9-domain sweep (typescript, dependencies, routers, frontend, security, mock/dead-code, cross-platform, icon-parity/responsive, input-trackers)

## Final Gate Status

| Gate | Before | After |
|---|---|---|
| `pnpm exec tsc --noEmit` (root) | ✅ 0 errors | ✅ 0 errors |
| `tsc --noEmit` (electron-app workspace) | n/a | ✅ 0 errors |
| `tsc --noEmit` (omnecor-hq APK workspace) | ❌ 1 error (ai-node.tsx) | ✅ 0 errors |
| `pnpm vitest run` | ✅ 323 passed / 2 skipped | ✅ 323 passed / 2 skipped |
| `pnpm build` (Vite + esbuild) | ✅ clean | ✅ clean |
| `pnpm audit` (prod + dev, all workspaces) | ❌ 8 vulns (2 critical, 2 high, 4 moderate) | ✅ **0 known vulnerabilities** |
| input-tracker.md | 4 stale DEAD + 13 stale entries | ✅ **0 DEAD, 0 PARTIAL** — verified ground truth |
| APK-input-tracker.md | unvalidated | ✅ validated 2026-06-12, full screen coverage |

## Scan Domain Results

| Domain | Result |
|---|---|
| TypeScript / N+1 / silent mutations | 1 N+1 (fixed), 10 silent audit-log catches (fixed), `as any` debt documented below |
| Dependencies | 8 CVEs fixed via overrides + direct bumps; engines field added; CJS `require()` in ESM removed |
| Server routers | 4 stub/no-op endpoints removed (zero callers), z.any() inputs tightened |
| Frontend | Clean (no mock data, no console.log, no dead routes, all tRPC hooks valid); 1 silent onError fixed |
| Security | 7 findings fixed (see Security Fixes) |
| Mock / dead code | Clean — all in-memory stores are documented caches/fallbacks; demo data only in labeled preview mode |
| Cross-platform | python3/bash assumptions fixed, .gitattributes added, hardcoded POSIX defaults removed |
| Icon parity (GUI ↔ APK) | ✅ Verified: all 7 shared surfaces semantically match (Chat/3D/Podcast/Alerts/Settings + HITL/Status); APK-only tabs (Terminal, AI Node, Status, HITL) are intentional mobile features; icon-symbol.tsx mapping complete, no fallback icons |
| Responsive / overflow | Chat preview panel now overlays on phones instead of crushing chat; PCB toolbar wraps; tables already overflow-x-auto; APK screens use flex + numberOfLines throughout |

## Fixes Applied

### Security (escalated per policy)
| File | Fix |
|---|---|
| server/phase2/websocket/WebSocketServer.ts | OMMESH secret now compared with SHA-256 + `crypto.timingSafeEqual` (no timing/length leak) |
| server/phase2/websocket/WebSocketServer.ts | Mobile node registration fail-closed: rejected when `OMMESH_SECRET` unset (except loopback / zero-login) with clear ack reason |
| server/phase2/websocket/WebSocketServer.ts | WS upgrade now verifies a session credential — cookie (browser SPA), `Authorization: Bearer`, or `?token=` query param (mobile APK); unauthenticated LAN sockets may only attempt `mobile_node_register` (and only when `OMMESH_SECRET` is set) before any other message/subscription |
| APK: lib/_core/server-config.ts, ws-channels.ts, hooks/use-terminal.ts | New `getAuthedWsUrl()` appends the stored session token as `?token=` so the APK's channel + terminal sockets authenticate at upgrade (RN WebSockets don't reliably attach cookies) |
| server/_core/index.ts | Dedicated auth rate limiter on all `/api/oauth/*` routes (10 req / 15 min / IP, skipSuccessfulRequests) |
| server/routers/attachmentsRouter.ts + server/_core/static.ts | Upload extension allowlist (executables/scripts/HTML/SVG → `.bin`); `/uploads` served with nosniff + `Content-Disposition: attachment` + restrictive CSP |
| server/_core/env.ts, sdk.ts, oauth.ts, .env.example | `SESSION_TTL_MS` env var controls session JWT + cookie lifetime (default unchanged for local-first installs; documented 7-day value for network deployments) |
| server/_core/trpc.ts | Verified (no change needed): audit-log redaction already applied on both success and error paths |

### Dependencies (0 vulnerabilities after)
| Package | Was | Now | Vuln |
|---|---|---|---|
| drizzle-orm (APK ws + override) | 0.44.7 | ≥0.45.2 | SQL injection (high) |
| @trpc/server,/client,/react-query (APK ws + override) | 11.7.2 | 11.17.0 | prototype pollution (high) |
| vitest (APK ws) | 2.1.9 | ^3.2.6 | arbitrary file read via UI server (critical) — also removes vulnerable vite 5.4.21 from its chain |
| shell-quote (override) | 1.8.3 | ≥1.8.4 | newline escape bypass (critical) |
| joi via simple-oauth2 (scoped override) | 17.13.3 | ≥18.2.1 | RangeError DoS (moderate) |
| uuid via xcode / @expo/ngrok (scoped overrides) | 3.4.0 / 7.0.3 | ≥11.1.1 | buffer bounds (moderate) |

Also: `engines` (node ≥20, pnpm ≥10) added to root package.json; `cross-env` added and used in `dev`/`start` scripts.

### Code quality / correctness
| File | Fix |
|---|---|
| server/db-pcb.ts | N+1 in `deleteProject` → batched `inArray` deletes |
| server/phase2/services/AgentService.ts | ESM-unsafe `require()` × 2 → dynamic `import()`; silent audit catch now logs |
| agentRouter, pipelineRouter, PipelineEngineService, HITLApprovalService | 9 silent `.catch(() => {})` on audit-log writes → `console.warn` |
| server/routers/agentSettingsRouter.ts | Removed `updateBotTheme` / `updateDiscoveryKeywords` no-op stubs (zero callers; silently dropped data); `optimalPostingTimes` typed `z.array(z.string())` |
| server/routers/brainmapRouter.ts (deleted) + routers.ts | Removed dead stub router (zero callers; acknowledged saves without persisting) |
| server/phase2/routers/modelMarketplaceRouter.ts | Removed `pullOllama` no-op (clients call `trpc.ollama.pullModel` directly) |
| comfyRouter / pcbEditorRouter / platformsRouter | `z.any()` inputs tightened to typed records |
| client/src/components/media/ComfyPanel.tsx | Workflow textarea now JSON-validated before queueing (raw string to ComfyUI /prompt was a latent bug) |
| client/src/pages/SetupWizard.tsx | Silent API-key save failure now surfaces a toast; hardcoded `/home/linux/...` default removed (platform-aware placeholder) |
| server/phase2/config/index.ts | `pythonBin` default platform-aware (`python` on win32, `python3` elsewhere) |
| package.json + scripts/run-python.mjs | `valet:build`/`valet:repro` use cross-platform Python launcher; `dev`/`start` use cross-env |
| .gitattributes (new) | LF/CRLF normalization (sh/py LF, bat/cmd/ps1 CRLF, binaries untouched) |

### Responsive / UX
| File | Fix |
|---|---|
| client/src/pages/Chat.tsx | Live Preview panel: overlay (`fixed`, 85vw, max-w-sm) below `sm` so chat stays readable on phones; in-flow at `sm+` |
| client/src/components/pcb/EditorToolbar.tsx | `flex-wrap` on toolbar so 10+ controls reflow on narrow screens |
| client/src/pages/Settings.tsx | `?tab=` deep-link support |
| client/src/components/SpecializedModuleLauncher.tsx | 3 toast-only Configure/Settings buttons now navigate to `/settings?tab=valet` / `?tab=hardware` |
| packaging/android/omnecor-hq/app/(tabs)/ai-node.tsx | useEffect cleanup type fix (workspace tsc now 0 errors) |

## Accepted / Deferred (documented, not blockers)

- **`as any` debt (~38 server instances)** — concentrated in sdk.ts OAuth response shaping and settings-file reads; all behind validated boundaries. Typed-schema refactor deferred post-beta (no behavior risk found).
- **electron-app Vite 5→7 / Electron 28→39 toolchain upgrade** — requires a compiler-equipped build machine; covered by the existing `/finish-electron-security` skill. (The vite 5.4.21 advisory instance was eliminated from the lockfile via the vitest bump; electron-app itself declares vite ^6.4.2.)
- **`valet:fetch` / `valet:setup-ml` bash scripts** — maintainer-only ML setup (GPU box), not part of the user-facing app; unchanged.
- **mode: 0o600/0o700 file permissions** — silently no-op on Windows by Node design (keys still protected by user profile ACLs); acceptable.
- **Android APK Gradle build (master-todo 4.11–4.16)** and **Windows/Linux installer builds** — explicitly out of scope (require physical build machines).
- **Valet 6.4 final sign-off** — requires clean GPU box (`pnpm valet:build`).

## Verification

- `pnpm exec tsc --noEmit` — 0 errors (root, electron-app, omnecor-hq)
- `pnpm vitest run` — 323 passed, 2 skipped
- `pnpm build` — clean production bundle
- `pnpm audit` / `pnpm audit --prod` — **No known vulnerabilities found**
