# Omnecor — Progress Tracker

This living document tracks the execution progress of the 5-phase build roadmap. Unchecked boxes represent pending features, and checked boxes indicate completed and verified items.

---

## 🚦 Current Status
*   **Active Phase:** Phase 3 ✅ COMPLETE — next: Phase 4: Desktop Shell & Theme Modernization
*   **Next Task:** Feature 16: React 19 Version Alignment

---

## 🛠️ Phase 1: Security Hardening & Access Control
- [x] **Feature 1: tRPC Procedures Lockdown**
  *   *File:* [server/routers.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers.ts)
  *   *Done:* jobRouter (getStatus/list/cancel→protected, runSandboxCommand/prune→admin), agentRouter (runCrew/runLiteAgent/triggerN8n→protected), ommesh.router (discover/routeInference/getIdentity→protected, rotateCert/approvePeer→admin), projectRouter (getFileTreeFlat/checkAgentLoop/resetLoopDetector/getLoopDetectorState/openPath→protected), voiceRouter (all health/list/convert/transcribe/synthesize→protected). `pnpm check` passes.
- [x] **Feature 2: Safe Subprocess Spawning**
  *   *File:* [projectRouter.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers/projectRouter.ts)
  *   *Done:* projectRouter.openPath (exec→spawn arg array + validatePath), systemRouter.applyOptimizations ZRAM (exec `&&` shell→two execFileAsync sudo calls + bounded int), SecurityManager.rotateCert & generate-certs.ts (execSync openssl shell strings→execFileSync arg arrays), ProcessManagerService taskkill & ESPToolService PowerShell (execSync→execFileSync). No shell-string exec remains in server. `pnpm check` passes.
- [x] **Feature 3: Strict File Path Sanitization**
  *   *File:* [paths.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/paths.ts)
  *   *Done:* Enforced validatePath on voiceRouter.convertVoice (audioFilePath+modelPath), voiceRouter.listRvcModels (modelsDir), modelManagementRouter.register (filePath). Hardened validatePath in security.ts with separator-aware `isWithin()` boundary checks (kills `/data` vs `/data-evil` prefix bypass) on baseDir, allowed dirs, and sensitive dirs. readFile/writeFile/transcribe/synthesize already validated. `pnpm check` passes.
- [x] **Feature 4: OAuth Callback CSRF Protection**
  *   *File:* [oauth.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/oauth.ts)
  *   *Done:* Added double-submit `social_oauth_state` httpOnly cookie (sameSite=lax to survive provider redirect). Set at initiation in oauthRouter.getAuthorizationUrl via new `setSocialOAuthStateCookie()`; verified + cleared in the `/api/oauth/callback/:platform` Express handler before trusting DB state. tRPC `handleCallback` already session-bound (userId match). `pnpm check` passes.
- [x] **Feature 5: llama.cpp Bridge Directory Containment**
  *   *File:* [llamacpp_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/llamacpp_bridge.py)
  *   *Done:* Added separator-aware `_is_within()` helper; `is_safe_model_path` now rejects sibling-prefix bypasses (e.g. `~/models-evil/x.gguf` no longer passes the `~/models` allow-list). `py_compile` OK.

> **Phase 1 verification:** `pnpm check` (tsc) clean, `pnpm test` → 323/323 passing. UI-Registry unchanged — Phase 1 is backend/security only, no UI components added or modified.

---

## 🗄️ Phase 2: Database Layer & Integrity — ✅ COMPLETE (5/5)
- [x] **Feature 6: Drizzle Relations Schema Definition**
  *   *File:* [schema.ts](file:///home/linux/Documents/OmnecorV1-Beta/drizzle/schema.ts)
  *   *Done:* Added `relations(...)` import and 20 relational definitions covering all FK-linked tables: users (13 one-to-many), chatSessions/chatMessages/spendLog, pipelines/pipelinePhases, platformAccounts, discoveredArticles/curatedPosts/scheduledPosts/postAnalytics, designProjects/designSaves/designExports/aiDesignReviews, componentLibraryItems, cloudComputeSessions/Subscriptions, neuralMaps, personas, oauthStates, postingScheduleConfig.
- [x] **Feature 7: Out-of-Band DB Migrations**
  *   *File:* [server/db.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db.ts), [server/scripts/migrate.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/scripts/migrate.ts)
  *   *Done:* Created standalone `server/scripts/migrate.ts` runner; added `pnpm db:migrate` script to `package.json`. Server boot migration changed from fatal (throws) to non-fatal (logs warning + continues) so `pnpm start` never aborts on schema drift — migrations run explicitly via `pnpm db:migrate` before deployment.
- [x] **Feature 8: Safe Cascading Transactions**
  *   *File:* [server/db-pcb.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db-pcb.ts)
  *   *Done:* `deleteProject` (exports+reviews+saves+project) and `deleteDesign` (exports+reviews+save) both wrapped in `db.transaction()`. `saveDesign` mark-old-saves + insert also wrapped atomically.
- [x] **Feature 9: SQLite Query Audit**
  *   *File:* [server/db-pcb.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db-pcb.ts)
  *   *Done:* All 5 MySQL-only `(result as any)[0]?.insertId` patterns replaced with `.returning({ id: table.id })` arrays (`createProject`, `saveDesign`, `addComponentToLibrary`, `createExport`, `createAIReview`). Return values now use `row.id` instead of `insertId || 0`.
- [x] **Feature 10: Sovereign Mode Audit Tracking**
  *   *File:* [server/_core/trpc.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/trpc.ts)
  *   *Done:* `sovereignCheck` middleware now fire-and-forget logs a `sovereign_block` audit event (actorId, procedure, ip, reason) before throwing FORBIDDEN, matching the same pattern as `auditMiddleware`.

> **Phase 2 verification:** `pnpm check` (tsc) clean, `pnpm test` → 323/323 passing. UI-Registry unchanged — Phase 2 is DB/server-only, no UI components added or modified.

---

## 🧠 Phase 3: Core AI Services & Pipeline Repairs
- [x] **Feature 11: Embedding Tokenizer Implementation**
  *   *File:* [ONNXEmbeddingService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/ONNXEmbeddingService.ts)
  *   *Done:* Replaced whitespace pseudo-tokenizer (`text.split(/\s+/).map((_, i) => i + 1)`) with `@anthropic-ai/tokenizer` BPE encoder. Tokenizer cached as class member (initialized once in `loadModel`, avoids WASM overhead per call). `embed()` now produces unique, content-sensitive token IDs — different texts yield different vectors. Empty-text guard added. `pnpm check` clean, 323/323 tests passing.
- [x] **Feature 12: Warm Model Memory Caching**
  *   *File:* [llamacpp_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/llamacpp_bridge.py)
  *   *Done:* Module-level `_gen_cache` + `_emb_cache` dicts (keyed by model path) hold warm `Llama` instances; `_get_or_load()` with double-checked locking ensures each model loads once. Per-model `threading.Lock` serialises concurrent inference on the same model. Added `/load` (pre-warm), `/unload` (free memory), `/loaded` (list cached models) endpoints. `/health` now reports loaded model lists. Path safety from F5 (`_is_within`) preserved.
- [x] **Feature 13: Agent Python Bridges Creation**
  *   *File:* [crewai_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/crewai_bridge.py), [liteagent_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/liteagent_bridge.py)
  *   *Done:* Created both missing bridges. `crewai_bridge.py`: uses `crewai` (Agent+Task+Crew with `step_callback` streaming, `step_callback` guarded for older versions); falls back to direct Ollama chat when crewai not installed. `liteagent_bridge.py`: minimal ReAct-style single-agent loop via Ollama (no crewai dep); up to 8 iterations; detects "Final Answer:" signal; streams each reasoning step as JSON line. Both bridges receive config as `sys.argv[1]` and emit AgentMessageBus-format JSON to stdout. `py_compile` OK on both.
- [x] **Feature 14: Dynamic Pipeline Phase Engine**
  *   *File:* [PipelineEngineService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/PipelineEngineService.ts)
  *   *Done:* Replaced static `phaseOutput()` with async `generatePhaseOutput()` that calls `AiProviderService.getInstance().chat()` via Ollama (`llama3.2:latest`, 800 tok, temp 0.3) with phase-specific system prompts (DEFINE/PLAN/EXECUTE/REVIEW/SHIP). Falls back to the original static string if Ollama is unreachable. All 3 call sites in `createPipeline()` and `approvePhase()` updated to `await`. `pnpm check` clean, 323/323 tests passing.
- [x] **Feature 15: Local Podcast Service Integration**
  *   *File:* [LocalPodcastService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/LocalPodcastService.ts), [podcast_engine.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/podcast_engine.py)
  *   *Done:* `podcast_engine.py` now calls TTS server (`POST /synthesize`) for each turn via `httpx.AsyncClient`; uses XTTS engine when `referenceWav` provided, Kokoro otherwise; falls back to 1.5 s silence per segment when TTS server unreachable; stitches segments + silence gaps with `soundfile`/numpy (nearest-neighbour resample to 44100 Hz if needed); outputs structured JSON `{jobId, audioPath, duration, segments}` to stdout. `LocalPodcastService.ts` replaces the stub with a `callPodcastEngine()` spawner (stdin→stdout JSON, 10-min timeout, graceful fallback to stub on error); `streamDialogue()` updated to call TTS server directly via `fetch`. `pnpm check` clean, 323/323 tests passing.

---

## 💻 Phase 4: Desktop Shell & Theme Modernization
- [ ] **Feature 16: React 19 Version Alignment**
  *   *File:* [package.json (Electron)](file:///home/linux/Documents/OmnecorV1-Beta/packaging/electron-app/package.json)
- [ ] **Feature 17: tRPC Client Alignment**
  *   *File:* [package.json (Mobile)](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/package.json)
- [ ] **Feature 18: Tailwind Token Drift Resolution**
  *   *File:* [theme.config.js](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/theme.config.js)
- [ ] **Feature 19: Multi-Window External Brain Map**
  *   *File:* [ExternalBrainMapWindow.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/window-system/ExternalBrainMapWindow.tsx)
- [ ] **Feature 20: Real-Time Telemetry Upgrades**
  *   *File:* [Dashboard.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/Dashboard.tsx)
- [ ] **Feature 21: mDNS Discovery Integration**
  *   *File:* [MeshDiscoveryService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/MeshDiscoveryService.ts)
- [ ] **Feature 22: RVC Server Fallback Repair**
  *   *File:* [rvc_server.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/rvc_server.py)

---

## 📱 Phase 5: Mobile App Realization & Verification
- [ ] **Feature 23: Secure KeyStore Encryption**
  *   *File:* [server-config.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/server-config.ts)
- [ ] **Feature 24: Mobile 3D Canvas Interactivity**
  *   *File:* [3DDesigner.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/3DDesigner.tsx)
- [ ] **Feature 25: Mobile Podcast Controls and Settings**
  *   *File:* [PodcastStudio.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/PodcastStudio.tsx)
- [ ] **Feature 26: Unwired Frontend Elements**
  *   *File:* [SettingsPanel.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/SettingsPanel.tsx)
- [ ] **Feature 27: End-to-End Build Smoke Tests**
  *   *File:* [package.json](file:///home/linux/Documents/OmnecorV1-Beta/package.json)

---

# 📋 Archive A: Functional Audit — Real vs Stub (baseline 2026-06-13/14)

> Merged from `FUNCTIONAL-AUDIT.md`. Legend: ✅ real · ⚠️ partial · ❌ stub/shell · 🔧 fixed.

## ✅ RESOLVED: unified on a single libSQL/SQLite engine (2026-06-14)
Previously `getDb()` returned `null` in SQLite mode → 13 routers no-op'd in the default install (MySQL-only). **Fixed permanently:**
- Single `sqlite-core` schema (`drizzle/schema.ts`, all 25 tables) — dropped MySQL schema + partial hand-mirrored sqlite schema.
- `server/db.ts` rewritten on `@libsql/client` + `drizzle-orm/libsql`; `getDb()` **always returns a live instance** (local file default, libsql/Turso via `LIBSQL_URL`); generated migrations auto-applied at boot.
- `server/db.sqlite.ts` deleted; `db.factory.ts` is a thin re-export; `mysql2` removed.
- Fixed MySQL-only APIs: neuralMaps `onConflictDoUpdate`, schedulingRouter `.returning()`.
- Verified: tsc 0 errors, 29 tests pass, boot smoke test inserts/reads `discoveredArticles`+`curatedPosts` in default local mode (timestamps return `Date`).
- **Result:** Agent Networking/social pipeline, AgenticWallet, BrainMap, persona, platform connections, mobile sync, cloudCompute now work in the default zero-infra install. No MySQL-only tier remains.

## Pages
| Page | Status | Notes |
|---|---|---|
| Chat | ✅ | `ai.chat` real (aiRouter:264); Honcho memory real via `honcho-ai` SDK (degrades w/o key) |
| Podcast Studio | ✅ | `LocalPodcastService.generatePodcast` real local TTS |
| Dashboard | ✅ | status/health queries real |
| Settings | 🔧 | Was ~37 write-only controls; most now wired. Remainder need new subsystems. |
| Agent Networking / Curation | ❌→🔧 | Social pipeline (see below) |
| 3D Designer / PCB | ✅ | blender/kicad/project file ops on real services |
| Models / ModelHub | ✅ | ollama/aiProvider real |

## Social content pipeline — ✅ NOW REAL
End-to-end: RSS discovery → AI curation → approve → schedule → real platform publish.
- 🔧 `discoveryRouter.fetchArticles` — ingests via `ArticleDiscoveryService` (rss-parser; feeds from Settings `discoveryFeeds` or defaults; dedup by urlHash).
- 🔧 `curatorRouter.curateArticle` — was hardcoded `"AI-generated content pending review"`; now generates real platform copy via AI (`generatePostDraft`), persists, marks processed. `regenerateDraft` on same helper.
- 🔧 `schedulingRouter.publishNow` — publishes via `PublishingService` + `publishExecutor` (real X/LinkedIn/Facebook/Instagram calls; honest errors for YouTube/IG media; 401 token-refresh).
- 🔧 Scheduled posts auto-publish at due time via `server/_core/publishWorker.ts`.
- OAuth configured for twitter/linkedin/instagram/facebook/youtube with write scopes; tokens in `platformAccounts`. ⚠️ Not yet live-tested against real platform APIs.

## Verified real (spot-checks)
cloudComputeRouter (vast.ai/runpod/lambdalabs), virtualCardRouter (Lithic), honchoRouter (honcho-ai SDK), walletRouter (projectBudgets + spend_log; spend really logged by AiProviderService.logSpend per chat + cloudComputeRouter), neuralMapsRouter (BrainMap CRUD + migrate), integrationManagementRouter / modelManagementRouter (delegate to dedicated services), aiRouter.chat / podcastRouter.
> **Heuristic note:** an "external call" grep undercounts — most routers delegate to singleton services (`X.getInstance()`) or SDK clients, not raw `fetch`. Verification = reading procedures, not grep counts.

---

# 📋 Archive B: Beta Code Sweep — Production-Readiness Audit (2026-06-12)

> Merged from `Beta-Code-Sweep.md`. Branch `claude/production-readiness-audit-f38749`. Full 9-domain sweep.

## Final Gate Status
| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` (root) | ✅ 0 | ✅ 0 |
| `tsc --noEmit` (electron-app) | n/a | ✅ 0 |
| `tsc --noEmit` (omnecor-hq APK) | ❌ 1 (ai-node.tsx) | ✅ 0 |
| `vitest run` | ✅ 323 / 2 skip | ✅ 323 / 2 skip |
| `pnpm build` | ✅ clean | ✅ clean |
| `pnpm audit` (prod+dev, all workspaces) | ❌ 8 vulns (2 crit, 2 high, 4 mod) | ✅ **0 known** |
| input-tracker.md | 4 stale DEAD + 13 stale | ✅ 0 DEAD, 0 PARTIAL |
| APK-input-tracker.md | unvalidated | ✅ validated, full coverage |

## Security fixes (escalated per policy)
- `WebSocketServer.ts`: OMMESH secret compared with SHA-256 + `crypto.timingSafeEqual`; mobile node registration fail-closed when `OMMESH_SECRET` unset (except loopback/zero-login); WS upgrade verifies a session credential (cookie / `Authorization: Bearer` / `?token=`); unauthenticated LAN sockets may only attempt `mobile_node_register`.
- APK `getAuthedWsUrl()` appends stored session token as `?token=` (RN WebSockets don't attach cookies).
- `index.ts`: dedicated auth rate limiter on `/api/oauth/*` (10 req / 15 min / IP).
- `attachmentsRouter.ts` + `static.ts`: upload extension allowlist (executables/scripts/HTML/SVG → `.bin`); `/uploads` served with nosniff + `Content-Disposition: attachment` + CSP.
- `env.ts`/`sdk.ts`/`oauth.ts`/`.env.example`: `SESSION_TTL_MS` controls session JWT + cookie lifetime.
- `trpc.ts`: verified audit-log redaction on success + error paths.

## Dependencies (0 vulns after)
| Package | Was | Now | Vuln |
|---|---|---|---|
| drizzle-orm (APK + override) | 0.44.7 | ≥0.45.2 | SQL injection (high) |
| @trpc/* (APK + override) | 11.7.2 | 11.17.0 | prototype pollution (high) |
| vitest (APK) | 2.1.9 | ^3.2.6 | arbitrary file read (critical); also removes vite 5.4.21 |
| shell-quote (override) | 1.8.3 | ≥1.8.4 | newline escape bypass (critical) |
| joi via simple-oauth2 (scoped) | 17.13.3 | ≥18.2.1 | RangeError DoS (moderate) |
| uuid via xcode / @expo/ngrok (scoped) | 3.4.0 / 7.0.3 | ≥11.1.1 | buffer bounds (moderate) |
Also: `engines` (node ≥20, pnpm ≥10) added; `cross-env` added to `dev`/`start`.

## Code quality / correctness
- `db-pcb.ts` N+1 in `deleteProject` → batched `inArray`.
- `AgentService.ts` ESM-unsafe `require()` ×2 → dynamic `import()`.
- 9 silent `.catch(() => {})` on audit-log writes → `console.warn` (agentRouter, pipelineRouter, PipelineEngineService, HITLApprovalService).
- `agentSettingsRouter.ts`: removed `updateBotTheme`/`updateDiscoveryKeywords` no-op stubs; `optimalPostingTimes` typed.
- `brainmapRouter.ts` deleted (dead stub, zero callers); `modelMarketplaceRouter` `pullOllama` no-op removed.
- comfy/pcbEditor/platforms routers: `z.any()` → typed records.
- `ComfyPanel.tsx`: workflow textarea JSON-validated before queueing.
- `SetupWizard.tsx`: silent API-key save failure → toast; hardcoded `/home/linux/...` default removed.
- `config/index.ts`: `pythonBin` platform-aware (`python` win32 / `python3` else).
- `.gitattributes` added (LF/CRLF normalization).
- Responsive: Chat Live Preview overlays below `sm`; PCB toolbar `flex-wrap`; Settings `?tab=` deep-link; SpecializedModuleLauncher buttons navigate to `/settings?tab=...`.

## Follow-up rounds (same day)
- **Audit Log Retention:** `AuditLogService` (`getRetentionDays`/`setRetentionDays`/`purgeExpired`/`getStorageStats`/`startRetentionScheduler` — boot + 6h sweep; default 14 days, 28/permanent). `auditRouter` `getRetention`/`setRetention` (admin-only). `AuditRetentionPanel.tsx` in Settings → Security.
- **Silent mutations eliminated:** Desktop + APK global `MutationCache.onError` (toast / Alert.alert); last 8 silent audit-log catches now warn; `onError: () => {}` count **0**.
- **`err: any` eliminated** in client + APK.
- **OAuth refresh implemented:** `IntegrationManagementService.refreshToken` does the real `refresh_token` grant, persists rotated token + expiry, clears health cache. Zero TODO/FIXME in server/, client/src/, shared/.
- **Audit log parity in SQLite/Sovereign:** `audit_log` table + factory functions (`auditInsert`/`auditPurgeBefore`/`auditList`/`auditListByActor`/`auditStats`); live-verified (insert → stats → backdated entry purged by 14-day window).
- **Bonus:** hardcoded `python3` spawns in AgentService (×2) + trainingRouter (×2) → `PYTHON_SCRIPTS.pythonBin`.

## Accepted / deferred (documented, not blockers)
`as any` debt (~38 server, behind validated boundaries); electron-app Vite 5→7 / Electron 28→39 toolchain upgrade (needs build machine — `/finish-electron-security`); `valet:fetch`/`valet:setup-ml` maintainer-only scripts; `0o600/0o700` file perms no-op on Windows by design; Android Gradle build + Windows/Linux installer builds (need physical machines); Valet 6.4 final sign-off (needs clean GPU box).

---

# 📋 Archive C: Completed Work Log (merged from master-todo.md)

> Historical record of completed roadmap work. `[x]` = done, `[~]` = partial, `[ ]` = pending.

## 3D Designer & Live Preview — ✅ DONE
Reference research (React Flow PCB, R3F 3D); `/3d-designer` route + sidebar; `3DDesigner.tsx`; `ThreeViewer` (GLTF/GLB/OBJ + primitives, lighting, orbit); `SchematicEditor` (reactflow custom PCB/logic nodes, PCB aesthetic); `WebPreview` (iframe srcDoc); mode switching; renderable-codeblock detection in AI responses; "Preview" button on AssistantBubble; `LivePreviewPanel` in Chat right pane; "Send to 3D Designer"; Floating Window system + "Stay on Top" pin; production-readiness review.

## Packaging (Web · Linux · Windows · Android) — ✅ DONE
Toolchain pinned (Node 22+/CI 24.15, pnpm 10.x); reproducible `pnpm install`; electron-app deps; `.env.example`; `db.factory.ts` single import surface; relaxed `env.ts` FATAL guard; SQLite schema/migrations on first boot; null-guards; `better-sqlite3` rebuild note; INSTALL.md DB section + docker-compose MySQL + `db:push` ordering; `npm start` serves `dist/public`; port-autoselect; smoke flows (chat, Brain Map); electron bundling strategy + `asarUnpack` native modules (`better-sqlite3`, `onnxruntime-node`) + prod path; `electron-vite` build + disabled `bytecodePlugin()`; Linux AppImage/.deb/.rpm emitted + `dpkg-deb -c` sanity + icons; `linux-unpacked` via `xvfb-run`; setup wizard + backend child process + `OMNECOR_DB=sqlite`; Windows native modules + prebuilt path + `electron-builder --win` + Setup.exe/portable + `omnecor.nsh` + `asInvoker`/`perMachine:false` + installer smoke suite + clean-VM launch + backend spawn + SQLite round-trip + uninstaller; Android init (JDK 17) + web assets + `cap add/sync android` + LAN model + `appId`/`appName`/version/icon + Debug APK flavor; single documented command per target; versions aligned to `2.3.0-beta.1`; CI build jobs; security pass; final matrix sign-off; 8-agent swarm audit (Sessions 1–10) of 795+ elements; Session 11 9-agent Haiku verification (~820+ elements, ~301 CONNECTED, ~485 LOCAL, ~9 DEAD, ~1 PARTIAL); stale-comment sweep; Session 12 full-completion pass.

## Omnecor Implementation (todo.md / todo2.md) — ✅ DONE
OKLCH dark palette + semantic tokens; typography; reusable component library; DashboardLayout + sidebar nav; CORTEX→Omnecor rebrand (16 files, 0 refs left); Obsidian-style graph view + folder-to-node; Model Hub UI; Ollama/Llama.cpp integration + marketplace + auto-update; OpenAI/Anthropic/Gemini/Groq connectors + generic provider UI; model selection/switching + health checks + local-vs-API prefs; chat UI + streaming + Streamdown markdown; context transparency + Visual Context Map + file ejection + size counter + token estimate; message input; hash loop detector (tool/args/state hash, 3-rep threshold) + HITL alert + retry/modify/abort; Goal&Plan buffer + 50-line rolling log + auto-summarization + context export/import + size alerts + reset; module launcher (LLM Builder/3D Modeler/PCB Designer) + LoRA/QLoRA UI + training progress + Blender CLI/API + KiCad CLI/API; integrations UI + OAuth (GitHub/Notion/Slack) + cloud storage connectors + status/sync/disconnect; settings (knowledge base mgmt + folder import + file filtering + search/index; security file blacklist + scan; privacy zero-login + cloud sync; performance zram/swap + cache + context limits; app prefs); Phase 2 services (FileSystemWatcher, ProcessManager, HashTracker, VectorDB+MemoryArchitect, Security AES-256-GCM); bridges (Blender headless render/glTF/script, KiCad DRC/STEP/BOM, RVC FastAPI proxy, ESPTool flashing); tRPC routers (specializedModules + knowledgeBase) registered; spacing/typography audit; loading states; error handling; keyboard shortcuts; help/tooltips; onboarding; PHASE2_STATUS.md + 7 sub-routers (FileSystem 4 / AIProvider 5 / ContextManager 6 / ActionTracking 4 / KnowledgeBase 4 / IntegrationManager 5 / ModelManagement 4); 0 tsc errors.
*   Memory: Drizzle/libSQL + ChromaDB vector store, semantic search, episodic memory; `useOmnecorSocket.ts` + tests; `HITLAlertPanel`; hook wired into NeuralGraphView/NeuralTreeView; Brain Map windowing + multi-window sync + floating overlay + external monitor; 177 tests pass.
*   OMMESH: LAN/mDNS discovery; mTLS federation; VRAM-weighted routing; post-rotation peer broadcast; Mesh Compute UI; packaging (.deb/AppImage/Flatpak/systemd/postinst/docs).
*   Security: deserialization fix; path traversal protection; sensitive-data protection; dependency updates; unified security router hardening; advanced path validation; DoS mitigation; Python bridge sandbox; zero-trust audit; 177 tests pass.
*   Advanced: Character Engine (Flux Pro); Video Clone; ComfyUI bridge; crewAI/n8n connectors; Unsloth LoRA UI; OMMESH federated routing; LLM Builder / 3D Modeler / PCB Designer integration; redundant-component removal; agentic memory; YARA security.

## Agentic Wallet + Virtual Cards + Execution Modes + Valet — ✅ DONE
`project_budget` + `spend_log` tables; `providerPricing.ts`; `estimateCost` + spend tracking + budget pre-flight in `AiProviderService.streamChat()`; `walletRouter` mounted; `BudgetPanel` + `BudgetConfigDialog` + Dashboard card; `budget:spend` WS event + `walletSpend` Zustand slice + HITL budget overlay; `setWsInstance` singleton; `VirtualCardService` (Lithic, AES-256-GCM PAN) + `virtualCardRouter` + Virtual Cards tab; `executionMode` enum on `users` + `sovereignCheck` middleware + `cloud:true` metadata + `SOVEREIGN_MODE` env in Python bridges + `ExecutionModeBadge` + 3-mode RadioGroup + `setExecutionMode` mutation; Valet dataset builder (10-category taxonomy, 4000 Alpaca JSONL, 10% negatives, 90/10 split) + `generateValetDataset` + UnslothPanel button + `--task_type router` + `valet_router_inference.py` + `ValetRouterService` + pre-routing in `streamChat()` + `valet.status/getModes/testRoute` + status card + mounted.
*   Zero-Login: `ZERO_LOGIN_MODE` in `context.ts`; skip OAuth registration; startup checklist; `ZeroLoginBanner`; `--zero-login` flag; auto-Sovereign; `.env.example`.
*   Command registry: `useCommandRegistry.ts` (New Conversation, Clear Context, Connect Blender, Flash Firmware, Run YARA Scan, Switch Execution Mode, Pull Ollama Model); cmdk fuzzy match; accessibility on 8 pages + axe-core tests.
*   Audit/RBAC: `audit_log` table + `AuditLogService` + `auditMiddleware` + HITL/agent-spawn wiring + `auditRouter` + Settings panel + PII redaction; `rbac.ts` + `ownerProcedure`/`requirePermission` + 4-role enum + `getMyPermissions`/`listUsers`/`setUserRole` + UserManagementPanel + hidden admin commands.
*   PromptSanitizer (NFC, null-byte removal) + integration into streamChat/MemoryArchitect/AgentService + `security:injection_attempt` event + audit log + tests.
*   OAuth: Google + Microsoft routes + client IDs/secrets + no silent email merge + `loginProviders` query + Connected Accounts tab.
*   Ollama proxy (`OLLAMA_BIND_ADDRESS`/`OLLAMA_PROXY_TOKEN` + `ollama_proxy.py` + `ollamaRouter` + HITL `deleteModel` + `ModelHubPanel` + `docker-compose.ollama.yml`); ElevenLabs (`ElevenLabsService` + key + voiceRouter procedures + `VoiceProviderSelector`); RecursiveMAS (`recursive_mas_bridge.py` + `runRecursiveMAS` + `AgentMessageBus` + per-agent ChromaDB isolation + sanitizer + `RecursiveMASPanel` + HITL when agentIds>3); MCP (`@modelcontextprotocol/sdk` + `MCPClientService` + `getAvailableMCPTools`/`callMCPTool` + `mcpRouter` + HITL on `dangerous:true` + `MCPToolDirectory` + AgenticOS opt-in); Pipelines (`pipelines`+`pipeline_phases` tables + `PipelineEngineService` + per-phase HITL + ship=plan-only + sanitizer + `pipelineRouter` + audit + dashboard + `PhaseOutputPanel`); PCBWay (`PCBWayService` + keys + kicadRouter procedures + `PCBViewer3D`); OpenArt/ImageGen (`OpenArtService` + unified `imageGenRouter` + `ImageGeneratorPanel`); Threat (`runVulnerabilityScan` + `ThreatIntelService` + `threat_scanner.py` + `ThreatDashboard` + command); llama.cpp (`llamacpp_bridge.py` + `LlamaCppService` + `ONNXEmbeddingService` + VectorDB pre-computed embeddings); GPU detect (`detect_gpu.py` + postinst) + `UpdateCheckerService` + `checkForUpdates` + `UpdateBanner`.

## Valet Router automation — ✅ DONE (sign-off [~])
Dataset builder / LoRA trainer / orchestration / inference server / TS bridge exist; canonical I/O contract; shared system prompt; chat-template prompt build; reconciled `/plan` filename; taxonomy on manifest categories; extended `valet_dataset_builder.py` (canonical `route` schema + ChatML `text` + KB/repo `qa` pairs + `metadata.json` + eval set); base model Qwen2.5-1.5B; maintainer-built distribution; GGUF via llama.cpp; deps bootstrap; GPU/CPU detect; `valet_pipeline.py` orchestrator + `buildValetRouter` + idempotent/resumable + `valet.config.json` + preconditions; deterministic output + `current.json` registry + `.gitignore` weights; load artifact from `current.json` + auto-start (`ValetServerService`) + rule fallback + resource guardrails; holdout eval + thresholds + baseline + scores + expertise/rules eval; live manifest hot-reload + Brain Map RAG + knowledge refresh + drift check; local-training setting/gate + first-run/scheduled trigger + cancelable; CI job + docs + reproducibility.
*   **[~] 6.4 final sign-off:** `pnpm valet:build` from clean GPU box [ ]; artifact checksum recorded in `current.json`, fresh-machine fetch flow [ ]; app auto-serves, `/health` model_loaded:true, `/route` model-driven [x done 2026-06-11, Ollama backend]; eval route accuracy **0.7385** (Kaggle P100, 390 ex, beats keyword baseline ~2.7×; below 0.85 gate); docs (`SERVING.md`/`VALET_ROUTER.md`/`current.json`) updated; pipeline docs still assume GitHub-Release GGUF. Deployed as `omnecor-valet-router:v2-q8` (Ollama; Sandy Bridge AVX1-only box → prebuilt wheels crash, transformers ~30s/route). Fixed 3 Windows/GPU serving bugs (device mismatch, cp1252 mojibake, prompt truncation).

## Android APK integration — ✅ DONE (build-machine steps [~])
RN/Expo app scaffolded as `packaging/android/omnecor-hq/` workspace; 8 tab screens wired to real PC tRPC; PC WS mobile-node handlers; `hitlRouter`; `auth.setExecutionMode`; `aiRouter` `"ommesh"` provider; Chat selectors from `neuralMaps.list`/`personas.list`; Podcast `podcast.generate`; `expo-file-system`; 0 tsc errors. `pnpm install` (Node 24.16/pnpm 10.34.1); `prebuild:android` (NDK 30.0.14904198); **APK built 2026-06-12** (100 MB, `android/app/build/outputs/apk/debug/app-debug.apk`); release follows same pipeline (needs keystore). **[ ] 4.15** sideload to physical device; **[ ] 4.16** download GGUF + test on-device inference. ⚠️ `OMMESH_SECRET` not yet set in `.env` (nodes accepted with warning).

## Other completed sessions
*   **API/Provider Settings reorg (2026-06-07):** Settings `api` tab → 4 sections (Local AI / Cloud AI / Specialty / Local Endpoints); Ollama Base URL + Hugging Face + ElevenLabs + fal.ai + Forge + n8n URL + ComfyUI URL fields; Configured/Not-set badges; single Save; `env.ts` `huggingfaceApiKey`/`falaiApiKey`; `systemRouter` aiProviders/saveKeys expanded; `aiProviderRouter` enum + `chatHuggingFace()` + streamChat switch; SetupWizard provider sync + Skip Setup + Browse/Run Scan fixes.
*   **JSX text-node crash fix (2026-06-07):** removed `// UI-AUDIT-FINDING/SUGGESTION` lines rendering as text nodes inside `asChild`/`Slot` (caused `React.Children.only` + `TRPCClientError: Missing result`) across 12 files.
*   **Kaggle GPU Training (2026-06-11):** `trainingRouter` `saveKaggleKey`/`kaggleStatus`/`startKaggleTraining`/`kaggleJobStatus`/`pullKaggleArtifact`; `valet_merge.py` (CPU LoRA→fp16, streamed progress); `KaggleKeyCard` (Settings API) + `KaggleTrainingCard` (ValetRouterPanel, 60s polling, Import/Activate) + SetupWizard section + LLM Builder card.
*   **Unified Notifications & Agent Messenger (2026-06-12):** `shared/notifications.ts`; `NotificationService` (ring buffer + EventEmitter); `AgentMessengerStore`; `notificationRouter` + `agentMessengerRouter`; WS `notifications` channel + HITL/job notifications; AiProviderService budget alerts; `ai.chat` chat notifications; `Notifications.tsx` + `useNotifications` + nav item w/ unread badge; APK hooks + `notifications.tsx` tab; 0 tsc errors + clean build.
*   **Session 14 (2026-06-12) Windows cross-platform:** `oauth.ts` `../db.js`→`../db.factory.js` (DB factory isolation complete); `BlenderService.executeExpression()` `process.env.HOME`→`os.tmpdir()`; `ESPToolService.detectPorts()` Windows COM auto-detect (PowerShell `Get-PnpDevice`) + macOS `/dev/cu.*`; `systemRouter.detectHardware` `KICAD_BIN`→`KICAD_CLI_PATH` + ESPTool detection.

## General risks / blockers
✅ MySQL requirement removed (db.factory + libSQL); ✅ Electron native modules (`asarUnpack`); ⚠️ Python ML deps GPU-heavy (Kaggle alternative provided); ⚠️ Android client needs Gradle build machine; ✅ `getDb()` import isolation complete (last `oauth.ts` bypass fixed).
