# Changelog

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
