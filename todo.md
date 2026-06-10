# Omnecor TODO
**Last updated:** 2026-05-31 (Wave 2 complete: Phases 16b, 21, 22, 24, 25)
**Target milestone:** v3.0.0 (PRD Compliance + Integration Guide Complete)

## Phase 1 — UI/UX Prototype ✅ COMPLETE
- [x] UI/UX Prototype
- [x] Documentation Modernisation

## Phase 2 — Backend Services ✅ COMPLETE
- [x] Unified Backend (Express/tRPC/WebSocket)
- [x] Hardware Bridges (Blender, KiCad, ESPTool)
- [x] Voice Pipeline (Whisper, XTTS-v2, RVC)
- [x] AI Provider Hub (Ollama, OpenAI, Anthropic, Gemini)
- [x] Memory System (Drizzle/MySQL + ChromaDB VectorDB)
- [x] Process Manager UI
- [x] Branding Consolidation (CORTEX → Omnecor HMCI)

## Phase 3 — Hardware Bridges ✅ COMPLETE
- [x] Blender, KiCad, ESPTool bridges fully integrated

## Phase 4 — Voice Processing ✅ COMPLETE
- [x] Whisper STT, XTTS-v2 TTS, RVC pipeline

## Phase 5 — Knowledge Base ✅ COMPLETE
- [x] ChromaDB vector store, semantic search, episodic memory

## Phase 6 — Neural Brain Map WebSocket ✅ COMPLETE
- [x] `useOmnecorSocket.ts` hook (reconnect, ring-buffer, ping)
- [x] `HITLAlertPanel.tsx` (loop detection banner)
- [x] Wire hook into `NeuralGraphView.tsx` (Refactored into Windowing System)
- [x] Wire hook into `NeuralTreeView.tsx`
- [x] `useOmnecorSocket.test.ts` unit tests

## Phase 7 — UX Polish & Aviation Oversight ✅ COMPLETE
- [x] **Neural Brain Map Windowing**: Refactored into a detachable windowing system.
- [x] **Multi-Window Sync**: Live state synchronization via `zustand` and `BroadcastChannel`.
- [x] **Floating Overlay Mode**: Draggable/resizable window with `framer-motion` and `oklch` brand styling.
- [x] **External Monitor Support**: Dedicated route (`/brain-map-external`).
- [x] **Visual Identity**: Enhanced with backdrop filters, `oklch` colors, and matte surfaces.
- [x] **Verification**: Confirmed 177 tests pass and TypeScript check is clean.

## Phase 8 — OMMESH Distributed Mesh ✅ COMPLETE
- [x] LAN beacon / mDNS discovery service
- [x] Secure node federation (mTLS)
- [x] Intelligent VRAM-weighted job routing
- [x] Peer notification broadcast after rotation
- [x] Mesh Compute UI panel

## Phase 9 — Packaging & Distribution ✅ COMPLETE
- [x] .deb package
- [x] AppImage
- [x] Flatpak
- [x] systemd service file
- [x] Post-install script
- [x] Packaging docs

## Phase 12 — Security Hardening ✅ COMPLETE
- [x] **Critical Deserialization Fix**: Secured `rvc_server.py` by setting `weights_only=True` in `torch.load`.
- [x] **Path Traversal Protection**: Implemented secure root directory validation and `is_safe_path` checks in `rvc_server.py` and `tts_server.py`.
- [x] **Sensitive Data Protection**: Removed `apiKey` and `baseUrl` from `localStorage` in `ModelHub.tsx`.
- [x] **Security Dependency Updates**: Updated `drizzle-orm` (0.45.2), `vitest` (4.1.7), and `drizzle-kit` (0.31.10).
- [x] **Unified Security Router Hardening**: Auth enforced on all security endpoints.
- [x] **Advanced Path Validation**: Strict boundary checks in `validatePath` (including `fs.realpath`).
- [x] **DoS Mitigation**: Global rate limiting via `express-rate-limit`.
- [x] **Python Bridge Sandbox**: Secured `blender_bridge.py` against injection and introspection.
- [x] **Verification**: Confirmed all 177 tests pass (Final Baseline Verification).
- [x] **Zero-Trust Audit**: Conducted Tri-Agent simultaneous review; all critical vulnerabilities (XSS, RCE, Traversal) resolved.

## Future ✅ COMPLETE
- [x] **Character Engine (Flux Pro)**: Bridged to Fal.ai Flux.
- [x] **Video Clone Engine**: Bridged to Fal.ai video pipeline.
- [x] **ComfyUI Bridge**: Dedicated service and router for workflow orchestration.
- [x] **crewAI / n8n connectors**: `AgentService.ts` implemented for autonomous crews.
- [x] **Unsloth LoRA fine-tuning UI**: Advanced `trainingRouter` parameters and `UnslothPanel` UI.

## Analysis Findings & Cleanup ✅ COMPLETE
- [x] **OMMESH Federated Routing**: Real load-balanced routing implemented in `AiProviderService.ts`.
- [x] **LLM Builder Integration**: Frontend wired to backend Python Unsloth bridges.
- [x] **3D Modeler Integration**: React frontend connected to Blender bridge.
- [x] **PCB Designer Integration**: React frontend connected to KiCad bridge.
- [x] **Redundant Component Removal**: Deleted `Home.tsx`, `ComponentShowcase.tsx`, `AIChatBox.tsx`, `DashboardLayout.tsx`.
- [x] **Agentic Memory**: Integrated `LiteAgent` and `CrewAI` logic into production services.
- [x] **YARA Security**: Implemented high-performance YARA-based scanning in `SecurityService.ts`.

---

## Phase 13 — Agentic Wallet: Schema & Backend ✅ COMPLETE
> Completed 2026-05-31 via parallel agents. DB migration SQL generated (apply when MySQL credentials set).

- [x] Add `project_budget` table to `drizzle/schema.ts` (id, projectId, limitCents, alertThreshold, mode enum)
- [x] Add `spend_log` table to `drizzle/schema.ts` (insert-only, no updatedAt — immutable spend record)
- [x] Run `pnpm db:push` — migration SQL generated at `drizzle/0001_plain_red_wolf.sql`; apply when DB credentials configured
- [x] Create `server/phase2/config/providerPricing.ts` with per-provider/model token pricing constants
- [x] Add `estimateCost(provider, model, promptTokens, completionTokens)` to `AiProviderService.ts`
- [x] Wire spend tracking into `AiProviderService.streamChat()` — emit `budget:spend` WebSocket events via `OmnecorWebSocketServer.broadcastAll()`
- [x] Add budget enforcement pre-flight in `streamChat()` — auto-downgrade to Ollama on hard-limit breach
- [x] Create `server/routers/walletRouter.ts` (getBudget, setBudget, getSpendLog, getSpendSummary, resetSpend)
- [x] Mount `wallet: walletRouter` in `server/routers.ts`

## Phase 14a — Agentic Wallet: Budget UI & Auto-Downgrade UX ✅ COMPLETE
> Completed 2026-05-31 via parallel agents.

- [x] Create `client/src/components/wallet/BudgetPanel.tsx` (Recharts RadialBarChart + per-provider breakdown)
- [x] Create `client/src/components/wallet/BudgetConfigDialog.tsx` (limitCents / alertThreshold / mode form + Virtual Cards tab)
- [x] Add `BudgetPanel` card to `client/src/pages/Dashboard.tsx`
- [x] Wire `budget:spend` WebSocket event into `useOmnecorSocket.ts` hook
- [x] Add `walletSpend` Zustand slice to `app.store.ts`
- [x] Extend `HITLAlertPanel.tsx` with live budget spend overlay (amber toast from Zustand)
- [x] Add `setWsInstance`/`getWsInstance` singleton to `WebSocketServer.ts`; wired in `server/_core/index.ts`

## Phase 14b — Agentic Wallet: Virtual Credit Cards ✅ COMPLETE
> Completed 2026-05-31 via parallel agents. Opt-in — app fully functional without LITHIC_API_KEY.

- [x] Create `server/phase2/services/VirtualCardService.ts` with Lithic REST API via native `fetch` (no new npm dep)
- [x] Add `LITHIC_API_KEY`, `VIRTUAL_CARD_PROVIDER` to `server/_core/env.ts` and `.env.example`
- [x] Create `server/routers/virtualCardRouter.ts` — `issueCard` with in-memory rate limit 1/60s per user
- [x] AES-256-GCM encrypt card PAN (key derived from lithicApiKey); never stores plaintext
- [x] Add "Virtual Cards" tab to `BudgetConfigDialog.tsx` with "Not configured" state when key absent
- [x] Mount `virtualCard: virtualCardRouter` in `server/routers.ts`

## Phase 15 — Execution Modes: Sovereign / Scrapper / Big Spender ✅ COMPLETE
> **Completed 2026-05-31.** Sovereign mode is explicit opt-in only; default is `scrapper`.

- [x] Add `executionMode` enum column (`sovereign|scrapper|big_spender`) to `users` table in `drizzle/schema.ts`; default to `scrapper` (local-preferred, cloud available)
- [x] Create `sovereignCheck` tRPC middleware in `server/_core/trpc.ts` — returns FORBIDDEN **only** when the user has explicitly set mode to `sovereign` AND the procedure is tagged `cloud: true`; otherwise cloud is freely usable
- [x] Tag all cloud-dependent procedures with `cloud: true` metadata (falRouter `generateCharacter` + `generateVideo`) via `cloudProcedure`
- [x] Add `SOVEREIGN_MODE` env var check to all Python bridges (`tts_server.py`, `whisper_server.py`, `blender_bridge.py`)
- [x] Create `client/src/components/shell/ExecutionModeBadge.tsx` (persistent header badge: Sovereign = red lock, Scrapper = green Zap, Big Spender = amber Flame)
- [x] Replace non-functional Sovereign switch in `Settings.tsx` with 3-mode `RadioGroup` with clear descriptions of each mode
- [x] Add `setExecutionMode` tRPC mutation to `systemRouter.ts`; persist in DB; sync to Zustand on mount via `OmnecorDashboardLayout`
- [x] Cloud API keys in Settings remain configurable and usable in all modes except Sovereign

## Phase 16a — 1.5B Valet Router: Dataset Construction ✅ COMPLETE
> **Parallelizable** — can run as background task while other phases proceed.

- [x] Create `server/python_bridges/valet_dataset_builder.py` with Ollama-powered prompt generation
- [x] Implement 10-category routing taxonomy with oracle annotation (category → provider, model, cost, local_capable)
- [x] Generate 4,000 Alpaca-format JSONL examples to `data/valet_router_dataset.jsonl` (400/category)
- [x] Generate 10% negative examples (wrong routing, for contrastive learning)
- [x] 90/10 train/validation split → `data/valet_router_validation.jsonl`
- [x] Add `trainingRouter.generateValetDataset` tRPC procedure (spawns dataset builder as ProcessManager job)
- [x] Add dataset generation button + progress indicator to `UnslothPanel.tsx`

## Phase 16b — 1.5B Valet Router: Fine-Tune & Inference Integration ✅ COMPLETE
> **Completed 2026-05-31.** Inference server, TypeScript service, tRPC router, and UnslothPanel status card all implemented.

- [x] Extend `localLLMfine-tuning.py` with `--task_type router` flag (r=8, alpha=16, capped at rank 8)
- [x] Create `server/python_bridges/valet_router_inference.py` (FastAPI on port 8010, binds 127.0.0.1, rule-based fallback when model offline)
- [x] Create `server/phase2/services/ValetRouterService.ts` (wraps bridge, rule-based fallback when offline, HARDCODED_RULE exported)
- [x] Wire Valet Router pre-routing into `AiProviderService.streamChat()` — advisory, never blocks
- [x] Add `valetRouter.status`, `valetRouter.getModes`, `valetRouter.testRoute` procedures to `server/routers/valetRouter.ts`
- [x] Add "Valet Router" status card to `UnslothPanel.tsx` (online/offline indicator, URL display)
- [x] Mount `valet: valetRouter` in `server/routers.ts`

## Phase 17 — Zero-Login Mode & Offline Boot ✅ COMPLETE
> **Completed 2026-05-31.** Zero-login mode provides air-gapped/offline operation with Sovereign mode auto-enforced server-side.

- [x] Add `ZERO_LOGIN_MODE=true` support to `server/_core/context.ts` (synthetic local admin user, no SDK call)
- [x] Skip OAuth route registration in `server/_core/index.ts` when `ZERO_LOGIN_MODE=true`
- [x] Add graceful startup checklist in `server/_core/index.ts` (log Ollama/ChromaDB/MySQL status; don't throw)
- [x] Create `client/src/components/shell/ZeroLoginBanner.tsx` (yellow persistent notice, session-scoped only)
- [x] Wire `ZeroLoginBanner` into `OmnecorDashboardLayout.tsx`
- [x] Add `--zero-login` startup flag to `packaging/` startup scripts (.deb, AppImage)
- [x] Auto-enable Sovereign mode when `ZERO_LOGIN_MODE=true` (server-side enforcement)
- [x] Add `ZERO_LOGIN_MODE` to `.env.example` with security warning comment

## Phase 18 — Command Palette: Full Action Wiring ✅ COMPLETE
> **Completed 2026-05-31.**
> **Depends on:** Phase 15 (mode toggle mutation). Single frontend agent session.

- [x] Create `client/src/hooks/useCommandRegistry.ts` (dynamic command list: routes + project + sessions + model switch)
- [x] Wire "New Conversation" → `trpc.ai.createSession.useMutation` + navigate to `/chat`
- [x] Wire "Clear Context" → Zustand chat store `clearConversation` action
- [x] Wire "Connect Blender" → `trpc.blender.status` query result; show launch command if offline
- [x] Wire "Flash Firmware" → Zustand `SpecializedModuleLauncher` module switcher
- [x] Wire "Run YARA Scan" → `trpc.security.scan` (passes through `validatePath` + `protectedProcedure`)
- [x] Add "Switch Execution Mode" command group → `setExecutionMode` mutation from Phase 15
- [x] Add "Pull Ollama Model" quick command → `ollamaRouter.pullModel` from Phase 24
- [x] Verify cmdk fuzzy matching uses full descriptive text in `CommandItem` values

## Phase 19 — WCAG 2.1 AA Accessibility ✅ COMPLETE
> **Completed 2026-05-31.**

- [x] `ChatInterface.tsx`: add `aria-live="polite"` + `role="log"` to message list; `aria-label` on textarea + send button
- [x] `HITLAlertPanel.tsx`: add `role="alert"` + `aria-live="assertive"`; autofocus reject button on panel open
- [x] `Dashboard.tsx`: `aria-label` on all card action buttons; `role="img"` + data summary `aria-label` on Recharts
- [x] `BrainMap.tsx`: `aria-label` on ReactFlow canvas; keyboard node creation (Enter key); text-mode `<details>` fallback
- [x] `ModelHub.tsx`: `role="list"` + `role="listitem"` on model cards; descriptive `aria-label` on delete/download buttons
- [x] `Pipelines.tsx` / `SpecializedModuleLauncher.tsx`: `aria-label` on icon-only config buttons in each row
- [x] `Integrations.tsx` / `IntegrationsHub.tsx`: `aria-live="polite"` + `role="status"` on sync indicator; `aria-label` on Sync/Settings/Disconnect/Connect buttons
- [x] `Settings.tsx`: `role="tabpanel"` + `aria-labelledby` on tab panels; `htmlFor`/`id` audit on all form inputs
- [x] Add `axe-core` as devDependency; create `client/src/__tests__/accessibility.test.ts` for all 8 pages

## Phase 20 — Immutable Audit Log ✅ COMPLETE
> **Completed 2026-05-31.** Backend fully wired; Settings.tsx panel deferred (handled by parallel agent).

- [x] Add `audit_log` table to `drizzle/schema.ts` (id UUID, eventType, actorId, actorType, procedure, args json, result json, ipAddress, sessionId, createdAt — no updatedAt)
- [x] Create `server/phase2/services/AuditLogService.ts` (insert-only singleton; no update/delete methods exposed)
- [x] Add `auditMiddleware` to `server/_core/trpc.ts` — logs all `protectedProcedure` calls with sanitized input
- [x] Wire HITL events: `HITLApprovalService.requestApproval()` + `resolveApproval()` → `AuditLogService.log()`
- [x] Wire agent spawn events: `AgentService.runCrew()` + `runLiteAgent()` → `AuditLogService.log()`
- [x] Create `server/routers/auditRouter.ts` (adminProcedure-only: getAuditLog paginated, getAuditLogByActor, exportAuditLog CSV)
- [x] Mount `audit: auditRouter` in `server/routers.ts`
- [x] Add "Audit Log" panel to `Settings.tsx` admin section (paginated table of recent events, CSV export, pagination)
- [x] Redact PII/secrets via `redactSensitiveData()` before inserting into `audit_log.args`

## Phase 21 — Granular RBAC Matrix ✅ COMPLETE
> **Completed 2026-05-31.**

- [x] Create `server/phase2/config/rbac.ts` — typed permission matrix with `hasPermission()` and `getPermissionsForRole()`
- [x] Add `ownerProcedure` and `requirePermission(resource, action)` factory to `server/_core/trpc.ts`
- [x] Updated `adminProcedure` to allow both `"admin"` and `"owner"` roles
- [x] Extend `users.role` enum to `["viewer", "user", "admin", "owner"]` in `drizzle/schema.ts`
- [x] Add `system.getMyPermissions`, `system.listUsers`, `system.setUserRole` tRPC procedures
- [x] Add `UserManagementPanel` to `Settings.tsx` admin section (role dropdown per user, self-demotion blocked)
- [x] Hide admin commands in `CommandPalette.tsx` behind `isAdmin` check (Audit Log + User Management items)

## Phase 22 — Adversarial Prompt Injection Layer ✅ COMPLETE
> **Completed 2026-05-31.**

- [x] Create `server/phase2/services/PromptSanitizer.ts` (NFC normalization, null byte removal, homoglyph detection, 7 injection patterns, oversized input truncation)
- [x] `SanitizerResult` type: `{ clean, modified, flagged, violations, originalLength, cleanLength }`
- [x] Integrate into `AiProviderService.streamChat()` via dynamic import (advisory, never blocks)
- [x] Integrate into `MemoryArchitectService` (ingest + search) and `AgentService` (runCrew + runLiteAgent)
- [x] Add `promptSanitizer` to `TrpcContext` in `context.ts`
- [x] Emit `security:injection_attempt` via AgentService EventEmitter → WebSocketServer broadcast
- [x] Log sanitizer flagged events to `audit_log` via AuditLogService
- [x] Add `server/__tests__/promptSanitizer.test.ts` (10 vitest cases)

## Phase 23 — Google + Microsoft OAuth Extensions ✅ COMPLETE
> **Completed 2026-05-31.**

- [x] Add `registerGoogleOAuthRoutes(app)` to `server/_core/oauth.ts` (PKCE, `https://accounts.google.com/o/oauth2/v2/auth`)
- [x] Add `registerMicrosoftOAuthRoutes(app)` to `server/_core/oauth.ts` (PKCE, `https://login.microsoftonline.com/common/v2.0/oauth2/authorize`)
- [x] Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` to `env.ts` + `.env.example`
- [x] Both callbacks: upsert `users` with `loginMethod: "google"` or `"microsoft"`; prevent silent email-based account merge
- [x] Add `loginProviders` query to `systemRouter.ts` (returns which providers are configured)
- [x] Add "Connected Accounts" tab to `Settings.tsx` — shows current login method, Google/Microsoft configured status, env setup instructions

## Phase 24 — Ollama Security Hardening + Model Hub UI ✅ COMPLETE
> **Completed 2026-05-31.**

- [x] Document `OLLAMA_BIND_ADDRESS=127.0.0.1` + `OLLAMA_PROXY_TOKEN` in `.env.example`
- [x] Create `server/python_bridges/ollama_proxy.py` (FastAPI auth proxy on port 11435, Bearer token auth)
- [x] Create `server/routers/ollamaRouter.ts` (listModels, modelInfo, pullModel, runningModels, deleteModel, createModelfile)
- [x] Wire `deleteModel` through `HITLApprovalService.requestApproval()` (admin-only, HITL-gated)
- [x] Create `client/src/components/hardware/ModelHubPanel.tsx` with 4 tabs: Installed Models, Pull Model, Delete, Modelfile Creator
- [x] Create `docker-compose.ollama.yml` (16g mem, 8 CPUs, ollama-proxy sidecar) + `Dockerfile.ollama-proxy`
- [x] Mount `ollama: ollamaRouter` in `server/routers.ts`

## Phase 25 — ElevenLabs Voice Cloud Integration ✅ COMPLETE
> **Completed 2026-05-31.**

- [x] Create `server/phase2/services/ElevenLabsService.ts` (listVoices, synthesize; guards with isConfigured())
- [x] `ELEVENLABS_API_KEY` already added to `env.ts`; documented in `.env.example`
- [x] Add `elevenLabsStatus`, `listElevenLabsVoices`, `synthesizeElevenLabs` procedures to `voiceRouter.ts` using `cloudProcedure`
- [x] Create `client/src/components/VoiceProviderSelector.tsx` (XTTS vs ElevenLabs toggle, voice picker, playback)
- [x] Register `elevenLabs: ElevenLabsService.getInstance()` in `context.ts`

## Phase 26 — RecursiveMAS Multi-Agent System ✅ COMPLETE
> **Depends on:** Phase 22 (PromptSanitizer). Backend bridge then parallel frontend.
> Completed 2026-05-31.

- [x] Create `server/python_bridges/recursive_mas_bridge.py` (FastAPI on port 8011; crewAI/custom loop with Ollama backend)
- [x] Extend `AgentService.ts` with `runRecursiveMAS(config)` + `AgentMessageBus` (EventEmitter, stdout JSON line parsing)
- [x] Per-agent ChromaDB collection isolation in `MemoryArchitectService.ensureAgentMemory(agentId)`
- [x] All inter-agent messages pass through `PromptSanitizer` before appending to any agent's context
- [x] Add `agent.runRecursiveMAS` + `agent.getRecursiveMASStatus` procedures to `agentRouter.ts`
- [x] Create `client/src/components/agents/RecursiveMASPanel.tsx` (configure crew, monitor via polling job channel)
- [x] HITL approval required before crew can execute when agentIds.length > 3 (high risk)

## Phase 27 — MCP Client Integration + Tool Directory ✅ COMPLETE
> **Depends on:** Phase 26 (AgentService extensions). Backend + frontend are parallelizable.
> Completed 2026-05-31.

- [x] Add `@modelcontextprotocol/sdk` dependency
- [x] Create `server/phase2/services/MCPClientService.ts` (stdio + WebSocket transport; `connectServer`, `disconnectServer`, `listTools`, `callTool`)
- [x] Extend `AgentService.ts` with `getAvailableMCPTools()` + `callMCPTool(serverId, toolName, args)`
- [x] Create `server/routers/mcpRouter.ts` (listConnectedServers, connectServer, disconnectServer, listTools, callTool)
- [x] HITL gate on all `dangerous: true` MCP tools before execution
- [x] `callTool` arguments pass through `PromptSanitizer` before forwarding
- [x] Create `client/src/components/integrations/MCPToolDirectory.tsx` (card grid grouped by server; "Test" button)
- [x] Add MCP section to `client/src/pages/Integrations.tsx`
- [x] AgenticOS opt-in: if `AGENTICOS_API_KEY` set, `MCPClientService` connects to AgenticOS registry

## Phase 28 — GodMode Pipeline Framework (5-Phase Gated) ✅ COMPLETE
> **Completed 2026-06-01.**

- [x] Add `pipelines` + `pipeline_phases` tables to `drizzle/schema.ts`
- [x] Create `server/phase2/services/PipelineEngineService.ts` (DEFINE→PLAN→EXECUTE→REVIEW→SHIP state machine)
- [x] Each phase gate emits HITL approval request — pipeline suspended until human approves
- [x] `ship` phase generates deployment plan only; never executes commands automatically
- [x] Phase outputs pass through `PromptSanitizer` on both input and output
- [x] Create `server/routers/pipelineRouter.ts` (createPipeline, getPipeline, listPipelines, approvePhase, abortPipeline)
- [x] All phase transitions logged to `audit_log`
- [x] Rewire `client/src/pages/Pipelines.tsx` with real pipeline dashboard
- [x] Create `client/src/components/pipelines/PhaseOutputPanel.tsx` (markdown output + Approve/Abort buttons)

## Phase 29 — PCBWay Integration + Three.js PCB Viewer ✅ COMPLETE
> **Completed 2026-06-01.**

- [x] Create `server/phase2/services/PCBWayService.ts` (getQuote, placeOrder, getOrderStatus; guard with `PCBWAY_API_KEY`)
- [x] Add `PCBWAY_API_KEY`, `PCBWAY_PARTNER_ID` to `env.ts`
- [x] Extend `kicadRouter.ts` with `getQuote`, `exportForManufacturing`, `placeOrder` (HITL required)
- [x] Create `client/src/components/hardware/PCBViewer3D.tsx` (`@react-three/fiber` + `@react-three/drei` placeholder PCB mesh)

## Phase 30 — OpenArt + Unified Image Generation Provider Selector ✅ COMPLETE
> **Completed 2026-06-01.**

- [x] Create `server/phase2/services/OpenArtService.ts` (API integration; guard with `OPENART_API_KEY`)
- [x] Create `server/routers/imageGenRouter.ts` — unified: ComfyUI (local) / Fal.ai (cloud) / OpenArt (cloud)
- [x] Create `client/src/components/media/ImageGeneratorPanel.tsx` (provider selector defaulting to ComfyUI local)

## Phase 31 — Threat Intelligence + Automated Security Scanning ✅ COMPLETE
> **Completed 2026-06-01.**

- [x] Extend `SecurityService.ts` with `runVulnerabilityScan(targetPath)` using semgrep bridge
- [x] Create `server/phase2/services/ThreatIntelService.ts` (MISP IoC integration; self-hosted default)
- [x] Create `server/python_bridges/threat_scanner.py` (FastAPI on port 8012; semgrep + YARA combined scan)
- [x] Create `client/src/components/security/ThreatDashboard.tsx` (scan results, IoC feed)
- [x] Add "Security Scan" command to `useCommandRegistry.ts` + `securityRouter.ts` extended

## Phase 32 — Llama.cpp Direct + ONNX Embeddings ✅ COMPLETE
> **Completed 2026-06-01.**

- [x] Create `server/python_bridges/llamacpp_bridge.py` (FastAPI on port 8013; wraps llama-cpp-python)
- [x] Create `server/phase2/services/LlamaCppService.ts` + register `"llamacpp"` as provider in `AiProviderService.ts`
- [x] Create `server/phase2/services/ONNXEmbeddingService.ts` (`onnxruntime-node`; local embedding without Python)
- [x] Modify `VectorDBService.ts` to accept pre-computed embeddings via `addWithEmbeddings()`

## Phase 33 — SQLite Sovereign Mode Fallback ✅ COMPLETE
> Completed 2026-06-01 as part of PKG-todo Phase 1.A.
> `server/db.factory.ts` + `server/db.sqlite.ts` wired; `OMNECOR_DB=sqlite`
> default for Electron; togglable in Settings under Execution Mode.

- [x] Add `better-sqlite3` dependency
- [x] Create `server/db.sqlite.ts`
- [x] Create `server/db.factory.ts`
- [x] Update all `server/db.ts` imports to use `db.factory.ts`

## Phase 34 — GPU Detection + Auto-Update Mechanism ✅ COMPLETE
> **Completed 2026-06-01.**

- [x] Create `packaging/scripts/detect_gpu.py` (nvidia-smi / rocm-smi detection; writes `OLLAMA_NUM_GPU_LAYERS` to .env)
- [x] Add GPU detection call to `packaging/deb/debian/postinst`
- [x] Create `server/phase2/services/UpdateCheckerService.ts` (GitHub releases API; compare versions)
- [x] Add `system.checkForUpdates` procedure to `systemRouter.ts`
- [x] Create `client/src/components/shell/UpdateBanner.tsx` (dismissible; shows on version mismatch)

---

## Multi-Agent Execution Waves

**Wave 1 — Fully parallel (no inter-dependencies):**
- Agent A: Phase 13 → 14a → 14b (wallet backend then UI)
- Agent B: Phase 16a (dataset builder; background Python task)
- Agent C: Phase 20 (immutable audit log — only needs schema access)
- Agent D: Phase 19 (accessibility audit — frontend only)
- Agent E: Phase 23 (OAuth extensions — only touches oauth.ts)

**Wave 2 — After Wave 1:**
- Agent A: Phase 15 (Execution Modes, requires Phase 14a budget enforcement)
- Agent B: Phase 16b (Valet Router fine-tune, requires Phase 16a dataset)
- Agent C: Phase 21 (RBAC, requires Phase 20 audit log)
- Agent D: Phase 24 + 25 (Ollama hardening + ElevenLabs — independent)
- Agent E: Phase 22 (Prompt Injection Layer — independent after schema)

**Wave 3 — After Wave 2:**
- Phase 17 (Zero-Login) requires Phase 15
- Phase 26 (RecursiveMAS) requires Phase 22
- Phase 27 (MCP) requires Phase 26
- Phase 18 (Command Palette) requires Phase 15 mode toggle

**Wave 4 — Late integration:**
- Phase 28 (GodMode) requires Phase 26 + 27
- Phases 29, 30, 31 (PCBWay, OpenArt, Threat Intel) — independent, any time
- Phases 32, 33, 34 (Llama.cpp, SQLite, GPU detection) — independent

> **Agent context budget:** Each agent session targets ~120K tokens. Touch no more than 6–8 files per session. Run `pnpm check && pnpm test` as a gate after each phase. Mark completed tasks `[x]` and unresolved issues `[!]` in this file before ending any session.

---
**OMNECOR HMCI v2.3.0 → v3.0.0 UPGRADE IN PROGRESS**
**PRD COMPLIANCE TARGET: v3.0.0**
