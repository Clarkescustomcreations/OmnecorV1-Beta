# Omnecor TODO
**Last updated:** 2026-05-31
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

## Phase 13 — Agentic Wallet: Schema & Backend 🔴 NOT STARTED
> **Critical PRD gap.** Required before v1.0 cloud billing. All tasks sequential (schema before code).

- [ ] Add `project_budget` table to `drizzle/schema.ts` (id, projectId, limitCents, alertThreshold, mode enum)
- [ ] Add `spend_log` table to `drizzle/schema.ts` (insert-only, no updatedAt — immutable spend record)
- [ ] Run `pnpm db:push` to apply migration
- [ ] Create `server/phase2/config/providerPricing.ts` with per-provider/model token pricing constants
- [ ] Add `estimateCost(provider, model, promptTokens, completionTokens)` to `AiProviderService.ts`
- [ ] Wire spend tracking into `AiProviderService.streamChat()` — emit `budget:spend` WebSocket events
- [ ] Add budget enforcement pre-flight in `chat()`/`streamChat()` — auto-downgrade to Ollama on hard-limit breach; throw `BudgetExhaustedError`
- [ ] Create `server/routers/walletRouter.ts` (getBudget, setBudget, getSpendLog, getSpendSummary, resetSpend)
- [ ] Mount `wallet: walletRouter` in `server/routers.ts`

## Phase 14a — Agentic Wallet: Budget UI & Auto-Downgrade UX 🔴 NOT STARTED
> **Depends on:** Phase 13. Can run in parallel with Phase 14b once backend is done.

- [ ] Create `client/src/components/wallet/BudgetPanel.tsx` (Recharts RadialBarChart + per-provider breakdown)
- [ ] Create `client/src/components/wallet/BudgetConfigDialog.tsx` (limitCents / alertThreshold / mode form)
- [ ] Add "Budget" card to `client/src/pages/Dashboard.tsx`
- [ ] Wire `budget:spend` WebSocket event into `useOmnecorSocket.ts` hook
- [ ] Add `walletBudget` Zustand slice to app store
- [ ] Extend `HITLAlertPanel.tsx` with `budget_warning` (80%) and `budget_exhausted` (100%) alert types
- [ ] Scope `budget:spend` WebSocket events to authenticated user's socket only (not global broadcast)

## Phase 14b — Agentic Wallet: Virtual Credit Cards 🔴 NOT STARTED
> **Depends on:** Phase 13. Opt-in only — app functions fully without this.

- [ ] Create `server/phase2/services/VirtualCardService.ts` with `LithicCardProvider` implementation
- [ ] Add `LITHIC_API_KEY`, `VIRTUAL_CARD_PROVIDER` to `server/_core/env.ts` and `.env.example`
- [ ] Create `server/routers/virtualCardRouter.ts` — `issueCard` gated by `HITLApprovalService`; rate limit 1/60s per user
- [ ] AES-256-GCM encrypt card tokens using existing `tokenIv`/`tokenTag` pattern from `drizzle/schema.ts`
- [ ] Add "Virtual Cards" tab to `BudgetConfigDialog.tsx` with "Not configured" state when key absent
- [ ] Mount `virtualCard: virtualCardRouter` in `server/routers.ts`

## Phase 15 — Execution Modes: Sovereign / Scrapper / Big Spender 🔴 NOT STARTED
> **Depends on:** Phase 14a. Required for privacy-first and air-gapped deployments.
> **Note:** Sovereign mode is an explicit opt-in lockdown — NOT a default. By default, users can freely use their own cloud API keys. Sovereign mode is for users who want a server-side guarantee that no data leaves the machine (air-gapped, HIPAA, etc.).

- [ ] Add `executionMode` enum column (`sovereign|scrapper|big_spender`) to `users` table in `drizzle/schema.ts`; default to `scrapper` (local-preferred, cloud available)
- [ ] Create `sovereignCheck` tRPC middleware in `server/_core/trpc.ts` — returns FORBIDDEN **only** when the user has explicitly set mode to `sovereign` AND the procedure is tagged `cloud: true`; otherwise cloud is freely usable
- [ ] Tag all cloud-dependent procedures with `cloud: true` metadata (non-Ollama aiRouter providers, falRouter, ElevenLabs, OpenArt) — this tag only activates under Sovereign mode, not by default
- [ ] Add `SOVEREIGN_MODE` env var check to all Python bridges (`tts_server.py`, `whisper_server.py`, etc.) — blocks external HTTP calls only when env var is set
- [ ] Create `client/src/components/shell/ExecutionModeBadge.tsx` (persistent sidebar badge: Sovereign = red lock, Scrapper = green local-preferred, Big Spender = amber)
- [ ] Replace non-functional Sovereign switch in `Settings.tsx` with 3-mode `RadioGroup` with clear descriptions of each mode
- [ ] Add `setExecutionMode` tRPC mutation to `systemRouter.ts`; persist in DB; sync to Zustand on mount
- [ ] Cloud API keys in Settings remain configurable and usable in all modes except Sovereign

## Phase 16a — 1.5B Valet Router: Dataset Construction 🟡 NOT STARTED
> **Parallelizable** — can run as background task while other phases proceed.

- [ ] Create `server/python_bridges/valet_dataset_builder.py` with Ollama-powered prompt generation
- [ ] Implement 10-category routing taxonomy with oracle annotation (category → provider, model, cost, local_capable)
- [ ] Generate 4,000 Alpaca-format JSONL examples to `data/valet_router_dataset.jsonl` (400/category)
- [ ] Generate 10% negative examples (wrong routing, for contrastive learning)
- [ ] 90/10 train/validation split → `data/valet_router_validation.jsonl`
- [ ] Add `trainingRouter.generateValetDataset` tRPC procedure (spawns dataset builder as ProcessManager job)
- [ ] Add dataset generation button + progress indicator to `UnslothPanel.tsx`

## Phase 16b — 1.5B Valet Router: Fine-Tune & Inference Integration 🟡 NOT STARTED
> **Depends on:** Phase 16a dataset. Base model: `Qwen2.5-1.5B` (best latency/accuracy tradeoff).

- [ ] Extend `localLLMfine-tuning.py` with `--task_type router` flag (r=8, alpha=16, seq_len=512, 3 epochs)
- [ ] Export trained model to GGUF q4_k_m format via Unsloth `save_pretrained_gguf`
- [ ] Create `server/python_bridges/valet_router_inference.py` (FastAPI on port 8010, binds 127.0.0.1)
- [ ] Implement routing prompt template with few-shot examples for ambiguous categories
- [ ] Create `server/phase2/services/ValetRouterService.ts` (wraps bridge, rule-based fallback when offline)
- [ ] Wire Valet Router pre-routing into `AiProviderService.streamChat()` — only when no explicit `providerId` set
- [ ] Sovereign mode override: if decision suggests cloud provider and mode is sovereign, force local
- [ ] Add `valetRouter.status` and `valetRouter.testRoute` procedures to new `server/routers/valetRouter.ts`
- [ ] Add "Valet Router" status card to `ModelHub.tsx` (accuracy stats, recent routing decisions)

## Phase 17 — Zero-Login Mode & Offline Boot 🟡 NOT STARTED
> **Depends on:** Phase 15 (Sovereign mode). Backend and frontend tasks are parallelizable.

- [ ] Add `ZERO_LOGIN_MODE=true` support to `server/_core/context.ts` (synthetic local admin user, no SDK call)
- [ ] Skip OAuth route registration in `server/_core/index.ts` when `ZERO_LOGIN_MODE=true`
- [ ] Add graceful startup checklist in `server/_core/index.ts` (log Ollama/ChromaDB/MySQL status; don't throw)
- [ ] Create `client/src/components/shell/ZeroLoginBanner.tsx` (yellow persistent notice, session-scoped only)
- [ ] Wire `ZeroLoginBanner` into `OmnecorDashboardLayout.tsx`
- [ ] Add `--zero-login` startup flag to `packaging/` startup scripts (.deb, AppImage)
- [ ] Auto-enable Sovereign mode when `ZERO_LOGIN_MODE=true` (server-side enforcement)
- [ ] Add `ZERO_LOGIN_MODE` to `.env.example` with security warning comment

## Phase 18 — Command Palette: Full Action Wiring 🟡 NOT STARTED
> **Depends on:** Phase 15 (mode toggle mutation). Single frontend agent session.

- [ ] Create `client/src/hooks/useCommandRegistry.ts` (dynamic command list: routes + project + sessions + model switch)
- [ ] Wire "New Conversation" → `trpc.ai.createSession.useMutation` + navigate to `/chat`
- [ ] Wire "Clear Context" → Zustand chat store `clearConversation` action
- [ ] Wire "Connect Blender" → `trpc.blender.status` query result; show launch command if offline
- [ ] Wire "Flash Firmware" → Zustand `SpecializedModuleLauncher` module switcher
- [ ] Wire "Run YARA Scan" → `trpc.security.scan` (passes through `validatePath` + `protectedProcedure`)
- [ ] Add "Switch Execution Mode" command group → `setExecutionMode` mutation from Phase 15
- [ ] Add "Pull Ollama Model" quick command → `ollamaRouter.pullModel` from Phase 24
- [ ] Verify cmdk fuzzy matching uses full descriptive text in `CommandItem` values

## Phase 19 — WCAG 2.1 AA Accessibility 🟡 NOT STARTED
> **Parallelizable** — two agents can split pages. No backend dependencies.

- [ ] `ChatInterface.tsx`: add `aria-live="polite"` + `role="log"` to message list; `aria-label` on textarea + send button
- [ ] `HITLAlertPanel.tsx`: add `role="alert"` + `aria-live="assertive"`; autofocus reject button on panel open
- [ ] `Dashboard.tsx`: `aria-label` on all card action buttons; `role="img"` + data summary `aria-label` on Recharts
- [ ] `BrainMap.tsx`: `aria-label` on ReactFlow canvas; keyboard node creation (Enter key); text-mode `<details>` fallback
- [ ] `ModelHub.tsx`: `role="list"` + `role="listitem"` on model cards; descriptive `aria-label` on delete/download buttons
- [ ] `Pipelines.tsx`: focus trap when node config panel open (use existing Dialog focus trap pattern)
- [ ] `Integrations.tsx`: `aria-checked` on toggle switches; `aria-expanded` on accordion sections
- [ ] `Settings.tsx`: `role="tabpanel"` + `aria-labelledby` on tab panels; audit `htmlFor`/`id` pairing on all form inputs
- [ ] Add `axe-core` as devDependency; create `client/src/__tests__/accessibility.test.ts` for all 8 pages

## Phase 20 — Immutable Audit Log 🟡 NOT STARTED
> **Parallelizable** — backend tasks then parallel frontend. No dependencies beyond schema access.

- [ ] Add `audit_log` table to `drizzle/schema.ts` (id UUID, eventType, actorId, actorType, procedure, args json, result json, ipAddress, sessionId, createdAt — no updatedAt)
- [ ] Create `server/phase2/services/AuditLogService.ts` (insert-only singleton; no update/delete methods exposed)
- [ ] Add `auditMiddleware` to `server/_core/trpc.ts` — logs all `protectedProcedure` calls with sanitized input
- [ ] Wire HITL events: `HITLApprovalService.requestApproval()` + `resolveApproval()` → `AuditLogService.log()`
- [ ] Wire agent spawn events: `AgentService.runCrew()` + `runLiteAgent()` → `AuditLogService.log()`
- [ ] Create `server/routers/auditRouter.ts` (adminProcedure-only: getAuditLog paginated, getAuditLogByActor, exportAuditLog CSV)
- [ ] Mount `audit: auditRouter` in `server/routers.ts`
- [ ] Add "Audit Log" panel to `Settings.tsx` admin section (paginated table of recent events)
- [ ] Redact PII/secrets via `redactSensitiveData()` before inserting into `audit_log.args`

## Phase 21 — Granular RBAC Matrix 🟡 NOT STARTED
> **Depends on:** Phase 20 (audit log must capture role changes). Backend then parallel frontend.

- [ ] Create `server/phase2/config/rbac.ts` — typed permission matrix: `procedurePath → minimumRole[]`
- [ ] Add RBAC check middleware to `protectedProcedure` in `server/_core/trpc.ts`
- [ ] Extend `users.role` enum to `["viewer", "user", "admin", "owner"]` in `drizzle/schema.ts`; run migration
- [ ] Enforce `owner` role assignment only via `OWNER_OPEN_ID` env var (not changeable via UI)
- [ ] Add `system.getMyPermissions` tRPC procedure (returns caller's allowed procedure list)
- [ ] Add role assignment UI to `Settings.tsx` admin section (change other users' roles; admin-only)
- [ ] Hide unauthorized commands in `CommandPalette.tsx` based on `getMyPermissions` data

## Phase 22 — Adversarial Prompt Injection Layer 🟡 NOT STARTED
> **Parallelizable** — no dependencies. Required before Phase 26 (RecursiveMAS).

- [ ] Create `server/phase2/services/PromptSanitizer.ts` (Unicode normalization, null byte removal, homoglyph detection, hidden character strip, injection pattern matching)
- [ ] `SanitizerResult` type: `{ sanitized, blocked, threats, risk_score 0–1 }` — block at >0.9, HITL alert at >0.7
- [ ] Integrate into `AiProviderService.streamChat()` on last user message — throw `PromptInjectionError` if blocked
- [ ] Integrate into `MemoryArchitectService.ingestDocument()` + `ingestDirectory()` on each chunk
- [ ] Integrate into `AgentService.runCrew()` + `runLiteAgent()` on goal/backstory fields
- [ ] Add `promptSanitizer` to `TrpcContext` in `context.ts`
- [ ] Emit `security:injection_attempt` WebSocket event when `risk_score > 0.7`; trigger HITL alert panel
- [ ] Log sanitizer events to `audit_log` when `risk_score > 0.5`
- [ ] Add `server/__tests__/promptSanitizer.test.ts` (10 injection patterns, context-aware: `###` in code not blocked)

## Phase 23 — Google + Microsoft OAuth Extensions 🟢 NOT STARTED
> **Parallelizable** — only touches `oauth.ts`. Both providers are structurally identical; one agent.

- [ ] Add `registerGoogleOAuthRoutes(app)` to `server/_core/oauth.ts` (PKCE, `https://accounts.google.com/o/oauth2/v2/auth`)
- [ ] Add `registerMicrosoftOAuthRoutes(app)` to `server/_core/oauth.ts` (PKCE, `https://login.microsoftonline.com/common/v2.0/oauth2/authorize`)
- [ ] Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` to `env.ts` + `.env.example`
- [ ] Both callbacks: upsert `users` with `loginMethod: "google"` or `"microsoft"`; prevent silent email-based account merge
- [ ] Add `loginProviders` query to `systemRouter.ts` (returns which providers are configured)
- [ ] Add "Connected Accounts" section to `Settings.tsx` with linked providers per user

## Phase 24 — Ollama Security Hardening + Model Hub UI 🟢 NOT STARTED
> **Parallelizable** — backend hardening and frontend UI are separable agents.

- [ ] Document `OLLAMA_BIND_ADDRESS=127.0.0.1` in `.env.example` with systemd override instructions
- [ ] Create `server/python_bridges/ollama_proxy.py` (FastAPI auth proxy on port 11435, Bearer token from `OLLAMA_PROXY_TOKEN`)
- [ ] Add `OLLAMA_PROXY_TOKEN` to `env.ts`; update `AiProviderService.chatOllama()` to use proxy port + auth header
- [ ] Create `server/routers/ollamaRouter.ts` (listModels, pullModel with WebSocket progress, deleteModel, createModelfile)
- [ ] Wire `deleteModel` through `HITLApprovalService.requestApproval("deleteOllamaModel", {modelName})`
- [ ] Extend `ModelHubPanel.tsx` with tabs: "Installed Models", "Pull Model", "Delete Model", "Modelfile Creator"
- [ ] Add `docker-compose.ollama.yml` snippet with `mem_limit: 16g` + `cpus: "8.0"` as reference

## Phase 25 — ElevenLabs Voice Cloud Integration 🟢 NOT STARTED
> **Parallelizable** — single agent for full service + router + minimal UI. Local XTTS-v2 remains default.

- [ ] Create `server/phase2/services/ElevenLabsService.ts` (synthesize, listVoices; guard with `if (!ENV.elevenLabsApiKey)`)
- [ ] Add `ELEVENLABS_API_KEY` to `env.ts` + `.env.example`
- [ ] Add `synthesizeElevenLabs` + `listElevenLabsVoices` procedures to `voiceRouter.ts`; tag `cloud: true`
- [ ] Add voice provider selector to synthesis UI (Local XTTS-v2 default / Cloud ElevenLabs)
- [ ] Add rate limiting on `synthesizeElevenLabs` at router level (prevent API key exhaustion)
- [ ] Register `elevenLabs: ElevenLabsService.getInstance()` in `context.ts`

## Phase 26 — RecursiveMAS Multi-Agent System 🟢 NOT STARTED
> **Depends on:** Phase 22 (PromptSanitizer). Backend bridge then parallel frontend.

- [ ] Create `server/python_bridges/recursive_mas_bridge.py` (FastAPI on port 8011; crewAI/custom loop with Ollama backend)
- [ ] Extend `AgentService.ts` with `runRecursiveMAS(config)` + `AgentMessageBus` (EventEmitter, stdout JSON line parsing)
- [ ] Per-agent ChromaDB collection isolation in `MemoryArchitectService.ensureProjectMemory(agentId)`
- [ ] All inter-agent messages pass through `PromptSanitizer` before appending to any agent's context
- [ ] Add `agent.runRecursiveMAS` procedure to `agentRouter.ts`
- [ ] Create `client/src/components/agents/RecursiveMASPanel.tsx` (configure crew, monitor via WebSocket job channel)
- [ ] HITL approval required before crew can execute destructive tool calls

## Phase 27 — MCP Client Integration + Tool Directory 🟢 NOT STARTED
> **Depends on:** Phase 26 (AgentService extensions). Backend + frontend are parallelizable.

- [ ] Add `@modelcontextprotocol/sdk` dependency
- [ ] Create `server/phase2/services/MCPClientService.ts` (stdio + WebSocket transport; `connectServer`, `disconnectServer`, `listTools`, `callTool`)
- [ ] Extend `AgentService.ts` with `getAvailableMCPTools()` + `callMCPTool(serverId, toolName, args)`
- [ ] Create `server/routers/mcpRouter.ts` (listConnectedServers, connectServer, disconnectServer, listTools, callTool)
- [ ] HITL gate on all `dangerous: true` MCP tools before execution
- [ ] `callTool` arguments pass through `PromptSanitizer` before forwarding
- [ ] Create `client/src/components/integrations/MCPToolDirectory.tsx` (card grid grouped by server; "Test" button)
- [ ] Add MCP section to `client/src/pages/Integrations.tsx`
- [ ] AgenticOS opt-in: if `AGENTICOS_API_KEY` set, `MCPClientService` connects to AgenticOS registry

## Phase 28 — GodMode Pipeline Framework (5-Phase Gated) 🟢 NOT STARTED
> **Depends on:** Phase 26 + Phase 27. Backend then parallel frontend.

- [ ] Add `pipelines` + `pipeline_phases` tables to `drizzle/schema.ts`
- [ ] Create `server/phase2/services/PipelineEngineService.ts` (DEFINE→PLAN→EXECUTE→REVIEW→SHIP state machine)
- [ ] Each phase gate emits HITL approval request — pipeline suspended until human approves
- [ ] `ship` phase generates deployment plan only; never executes commands automatically
- [ ] Phase outputs pass through `PromptSanitizer` on both input and output
- [ ] Create `server/routers/pipelineRouter.ts` (createPipeline, getPipeline, listPipelines, approvePhase, abortPipeline)
- [ ] All phase transitions logged to `audit_log`
- [ ] Rewire `client/src/pages/Pipelines.tsx` with real pipeline dashboard
- [ ] Create `client/src/components/pipelines/PhaseOutputPanel.tsx` (markdown output + Approve/Abort buttons)

## Phase 29 — PCBWay Integration + Three.js PCB Viewer 🟢 BACKLOG
- [ ] Create `server/phase2/services/PCBWayService.ts` (getQuote, placeOrder, getOrderStatus; guard with `PCBWAY_API_KEY`)
- [ ] Add `PCBWAY_API_KEY`, `PCBWAY_PARTNER_ID` to `env.ts` + `.env.example`
- [ ] Extend `kicadRouter.ts` with `getQuote` (Gerber export → PCBWay quote), `exportForManufacturing`, `placeOrder` (HITL required)
- [ ] Create `client/src/components/hardware/PCBViewer3D.tsx` (`@react-three/fiber` + `@react-three/drei` STEP/GLB viewer)
- [ ] Wire KiCad STEP export → auto-load in `PCBViewer3D` from `KiCadPanel.tsx` (via `storageProxy.ts` pattern)

## Phase 30 — OpenArt + Unified Image Generation Provider Selector 🟢 BACKLOG
- [ ] Create `server/phase2/services/OpenArtService.ts` (API integration; guard with `OPENART_API_KEY`)
- [ ] Create `server/routers/imageGenRouter.ts` — unified: ComfyUI (local) / Fal.ai (cloud) / OpenArt (cloud)
- [ ] Create `client/src/components/media/ImageGeneratorPanel.tsx` (provider selector defaulting to ComfyUI local)
- [ ] Tag Fal.ai and OpenArt procedures with `cloud: true` for Sovereign mode enforcement

## Phase 31 — Threat Intelligence + Automated Security Scanning 🟢 BACKLOG
- [ ] Extend `SecurityService.ts` with `runVulnerabilityScan(targetPath)` using `semgrep`
- [ ] Create `server/phase2/services/ThreatIntelService.ts` (MISP IoC integration; self-hosted default)
- [ ] Create `server/python_bridges/threat_scanner.py` (FastAPI on port 8012; semgrep + YARA combined scan)
- [ ] Create `client/src/components/security/ThreatDashboard.tsx` (scan results, IoC feed, vulnerability list)
- [ ] Add "Security Scan" command to `CommandPalette.tsx` → scans current project directory

## Phase 32 — Llama.cpp Direct + ONNX Embeddings 🟢 BACKLOG
- [ ] Create `server/python_bridges/llamacpp_bridge.py` (FastAPI on port 8013; wraps llama-cpp-python)
- [ ] Create `server/phase2/services/LlamaCppService.ts` + register `"llamacpp"` as provider in `AiProviderService.ts`
- [ ] Create `server/phase2/services/ONNXEmbeddingService.ts` (`onnxruntime-node`; local embedding without Python)
- [ ] Modify `VectorDBService.ts` to accept pre-computed embeddings from `ONNXEmbeddingService`

## Phase 33 — SQLite Sovereign Mode Fallback 🟢 BACKLOG
> **Depends on:** Phase 17 (Zero-Login Mode).

- [ ] Add `better-sqlite3` dependency
- [ ] Create `server/db.sqlite.ts` (Drizzle SQLite adapter with same schema subset)
- [ ] Create `server/db.factory.ts` (auto-select MySQL vs SQLite based on `DATABASE_URL` or `ZERO_LOGIN_MODE`)
- [ ] Update all `server/db.ts` imports to use `db.factory.ts`

## Phase 34 — GPU Detection + Auto-Update Mechanism 🟢 BACKLOG
- [ ] Create `packaging/scripts/detect_gpu.py` (nvidia-smi / rocm-smi detection; writes `OLLAMA_NUM_GPU_LAYERS` to .env)
- [ ] Add GPU detection call to `packaging/scripts/postinst`
- [ ] Create `server/phase2/services/UpdateCheckerService.ts` (GitHub releases API; compare versions)
- [ ] Add `system.checkForUpdates` procedure to `systemRouter.ts`
- [ ] Create `client/src/components/shell/UpdateBanner.tsx` (dismissible; shows on version mismatch)

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
