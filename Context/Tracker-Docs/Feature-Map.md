# Feature Ownership Map

*An architectural cross-reference mapping every major feature to its exact surface area across the entire stack (frontend components, routers, storage tables, background jobs, dependencies, settings, API namespace). Last audited: 2026-07-10 (Model-Fabric **Phase 8** — local GGUF auto-discovery + hot-swap — added; prior 2026-07-08: Chats-Agentic-Upgrade Phases 1–6, Model-Fabric Phases 0–7, Mesh-Delegation Phases 1–9). Source of truth: `server/routers.ts`, `drizzle/schema.ts`, `client/src/App.tsx`.*

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

- **Frontend**: `client/src/pages/Chat.tsx`, `client/src/components/chat/ChatInput.tsx` (with FIFO queue chips + `enableQueue` prop), `client/src/components/ChatInterface.tsx` (`layout: "stream" | "bubble"` prop), `client/src/components/chat/AssistantBubble.tsx` (bubble layout fallback), `client/src/components/chat/agentic/AssistantStream.tsx` (guide-line stream layout), `client/src/components/chat/agentic/AgenticBlocks.tsx` (`StatusDot`, `CommandBox`, `EditBox`, `JobBox`, `McpBox`, `SubAgentBox`, `ApprovalRow`, `DiffView`), `client/src/components/chat/agentic/ThinkingSection.tsx`, `client/src/components/chat/ConversationList.tsx` (Network badge for delegated chats), `client/src/components/LivePreviewPanel.tsx`, `client/src/components/VisualContextMap.tsx`
- **Router**: `server/routers/aiRouter.ts` → `trpc.ai.*`; `server/routers/chatRouter.ts` → `trpc.chat.*`; `server/routers/attachmentsRouter.ts` → `trpc.attachments.*`; `server/routers/agentMessengerRouter.ts` → `trpc.agentMessenger.*`; `server/routers/delegationRouter.ts` → `trpc.delegation.*` (stream, sendTurn, cancel, status)
- **Storage**: `chat_sessions` table (gains `taskId`, `targetNodeId`, `parentConversationId` columns for delegated chats), `chat_messages` table (gains `blocks?: AssistantBlock[]` JSON column), `saved_scripts` table
- **Background Jobs**: `ChatAgentRunner` (`server/core_services/services/ChatAgentRunner.ts` — streaming typed-event tool loop; `edit_file` / `run_command` / `start_job` / MCP; `ToolApprovalRegistry` HITL broker; `MAX_TURNS=8`); `MemoryArchitectService` (auto-summarization + map RAG retrieval); `HashTrackerService` (action-hash loop detection); `AiProviderService` (spend tracking)
- **Dependencies**: `ai` SDK / provider SDKs, Ollama HTTP client, `@anthropic-ai/tokenizer`, `honcho-ai`, `js-tiktoken@1.0.21`, `xterm.js`, `diff` (structuredPatch for hunk-only DiffView), `@radix-ui/react-dialog` (block overlays)
- **Settings**: Settings → API; SetupWizard → provider step; execution mode badge; chat-header auto-approve toggle (`chatDisplaySettings.autoApproveTools`)
- **API**: `trpc.ai.chat`, `trpc.aiProvider.agentChatStream` (protectedProcedure subscription — typed `AgentStreamEvent[]`), `trpc.aiProvider.resolveToolApproval` (ownership-checked mutation), `trpc.aiProvider.runCodeSnippet`, `trpc.aiProvider.catalog` (unified model catalog), `trpc.ai.chatStream`, `trpc.ai.summarizeAndPruneSession`, `trpc.ai.reportLoopViolation`, `trpc.chat.list`, `trpc.chat.create`, `trpc.chat.delete`, `trpc.scripts.*`, `trpc.delegation.stream`, `trpc.delegation.sendTurn`, `trpc.delegation.cancel`, `trpc.delegation.status`

---

## OMMESH Distributed Intelligence

- **Frontend**: `client/src/pages/AgentNetworking.tsx` (Mesh Compute UI panel), `client/src/components/mesh/MeshTopologyGraph.tsx` (ForceGraph2D live mesh rendering — local node blue glow, trusted peers green, pending-approval red; dashed edges for unapproved)
- **Router**: `server/routers/ommesh.router.ts` → namespace `trpc.ommesh.*`; `server/ommesh/core/MeshNode.ts`; `server/ommesh/core/MeshServer.ts` (mTLS HTTPS inference + subagent listener on `MESH_PORT` 3001 — routes: `/inference`, `/sync`, `/discourse`, `/models` (beacon-minimal catalog), `/subagent` (delegation host), `/health`)
- **Storage**: No dedicated SQLite table — state held in `MeshDiscoveryService` in-memory nodes map. Peer authorization keys written to `data/certs/` directory. Node identity tracked via `SecurityManager.ts`. `NodeCapabilities.models[]` populated by `ModelCatalogService.collectLocalOnly()` (Omnecor runtime + optional Ollama only; excludes mesh-peer/cloud to prevent re-advertising).
- **Background Jobs**: `MeshDiscoveryService` (bonjour mDNS advertisement with beacon-minimal TXT — `modelsHash` only, models excluded; browser; emits `nodeDiscovered`/`nodeLost` events); `MeshNode.refreshModelCatalog()` (populates `NodeCapabilities.models` from `collectLocalOnly()` at start + every 30 s, re-advertises on hash change); `WebSocketServer.ts` (mobile node registration handlers); `startTelemetryPush()` (2 s CPU/RAM/GPU broadcast)
- **Dependencies**: `bonjour` (mDNS, static import required), `@forge-ai/node` (mTLS cert generation), `react-force-graph ^1.48.2` (topology canvas), `AiProviderService`
- **Settings**: Settings → OMMESH tab; AgentNetworking → OMMESH Trust panel
- **API**: `trpc.ommesh.discover`, `trpc.ommesh.routeInference`, `trpc.ommesh.getIdentity`, `trpc.ommesh.rotateCert` (adminProcedure), `trpc.ommesh.approvePeer` (adminProcedure); mesh endpoints: `GET /models` (fetch peer model list, pinned-peer gated, returns `{models: NodeCapabilities.models[]}`), `POST /subagent` / `GET /subagent/:id/stream` / `POST /subagent/:id/approval` / `POST /subagent/:id/cancel` (delegation host, pinned-peer gated)
- **Tests**: `ommeshRouter.test.ts` (13 — mesh control + admin gates); `meshServerModels.test.ts` (5 — **first-ever** `MeshServer.handleRequest` tests: `/models` trust gate + pre-trust `/health`); `meshServerSubAgent.test.ts` (5 — **first-ever** `MeshServer` subagent route tests); `meshNodeModelCatalog.test.ts` (5 — **first-ever** `MeshNode` tests: catalog mapping, fail-safe, hash/GPU re-advertise gating); `discoveryService.test.ts` (+8 — beacon-minimal TXT shape + fetch-on-hash-change + peer-trusted-event retry + RFC 6763 255-byte limit verified at 500 models)

---

## 3D Designer / PCB & Schematic Editor

- **Frontend**: `client/src/pages/3DDesigner.tsx`, `client/src/components/designer/ThreeViewer.tsx` (GLTF/GLB/OBJ + primitives, raycast selection), `client/src/components/designer/SchematicEditor.tsx` (ReactFlow PCB aesthetic), `client/src/components/pcb/EnhancedPCBEditor.tsx` (full-persistence PCB editor — auto-save debounce 1.5 s, auto-create Default Design; uses module-level `EMPTY_PROJECTS` + Zustand selectors to prevent first-boot infinite render loop — see TD-046), `client/src/components/pcb/PCBSchematicEditor.tsx`, `client/src/components/pcb/ComponentLibraryPanel.tsx` (49 components across 9 categories), `client/src/components/pcb/AIAssistantPanel.tsx`, `client/src/components/pcb/PCBViewer3D.tsx`, `client/src/components/pcb/SchematicNode.tsx` (backward-compat: resolves string component IDs from `componentLibrary` for designs saved before 2026-06-28), `client/src/components/pcb/PCBNode.tsx` (same backward-compat guard), `client/src/components/WebPreview.tsx`, `client/src/lib/componentLibrary.ts`
- **Router**: `server/routers/blenderRouter.ts` → `trpc.blender.*`; `server/routers/kicadRouter.ts` → `trpc.kicad.*`; `server/routers/pcbEditorRouter.ts` → `trpc.pcbEditor.*`; `server/routers/espRouter.ts` → `trpc.esp.*`
- **Storage**: `design_projects` table, `design_saves` table, `design_exports` table, `ai_design_reviews` table, `component_library_items` table (all in SQLite via `server/db-pcb.ts`)
- **Background Jobs**: `BlenderService.ts` (headless render, glTF export, Python subprocess), `KiCadService.ts` (DRC/ERC, STEP/Gerber export, BOM), `ESPToolService.ts` (serial port detection, firmware flash), `PCBWayService.ts` (quoting + ordering — HITL-gated)
- **Dependencies**: `react-three-fiber`, `@react-three/drei` (3D canvas), `@xyflow/react` (schematic/PCB node graph), `three`, `three/examples/jsm/loaders` (GLTFLoader, OBJLoader), `blender_bridge.py`, `kicad_bridge.py`, `esptool_bridge.py`
- **Settings**: Settings → Advanced → Blender path, KiCad CLI path, ESPTool path; SetupWizard → Dependency Checklist step
- **API**: `trpc.blender.render`, `trpc.blender.export`, `trpc.blender.listModels`, `trpc.kicad.runDrc`, `trpc.kicad.exportStep`, `trpc.kicad.exportGerber`, `trpc.kicad.generateBom`, `trpc.pcbEditor.createProject`, `trpc.pcbEditor.saveDesign`, `trpc.pcbEditor.loadDesign`, `trpc.pcbEditor.deleteProject`, `trpc.pcbEditor.reviewDesign`, `trpc.pcbEditor.exportDesign`, `trpc.esp.detectPorts`, `trpc.esp.flash`

---

## Blueprint Studio (AI-Assisted Fabrication Planning)

- **Frontend**: `client/src/pages/BlueprintStudio.tsx` (plans rail → agentic planning conversation → Build Plan document tabs; reuses `AssistantStream` + `ModelSelector` from chat), `client/src/components/blueprint/PlanTabs.tsx` (Overview / BOM / Cut List / Drawings / 3D / Patterns / Simulation / Steps / Files — BOM + cut list hand-editable, drawings rendered inline, Export PDF), `client/src/components/blueprint/BlueprintMeshViewer.tsx` (r3f viewer for compiled `MeshJson` parts + FEA von-Mises heatmap overlay with tet-surface extraction; lazy via `LazyPreviewPane`)
- **Router**: `server/routers/blueprintRouter.ts` → `trpc.blueprint.*` (plan CRUD map-scoped to the active Neural Map, `agentStream` subscription, conversation persistence, manual BOM/cut editing, file access by id, materials catalog, concept renders, engine status, plan-PDF export)
- **Agent**: `ChatAgentRunner` extended with **injectable `ExtraAgentTool[]`** (`extraTools` + `includeBuiltInTools:false` on `AgentRunParams`; dispatched before the MCP fallthrough, rendered as `mcp` blocks with `server:"feature"`). Blueprint toolset (`server/core_services/blueprint/blueprintAgentTools.ts`): `list_materials`, `engineering_calc`, `optimize_cuts`, `update_plan`, `set_bom`, `set_cut_list`, `compile_cad`, `generate_pattern`, `run_fea`, `generate_concept_image`, `search_materials_web` (omitted for sovereign users). System prompt embeds a live plan snapshot + hard rule: structural numbers only from tools, never model mental math.
- **Engineering core**: `calcEngine.ts` (pure TS, SI-metric mm/N/MPa: section properties, beam bending/deflection, Euler buckling, fastener groups, rafter/stair/compound-miter/triangle geometry, 1D FFD + 2D shelf nesting, fabric yardage; every result returns `workings` + safety factor with basis-aware required SF), `materialsCatalog.ts` (~50 offline materials with real mechanical properties: NDS lumber design values, ASTM metals, filament datasheets, fabrics/foams/thermoplastics)
- **CAD**: `BlueprintCadService.ts` — dual engine: **JSCAD** (`@jscad/modeling`, in-process `node:vm` sandbox, zero-install default) + **OpenSCAD** (optional external binary, `openscadPath` setting, `--version` detection, spawn → STL). Both → `MeshJson` (mm), binary STL, dimensioned three-view drawing SVG (`drawingSvg.ts` — feature-edge extraction + orthographic projection + title block), minimal R12 DXF; artifacts under `resolveDataPath("blueprints")/<planId>/`
- **Patterns**: `patternPdf.ts` — true-scale tiled US-Letter pattern PDFs (seam-allowance polygon offset, calibration square, registration crosses, A1/B2 glue grid, cut vs stitch lines, grainline arrows) via pdfkit
- **FEA**: `server/python_bridges/fea_bridge.py` (Gmsh STL tet-meshing + TET4 linear-static elasticity in numpy/scipy — consistent mm-N-MPa; von Mises per node) + `BlueprintFeaService.ts` (availability probe with `pip install gmsh numpy scipy` hint, temp-file I/O, 10-min cap); field JSON drives the client heatmap
- **Storage**: `blueprint_plans`, `blueprint_bom_items`, `blueprint_cut_items`, `blueprint_files`, `blueprint_sim_results`, `blueprint_messages` (migration `0016`; FK cascade; dimensions stored canonically in mm, displayed per plan `units`)
- **Exports**: `planPdf.ts` — full Build Plan PDF booklet (cover + concept renders, BOM w/ cost rollup, cut list, embedded vector drawings via svg-to-pdfkit, assembly steps, verification workings, safety disclaimer; WinAnsi transliteration for Greek/math symbols). pdfkit/svg-to-pdfkit are esbuild `external` (they need real `__dirname` for font data)
- **Sovereign**: fully functional offline — JSCAD + materials DB + calc engine + local models; cloud gated per-provider (`assertProviderAllowedInMode`), web search tool omitted, cloud image providers blocked
- **API**: `trpc.blueprint.list/create/get/update/delete`, `trpc.blueprint.agentStream` (agentsRun capability), `trpc.blueprint.listMessages/appendMessage`, `trpc.blueprint.upsertBomItem/deleteBomItem/upsertCutItem/deleteCutItem`, `trpc.blueprint.getFile/deleteFile`, `trpc.blueprint.materials.categories/search`, `trpc.blueprint.generateConcept`, `trpc.blueprint.engineStatus`, `trpc.blueprint.exportPdf`
- **Tests**: `blueprintCalcEngine.test.ts` (23 — textbook golden values incl. PL³/48EI, Euler, compound-miter anchors, nesting overlap checks), `blueprintCadService.test.ts` (18 — JSCAD compile/booleans/sandbox isolation, STL round-trip, cube feature edges = 12, drawing/DXF content, pattern offset + PDF, extraTools prompt rendering), `blueprintRouter.test.ts` (15 — ownership isolation on every endpoint, cascade delete, agent toolset against the real in-memory DB, sovereign tool gating)
- **Live-verified 2026-07-13**: real Gemini agent turn ran `list_materials` → `engineering_calc` (SF 12.54 PASS) → `set_bom`/`set_cut_list`; `compile_cad` produced mesh/STL/drawing/DXF; plan PDF exported clean

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
- **Dependencies**: Omnecor's managed `llama-server` runtime (`LocalLlmRuntimeService` — hot-swap + per-model VRAM-fit; the primary local-inference path, Ollama-independent); optional Ollama HTTP API (`OLLAMA_URL`) + `ollama_proxy.py` (used if present, never required); `valet_router_inference.py` (Qwen2.5-1.5B-Instruct Q8_0 GGUF; Ollama backend `omnecor-valet-router:v2-q8`), `valet_dataset_builder.py`, `valet_pipeline.py`, `valet_eval.py`
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

---

## Agentic Chat Stream (Chats-Agentic-Upgrade)

*Added 2026-07-04–07. Turns the main Omnecor chat (web + APK) from symmetric bubbles into a Claude-Code-style typed stream.*

- **Frontend**: `client/src/components/chat/agentic/AssistantStream.tsx` (guide-line container), `client/src/components/chat/agentic/AgenticBlocks.tsx` (`StatusDot`, `CommandBox`, `EditBox`, `JobBox`, `McpBox`, `SubAgentBox`, `ApprovalRow`, `DiffView` — Radix Dialog overlays, hunk-only diff), `client/src/components/chat/agentic/ThinkingSection.tsx` (collapsible, default-closed; `LoadingQuote` typewriter fallback), `client/src/lib/agentStream.ts` (pure `applyAgentEvent` / `applyJobCompletion` reducer), `client/src/lib/useCodeBlockActions.ts` (MutationObserver toolbar injector), `client/src/components/chat/LoadingQuote.tsx` (no-repeat shuffle bag). APK equivalents: `packaging/android/omnecor-hq/components/agentic/assistant-stream.tsx`, `agentic-blocks.tsx`
- **Shared contract**: `shared/chatBlocks.ts` (`AssistantBlock` union + `FileDiff` + helpers), `shared/chatAgentEvents.ts` (wire event shapes), `shared/subagent.ts` (delegation wire contract)
- **Router**: `server/routers/aiProviderRouter.ts` — `aiProvider.agentChatStream` (protectedProcedure subscription; per-provider `assertProviderAllowedInMode`), `aiProvider.resolveToolApproval` (mutation), `aiProvider.runCodeSnippet` (mutation)
- **Storage**: `chat_messages.blocks` (JSON column, `AssistantBlock[]` — source of truth for assistant rendering); `chat_messages.content` (flattened text, retained for persistence/copy/export); `messageQueue` Zustand slice (not persisted — FIFO, cleared on conversation switch)
- **Background Jobs**: `ChatAgentRunner` (streaming typed-event tool loop; `ToolApprovalRegistry` HITL broker; `ProcessManager.spawn` for run_command; `AsyncJobService` for start_job; `validatePath` for edit_file)
- **Dependencies**: `diff` (npm — `structuredPatch` for hunk-only diffs), `@radix-ui/react-dialog`, `shiki` (code highlighting + toolbar injection via MutationObserver)
- **Settings**: `chatDisplaySettings.autoApproveTools` (chat-header toggle, persisted to Zustand store); `layout: "stream" | "bubble"` prop on `ChatInterface` (main chat = stream, wrapper chats = bubble)
- **API**: `trpc.aiProvider.agentChatStream`, `trpc.aiProvider.resolveToolApproval`, `trpc.aiProvider.runCodeSnippet`

---

## Unified Model Catalog (Model-Fabric)

*Added 2026-07-07–08. Ollama decoupled; Omnecor-owned local runtime primary; one aggregated catalog for all sources. **Phase 8 (2026-07-10): local GGUF auto-discovery + hot-swap** — the runtime hosts every local GGUF (app models dir + Ollama blob store, read off disk so Ollama can be stopped), hot-swaps between them on selection, and fits each model's `--n-gpu-layers` to available VRAM.*

- **Frontend**: `client/src/components/chat/ModelSelector.tsx` (rewritten to source `trpc.aiProvider.catalog`; groups: Omnecor · This PC / Ollama · This PC / Omnecor · \<node\> / Cloud; curated via `getActiveModels()` for cloud slice; **Phase 8: "loading… → loaded" pending indicator** — selecting a cold local model fires `loadLocalModel`, drops `refetchInterval` to 2.5 s, and flips to a `bg-accent-success` "loaded" mark once the catalog's `loaded` flag confirms, with a ceiling so a failed load can't stick). Model Hub "Omnecor" tab (per-node self-hosted sections + `Self-hosted / Ready` card). APK: `packaging/android/omnecor-hq/lib/_core/ai-models.ts` (`listCatalogGroups()` — Phone / This PC / Mesh:\<node\> / Cloud; Phase-8 `loaded` flag mirrored in the type, picker UI indicator still TODO)
- **Shared types**: `shared/types/modelCatalog.ts` (`CatalogEntry` discriminated union; `describeCatalogHost()` single source of truth for brand + node derivation; mirrored in APK `lib/_core/model-catalog-types.ts`)
- **Server services**: `server/core_services/services/ModelIndexService.ts` (**Phase 8**, singleton — auto-discovers every GGUF from `PATHS.models` (skips `valet-router/`) **and** the Ollama blob store (parses `~/.ollama/models/manifests` → model-layer digest → `blobs/sha256-*`, reconstructs real names like `deepseek-r1:14b`); GGUF-magic (4-byte) gated; content-deduped by `size + sha256(first 64 KB)`, models-dir wins; async `fs/promises` scan, 30 s cache, synchronous non-blocking `list()`/`resolve()` with background refresh; works with Ollama **stopped** — blobs are just files); `server/core_services/services/LocalLlmRuntimeService.ts` (managed `llama-server` subprocess; auto-restart; `/apply-template` → `/completion` inference path; `LLAMA_SERVER_BIN` / `LOCAL_LLM_MODEL_PATH` / `LOCAL_LLM_GPU_LAYERS` env vars; **Phase 8: `ensureModelLoaded(idOrPath)` hot-swap** — stop current server, spawn requested model, all lifecycle work (boot load / hot-swap / crash respawn) funnelled through **one serialization queue** so nothing orphans a server on the port; per-model `_computeGpuLayers()` VRAM-fit via `collectGpuTelemetry()` (fits→all layers, else proportional partial offload — no OOM crash-loop for a 14B/27B on 8 GB); `getLoadedModelId()` / `isAvailable()`; last-model persisted to the `localLlmLastModel` setting → boot resumes it, else idle/load-on-select); `server/core_services/services/ModelCatalogService.ts` (4-source parallel aggregator: local runtime + Ollama + mesh peers + cloud; `getCatalog({isSovereign})` skips cloud when sovereign; `collectLocalOnly()` for mesh advertising; `hashModelList()` for beacon versioning; **Phase 8: lists *all* indexed models as `omnecor-runtime`** — the warm one flagged `loaded` (ready-gated: `isReady() ? getLoadedModelId() : null`, so a mid-swap/failed load isn't falsely flagged) — and **skips the live Ollama API source when the runtime is available**, since the index already covers the store (no double-listing))
- **Router**: `server/routers/aiProviderRouter.ts` — `aiProvider.catalog` (protectedProcedure; `isSovereign` flag gates cloud sources); **`aiProvider.loadLocalModel` (Phase 8** — non-blocking hot-swap trigger; fires `ensureModelLoaded()` fire-and-forget and returns `{started:true, modelId}` immediately, never rejects on a background load failure); `agentChatStream` gains `supportsNativeTools` + `targetNodeId` passthrough
- **Storage**: No new tables. `NodeCapabilities.models[]` (in-memory, populated by `MeshNode.refreshModelCatalog()` from `collectLocalOnly()` at boot + every 30 s)
- **Background Jobs**: `LocalLlmRuntimeService` (spawned at boot alongside ValetServerService; fire-and-forget, informational-only health entry `checks.localLlm`); `MeshNode.refreshModelCatalog()` (runs every 30 s telemetry tick + on `peer-trusted` event; re-advertises beacon when hash changes)
- **Dependencies**: `llama-server` (llama.cpp binary, external — auto-discovered via `LLAMA_SERVER_BIN` / PATH / common paths); Ollama (optional external HTTP daemon); `crypto` (Node built-in, `createHash("sha256")` for `hashModelList`)
- **Settings**: `LLAMA_SERVER_BIN`, `LOCAL_LLM_MODEL_PATH`, `LOCAL_LLM_GPU_LAYERS` env vars; `OLLAMA_URL` (optional); Model Hub → Omnecor tab → per-node model curation; chat ModelSelector → `getActiveModels()` cloud curation toggle
- **API**: `trpc.aiProvider.catalog`, `trpc.aiProvider.loadLocalModel` (Phase 8 — non-blocking hot-swap trigger), `GET /models` (mTLS mesh endpoint — returns `{models: CatalogEntry[]}` for a trusted peer), `GET /health` (gains `checks.localLlm` informational field)

---

## Mesh Sub-Agent Delegation (Mesh-Delegation)

*Added 2026-07-08. The main chat agent can delegate a full ChatAgentRunner loop to a trusted OMMESH peer.*

- **Frontend**: `client/src/components/chat/agentic/AgenticBlocks.tsx` — `SubAgentBox` chip (approve/deny inline + tap-through to managed chat); `client/src/pages/Chat.tsx` — `delegation.stream` live fold + between-turn input + cancel banner; `client/src/components/chat/ConversationList.tsx` — Network badge + node name for delegated chats; `delegationEvent` WS handler: invalidates list + shows toast. APK: `subagent` case in native `ToolChip`/`BlockDetail`/`assistant-stream.tsx`; `delegationEvent` materializes managed chat + node badge + header cancel
- **Shared contract**: `shared/subagent.ts` (turn request, sequenced NDJSON envelope wrapping `AgentStreamEvent`, control shapes, run-status enum, error codes, constants); `shared/chatBlocks.ts` — `subagent` `AssistantBlock` type + `ApprovableBlockType` extension
- **Server services**: `server/core_services/services/SubAgentHostService.ts` (peer-side: run registry, sandbox `validatePath`-enforced, concurrency cap + kill-switch, isolated `ToolApprovalRegistry`, `executionMode` enforcement, cursor-replay buffer, grace-window abort, `AsyncJobService` continuation); `server/core_services/services/DelegationService.ts` (origin-side: NDJSON stream consumer → persist turns → re-publish live → forward HITL + cancels → cursor re-attach → synthetic AsyncJob re-prompt)
- **Router**: `server/routers/delegationRouter.ts` (`trpc.delegation.stream`, `sendTurn`, `cancel`, `status`); `aiProvider.resolveToolApproval` forwards peer-owned approval IDs to the peer transparently; `agentChatStream` sets `allowDelegation` from active trusted peer set; WS `delegationEvent` lifecycle broadcast (started / turn-complete / done / failed)
- **Tool**: `delegate_task` (`ChatAgentRunner` built-in, origin-only) — offered only when `allowDelegation`; always HITL-gated (bypasses `autoApproveTools`); emits `subagent` block; ends parent turn on approved spawn (start_job semantics)
- **Mesh endpoints** (on `MeshServer`, pinned-peer trust gate): `POST /subagent` (spawn/follow-up turn, NDJSON with lazy headers), `GET /subagent/:id/stream?since=N` (cursor re-attach), `POST /subagent/:id/approval`, `POST /subagent/:id/cancel`
- **Storage**: `chat_sessions` (origin-owned delegated conversations: `taskId`, `targetNodeId`, `parentConversationId` columns); peer keeps only an in-memory event log for cursor re-attach + the sandbox directory
- **Background Jobs**: `DelegationService` watch-stream (keeps peer-side `start_job` continuations flowing between turns by polling the re-attach endpoint); `AsyncJobService` (synthetic jobId = taskId for parent re-prompt)
- **Dependencies**: Node `https`/`http` for mTLS NDJSON stream; pinned-fingerprint mTLS (injectable `DelegationTransport` seam for test isolation)
- **Settings**: Peer kill-switch (allow inbound sub-agents, default on for trusted peers) — configurable per-node; concurrent-run cap
- **API**: `trpc.delegation.stream`, `trpc.delegation.sendTurn`, `trpc.delegation.cancel`, `trpc.delegation.status`
