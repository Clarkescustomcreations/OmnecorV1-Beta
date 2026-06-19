# Changelog

## [Unreleased] - 2026-06-19 — Security, Correctness & Design-Token Sweep

### Changed

- **Export-default debt resolved:** All 77 files using default React component exports converted to named exports (matches `AGENTS.md` style rule); all import statements and dynamic lazy-load references updated across 19 importing files.
- **Real BPE tokenizer, then right-sized:** Added `js-tiktoken` for accurate per-model token counting, then replaced it same-day with a lightweight ~4-chars/token approximation after discovering the BPE rank files bloated the Chat bundle to 3.9 MB and broke module resolution in the browser. Chat chunk: 3.9 MB → 472 kB. `estimateTokens()` API unchanged.
- **Design-token sweep:** Hardcoded hex literals in `neuralNodeTree.ts`, `MeshTopologyGraph.tsx`, and `AgentNetworking.tsx` legend dots replaced with CSS variable references. Raw Tailwind color classes (`green-*`, `blue-*`, `red-*`, etc.) swept across 14 files to semantic tokens (`accent-success`, `accent-cyan`, `destructive`, etc.).
- **`AGENTS.md` hex-literal exceptions documented:** `PCBViewer3D` (Three.js integer colors), brand-identity SVGs in `SetupWizard` (Google/Microsoft palettes), `MeshTopologyGraph` (Canvas API), `OAUTH_PLATFORMS` buttons (brand-required platform colors).

### Fixed

- Dead `if (!db)` branch removed from `agentMessengerRouter.ts` — `getDb()` never returns null; the branch was unreachable and misleading.
- Dev-mode rate limiter no longer 429s on cold Vite module fetches (added `skip` for non-`/api` paths).

### Removed

- Leftover "Manus" AI dev-tooling: browser debug-collector script injected into every dev page, the ~150-line Vite plugin that injected it, and the wildcard `allowedHosts` entries.
- Stale Manus symlink that was blocking Vite production builds.

**Gates:** root `tsc` 0 · `vitest` 353/353

---

## [Unreleased] - 2026-06-16/17 — OMMESH Live Cross-Node Verification + Documentation Overhaul

### Added

- **OMMESH cross-node mTLS inference routing (Phase 9 stub → real implementation):** New `server/ommesh/core/MeshServer.ts` — strict-mTLS HTTPS listener on `MESH_PORT` (3001); only CA-signed peers connect (`requestCert` + `rejectUnauthorized` + TLSv1.3). `MeshNode.executeLocal()` runs real inference via `AiProviderService.chat()`; `routeToRemote()` pins the peer's advertised certificate fingerprint (rejects MITM even with a different CA-signed cert). Sovereign-mode guard prevents cloud providers from ever tunneling through mesh routing.
- **LAN peer discovery fixed:** two real bugs found via live 3-machine testing — peers resolving to IPv6 link-local addresses instead of routable IPv4, and Windows multicast-DNS binding to the WSL/Hyper-V virtual adapter instead of the real LAN. New shared `server/_core/net-utils.ts` fixes both, wired into both `DiscoveryService` and the legacy `MeshDiscoveryService`.
- **OMMESH live-verified across real machines (2026-06-16):** Windows (`omnecor-win-clark`) ↔ Linux (`omnecor-lin-vis`) — bidirectional mDNS discovery and bidirectional mTLS inference both confirmed working end-to-end with real Ollama completions routed across the network.
- **Desktop Bearer-token auth (`client/src/lib/desktopAuth.ts`):** Fixed a Windows/Electron-specific auth bug — the desktop frontend runs on the privileged `app://omnecor` scheme and calls the embedded backend cross-origin at `localhost:<port>`; the `SameSite=Strict` session cookie never reached the backend on that path. Falls back to an `Authorization: Bearer` token returned from local-auth routes and persisted in `localStorage`; the web build is unaffected (still cookie-based).
- **New user guides:** `docs/setup/OMMESH_SETUP.md`, `docs/user-guides/3D_DESIGNER.md`, `docs/user-guides/ALWAYS_LISTEN.md`, `docs/user-guides/SLASH_COMMANDS.md`, `docs/user-guides/PODCAST_STUDIO.md`, `docs/user-guides/FICTION_MODE.md`, `docs/README.md` (full documentation index).
- **Android Always-Listen voice mode simplified:** wake-word matching moved from a Picovoice/Porcupine dependency to on-device Whisper-only matching — no third-party account, API key, or external wake-word service required.

### Fixed

- `apk:debug` / `apk:release` / `apk:install` build scripts: replaced hardcoded `gradlew clean` with a targeted `rm -rf app/.cxx app/build/generated/autolinking` — the blanket clean was re-running CMake against not-yet-generated autolinking codegen JNI directories (`react-native-voice-processor`, etc.) and failing the build.
- `packaging/windows/BUILD-WINDOWS.md`: removed stale internal project name reference, updated version strings to match actual build output, corrected the Valet Router GGUF step from a Git LFS reference to the actual GitHub Release download flow (`scripts/fetch-valet-model.sh`).
- `README.md`: removed inaccurate MySQL/TiDB support claim (the backend has been libSQL/SQLite-only since the Phase 2 database unification); added Windows to the system requirements table.
- `FAQ.md`: corrected "Linux-only" system requirements answer to reflect native Windows + Linux + Android support.
- `QUICKSTART.md`, `CONTRIBUTING.md`, `docs/workflows/DEVELOPMENT_WORKFLOWS.md`: `npm run dev` → `pnpm dev` throughout (project has been pnpm-only for the entire beta).
- `ROADMAP.md`: updated v1.0 blocker status — Valet Router integration and Android APK build are both code-complete (previously marked pending).

### Removed

- Obsolete planning docs no longer reflecting current architecture: `docs/MULTI-PLATFORM-COMPATIBILITY-AUDIT.md`, `docs/MULTI-PLATFORM-FIX-PLAN.md`, `docs/UPGRADE-PLAN.md`, `docs/june-3-doc-updates.md` (1,231-line dev session note that had been committed as a permanent doc).
- Duplicate documentation files: `docs/OAUTH_SETUP.md` (superseded by `docs/setup/OAUTH_SETUP.md`), `docs/neural brain map/NEURAL_BRAIN_MAP_UI.md` (superseded by `docs/frontend/NEURAL_BRAIN_MAP_UI.md`).

### Environment Notes (not code bugs, but relevant if reproducing)

- Windows requires the network profile set to **Private** with inbound firewall allowances for TCP 3000/3001 for OMMESH discovery to work.
- Clock drift on a mesh node (observed: ~61 min fast, NTP disabled) affects the mTLS replay-protection window — keep NTP enabled on all OMMESH nodes.

**Gates (2026-06-16):** root `tsc` 0 · APK `tsc` 0 · `vitest` 338/338 · Linux AppImage/.deb ✓ · release APK ✓ · Windows installer ✓ (install/test pending on-device)

---

## [Unreleased] - 2026-06-15 — Out-of-Band Depth Pass: AI Context & Feature Gaps

### Added

- **3D Viewer real model loading:** the `url` prop was previously declared but inert (no loader existed — the viewer only ever showed demo primitives regardless of input). Real GLTF/GLB loading via `GLTFLoader`, OBJ via `OBJLoader`. `buildSceneContext()` walks the loaded scene graph and feeds mesh names, parent hierarchy, vertex counts, and bounding-box dimensions into the AI context when using "Ask AI" or "Suggest Changes" — previously real models fell back to a bare mesh name with no description.
- **PCB AI panel real netlist context:** the AI system prompt previously sent only `{ nodes: N, edges: N, mode }` — node/edge counts with no component or connection detail. `buildDesignContext()` now serializes the actual canvas state into a readable netlist (component refs, types, values, source→target connections), capped at 2000 characters.
- **Podcast Studio session persistence, per-segment regeneration, and audio download** — see `docs/user-guides/PODCAST_STUDIO.md` for the full feature set.
- **Social media automation: failed-post visibility and retry** — posts with `status: "failed"` are now surfaced in the Calendar tab with a destructive badge and error message (previously silently invisible); new `scheduling.retryPost` procedure with ownership verification.
- **Per-platform character-limit enforcement** for the social post composer (Twitter/X 280, LinkedIn 3000, Instagram 2200, Facebook 63206, YouTube 5000, TikTok 2200) — composer now disables Schedule/Publish and shows a live counter when over limit.

### Changed

- `AGENTS.md` rewritten with explicit skill trigger conditions, Process/Style/Safety rule categories, a Critical Schema & Import Rules section, and a Known Gotchas table sourced from real session history.

---

## [Unreleased] - 2026-06-14 — Documentation Consolidation

### Changed

- **Consolidated all working/planning docs into a single local-only `Context/` folder.** Twelve scattered markdown files were merged into the ten thematic Context documents and then removed: `input-tracker.md` + `ui_audit_report.md` + `APK-input-tracker.md` → `UI-Registry.md`; `master-feature-plan.md` → `Project-Overview.md`; `jun14-review.md` (detailed findings) + `BUILD.md` + `APK-feature-plan.md` + `APK-todo.md` → `Build-Plan.md` (appendices A–D); `master-todo.md` + `FUNCTIONAL-AUDIT.md` + `Beta-Code-Sweep.md` → `Progress-Tracker.md` (archives A–C). No information was lost in the merge.
- **`Context/` is now git-ignored** (consolidated working docs are local-only), alongside the agent/session files `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, `memory.md`, and `.claude/`.

## [2.4.1-beta.1] - 2026-06-12 — Production-Readiness Sweep & Audit Log Retention

### Added

- **Audit Log Retention (storage control):** The append-only audit log now purges itself automatically — default **2 weeks**, with **4 weeks** and **Permanent** selectable under Settings → Security → Audit Log Retention (admin/owner only). Permanent shows a storage warning with the live entry count and approximate table size. A background sweep runs every 6 hours (and at boot); shrinking the window purges immediately; retention changes are themselves audit-logged (`audit_retention_changed`). New procedures: `audit.getRetention`, `audit.setRetention`.
- **WebSocket upgrade authentication:** `/ws` now verifies the session cookie, an `Authorization: Bearer` header, or a `?token=` query parameter. The Android APK's channel + terminal sockets attach the stored session token automatically. Unauthenticated LAN sockets are restricted to `mobile_node_register` (and rejected entirely when `OMMESH_SECRET` is unset).
- **`SESSION_TTL_MS`:** configurable session lifetime (default one year for local-first installs).
- **Settings deep links:** `/settings?tab=<id>` opens a specific tab directly.
- **`engines` field + cross-platform scripts:** Node ≥20 / pnpm ≥10 enforced; `dev`/`start` use cross-env; Python scripts launch via `scripts/run-python.mjs` (resolves `python3`/`python`/`py`); `.gitattributes` normalizes line endings.

### Security

- Timing-safe OMMESH secret comparison; fail-closed mobile node registration when `OMMESH_SECRET` is unset.
- Dedicated rate limit on `/api/oauth/*` (10 req / 15 min / IP).
- Attachment upload extension allowlist; `/uploads` served with nosniff + forced download + sandbox CSP.
- `pnpm audit` clean across all workspaces (was 2 critical / 2 high / 4 moderate): drizzle-orm ≥0.45.2, @trpc/* 11.17.0, vitest ≥3.2.6, shell-quote ≥1.8.4, joi ≥18.2.1, uuid ≥11.1.1.

### Fixed

- N+1 query in PCB `deleteProject` (batched `inArray` deletes).
- 9 silent `.catch(() => {})` blocks on audit-log writes now log warnings.
- ESM-unsafe `require()` calls in `AgentService` converted to dynamic imports.
- ComfyUI panel validates workflow JSON before queueing (raw text was silently invalid).
- Chat live-preview panel overlays on phones instead of crushing the chat column; PCB editor toolbar wraps on narrow screens.
- Setup wizard surfaces API-key save failures; platform-aware knowledge-base path placeholder (was hardcoded `/home/linux/...`).
- APK `ai-node` useEffect cleanup type error (all three workspaces now typecheck clean).

### Added (v1.0-tag blockers pass)

- **No silent mutations, by construction:** global `MutationCache.onError` in both the desktop GUI and the Android APK — every tRPC mutation without a local `onError` now surfaces its failure (toast on desktop, alert on mobile). Remaining server-side audit-log catches all log warnings.
- **SQLite audit-log parity:** the `audit_log` table now exists in the SQLite (Sovereign) backend with the identical retention windows and 6-hour purge schedule as MySQL, routed through new `audit*` functions in `db.factory.ts`. Live-verified end-to-end.
- **Real OAuth token refresh:** `integrationManagement.refreshToken` now performs the OAuth2 `refresh_token` grant and persists rotated credentials (was a logged no-op returning fake success).
- Last `err: any` usages removed (CurationStudio, APK podcast screen); zero TODO/FIXME comments remain in server/client/shared; hardcoded `python3` spawns in AgentService/trainingRouter now use the platform-aware Python resolver.

### Removed

- Dead/no-op endpoints with zero callers: `agentSettings.updateBotTheme`, `agentSettings.updateDiscoveryKeywords`, the `brainmap` router, and `modelMarketplace.pullOllama`.

## [2.4.0-beta.1] - 2026-06-12 — Unified Notifications & Agent Messenger

### Added

- **Unified Notifications (main GUI + Android APK):** New Notifications hub that aggregates every alert the user would wait on — new chat replies, task/job completion, HITL approvals, and agentic-wallet budget alerts. Placed in the desktop sidebar between Agentic Wallet and Settings (`/notifications`) with a live unread badge, and as a dedicated "Alerts" tab in the Android app.
- **NotificationService:** Process-wide in-memory store + EventEmitter (`server/_core/NotificationService.ts`). Ephemeral by design (no schema migration) so it behaves identically under MySQL and zero-infra SQLite. Broadcasts on the `notifications` WebSocket channel.
- **notificationRouter:** `notifications.list / unreadCount / markRead / markAllRead / clear / create`.
- **Agent Messenger:** WhatsApp/Discord-style threads with agents/personas, separate from regular project chats. Message always-on agents to plan, assist, start/check Omnecor tasks, or retrieve neural-map data. Replies are generated through each persona's configured model backend (graceful offline fallback) and raise an `agent` notification.
- **agentMessengerRouter:** `agentMessenger.listConversations / getMessages / markRead / send`, backed by an in-memory `AgentMessengerStore`.
- **Alert sources wired:** HITL `actionPending`, job `lifecycle` (completed/failed), agentic-wallet budget threshold/limit (deduped per project), and blocking `ai.chat` completions now raise notifications.
- **Android:** `bell.fill` icon mapping, `use-notifications` + `use-agent-messenger` hooks, and the `notifications` tab (Alerts + Messenger).

## [2.3.0-beta.1] - 2026-06-11 — Android Companion App & Mobile OMMESH Integration

### Added

- **Android Companion App (Omnecor HQ):** React Native 0.81 + Expo SDK 54 mobile client (com.omnecor.mobilehq) with 8 tabs: Chat, HITL, AI Node, Status, Terminal, Podcast, 3D Viewer, Settings.
- **On-Device Inference:** llama.rn GGUF support with Vulkan/NNAPI backend for Snapdragon NPU on mobile.
- **Mobile Connectivity:** Tailscale remote access + LAN Wi-Fi connectivity between PC and mobile.
- **PC WebSocket OMMESH Integration:** Full mobile node registration, inference requests/responses, and heartbeat handlers.
- **aiRouter "ommesh" Provider:** Connected phones surface as "Phone — {nodeName}" in provider list; ai.chat/ai.chatStream routed to phone when selected.
- **HITL Router:** New tRPC router exposing HITLApprovalService (hitl.getPending, hitl.resolve).
- **Mobile Status Screen:** Real-time PC job listing (jobs.list), live state badges, progress bars, and job cancellation (jobs.cancel).
- **Mobile HITL Screen:** Live CriticalAction queue with approve/reject capabilities from mobile.
- **Mobile Terminal Screen:** Live shell PTY over WebSocket with Ctrl+C interrupt and command history.
- **Mobile Podcast Screen:** Integration with podcast.generate tRPC procedure.
- **Execution Mode Sync:** Mobile-to-PC settings.setExecutionMode synchronization.
- **Mobile Chat:** Neural map and agent persona selectors wired to neuralMaps.list and personas.list.
- **Kaggle GPU Training:** Free T4 GPU support for Valet Router LoRA training via Settings/Setup Wizard/LLM Builder/Valet Panel.

## [2.2.0] - 2026-06-05 — 3D Designer, Fiction Mode & New UI Features

### Added

- **3D Designer Page:** /3d-designer with 4 integrated modes: 3D Viewer (React Three Fiber with GLTF/OBJ support), PCB/Schematic Editor (React Flow), Web Preview (sandboxed iframe), and Code Editor (tab-based virtual FS).
- **Floating Windows & Multi-Monitor Support:** External monitor and floating window capabilities in 3D Designer.
- **Blender & KiCad Integration:** "Open in Blender" and "Open in KiCad" with bidirectional file sync.
- **PCB Editor Database Tables:** design_projects, design_saves, component_library_items, design_exports, ai_design_reviews.
- **Neural Brain Map Persistence:** Neural Brain Maps now stored in neural_maps table (replacing localStorage-only storage).
- **Personas Database Table:** Persistent persona storage in database.
- **Fiction Mode:** Creative toggle that locks wallet/agent-networking/terminal, injects AI guardrails, and shows persona selector in banner.
- **Podcast Studio:** AI script generation, multi-speaker turns, Web Speech API TTS, content discovery integration.
- **Curation Studio:** Standalone curation workspace with keyword management, draft approval, and history tracking.
- **Embedded Terminal:** xterm.js-powered terminal with bidirectional PTY via WebSocket and shell selector (Bash/Zsh/Sh/Fish/Python3/Node).
- **HITL Command Approval Gate:** Every terminal command passes through human approval before execution.

## [2.1.0] - 2026-05-30 — Agent Networking & Social Media Automation

### Added

- **Multi-Platform OAuth 2.0:** Twitter/X, LinkedIn, Instagram, TikTok, Facebook, YouTube account connection with CSRF-protected state tokens (10-minute TTL, PKCE support).
- **Content Discovery Engine:** RSS feeds and keyword-based article discovery for content curation.
- **AI-Curated Content Workflow:** Automated content draft generation with approval workflow.
- **Scheduled Post Publishing:** Automated posting to connected social media accounts.
- **Engagement Analytics Dashboard:** Real-time metrics for likes, impressions, reach, and shares across connected platforms.
- **Persona Studio:** Three persona types: Self Clone, Social Media Persona, Omnecor Agent.
- **Automated Posting Schedule:** Configurable schedule for automated content distribution.
- **Platform Account Management:** AES-encrypted token storage for OAuth credentials and secure account management.

## [2.0.0] - 2026-05-28 — Phase 2: Production Unification

### Added

- **Unified Backend:** Full Express/tRPC integration.
- **Hardware Integration Layer:** Blender, KiCad, ESPTool bridges.
- **Voice System:** RVC voice conversion pipeline.
- **Branding:** Rebranded to Omnecor HMCI.
- **Documentation:** Full rewrite and modernization of project docs.
- **Neural Workspaces:** Spatial graph-based project management using React Flow.
- **Multi-Modal Workforce:** Integrated autonomous agent orchestration.
- **OMMESH:** Distributed mesh intelligence layer.
- **Local-First Data Sovereignty:** Your data stays on your machine. Always.
- **Honcho Cross-Session Memory:** Persistent user facts and background notes via `/btw` command; enabled by `HONCHO_API_KEY`.
- **PeerCard Mesh Indicator:** Sidebar footer shows discovered Omnecor peers with hostname, latency, and available model counts; updates every 10 seconds.
- **Context Management:** Token budget bar under chat input; `/compress` command to summarize conversation; per-message context exclusion toggle.
- **Valet Router Auto-Start:** Local ~1.5B routing model auto-starts when artifact present; keyword fallback mode when not. Control with `VALET_AUTO_START` env var.

### Changed

- All legacy "CORTEX" branding removed.
- Backend services consolidated.

### Fixed

- Backend server conflicts.
