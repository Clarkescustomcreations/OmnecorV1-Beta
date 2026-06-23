# Technical Debt Register

*A centralized log of all known TODOs, FIXMEs, architectural compromises, and temporary workarounds across the Omnecor codebase. Entries are sourced from code-sweep audits, session notes, AGENTS.md, and Build-Plan appendices. Risk levels: Low / Medium / High / Critical. Last audited: 2026-06-20.*

---

## Debt Registry

### TD-001: Valet Router Electron Packaging Gap (BLOCKER)
- **File**: `packaging/electron-app/electron-builder.yml`
- **Reason**: `extraResources` ships only `dist/index.js` + assets. Does NOT bundle `server/python_bridges/valet_router_inference.py`, `docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md`, or `routing_manifest.json`. Without these, the Valet inference server cannot spawn in a packaged Electron installer. Also requires a Python runtime + `fastapi`, `uvicorn`, and optionally `llama-cpp-python` to be available in the packaged app environment.
- **Risk**: High
- **Status**: Open — awaiting Windows build machine work. See Progress-Tracker ACTION REQUIRED section.

### TD-002: Valet Router `current.json` Hardcoded Windows Path
- **File**: `models/valet-router/current.json`
- **Reason**: `artifact_path` is currently set to an absolute Windows path (`C:\OmnecorV1-Beta\models\valet-router\kaggle-2026-06-11\valet-router-q8_0.gguf`). This is harmless for the Ollama backend (the loader ignores it), but **must** be made relative or portable before building an end-user installer on any target machine.
- **Risk**: High
- **Status**: Open — must be fixed before first public Electron release (see Build-Plan Appendix B §4 options A and B).

### TD-003: `OMMESH_SECRET` Not Set in Default `.env`
- **File**: `.env` / `packaging/android/omnecor-hq/.env`
- **Reason**: `OMMESH_SECRET` is not pre-configured in the default `.env`. Mobile nodes connecting to the PC are accepted with a security warning (`"OMMESH_SECRET not set — accepting with warning"`) — this is an intentional fail-open for developer convenience but represents a real security gap in any deployment where the mobile node is not trusted automatically.
- **Risk**: Medium
- **Status**: Open — developer must manually set `OMMESH_SECRET=<value>` in `.env` before production or any physical LAN deployment.

### TD-004: Linux System Clock NTP Drift (VIS Node)
- **File**: N/A — system-level issue
- **Reason**: The Linux development machine (`omnecor-lin-vis`, `192.168.1.252`) clock was found to be ~61 minutes fast (NTP disabled). This caused mTLS cert validation failures because certificate timestamps appeared to be in the future. The OMMESH 5-minute `verifyMessage` replay window is also affected.
- **Risk**: Medium
- **Status**: Open — fix: `sudo timedatectl set-ntp true`. Must be done before next OMMESH 3-way test with Android node.

### TD-005: Windows Installer — Not Run on Clean Machine
- **File**: `packaging/electron-app/dist/Omnecor-Setup-2.3.0-beta.1.exe`
- **Reason**: The Windows installer was built (1.69 GB NSIS) and smoke tests are static-analysis-only (338/338 passing). No one has yet run the installer on a clean Windows machine to confirm the app launches, the backend spawns, and the SQLite round-trip succeeds.
- **Risk**: High
- **Status**: Open — pending physical Windows machine test. See F27 remaining checklist in Progress-Tracker.

### TD-006: Android APK Physical Device Test Not Completed
- **File**: `packaging/android/omnecor-hq/android/app/build/outputs/apk/release/app-release.apk`
- **Reason**: The release APK (118 MB, JS-bundled, debug-signed) has been built and verified at the build level. On-device sideload testing, Vulkan/NNAPI on-device LLM inference verification, and 3rd-party GGUF download/load testing on a physical Samsung Galaxy S25 Ultra (Snapdragon 8 Elite) are all pending.
- **Risk**: High
- **Status**: Open — F27 Android leg pending. GGUF must be downloaded to `Documents/models/` on device and Load tested at runtime.

### TD-007: Always-Listen Wake-Word `.ppn` Not Trained
- **File**: `packaging/android/omnecor-hq/lib/_core/always-listen.ts`
- **Reason**: The Always-Listen foreground service is built, type-checked, and APK build-verified. However, the custom "Hey Omnecor" Porcupine `.ppn` wake-word file has not been trained via the Picovoice console. The system currently falls back to the built-in `COMPUTER` keyword. The fallback works but responds to "computer" not "Hey Omnecor."
- **Risk**: Low
- **Status**: Open — low priority until on-device verification (F27). Train `.ppn` → bundle + `setKeywordPath`.

### TD-008: Mobile Tl;DR on-Device Verification Loop — F23b Background Listen
- **File**: `packaging/android/omnecor-hq/modules/mic-foreground-service/`
- **Reason**: The native Kotlin `MicForegroundService` was built and verified via `./gradlew :app:assembleDebug` (BUILD SUCCESSFUL). However, the end-to-end test (wake-word fires with app **backgrounded/closed**) requires a physical Android device — not verifiable in CI or emulator.
- **Risk**: Medium
- **Status**: Open — pending F27 on-device verification.

### TD-009: `tmp-valet-train/` Training Debris in Repo
- **File**: `tmp-valet-train/` (135 tracked files)
- **Reason**: `tmp-valet-train/` contains 135 tracked files of Valet Router training debris (archived/superseded by the Kaggle pipeline). An "Archived/Superseded" banner was added to `tmp-valet-train/README.md` (2026-06-19) but the files were not removed/gitignored due to removal risk without explicit sign-off.
- **Risk**: Low
- **Status**: Open — deferred. Decision required before next major version tag.

### TD-010: Valet Router Route Accuracy Below 0.85 Gate
- **File**: `models/valet-router/`, `server/python_bridges/valet_router_inference.py`
- **Reason**: The Valet Router V2 achieved 0.7385 route accuracy on Kaggle P100 eval (390 examples, beats keyword baseline ~2.7×). The configured accuracy gate is 0.85 before full production sign-off. The 0.85 gate was not met in the Kaggle run; the model is deployed but advisory-only.
- **Risk**: Medium
- **Status**: Open — requires another training run from a clean GPU box with full compute. `pnpm valet:build` sign-off still pending. Current model (`omnecor-valet-router:v2-q8`) is live on `192.168.1.78:11434` only.

### TD-011: `dangerouslySetInnerHTML` in PCB Schema Nodes
- **File**: `client/src/components/pcb/SchematicNode.tsx`, `client/src/components/pcb/PCBNode.tsx`, `client/src/components/pcb/ComponentLibraryPanel.tsx`
- **Reason**: These components inject SVG content via `dangerouslySetInnerHTML`. Appears to inject only static component SVG (not user content), but a confirm-static review was flagged and deferred by the 10-domain code sweep. The `ui/chart.tsx` instance is the standard shadcn CSS-var pattern and is safe.
- **Risk**: Medium
- **Status**: Open — review required to confirm no user-supplied content flows into these injection points.

### TD-012: Server `: any` Type Annotations (Behind Validated Boundaries)
- **File**: Multiple — `server/` codebase (untyped third-party libs: `bonjour`, ChromaClient; dynamic WS event payloads; `db: any` context field)
- **Reason**: All `as any` casts were eliminated (0 in `server/` after the beta sweep). However, `: any` **type annotations** remain intentionally behind validated boundaries where third-party libraries don't provide types (`bonjour`, ChromaClient) or where dynamic payloads are validated at runtime (WS event payloads). These are architectural decisions, not regressions.
- **Risk**: Low
- **Status**: Accepted — not sweep-fixable without significant effort or library type updates. Documented here for awareness.

### TD-013: `MapManager.tsx` "Cloud Indexing Coming Soon" Placeholder
- **File**: `client/src/components/neural/MapManager.tsx`, `server/routers/integrationsRouter.ts`, `client/src/pages/BrainMap.tsx`
- **Reason**: Neural Maps remote sources (`github://`, `integration://`) were decorative-label shells — stored + drawn as a single dot, never ingested. `settings.indexingEnabled` was stored-but-unconsumed.
- **Risk**: Low
- **Status**: **RESOLVED (2026-06-23).** Session 23 (2026-06-20) made the trees real (`integrations.fetchSourceTree` → recursive github tree + `integration://` listings, rendered via `fileTreeToNetwork`, gated by `indexingEnabled`; **GitHub live-verified**, 1500-node tree). The two follow-ons are now also done: (a) **content → VectorDB + chat RAG (2026-06-23)** and (b) **dropbox/onedrive adapters (2026-06-22)**. `indexingEnabled` is now consumed for real (the write-gate). See TD-038 (resolved) and the Progress-Tracker "Map RAG over Remote Sources" entry. Only live end-to-end runtime proof remains (needs ChromaDB + tokens).

### TD-014: `template-brand "Manus"` Leftover Comments in Server Core
- **File**: `server/_core/notification.ts`, `server/_core/map.ts`, `server/_core/sdk.ts`, `server/_core/storage.ts`
- **Reason**: These active (non-dead-code) files still contain "Manus" brand references in comments and default strings — leftover from the original template fork. `ManusDialog.tsx` was fully deleted (zero importers), but these server-side files were left because renaming comments in active files was deemed cosmetic risk. Not functional debt.
- **Risk**: Low
- **Status**: Open — cosmetic only; safe to rename in any future polish pass.

### TD-015: `AppRouter` Type Not Imported in Mobile APK
- **File**: `packaging/android/omnecor-hq/` tRPC client configuration
- **Reason**: The mobile APK does not import the PC's `AppRouter` type for full end-to-end tRPC type safety. tRPC calls from the APK are typed against a local stub or `any`. Full type safety requires importing `AppRouter` from the desktop workspace (cross-workspace type import).
- **Risk**: Medium
- **Status**: Open — deferred to "important" tier in APK remaining work. Requires pnpm workspace type-sharing setup.

### TD-016: Mobile `llm.ts` `fetchWithBackoff` Not Grafted into Server
- **File**: `packaging/android/omnecor-hq/lib/_core/llm.ts` (mobile-specific)
- **Reason**: The mobile APK has a `fetchWithBackoff` retry helper in `llm.ts` that provides resilient LLM request retry logic. This was not grafted into the main server's `server/_core/llm.ts`. The server LLM calls do not have equivalent retry/backoff logic.
- **Risk**: Low
- **Status**: Deferred — noted in APK deferred tasks. Low impact on server stability given existing error handling.

### TD-017: Dedup / Remove Dead Scaffolding in Mobile Workspace
- **File**: `packaging/android/omnecor-hq/server/`, `packaging/android/omnecor-hq/drizzle/`, `packaging/android/omnecor-hq/shared/`
- **Reason**: The mobile workspace contains dead `server/`, `drizzle/`, and `shared/` scaffolding directories inherited from the template fork (older Omnecor fork). Only the `AppRouter` type is imported from this stale tree. These files are never executed.
- **Risk**: Low
- **Status**: Deferred — safe to delete once `AppRouter` import is properly resolved via workspace type-sharing (TD-015).

### TD-018: OMMESH VRAM-Weighted Routing Not Implemented (Partially Resolved)
- **File**: `server/ommesh/core/MeshNode.ts`
- **Reason**: The original template debt was "temporary fallback routing implemented instead of dynamic mesh discovery." Dynamic discovery via mDNS (`MeshDiscoveryService`) and real mTLS remote inference are now LIVE-VERIFIED (Linux↔Windows, 2026-06-16). However, VRAM-weighted routing — selecting the best peer by available VRAM headroom rather than first-available — is described in the product vision but not yet implemented. `MeshNode.routeInference()` currently selects the first responding peer.
- **Risk**: Medium
- **Status**: Partially resolved — basic dynamic mesh routing is live. VRAM-weighted peer selection remains unimplemented. Requires `startTelemetryPush()` VRAM data to feed into peer selection logic.

### TD-019: `publicProcedure` Intentional Exceptions — Security Decision on Record
- **File**: `server/_core/systemRouter.ts`, `server/routers/honchoRouter.ts`
- **Reason**: `systemRouter.getSettings` / `saveSettings` are `publicProcedure` intentionally — required for the Setup Wizard pre-login. `honchoRouter` is `publicProcedure` by design for zero-login mode. All `*.status` / `getProviders` / health probes are read-only public. These are **intentional security decisions** documented in the 10-domain sweep, not vulnerabilities.
- **Risk**: Low
- **Status**: Accepted — documented here so any future security review knows these are not oversights.

### TD-020: OAuth Live-Test Against Real Platform APIs Not Done
- **File**: `server/routers/oauthRouter.ts`, `server/routers/schedulingRouter.ts`, `server/oauth/oauthClients.ts`
- **Reason**: The social publishing OAuth flow (X/Twitter, LinkedIn, Instagram, Facebook, YouTube) is fully implemented end-to-end (RSS discovery → curation → schedule → publish). However, it has **not been live-tested against real platform APIs** — only code-level verification was performed. Platform API behavior, rate limits, and token expiry paths are untested in production.
- **Risk**: High
- **Status**: Open — blocked on operator registering OAuth apps + entering credentials + registering callback URIs with each platform. **Pipeline mechanics PROVEN LIVE (2026-06-20, Session 23):** with a dummy-token account, `createDirectPost` → `publishNow` ran the full executor (token lookup → curated⨝scheduled join → `PublishingService` dispatch → real `api.twitter.com/2/tweets` call → genuine 403 → `failed` status + real errorMessage persisted). The chain is real; only a valid platform user-token (or a pasted token via `platforms.addAccount`, which accepts a raw token) is missing. `listAccounts` correctly does not expose raw tokens.

### TD-021: Electron Toolchain Upgrade Deferred
- **File**: `packaging/electron-app/package.json`
- **Reason**: `electron-app` is on Vite 5 / Electron 39. The beta sweep flagged a recommended upgrade to Vite 7 / Electron 39+ security patch. This requires a build machine (native modules must be rebuilt). Deferred as a post-V1 task.
- **Risk**: Low (current versions have no known critical CVEs after 0 audit)
- **Status**: Deferred — planned for V2 toolchain update pass.

### TD-022: Valet Router Kaggle Training Pipeline Docs Still Reference GitHub-Release
- **File**: `tmp-valet-train/README.md`, `packaging/windows/BUILD-WINDOWS.md` (partially fixed 2026-06-19)
- **Reason**: `packaging/windows/BUILD-WINDOWS.md` was corrected (2026-06-19 doc pass) to reference `scripts/fetch-valet-model.sh` instead of `git lfs pull`. However, `tmp-valet-train/README.md` still references the old GitHub-Release GGUF distribution flow (now archived/superseded). A stale hardcoded path reference was also fixed in that file.
- **Risk**: Low
- **Status**: Open (cosmetic) — `tmp-valet-train/README.md` archived banner added but doc content still references old flow. Will be resolved when TD-009 (debris cleanup) is addressed.

### TD-023: Chat Streaming Display / Session Rename / Delete / Export (Mobile)
- **File**: `packaging/android/omnecor-hq/app/(tabs)/index.tsx`
- **Reason**: Mobile APK chat streaming display improvements, session rename, delete, and export are listed as "Enhancement" tier in the APK remaining work. Currently sessions exist but management UI is minimal (dropdown picker only).
- **Risk**: Low
- **Status**: Open (Enhancement) — post-F27 backlog.

### TD-024: *(Merged into TD-018)*
- **Status**: Removed — original entry was "Temporary Fallback Routing in OMMESH." Consolidated into TD-018 (OMMESH VRAM-Weighted Routing) to eliminate the circular forward/backward reference.

### TD-025: OAuth Login Screen + Token Expiry Handling (Mobile)
- **File**: `packaging/android/omnecor-hq/app/(tabs)/settings.tsx`, `packaging/android/omnecor-hq/lib/_core/server-config.ts`
- **Reason**: The APK auth flow supports local accounts and Google/Microsoft OAuth via the desktop PC. However, an explicit OAuth login screen and automatic token-expiry handling (re-auth prompt) have not been built in the mobile app. Users currently must manually logout + reconnect on token expiry.
- **Risk**: Medium
- **Status**: Open (Enhancement) — post-F27 backlog.

### TD-026: Podcast History — No Server-Backed Persistence
- **File**: `client/src/pages/PodcastStudio.tsx`
- **Reason**: Podcast episode history is stored in `localStorage["omnecor:podcast_session"]` (session-level) and in a `localStorage`-backed episode-history dialog (play/download/remove). No server-backed table exists for episode history — episodes are lost if the browser storage is cleared or the user switches browsers.
- **Risk**: Low
- **Status**: Open — localStorage was chosen as a pragmatic fix (F26). A future `podcast_episodes` SQLite table would complete this.

### TD-027: `scheduledPosts` Table Has No `userId` Column
- **File**: `drizzle/schema.ts` — `scheduledPosts` table
- **Reason**: `scheduledPosts` table has no direct `userId` column. IDOR protection in `trpc.scheduling.retryPost` was implemented by verifying `platformAccounts.userId` matches the session user (join required). This is an awkward pattern and adds query complexity for any user-scoped scheduling query.
- **Risk**: Low
- **Status**: Open — schema migration required to add `userId` column to `scheduledPosts`. Low priority given the platform-accounts join works correctly.

### TD-028: Polling Instead of WebSocket Subscription on Kaggle Training Status
- **File**: `client/src/components/model-hub/KaggleTrainingCard.tsx`
- **Reason**: Kaggle training job status uses 60-second polling (`useInterval`) rather than a WebSocket subscription. This means 0–60 s lag between job completion and UI update. Acceptable for long-running Kaggle training (multi-hour) but inconsistent with the real-time WS-first design philosophy.
- **Risk**: Low
- **Status**: Open (cosmetic) — acceptable for V1. Would be upgraded to WS subscription in a future polish pass.

### TD-029: `if (!db)` Null-Guards Fully Removed (Resolved)
- **File**: All server files (resolved 2026-06-15)
- **Reason**: Pre-unification pattern — `getDb()` returned `null` in SQLite mode → 13 routers no-op'd. All 83 `if (!db)` null-guards were cleaned up (2026-06-15 beta sweep).
- **Risk**: N/A — Resolved
- **Status**: Resolved — `getDb()` always returns a live instance. No null-guards should be added going forward.

### TD-030: Default Export Debt (Resolved)
- **File**: 77 React component files + router files (resolved 2026-06-19)
- **Reason**: 77 files contained `export default function` instead of named exports (violation of AGENTS.md style rules).
- **Risk**: N/A — Resolved
- **Status**: Resolved — mass-renamed 2026-06-19. All import statements and lazy-load references updated across 19 importing files including `App.tsx` and `main.tsx`.

### TD-031: MySQL `insertId` Pattern (Resolved)
- **File**: `server/db-pcb.ts` lines 44, 169, 270, 356, 408 (resolved F9)
- **Reason**: 5 instances of `(result as any)[0]?.insertId` — MySQL-only pattern that returns 0 under SQLite/libSQL.
- **Risk**: N/A — Resolved
- **Status**: Resolved — all 5 replaced with `.returning({ id: table.id })` (F9, 2026-06-14).

---

## Ruthless Beta Code-Sweep — new entries (2026-06-20, Session 23)

### TD-032: Sovereign guard not centralized in `AiProviderService` (Resolved at call sites)
- **File**: `server/_core/sovereign.ts` (new), `server/routers/{curator,pcbEditor,imageGen}Router.ts`, `server/phase2/services/AiProviderService.ts`
- **Reason**: `AiProviderService.chat()` takes no `executionMode`, so the Sovereign (air-gap) gate lives **per-router**. `aiRouter`/`podcastRouter`/`agentMessengerRouter` had it; `curatorRouter` (anthropic), `pcbEditorRouter.reviewDesign` (openai), and `imageGenRouter.generate` (fal/openart) did **not** → a sovereign user could tunnel a cloud call through them.
- **Risk**: High (security — Sovereign-mode bypass)
- **Status**: **Resolved** — added shared `assertProviderAllowedInMode` / `assertImageProviderAllowedInMode` (`server/_core/sovereign.ts`), wired into the 3 unguarded procedures. **Defense-in-depth recommendation (open):** thread `executionMode` into `AiProviderService.chat()` so no future router can forget the guard.

### TD-033: `pnpm build` broken under `node-linker=hoisted` (Resolved)
- **File**: `scripts/build-server.mjs`, `.npmrc`
- **Reason**: The Express-4 callable `path-to-regexp@0.1.x` resolver only scanned `node_modules/.pnpm`. `.npmrc` sets `node-linker=hoisted`, so `.pnpm` is empty and the non-callable v8 is hoisted to top-level while Express-4's 0.1.x is nested at `node_modules/express/node_modules/path-to-regexp`. The server bundle step threw; recent gates had been silently skipping `pnpm build`.
- **Risk**: High (production build broken)
- **Status**: **Resolved** — resolver now checks the hoisted nested path first (verifies `0.1.x`), then falls back to the `.pnpm` scan; works in both linker modes. `pnpm build` green.

### TD-034: Provider HTTP errors were opaque (Resolved)
- **File**: `server/phase2/services/AiProviderService.ts`
- **Reason**: All 8 chat methods threw only `response.statusText` ("Bad Request"/"Too Many Requests"), discarding the provider's real error body — so users saw uninformative errors (the actual cause of a "keys can't be tested" report).
- **Risk**: Medium (UX / debuggability)
- **Status**: **Resolved** — added `describeHttpError()`; errors now read e.g. `429 — You exceeded your current quota` / `400 — Your credit balance is too low`. (`PublishingService` already did this correctly.)

### TD-035: `undici` override floor footgun (Resolved)
- **File**: `pnpm-workspace.yaml`
- **Reason**: A naive `undici >=6.27.0` security floor let pnpm jump to **undici 8.0–8.4**, which reintroduce a TLS-validation-bypass + WS DoS (patched only in 8.5.0) — audit went 14→7 but **highs 2→3**.
- **Risk**: Medium (supply chain)
- **Status**: **Resolved** — pinned `undici >=8.5.0`; `pnpm audit --prod` → **0**. Lesson: when bumping a transitive dep's floor, check whether the latest satisfying major has *newer* advisories.

### TD-036: `getInstance()` → `ctx.services.*` migration needs context-factory expansion (Open)
- **File**: `server/_core/context.ts`, multiple routers (`mcpRouter`, `virtualCardRouter`, `valetRouter`, `kicadRouter`, `modelManagementRouter`)
- **Reason**: Many routers call `Service.getInstance()` instead of `ctx.services.*` (Code-Standards §2.2). `ctx.services` exposes hitl/mcpClient/aiProvider/etc. but **not** VirtualCardService, ValetRouterService, ValetServerService, PCBWayService, ModelManagementService, AuditLogService.
- **Risk**: Low (pure convention — functionally identical)
- **Status**: Open — do it as one pass: expose the missing singletons on `ctx.services` first, then migrate uniformly. Do NOT scatter partial edits. (My new `securityRouter` HITL calls already use `ctx.services.hitl`.)

### TD-037: ~506 raw Tailwind color classes remain (Open)
- **File**: `client/src/**` (~64 files)
- **Reason**: Raw color classes / hex vs AGENTS "no hardcoded colors". The semantic palette was incomplete (no warning/info token; accents were `.dark`-only) — now fixed: `--accent-warning` + `--accent-info` added to `Globals.css`. Always-on chrome migrated (UpdateBanner/ZeroLoginBanner/PeerCard/ExecutionModeBadge).
- **Risk**: Low (cosmetic)
- **Status**: Open — needs a **visually-verified** pass (dark theme can't be validated headless). Mapping table + exempt-file list in memory `beta-sweep-followups`. Exempt: three.js/PCBViewer3D, reactflow canvases, xterm, WebPreview iframe, MeshTopologyGraph canvas, brand OAuth colors.

### TD-038: Neural-map ingested content not fed to VectorDB; dropbox/onedrive no adapters (RESOLVED 2026-06-23)
- **File**: `server/routers/integrationsRouter.ts`, `client/src/pages/BrainMap.tsx`, `server/phase2/services/{VectorDBService,MemoryArchitectService}.ts`, `server/_core/ragContext.ts`, `server/routers/{aiProviderRouter,aiRouter,neuralMapsRouter}.ts`, `client/src/pages/Chat.tsx`
- **Reason**: Remote map sources rendered as real trees (TD-013) but their content was **not** pushed into `VectorDBService`, so map RAG over remote sources wasn't real. Dropbox/onedrive also couldn't connect.
- **Risk**: Low
- **Status**: **RESOLVED.** Built end-to-end (no deferrals): per-adapter **content** resolvers for all 8 source types → generic `MemoryArchitectService.reindexRemoteSource` (chunk/sanitize/redact) into `omnecor_{mapId}`; `integrations.indexMapSources` detached job (gated by `indexingEnabled`) + `getMapIndexStatus` polling + `BrainMap` Index button/auto-trigger; **read path** `ragContext.injectMapRagContext` wired into `aiProvider.chatStream` + `ai.chat` (gated by `enableAIContext`, Sovereign-safe), `Chat.tsx` passes `ragMapId`. Dropbox/onedrive adapters landed 2026-06-22. **Latent bug fixed in the same pass:** the local file watcher wrote a *raw* `omnecor_${projectId}` collection while the reader queried a *sanitized* one (divergent for hyphenated map UUIDs → RAG silently empty) — unified on exported `VectorDBService.sanitizeCollectionName`. Gates: tsc 0 · vitest 371/371 · build ✓. Outstanding: live runtime proof only (ChromaDB + real tokens).

### TD-039: Neural-map overlapping local roots → multi-parent nodes (Open)
- **File**: `client/src/pages/BrainMap.tsx` (`neuralNetwork` merge), `client/src/lib/fileTreeToNetwork.ts`
- **Reason**: Node ids are `node-${absolutePath}`. If a map has two local roots where one is an ancestor of the other (or they otherwise overlap), the same absolute path produces the same node id under both roots. The lazy-expansion merge dedupes the **node** by id but can still append a second parent **edge**, so a node can end up with two incoming edges — hierarchical layout in-degree and tree-view parent grouping then treat it as having multiple parents.
- **Risk**: Low — rare (requires deliberately mapping overlapping directories); the map still renders, the node just appears under both parents.
- **Status**: Open — **pre-existing** (predates the 2026-06-22 off-thread/bounded-loading work; surfaced during its `/review`, not introduced by it). Fix: dedupe edges by `target` (enforce one parent per node) or reject/merge overlapping roots at map-config time.

### TD-040: Neural-map layout Web Worker — first Web Worker in `client/src` (By design — recorded)
- **File**: `client/src/lib/neuralLayout.worker.ts`, `client/src/lib/neuralLayoutClient.ts`
- **Reason**: The 2026-06-22 off-thread layout fix introduces the **first Web Worker** in the client (Vite `new Worker(new URL(…), { type: "module" })`, bundled as its own chunk; synchronous main-thread fallback when `Worker` is unavailable). New build/runtime surface worth tracking.
- **Risk**: None — intentional and verified (worker chunk builds clean; fallback covers SSR / locked-down envs).
- **Status**: **By design — no action.** Recorded because `/review` flagged the new pattern as deserving a conscious decision (acknowledged). Reuse `neuralLayoutClient` for any future off-thread compute rather than spawning ad-hoc workers.

### TD-041: Neural-map tree-view drill-in — deliberate scope addition (By design — recorded)
- **File**: `client/src/components/neural/NeuralTreeView.tsx`
- **Reason**: Bounded-loading lazy expansion (graph view) was also wired into the **tree view**, slightly beyond the literal request. Without it, truncated folders would render as misleading empty leaves in tree view.
- **Risk**: None — intentional, keeps the two views consistent.
- **Status**: **By design — no action.** Recorded for the record.

---

## Key Insights & Gotchas (2026-06-20 sweep + live verification)

*Operational learnings — not "debt" to fix, but things that cost time to discover. Read before touching auth, the dev server, or tRPC clients.*

- **THREE separate connection systems — don't conflate them.** (1) **Login OAuth** (Google/Microsoft sign-in) → identity, users/session. (2) **Integrations** (GitHub/Notion/Drive **PAT/OAuth**) → `~/.omnecor/integrations.json`, powers **neural-map sources**. (3) **Platform accounts** (social publishing) → `platformAccounts` table. Connecting Google *login* does NOT make GitHub/Drive show as connected in the Integrations list. This caused a "still says not connected" report.
- **`ZERO_LOGIN_MODE` execution mode is configurable; defaults to `sovereign`** (`context.ts` creates the local-zero-login user with `role:"admin"` and `executionMode = ENV.zeroLoginExecutionMode`, driven by `ZERO_LOGIN_EXECUTION_MODE`, default `sovereign`). Default → `cloudProcedure`s are **blocked** (true air-gap). Set `ZERO_LOGIN_EXECUTION_MODE=scrapper` (or `big_spender`) to allow cloud (spend-tracked) for testing — the env flag is authoritative and overrides any value persisted on the local-zero-login user. *(Was hardcoded `scrapper` before 2026-06-21; the docs/UI claimed sovereign, the code did scrapper — reconciled via this flag. See [docs/development/LOCAL_TESTING.md](../../docs/development/LOCAL_TESTING.md).)*
- **Two ways to get a real test session — NOT zero-login (which defaults to sovereign/cloud-blocked).** **(A) Emulated OAuth:** set `GOOGLE_EMULATOR_URL` / `MICROSOFT_EMULATOR_URL` (the `google`/`microsoft` skills' `npx emulate` servers) → `oauth.ts` points the auth/token/userinfo endpoints at the emulator (real URLs otherwise) → sign in through the real flow with no real creds. **(B) Seed script:** `pnpm tsx server/scripts/dev-seed-user.ts` (git-ignored) mints a valid `app_session_id` cookie (default `scrapper`) for headless Playwright/curl. Both need `JWT_SECRET` + `VITE_APP_ID` set — `verifySession()` rejects a token with an empty `appId` **or** empty `name`. Full guide: [docs/development/LOCAL_TESTING.md](../../docs/development/LOCAL_TESTING.md).
- **Sovereign blocks by CATEGORY, and the integration "block AI only" toggle.** `trpc.ts` meta now carries `cloudKind: "ai" | "service"`. `cloudProcedure` = AI inference (OpenAI/Anthropic/Gemini/Fal/voice/training) → **always** blocked in sovereign. `externalServiceProcedure` = non-AI external calls (GitHub/Notion/Drive sync — the 4 integration procs `connect`/`sync`/`fetchSourceTree`/`updateSettings`) → blocked in sovereign **unless** the `sovereignBlockAiOnly` setting is on (Settings → Security, default OFF = strict air-gap). That setting is **admin-gated**: it persists only through the `system.setSovereignBlockAiOnly` `adminProcedure` and is explicitly **stripped from the public `saveSettings`** endpoint (it weakens the air-gap, so it must not be settable unauthenticated). Email (gmailRouter) and web search were never `cloudProcedure`, so they already work in sovereign. Use `externalServiceProcedure` (not `cloudProcedure`) for any new non-AI external call so it respects the toggle.
- **The Settings execution-mode selector is per-USER (DB) and is OVERRIDDEN under zero-login.** `system.setExecutionMode` writes `users.executionMode`; the nav `ExecutionModeBadge` reads the Zustand store hydrated from `auth.me`. This works for real sessions. But in **zero-login**, `context.ts` re-forces the mode to `ZERO_LOGIN_EXECUTION_MODE` on every request, so changing it in Settings appears to "have no effect" — the selector is therefore **disabled with a note** when `me.loginMethod === "zero-login"`. (Also: a static/demo build has no backend, so the mutation just errors — another "no effect" cause.)
- **Microsoft OAuth real endpoints were malformed** (`/common/v2.0/oauth2/<verb>` — segments swapped; 404s against real Entra ID). Fixed 2026-06-21 to `/common/oauth2/v2.0/<verb>` in `oauth.ts`. The endpoints are now resolved via `microsoftEndpoints()` / `googleEndpoints()`, which switch to the local emulator when `*_EMULATOR_URL` is set.
- **AI key env var names must be EXACT:** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (read via `env.ts` → `process.env.*`, with `SettingsService.getSecret(key, ENV.fallback)`). Custom names like `Open_AI_Token` are silently ignored → "API Key not configured". Server loads `.env` via `import "dotenv/config"` at startup → **a `.env` edit needs a server restart**.
- **Free OpenAI/Anthropic accounts need purchased credits even for low usage.** Valid keys authenticate but completions fail: OpenAI `429 insufficient_quota`, Anthropic `400 credit balance too low`. Not a config bug. Free local alternative: Ollama (works in scrapper mode, no key).
- **Stale `tsx watch` processes hold `:3000`** → a new `pnpm dev` fails to bind (`exit 144`) and the OLD process (stale env) keeps serving — which looks like "my fix didn't take." Before restarting: `fuser -k 3000/tcp` + `pkill -9 -f "tsx watch server/_core"`, then confirm the port is free (`curl` fails) before starting one fresh server.
- **superjson tRPC encoding (when cur/scripting the API):** query input is `?input={"0":{"json":<value>}}`; a `Date` needs `meta:{values:{<field>:["Date"]}}`; **the null-input meta `{"values":["undefined"]}` OVERRIDES any `json` you pass** — only use it when the value really is null/undefined.
- **Headless screenshots can't capture the BrainMap graph** — the force-graph canvas animates forever, so Playwright never reaches a stable frame (`screenshot` times out). Use the **tree-view DOM** or `page.evaluate` text capture as evidence instead.
- **Setup wizard gates routes** until `localStorage["omnecor:setup_complete"]==="true"` — set it via `addInitScript` before navigating, or you'll be redirected to `/setup`.
- **Drive the app via the DEV server for ZERO_LOGIN** (production forbids it; local OAuth portal is a dummy). The rate limiter now `skip`s non-`/api` paths, so a Playwright dev-mode page load no longer 429s.
- **`platforms.addAccount` accepts a RAW token** — social posting can be tested by pasting a token from a platform's own token tool (Graph API Explorer, etc.) instead of implementing the full client-id/secret OAuth flow. "Sign in with Google/Microsoft" can NOT authorize posting to Twitter/LinkedIn/Meta (separate platforms require their own app).
