# Feature Ownership Map

*An architectural cross-reference mapping every major feature to its exact surface area across the entire stack (frontend components, routers, storage tables, background jobs, dependencies, settings, API namespace). Last audited: 2026-06-20. Source of truth: `server/routers.ts`, `drizzle/schema.ts`, `client/src/App.tsx`.*

---

## Neural Brain Map

- **Frontend**: `client/src/pages/BrainMap.tsx`, `client/src/components/neural/*` (`NeuralGraphView.tsx`, `NeuralTreeView.tsx`, `NeuralWorkspaceCanvas.tsx`, `NeuralMapContext.tsx`), `client/src/components/workspace/NeuralWorkspaceCanvas.tsx`, `client/src/lib/stores/brainMapStore.ts`, `client/src/contexts/NeuralMapContext.tsx`
- **Router**: `server/routers/neuralMapsRouter.ts` → namespace `trpc.neuralMaps.*`
- **Storage**: `neural_maps` table (SQLite) — `id`, `userId`, `name`, `source`, `settings` (JSON — includes `collapsedFolderIds`, `labelOverrides`, layout prefs), `createdAt`, `updatedAt`
- **Background Jobs**: `FileSystemWatcherService` (monitors indexed local folders for graph updates → VectorDB), `MemoryArchitectService` (ChromaDB semantic index of the map "brain" — local files **and**, since 2026-06-23, real content from remote sources via `reindexRemoteSource`); `integrations.indexMapSources` detached job (fetches + embeds remote-source content, gated by `settings.indexingEnabled`)
- **Dependencies**: `react-flow-renderer` / `@xyflow/react` (canvas), `fileTreeToNetwork.ts` (file→graph converter), ChromaDB (long-term vector index — collection `omnecor_{mapId}` via shared `VectorDBService.sanitizeCollectionName`), `react-force-graph` (Force/Hierarchical/Mind-Map/Circular layouts)
- **Settings**: Settings → Knowledge tab (folder path, file filters, auto-index toggle); map `settings.indexingEnabled` (remote-source VectorDB write-gate) + `settings.enableAIContext` (chat RAG read-gate); Visual Controller sidebar (layout engine, node size 20–50 px, animation speed, GPU acceleration, auto-clustering, show labels); `omnecor_visual_control_sync` BroadcastChannel syncs visual prefs to external pop-out
- **API**: `trpc.neuralMaps.list`, `trpc.neuralMaps.create`, `trpc.neuralMaps.update`, `trpc.neuralMaps.delete`, `trpc.neuralMaps.get`; remote-source pipeline (integrations namespace): `trpc.integrations.fetchSourceTree` (listing), `trpc.integrations.indexMapSources` (content → VectorDB), `trpc.integrations.getMapIndexStatus` (progress); read-side RAG: `ragMapId` on `trpc.aiProvider.chatStream` / `trpc.ai.chat`
- **External Window**: `/brain-map-external` route — `ExternalBrainMapWindow.tsx`; bidirectional `requestInitialState` / `initialState` handshake

---

## Chat Workspace (AI Chat Engine)

- **Frontend**: `client/src/pages/Chat.tsx`, `client/src/components/chat/ChatInput.tsx`, `client/src/components/ChatInterface.tsx`, `client/src/components/chat/AssistantBubble.tsx`, `client/src/components/chat/ConversationList.tsx`, `client/src/components/LivePreviewPanel.tsx`, `client/src/components/VisualContextMap.tsx`
- **Router**: `server/routers/aiRouter.ts` → `trpc.ai.*`; `server/routers/chatRouter.ts` → `trpc.chat.*`; `server/routers/attachmentsRouter.ts` → `trpc.attachments.*`; `server/routers/agentMessengerRouter.ts` → `trpc.agentMessenger.*`
- **Storage**: `chat_sessions` table, `chat_messages` table, `saved_scripts` table (server-backed script library with `userId`, `name`, `code`, `language`, `project`)
- **Background Jobs**: `MemoryArchitectService` (auto-summarization after 50 messages — keeps last 6 + system summary; also serves **map RAG retrieval** — when a chat carries `ragMapId`, `server/_core/ragContext.ts` pulls relevant excerpts from the map's collection and injects them into the prompt, gated by `settings.enableAIContext`, 2026-06-23), `HashTrackerService` (action-hash loop detection, 3-rep threshold → HITL alert), `AiProviderService` (spend tracking per token)
- **Dependencies**: `ai` SDK / provider SDKs (OpenAI, Anthropic, Gemini, Groq), Ollama HTTP client, `@anthropic-ai/tokenizer` (BPE tokenizer for real token counts), `honcho-ai` SDK (long-term session memory), `js-tiktoken@1.0.21` (`client/src/lib/tokenizer.ts` — model-aware BPE: o200k_base for GPT-4o/Claude 4/Gemini, cl100k_base for legacy), `xterm.js` (embedded terminal)
- **Settings**: Settings → API (provider keys, Ollama URL, Hugging Face, fal.ai, ElevenLabs, Forge, n8n, ComfyUI); SetupWizard → provider step; execution mode badge (Sovereign/Scrapper/Big Spender)
- **API**: `trpc.ai.chat`, `trpc.ai.chatStream`, `trpc.ai.summarizeAndPruneSession`, `trpc.ai.reportLoopViolation`, `trpc.chat.list`, `trpc.chat.create`, `trpc.chat.delete`, `trpc.scripts.list`, `trpc.scripts.create`, `trpc.scripts.update`, `trpc.scripts.delete`

---

## OMMESH Distributed Intelligence

- **Frontend**: `client/src/pages/AgentNetworking.tsx` (Mesh Compute UI panel), `client/src/components/mesh/MeshTopologyGraph.tsx` (ForceGraph2D live mesh rendering — local node blue glow, trusted peers green, pending-approval red; dashed edges for unapproved)
- **Router**: `server/routers/ommesh.router.ts` → namespace `trpc.ommesh.*`; `server/ommesh/core/MeshNode.ts`; `server/ommesh/core/MeshServer.ts` (mTLS HTTPS inference listener on `MESH_PORT` 3001)
- **Storage**: No dedicated SQLite table — state held in `MeshDiscoveryService` in-memory nodes map. Peer authorization keys written to `data/certs/` directory. Node identity tracked via `SecurityManager.ts`.
- **Background Jobs**: `MeshDiscoveryService` (bonjour mDNS advertisement + browser; emits `nodeDiscovered`/`nodeLost` events); `WebSocketServer.ts` (mobile node registration handlers: `mobile_node_register`, `mobile_node_heartbeat`, `mobile_inference_request`, `mobile_inference_response`); `startTelemetryPush()` (2 s CPU/RAM/GPU VRAM broadcast on `system:metrics` WS channel)
- **Dependencies**: `bonjour` (mDNS, static import required — CJS `export =` pattern), `@forge-ai/node` (mTLS cert generation via `SecurityManager`), `react-force-graph ^1.48.2` (topology canvas), `AiProviderService` (local inference via `executeLocal()`)
- **Settings**: Settings → OMMESH tab (enable discovery, node name, `OMMESH_SECRET`); AgentNetworking → OMMESH Trust panel (approve/deny pending node fingerprints)
- **API**: `trpc.ommesh.discover`, `trpc.ommesh.routeInference`, `trpc.ommesh.getIdentity`, `trpc.ommesh.rotateCert` (adminProcedure), `trpc.ommesh.approvePeer` (adminProcedure)

---

## 3D Designer / PCB & Schematic Editor

- **Frontend**: `client/src/pages/3DDesigner.tsx`, `client/src/components/designer/ThreeViewer.tsx` (GLTF/GLB/OBJ + primitives, raycast selection), `client/src/components/designer/SchematicEditor.tsx` (ReactFlow PCB aesthetic), `client/src/components/pcb/EnhancedPCBEditor.tsx` (full-persistence PCB editor — auto-save debounce 1.5 s, auto-create Default Design), `client/src/components/pcb/PCBSchematicEditor.tsx`, `client/src/components/pcb/ComponentLibraryPanel.tsx` (49 components across 9 categories), `client/src/components/pcb/AIAssistantPanel.tsx`, `client/src/components/pcb/PCBViewer3D.tsx`, `client/src/components/WebPreview.tsx`, `client/src/lib/componentLibrary.ts`
- **Router**: `server/routers/blenderRouter.ts` → `trpc.blender.*`; `server/routers/kicadRouter.ts` → `trpc.kicad.*`; `server/routers/pcbEditorRouter.ts` → `trpc.pcbEditor.*`; `server/routers/espRouter.ts` → `trpc.esp.*`
- **Storage**: `design_projects` table, `design_saves` table, `design_exports` table, `ai_design_reviews` table, `component_library_items` table (all in SQLite via `server/db-pcb.ts`)
- **Background Jobs**: `BlenderService.ts` (headless render, glTF export, Python subprocess), `KiCadService.ts` (DRC/ERC, STEP/Gerber export, BOM), `ESPToolService.ts` (serial port detection, firmware flash), `PCBWayService.ts` (quoting + ordering — HITL-gated)
- **Dependencies**: `react-three-fiber`, `@react-three/drei` (3D canvas), `@xyflow/react` (schematic/PCB node graph), `three`, `three/examples/jsm/loaders` (GLTFLoader, OBJLoader), `blender_bridge.py`, `kicad_bridge.py`, `esptool_bridge.py`
- **Settings**: Settings → Advanced → Blender path, KiCad CLI path, ESPTool path; SetupWizard → Dependency Checklist step
- **API**: `trpc.blender.render`, `trpc.blender.export`, `trpc.blender.listModels`, `trpc.kicad.runDrc`, `trpc.kicad.exportStep`, `trpc.kicad.exportGerber`, `trpc.kicad.generateBom`, `trpc.pcbEditor.createProject`, `trpc.pcbEditor.saveDesign`, `trpc.pcbEditor.loadDesign`, `trpc.pcbEditor.deleteProject`, `trpc.pcbEditor.reviewDesign`, `trpc.pcbEditor.exportDesign`, `trpc.esp.detectPorts`, `trpc.esp.flash`

---

## Agent Networking & Social Automation

- **Frontend**: `client/src/pages/AgentNetworking.tsx` (tabs: Curation, Calendar, Scheduler, Analytics, Personas, Mesh Compute, OMMESH Trust), `client/src/components/mesh/MeshTopologyGraph.tsx`
- **Router**: `server/routers/schedulingRouter.ts` → `trpc.scheduling.*`; `server/routers/curatorRouter.ts` → `trpc.curator.*`; `server/routers/discoveryRouter.ts` → `trpc.discovery.*`; `server/routers/platformsRouter.ts` → `trpc.platforms.*`; `server/routers/analyticsRouter.ts` → `trpc.analytics.*`; `server/routers/agentSettingsRouter.ts` → `trpc.settings.*`; `server/routers/oauthRouter.ts` → `trpc.oauth.*`; `server/routers/gmailRouter.ts` → `trpc.gmail.*` (cloudProcedure, refresh-on-401, RFC-2047 subject encoding, header-injection guard)
- **Storage**: `discoveredArticles`, `curatedPosts`, `scheduledPosts`, `postAnalytics`, `platformAccounts`, `postingScheduleConfig`, `oauthStates` tables
- **Background Jobs**: `ArticleDiscoveryService` (RSS ingest via `rss-parser`; dedup by `urlHash`); `publishWorker.ts` (auto-publish at scheduled time); `PublishingService` + `publishExecutor.ts` (real X/Twitter/LinkedIn/Facebook/Instagram calls + 401 token-refresh); `TokenRefreshService`
- **Dependencies**: `rss-parser` (RSS ingestion), platform OAuth SDKs (Twitter API v2, LinkedIn, Facebook Graph API, Instagram Graph API, YouTube Data API), `simple-oauth2` (token flows), react-force-graph (OMMESH topology canvas)
- **Settings**: Settings → Accounts → Service Connections card (`ServiceConnectionsCard` — 10 providers × client-id/secret, copyable callback URI, `isAdmin`-gated); AgentNetworking → Persona Studio; `CHAR_LIMITS` per-platform (X: 280, LinkedIn: 3000, etc.)
- **API**: `trpc.discovery.fetchArticles`, `trpc.curator.curateArticle`, `trpc.curator.regenerateDraft`, `trpc.scheduling.publishNow`, `trpc.scheduling.retryPost`, `trpc.scheduling.schedulePost`, `trpc.platforms.connect`, `trpc.platforms.disconnect`, `trpc.analytics.getPostAnalytics`, `trpc.oauth.getAuthorizationUrl`, `trpc.oauth.handleCallback`, `trpc.gmail.sendEmail`, `trpc.gmail.status`

---

## Podcast Studio

- **Frontend**: `client/src/pages/PodcastStudio.tsx` (timeline rows, speaker/emotion dropdowns, per-segment regeneration, localStorage session persistence, Download Audio WAV, episode history dialog), `client/src/components/podcast/*`
- **Router**: `server/routers/podcastRouter.ts` → `trpc.podcast.*`
- **Storage**: No dedicated SQLite table — generated audio written to `PATHS.uploads`. Episode history stored in `localStorage["omnecor:podcast_session"]`.
- **Background Jobs**: `LocalPodcastService.ts` (calls `podcast_engine.py` via `callPodcastEngine()` spawner, 10-min timeout); `podcast_engine.py` (XTTS-v2/Kokoro TTS synthesis per turn via `POST /synthesize`, `soundfile`/numpy stitching + resample to 44100 Hz, silence gap insertion); real-time WS progress events on `podcast:${jobId}` channel
- **Dependencies**: `podcast_engine.py` (Python — XTTS-v2, Kokoro TTS, `httpx`, `soundfile`, numpy), TTS server (port 8002), Whisper server (port 8001), `expo-audio` (mobile playback), `expo-speech` (mobile TTS)
- **Settings**: Settings → Voice (STT/TTS toggles, speed 0.75/1.0/1.25/1.5×); SetupWizard → Dependency Checklist (Whisper/TTS detected)
- **API**: `trpc.podcast.generate`, `trpc.podcast.generateScript`, `trpc.voice.transcribe`, `trpc.voice.synthesize`, `trpc.voice.listVoices`, `trpc.voice.convertVoice` (RVC)

---

## Voice Pipeline (Whisper STT / XTTS-v2 / RVC)

- **Frontend**: `client/src/components/chat/ChatInput.tsx` (hold-to-record 🎤, Voice Input button), `client/src/components/voice/VoiceProviderSelector.tsx`, `client/src/pages/Settings.tsx` (Voice section)
- **Router**: `server/routers/voiceRouter.ts` → `trpc.voice.*`
- **Storage**: RVC model files on filesystem under validated path; TTS reference WAV files
- **Background Jobs**: `VoiceService.ts` (manages Whisper daemon proxy on port 8001; XTTS/Kokoro daemon proxy on port 8002; RVC daemon proxy via `rvc_server.py`); `ElevenLabsService.ts` (cloud TTS fallback — cloudProcedure)
- **Dependencies**: `whisper_server` (FastAPI, port 8001 — `faster-whisper`), `rvc_server.py` (FastAPI — HuBERT + SynthesizerTrnMs768NSFsid; fallback: identity pass-through of original 16 kHz audio), `podcast_engine.py` (orchestrator), `ElevenLabsService.ts`
- **Settings**: Settings → Voice → STT/TTS provider toggles, RVC model path, speed settings
- **API**: `trpc.voice.transcribe`, `trpc.voice.synthesize`, `trpc.voice.listRvcModels`, `trpc.voice.convertVoice`, `trpc.voice.status`

---

## Agentic Wallet & Spend Controls

- **Frontend**: `client/src/pages/AgenticWallet.tsx`, `client/src/components/wallet/BudgetPanel.tsx`, `client/src/components/wallet/BudgetConfigDialog.tsx`, `client/src/components/wallet/VirtualCards tab` (tab inside AgenticWallet)
- **Router**: `server/routers/walletRouter.ts` → `trpc.wallet.*`; `server/routers/virtualCardRouter.ts` → `trpc.virtualCard.*`
- **Storage**: `project_budgets` table (limitCents, alertThreshold 80%, mode: soft/hard), `spend_log` table (immutable — provider, modelId, promptTokens, completionTokens, estimatedCostMicrocents, sessionId)
- **Background Jobs**: `AiProviderService.logSpend()` (called after every chat/stream with token counts and microcent estimates); `VirtualCardService.ts` (Lithic API integration — AES-256-GCM PAN encryption at rest); WS `budget:spend` events; HITL overlay when budget limit approached
- **Dependencies**: `Lithic SDK` (virtual card issuance — requires `LITHIC_API_KEY`), `providerPricing.ts` (per-model cost lookup table), AES-256-GCM (PAN encryption)
- **Settings**: Settings → Wallet (global budget); SetupWizard → Resource Limits (max VRAM slider)
- **API**: `trpc.wallet.getSpendLog`, `trpc.wallet.getProjectBudget`, `trpc.wallet.setProjectBudget`, `trpc.wallet.getGlobalSummary`, `trpc.virtualCard.issue`, `trpc.virtualCard.list`, `trpc.virtualCard.revoke`

---

## Model Hub (Ollama + Cloud API Management)

- **Frontend**: `client/src/pages/ModelHub.tsx`, `client/src/components/model-hub/ModelHubPanel.tsx`, `client/src/components/model-hub/UnslothPanel.tsx`, `client/src/components/model-hub/KaggleTrainingCard.tsx`, `client/src/components/model-hub/ValetRouterPanel.tsx`
- **Router**: `server/routers/ollamaRouter.ts` → `trpc.ollama.*`; `server/routers/modelManagementRouter.ts` → `trpc.modelManagement.*`; `server/routers/trainingRouter.ts` → `trpc.training.*`; `server/routers/valetRouter.ts` → `trpc.valet.*`
- **Storage**: `models/` directory (GGUF, EXL2 weight files — gitignored); `models/valet-router/current.json` (registry — seeded from repo on first boot by `ValetArtifactRegistry.ts`)
- **Background Jobs**: `ValetServerService.ts` (auto-starts Valet inference server on port 8010 — `valet_router_inference.py`; seeds registry on boot; 45 s cold-load timeout); `ModelMarketplaceService.ts` (curated model sync); `AsyncJobService.ts` (training job tracking); `valet_pipeline.py` (orchestrator for full training run)
- **Dependencies**: Ollama HTTP API (`OLLAMA_URL`), `ollama_proxy.py` (proxy bridge), `llamacpp_bridge.py` (warm model cache — `_gen_cache`/`_emb_cache` keyed by path, `/load` `/unload` `/loaded` endpoints), `valet_router_inference.py` (Qwen2.5-1.5B-Instruct Q8_0 GGUF; Ollama backend `omnecor-valet-router:v2-q8`), `valet_dataset_builder.py`, `valet_pipeline.py`, `valet_eval.py`
- **Settings**: Settings → API → Local AI section (Ollama URL, llama.cpp path); SetupWizard → Dependency Checklist (Ollama detected/install); ModelHub → Quantization selector (GGUF / EXL2)
- **API**: `trpc.ollama.pullModel`, `trpc.ollama.listModels`, `trpc.ollama.deleteModel`, `trpc.ollama.getModelInfo`, `trpc.modelManagement.register`, `trpc.modelManagement.list`, `trpc.training.startTraining`, `trpc.training.stopTraining`, `trpc.training.status`, `trpc.training.saveKaggleKey`, `trpc.training.startKaggleTraining`, `trpc.training.kaggleJobStatus`, `trpc.training.pullKaggleArtifact`, `trpc.valet.status`, `trpc.valet.testRoute`, `trpc.valet.getModes`

---

## Agent Orchestration (CrewAI / LiteAgent / n8n / Pipelines)

- **Frontend**: `client/src/pages/Pipelines.tsx`, `client/src/components/pipeline/PhaseOutputPanel.tsx`, `client/src/components/agent/RecursiveMASPanel.tsx`, `client/src/components/HITLAlertPanel.tsx`
- **Router**: `server/routers/agentRouter.ts` → `trpc.agent.*`; `server/routers/pipelineRouter.ts` → `trpc.pipeline.*`; `server/routers/hitlRouter.ts` → `trpc.hitl.*`; `server/routers/workflowRouter.ts` → `trpc.workflow.*`
- **Storage**: `pipelines` table (status enum: pending/running/paused/complete/aborted; currentPhase: DEFINE/PLAN/EXECUTE/REVIEW/SHIP/DONE), `pipeline_phases` table (status: pending/awaiting_approval/approved/rejected/complete; inputText, outputText, approvedBy)
- **Background Jobs**: `PipelineEngineService.ts` (async `generatePhaseOutput()` → Ollama `llama3.2:latest`, 800 tok, temp 0.3, phase-specific system prompts; falls back to static string if Ollama unreachable); `AgentService.ts` (spawns `crewai_bridge.py` / `liteagent_bridge.py` as child processes; `step_callback` guarded for older crewai versions; `liteagent_bridge.py` = ReAct-style loop up to 8 iterations); `HITLApprovalService.ts` (gates dangerous actions); `HashTrackerService.ts` (loop prevention)
- **Dependencies**: `crewai_bridge.py` (crewai Agent+Task+Crew + Ollama fallback), `liteagent_bridge.py` (ReAct single-agent loop via Ollama, up to 8 iter, detects "Final Answer:"), `recursive_mas_bridge.py` (multi-agent system with per-agent ChromaDB isolation), n8n webhook integration
- **Settings**: HITL gates enabled globally; max crew size 3 before HITL; `HITL_GATES` config
- **API**: `trpc.agent.runCrew`, `trpc.agent.runLiteAgent`, `trpc.agent.triggerN8n`, `trpc.agent.approveAction`, `trpc.agent.rejectAction`, `trpc.pipeline.createPipeline`, `trpc.pipeline.approvePhase`, `trpc.pipeline.rejectPhase`, `trpc.pipeline.list`, `trpc.hitl.getPending`, `trpc.hitl.resolve`

---

## Integrations Manager (OAuth / MCP / External Services)

- **Frontend**: `client/src/pages/Integrations.tsx`, `client/src/components/integrations/*` (category sheets — connected vs available services), `client/src/pages/Settings.tsx` → Accounts → Service Connections card
- **Router**: `server/routers/integrationsRouter.ts` → `trpc.integrations.*`; `server/routers/integrationManagementRouter.ts` → `trpc.integrationManagement.*`; `server/routers/oauthRouter.ts` → `trpc.oauth.*`; `server/routers/mcpRouter.ts` → `trpc.mcp.*`
- **Storage**: `integrations` table (provider, accessToken/refreshToken — AES-256-GCM encrypted, `tokenIv`, `tokenTag`, expiresAt); `~/.omnecor/integrations.json` (encrypted secrets at rest); `~/.omnecor/settings.json` (OAuth client IDs/secrets — per-call resolution via `SettingsService.getSecret()`)
- **Background Jobs**: `IntegrationManagementService.ts` (health checks, token refresh via real `refresh_token` grant, expiry tracking, mtime-cached settings); `TokenRefreshService.ts`; `oauthClients.ts` (per-call credential resolution — NOT cached at module load)
- **Dependencies**: `simple-oauth2`, platform OAuth SDKs; `@modelcontextprotocol/sdk` (MCP stdio + Streamable HTTP transport); Express OAuth callback handler (`GET /api/oauth/callback/:platform`)
- **Settings**: Settings → Accounts → Service Connections; SetupWizard → Integration Keys step; OAuth redirect URI = `PUBLIC_URL` or `http://localhost:${PORT}` (desktop PORT=37291)
- **API**: `trpc.integrations.list`, `trpc.integrations.connect`, `trpc.integrations.disconnect`, `trpc.integrationManagement.getStatus`, `trpc.integrationManagement.refreshToken`, `trpc.oauth.getAuthorizationUrl`, `trpc.oauth.handleCallback`, `trpc.mcp.connectServer` (adminProcedure), `trpc.mcp.listTools`, `trpc.mcp.callTool` (HITL on `dangerous:true`)

---

## Notifications & Agent Messenger

- **Frontend**: `client/src/pages/Notifications.tsx`, `client/src/components/notifications/useNotifications.ts`
- **Router**: `server/routers/notificationRouter.ts` → `trpc.notifications.*`; `server/routers/agentMessengerRouter.ts` → `trpc.agentMessenger.*`
- **Storage**: `NotificationService` in-memory ring buffer + EventEmitter; `AgentMessengerStore` in-memory per-persona thread store
- **Background Jobs**: `NotificationService` (WS broadcast on `notifications` channel for HITL/job/budget/chat alerts); `AiProviderService` (budget alerts); WS `actionPending` channel (HITL events to mobile APK)
- **Dependencies**: WS pub/sub (built on Node.js `EventEmitter`)
- **Settings**: N/A (real-time only)
- **API**: `trpc.notifications.list`, `trpc.notifications.markRead`, `trpc.notifications.clear`, `trpc.agentMessenger.send`, `trpc.agentMessenger.getThread`, `trpc.agentMessenger.list`

---

## System Health & Setup Wizard

- **Frontend**: `client/src/pages/SetupWizard.tsx` (8-step wizard — 9th `checklist` step added 2026-06-19), `client/src/pages/Dashboard.tsx` (System Monitor — CPU/RAM/VRAM progress bars, hardware pollers), `client/src/components/system/UpdateBanner.tsx`
- **Router**: `server/_core/systemRouter.ts` → `trpc.system.*`
- **Storage**: `users` table (executionMode), `~/.omnecor/settings.json` (all settings), `~/.omnecor/data/omnecor.db` (SQLite DB path)
- **Background Jobs**: `startTelemetryPush()` in `WebSocketServer.ts` (2 s CPU/RAM/VRAM broadcast via `os.cpus()` delta + `nvidia-smi` 5 s cache); `UpdateCheckerService.ts`; `detect_gpu.py` (hardware scan)
- **Dependencies**: `detect_gpu.py`, `nvidia-smi` CLI, `bonjour`, all Python bridge health checks
- **Settings**: All settings live here
- **API**: `trpc.system.health`, `trpc.system.getSettings`, `trpc.system.saveSettings`, `trpc.system.saveKeys`, `trpc.system.detectHardware`, `trpc.system.checkDependencies` (protectedProcedure — probes Ollama, Python 3.10+, llama-cpp, Blender, KiCad, esptool, Whisper, TTS, ComfyUI in parallel), `trpc.system.installOllama` (adminProcedure — platform-aware installer), `trpc.system.integrationsStatus`, `trpc.system.applyOptimizations`

---

## Security & Audit Log

- **Frontend**: `client/src/components/security/ThreatDashboard.tsx`, `client/src/components/security/AuditRetentionPanel.tsx` (Settings → Security)
- **Router**: `server/routers/securityRouter.ts` → `trpc.security.*`; `server/routers/auditRouter.ts` → `trpc.audit.*` (adminProcedure)
- **Storage**: `audit_log` table (append-only — `eventType`, `actorId`, `actorType`, `procedure`, `args`/`result` JSON, `ipAddress`; 14-day default retention, 6 h purge sweep)
- **Background Jobs**: `AuditLogService.ts` (`startRetentionScheduler` — 6 h sweep; `getRetentionDays`/`setRetentionDays`/`purgeExpired`/`getStorageStats`); `SecurityService.ts` (AES-256-GCM encryption, YARA scanning, `auditMiddleware`); `threat_scanner.py` (YARA rules engine); `SettingsService.ts`
- **Dependencies**: `threat_scanner.py` (YARA), `validatePath` from `server/_core/security.ts` (all filesystem procedures), `PromptSanitizer.ts` (NFC normalization + null-byte removal + adversarial injection defense), `crypto.timingSafeEqual` (OMMESH secret comparison)
- **Settings**: Settings → Security (scan on upload, encryption enabled, API key encryption, malicious file scan toggle); `AuditRetentionPanel` (14/28/permanent retention options)
- **API**: `trpc.security.encryptFile`, `trpc.security.decryptFile`, `trpc.security.runVulnerabilityScan`, `trpc.security.backup`, `trpc.security.restore`, `trpc.audit.list`, `trpc.audit.listByActor`, `trpc.audit.getStats`, `trpc.audit.getRetention`, `trpc.audit.setRetention` (adminProcedure)

---

## Cloud Compute (Vast.ai / RunPod / Lambda Labs)

- **Frontend**: `client/src/components/cloud-compute/*` (embedded in Settings or Specialized Module Launcher)
- **Router**: `server/routers/cloudComputeRouter.ts` → `trpc.cloudCompute.*` (cloudProcedure — blocked in Sovereign mode)
- **Storage**: `cloud_compute_sessions` table, `cloud_compute_subscriptions` table
- **Background Jobs**: `AsyncJobService.ts` (session lifecycle tracking)
- **Dependencies**: Vast.ai API, RunPod API, Lambda Labs API (all cloudProcedure)
- **Settings**: Settings → Cloud Compute (API keys per provider)
- **API**: `trpc.cloudCompute.listPlans`, `trpc.cloudCompute.startSession`, `trpc.cloudCompute.stopSession`, `trpc.cloudCompute.getStatus`, `trpc.cloudCompute.listSessions`, `trpc.cloudCompute.listSubscriptions`

---

## Knowledge Base & Vector Memory

- **Frontend**: `client/src/pages/Settings.tsx` → Knowledge Base tab (root folder, file filters, auto-index toggle, clear index button), `client/src/components/neural/NeuralGraphView.tsx` (semantic search → node highlight), `client/src/components/chat/VisualContextMap.tsx` (file drag-to-context)
- **Router**: `server/routers/knowledgeBase.ts` → namespace `trpc.knowledgeBase.*`
- **Storage**: ChromaDB (vector store on disk) — `MemoryArchitectService.ts` manages collections; `ONNXEmbeddingService.ts` generates BPE embeddings via `@anthropic-ai/tokenizer` (o200k_base / cl100k_base); per-agent isolated collections for `recursive_mas_bridge.py`
- **Background Jobs**: `FileSystemWatcherService.ts` (chokidar — watches indexed root, re-ingests changed files, debounce 2 s); `MemoryArchitectService.ts` (auto-summarization after 50 chat turns — episodic memory); `VectorDBService.ts` (ChromaDB HTTP client wrapper — dedup by content hash before insert)
- **Dependencies**: `chromadb` npm SDK, `@anthropic-ai/tokenizer` (real BPE — replaced whitespace pseudo-tokenizer in F11), `ONNXEmbeddingService.ts` (`onnxruntime-node`, `asarUnpack`'d in Electron), `chokidar`
- **Settings**: Settings → Knowledge Base (root folder path, max file size MB, allowed extensions, auto-index on file change); SetupWizard → Knowledge step
- **API**: `trpc.knowledgeBase.setRootPath`, `trpc.knowledgeBase.ingestDirectory`, `trpc.knowledgeBase.search`, `trpc.knowledgeBase.deleteCollection`, `trpc.knowledgeBase.listCollections`, `trpc.knowledgeBase.getStatus`

---

## Image Generation (Unified — ComfyUI / Fal.ai / OpenArt)

- **Frontend**: `client/src/components/image-gen/ImageGeneratorPanel.tsx` (embedded in Chat right pane and 3D Designer); provider selector (local ComfyUI / fal.ai / OpenArt); prompt + dimensions (64–2048 px); generated image gallery
- **Router**: `server/routers/imageGenRouter.ts` → namespace `trpc.imageGen.*`; `server/routers/falRouter.ts` → namespace `trpc.fal.*`; `server/routers/comfyRouter.ts` → namespace `trpc.comfy.*`
- **Storage**: `falRouter` in-process image gallery — `GeneratedImage[]` ring buffer (cap 100; oldest evicted first; process-lifetime only — not persisted to SQLite); ComfyUI results returned inline
- **Background Jobs**: `FalApiService.ts` (HTTP client to fal.ai cloud API — `cloudProcedure`); `OpenArtService.ts` (HTTP client to OpenArt API — `cloudProcedure`); `ComfyService.ts` (HTTP client to local ComfyUI daemon at `COMFYUI_URL`); `fal_bridge.py` (Python subprocess alternative for fal.ai)
- **Dependencies**: `fal_bridge.py`, `ComfyService.ts`, `OpenArtService.ts`, `FAL_KEY` env var
- **Settings**: Settings → API → fal.ai key; Settings → Local Endpoints → ComfyUI URL (`COMFYUI_URL`); SetupWizard Checklist → ComfyUI detected badge
- **API**: `trpc.imageGen.providers` (capability flags — local/fal/openart), `trpc.imageGen.generate` (unified — routes by provider enum), `trpc.fal.generateImage` (cloudProcedure), `trpc.fal.generateCharacter` (cloudProcedure — Flux + optional LoRA path), `trpc.fal.generateVideo` (cloudProcedure — MiniMax Subject Reference video clone), `trpc.fal.listImages` (process-lifetime gallery), `trpc.comfy.queuePrompt`, `trpc.comfy.getQueue`, `trpc.comfy.getSystemStats`, `trpc.comfy.interrupt`, `trpc.comfy.clearQueue`

---

## Background Jobs (Process Manager)

- **Frontend**: `client/src/pages/Dashboard.tsx` (running jobs list, cancel button), `packaging/android/omnecor-hq/app/(tabs)/status.tsx` (PC Tasks panel — list + cancel)
- **Router**: `server/routers/jobRouter.ts` → namespace `trpc.jobs.*`
- **Storage**: `ProcessManagerService.ts` in-memory job map (UUID → `JobStatus`); `AsyncJobService.ts` per-job tracking (userId + conversationId for result routing back into chat); no SQLite table — state is process-lifetime
- **Background Jobs**: `ProcessManagerService.ts` (spawns child processes for LoRA training / Blender renders / ESP flash / custom agent commands; SIGTERM → SIGKILL on cancel; `captureMode: raw` — no stdout line limit); `AsyncJobService.ts` (`JobResultCondenser.ts` — summarizes long stdout before injecting into next chat turn); `DockerService.ts` (sandboxed command execution via `docker run --rm`)
- **Dependencies**: `ProcessManagerService.ts`, `AsyncJobService.ts`, `JobResultCondenser.ts`, `DockerService.ts`
- **Settings**: N/A — jobs are spawned programmatically; `adminProcedure` gates `runSandboxCommand` and `prune`
- **API**: `trpc.jobs.getStatus` (UUID lookup), `trpc.jobs.startAsync` (HITL-gated + `validatePath` on cwd; args as discrete array — no shell string), `trpc.jobs.list` (filterable by type: lora_training / blender / esp_flash / custom; by state: queued / running / completed / failed / cancelled), `trpc.jobs.cancel` (SIGTERM + SIGKILL), `trpc.jobs.runSandboxCommand` (adminProcedure — Docker sandboxed), `trpc.jobs.prune` (adminProcedure — keep last N completed)

---

## Honcho Long-Term Memory

- **Frontend**: `/btw` command in `client/src/pages/Chat.tsx` chat input (stores a persistent fact); facts injected into system prompt on session start
- **Router**: `server/routers/honchoRouter.ts` → namespace `trpc.honcho.*` — all procedures `publicProcedure` (zero-login mode compatible; `openId` ownership validated server-side via `assertOpenIdOwnership()` to prevent session A reading session B's memory)
- **Storage**: Honcho AI cloud service (external — `HONCHO_API_KEY`); `HonchoService.ts` in-memory noop when key absent
- **Background Jobs**: None — synchronous per-message sync (`addMessage`) and per-command fact storage (`addFact`)
- **Dependencies**: `honcho-ai` npm SDK, `HONCHO_API_KEY` env var; degrades gracefully (noop) without key
- **Settings**: Settings → API → Honcho API Key field; all procedures degrade with `{ ok: true }` when key absent
- **API**: `trpc.honcho.addMessage` (publicProcedure — sync one message to Honcho session; max content 200 000 chars), `trpc.honcho.addFact` (publicProcedure — persist `/btw` note as long-term fact; max 2000 chars), `trpc.honcho.getFacts` (publicProcedure — retrieve up to 50 recent facts to inject into system prompt)

---

## Mobile Chat Sync

- **Frontend**: `client/src/pages/Notifications.tsx` ("Mobile Chats" tab — lists synced conversations with device name, title, message count, auto-link status; "Add to project" action); `packaging/android/omnecor-hq/app/(tabs)/index.tsx` (APK side — push on session end or explicit sync button)
- **Router**: `server/routers/mobileSyncRouter.ts` → namespace `trpc.mobileSync.*`
- **Storage**: In-memory ring buffer (`SyncedChat[]`, cap 250, oldest evicted; idempotent by `mobileSessionId`) — process-lifetime, mirrors `NotificationService`/HITL pattern. When "Add to project" is invoked, `createChatSession` + `addChatMessage` materialize the conversation as a real `chat_sessions` / `chat_messages` row (fully durable).
- **Background Jobs**: `detectLink()` — auto-links unassigned chats by matching conversation text against active `FileSystemWatcherService` project names and `neuralMaps` names (best-effort; wrapped in try/catch); `NotificationService.getInstance().notify()` emits `mobile-chat` notification to desktop Notifications feed on every push
- **Dependencies**: `NotificationService`, `FileSystemWatcherService`, `db.factory.ts` (`createChatSession`, `addChatMessage`), `neuralMaps` schema
- **Settings**: N/A — triggered from APK; PC always listens
- **API**: `trpc.mobileSync.push` (protectedProcedure — idempotent push; returns `{syncId, needsProject, autoLinked, projectId, neuralMapId}`), `trpc.mobileSync.list` (protectedProcedure — newest-first ring buffer), `trpc.mobileSync.addToProject` (protectedProcedure — materializes synced chat into `chat_sessions`; returns `{sessionId, projectId}`)

---

## Mobile APK (Omnecor HQ — Android)

- **Frontend**: `packaging/android/omnecor-hq/app/(tabs)/` — `index.tsx` (Chat), `viewer.tsx` (3D Viewer — interactive Three.js WebView, orbit/pinch/tap-select, GLB model picker, AI/Analyze/Modify/Export action bar), `podcast.tsx`, `settings.tsx` (7 sections), `notifications.tsx` (HITL merged), `status.tsx`, `ai-node.tsx`, `terminal.tsx`
- **Router**: All tRPC procedures shared with desktop — `ai.chat`, `neuralMaps.list`, `personas.list`, `podcast.generate`, `blender.*`, `hitl.*`, `jobs.*`; WS: `mobile_node_register`, `mobile_node_heartbeat`, `mobile_inference_request`, `mobile_inference_response`
- **Storage**: `expo-secure-store` (Android KeyStore) for `omnecor_ommesh_secret` + JWT session token; AES-256-CBC + HMAC-SHA256 envelope encryption for chat histories in AsyncStorage (via `secure-crypto.ts`); `chat-store.ts` (session persistence)
- **Background Jobs**: `MicForegroundService` (Kotlin — `FOREGROUND_SERVICE_TYPE_MICROPHONE`, `START_STICKY`); `always-listen.ts` (Porcupine wake-word → whisper.rn on-device STT → agentMessenger); `use-always-listen.ts` (headless capture provider mounted at `app/_layout.tsx`); `mobile-mesh-node.ts` (OMMESH registration + heartbeat 10 s)
- **Dependencies**: `llama.rn ^0.9.0` (on-device GGUF inference — Vulkan/NNAPI), `@picovoice/porcupine-react-native` (wake-word detection — "COMPUTER" built-in fallback), `whisper.rn` (on-device STT), `expo-speech` (Android TTS), `expo-audio`, `expo-secure-store`, `crypto-js ^4.2.0` (envelope encryption), `nanoid` (Metro intercept → `index.browser.js`), `react-native-get-random-values` (CSPRNG)
- **Settings**: APK Settings → 7 sections (Omnecor Server, OMMESH Network, Voice, Phone AI Model, Execution Mode, Appearance, About/Auth)
- **API**: All via tRPC to desktop host; STT via direct `POST :8001/transcribe`; WS via `?token=` query param (cookies not supported in RN WebSockets)
