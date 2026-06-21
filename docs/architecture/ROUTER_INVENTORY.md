# tRPC Router Inventory

## Overview

Omnecor's backend API is built on a unified tRPC architecture where all routers are composed into a single `appRouter` at runtime. This document catalogs every available router, its namespace key, file location, and primary responsibilities.

### Architecture Notes

- **Single tRPC Instance**: All routers import from `server/_core/trpc.ts` and share a unified `TrpcContext` that provides both authentication state (`req`, `res`, `user`) and service singletons (`ctx.services.*`).
- **Namespace Keys**: Each router is registered under a flat namespace key in `server/routers.ts` (lines 90–216), enabling discoverable API routes like `api/trpc/system.health` or `api/trpc/ai.chat`.
- **Procedure Types**:
  - `publicProcedure` — Unauthenticated; accessible without a session.
  - `protectedProcedure` — Requires a valid session; automatically logged to audit trail.
  - `cloudProcedure` — Protected + blocked when user is in sovereign execution mode (air-gapped deployments).
  - `adminProcedure` — Requires `admin` or `owner` role.
  - `ownerProcedure` — Requires `owner` role only.
- **Formerly Phase 2 Routers**: Three routers (`agentRouter`, `aiProviderRouter`, `modelMarketplaceRouter`) were relocated from `server/phase2/routers/` into `server/routers/`. They share the unified tRPC context; the services they call still live in `server/phase2/services/`.

---

## Router Summary Table

| Namespace | File | Purpose | Procedures | Types |
|-----------|------|---------|-----------|-------|
| system | `_core/systemRouter.ts` | Health checks, version info, system status | 4+ | public |
| auth | routers.ts inline | Session management (login, logout, mode switch) | 3 | public/protected |
| jobs | jobRouter.ts | Background job orchestration (list, status, cancel) | 6+ | public/protected |
| knowledgeBase | knowledgeBase.ts | VectorDB search, document ingestion, memory | 6+ | public/protected |
| ai | aiRouter.ts | Chat completion, session persistence, provider health | 7+ | public/protected |
| aiProvider | aiProviderRouter.ts | Multi-provider inference routing (Ollama, OpenAI, etc.) | 3+ | public |
| voice | voiceRouter.ts | Whisper transcription, TTS synthesis, RVC conversion | 6+ | public/cloudProcedure |
| podcast | podcastRouter.ts | Multi-speaker podcast generation | 2+ | protected |
| training | trainingRouter.ts | LoRA fine-tuning job control, dataset validation | 3+ | public/protected |
| project | projectRouter.ts | File watching, neural node trees, loop detection | 7+ | public/protected |
| agent | agentRouter.ts | CrewAI, LiteAgent, n8n orchestration | 3+ | public/protected |
| ommesh | ommesh.router.ts | OMMESH LAN discovery, mesh routing, cert rotation | 4+ | public |
| fal | falRouter.ts | Fal.ai image gen (Flux), video cloning (MiniMax) | 4+ | public/cloudProcedure |
| comfy | comfyRouter.ts | ComfyUI workflow queueing, queue status | 2+ | public |
| wallet | walletRouter.ts | Per-project budget limits, spend tracking (insert-only log) | 6+ | protected |
| virtualCard | virtualCardRouter.ts | Lithic virtual card issuance (HITL-gated, rate-limited) | 2+ | protected |
| blender | blenderRouter.ts | Blender headless rendering, script execution | 3+ | public/protected |
| kicad | kicadRouter.ts | KiCad schematic/PCB exports (PDF, SVG, Gerber), DRC/ERC | 5+ | public/protected |
| pcbEditor | pcbEditorRouter.ts | PCB design persistence, versioning, AI review | 8+ | protected |
| esp | espRouter.ts | ESP microcontroller flashing, detection, erasing | 5+ | public/protected |
| security | securityRouter.ts | File scanning (YARA), encryption, backup/restore | 4+ | protected |
| audit | auditRouter.ts | Append-only event log retrieval + retention window control (admin-only) | 5 | admin |
| valet | valetRouter.ts | Intelligent multi-API routing, GPU detection, training setup | 4+ | protected |
| ollama | ollamaRouter.ts | Ollama model lifecycle (list, info, pull, delete) | 5+ | protected/admin |
| modelMarketplace | modelMarketplaceRouter.ts | Model search across Ollama + HuggingFace (search, featured) | 2 | protected |
| modelManagement | modelManagementRouter.ts | Model registry CRUD, versioning, lifecycle | 5+ | protected |
| mcp | mcpRouter.ts | Model Context Protocol client (connect, disconnect, list) | 4+ | protected |
| pipeline | pipelineRouter.ts | GodMode pipeline framework (CRUD, phase approval) | 5+ | protected |
| imageGen | imageGenRouter.ts | Image generation (local/Fal/OpenArt) | 2+ | protected |
| cloudCompute | cloudComputeRouter.ts | GPU rental (Vast.ai, RunPod, Lambda Labs), session tracking | 8+ | protected |
| integrations | integrationsRouter.ts | OAuth tokens (GitHub, Notion, Slack, Google Drive) — encrypted at rest | 5+ | protected |
| integrationManagement | integrationManagementRouter.ts | Integration health, token refresh, lifecycle | 4+ | protected |
| honcho | honchoRouter.ts | Honcho memory (sessions, facts, context injection) | 3+ | public |
| scheduling | schedulingRouter.ts | Scheduled post management (list, create, update) | 5+ | protected |
| curator | curatorRouter.ts | Curated content (draft, pending review, approved, published) | 4+ | protected |
| discovery | discoveryRouter.ts | Article discovery, processing pipeline | 3+ | protected |
| platforms | platformsRouter.ts | Social platform account management (safe columns only) | 3+ | protected |
| analytics | analyticsRouter.ts | Platform analytics summaries (impressions, engagement) | 2+ | protected |
| settings | agentSettingsRouter.ts | Agent posting schedule configuration (getScheduleConfig, updateScheduleConfig) | 2 | protected |
| oauth | oauthRouter.ts | OAuth flow (authorization, callback, token exchange) | 3+ | protected |
| attachments | attachmentsRouter.ts | File upload with sanitization (max 10 MB base64) | 1+ | protected |
| neuralMaps | neuralMapsRouter.ts | Neural brain map persistence (settings, metadata) | 4+ | protected |
| personas | personaRouter.ts | Persona CRUD and data persistence | 3+ | protected |
| hitl | hitlRouter.ts | Human-in-the-Loop approval queue (pending, approve, reject) | 3+ | protected |
| notifications | notificationRouter.ts | Unified alert feed (list, unreadCount, markRead, markAllRead, clear, create) | 6 | protected |
| agentMessenger | agentMessengerRouter.ts | Agent/persona messenger threads (listConversations, getMessages, markRead, send) | 4 | protected |

---

## Primary Routers (server/routers/)

### System Router
- **Namespace**: `system`
- **File**: `server/_core/systemRouter.ts`
- **Description**: Core health and system information endpoints accessible without authentication.
- **Key Procedures**: `health`, `version`, `systemInfo`
- **Procedure Types**: `publicProcedure`

### Auth Router
- **Namespace**: `auth`
- **Inline in**: `server/routers.ts` (lines 93–108)
- **Description**: Session lifecycle management and user execution mode switching.
- **Key Procedures**: `me`, `logout`, `setExecutionMode`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### Jobs Router
- **Namespace**: `jobs`
- **File**: `server/routers/jobRouter.ts`
- **Description**: Unified background job management (Blender renders, LoRA training, ESP flashing). Status, list, and cancellation are unified here.
- **Key Procedures**: `list`, `getStatus`, `cancel`, `retry`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### Knowledge Base Router
- **Namespace**: `knowledgeBase`
- **File**: `server/routers/knowledgeBase.ts`
- **Description**: VectorDB semantic search (ChromaDB) and document ingestion for project context retrieval and memory consolidation.
- **Key Procedures**: `ingestDirectory`, `search`, `getContext`, `consolidateMemory`, `getCollectionStats`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### AI Router
- **Namespace**: `ai`
- **File**: `server/routers/aiRouter.ts`
- **Description**: Chat completion requests, provider health checks, session persistence (D1 chat history), and Ollama model discovery.
- **Key Procedures**: `getProviders`, `discoverOllamaModels`, `createSession`, `chatStream`, `saveMessage`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### Voice Router
- **Namespace**: `voice`
- **File**: `server/routers/voiceRouter.ts`
- **Description**: Whisper STT transcription, TTS synthesis (XTTS-v2, ElevenLabs), and RVC voice conversion. Proxies FastAPI microservices.
- **Key Procedures**: `healthCheck`, `transcribe`, `synthesize`, `convertVoice`
- **Procedure Types**: `publicProcedure`, `cloudProcedure`

### Podcast Router
- **Namespace**: `podcast`
- **File**: `server/routers/podcastRouter.ts`
- **Description**: Multi-speaker podcast generation with dialogue turns, emotion markers, and optional RVC voice cloning.
- **Key Procedures**: `generate`
- **Procedure Types**: `protectedProcedure`

### Training Router
- **Namespace**: `training`
- **File**: `server/routers/trainingRouter.ts`
- **Description**: LoRA fine-tuning job initiation and dataset format validation. Job status/cancel is via `jobRouter`.
- **Key Procedures**: `startTraining`, `validateDataset`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### Project Router
- **Namespace**: `project`
- **File**: `server/routers/projectRouter.ts`
- **Description**: File system watching, neural node-tree generation for the Brain Map UI, and loop detection in agent workflows.
- **Key Procedures**: `registerProject`, `getFileTree`, `checkAgentLoop`, `resetLoopDetector`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### OMMESH Router
- **Namespace**: `ommesh`
- **File**: `server/routers/ommesh.router.ts`
- **Description**: Distributed LAN node discovery via mDNS/Bonjour, inference routing through mesh, and certificate rotation.
- **Key Procedures**: `discover`, `routeInference`, `rotateCert`
- **Procedure Types**: `publicProcedure`

### Fal.ai Router
- **Namespace**: `fal`
- **File**: `server/routers/falRouter.ts`
- **Description**: OpenArt AI integration for character generation (Flux) and video cloning (MiniMax Subject Reference).
- **Key Procedures**: `generateCharacter`, `generateVideo`, `getGallery`
- **Procedure Types**: `publicProcedure`, `cloudProcedure`

### ComfyUI Router
- **Namespace**: `comfy`
- **File**: `server/routers/comfyRouter.ts`
- **Description**: ComfyUI workflow queuing and queue status polling.
- **Key Procedures**: `queuePrompt`, `getQueue`
- **Procedure Types**: `publicProcedure`

### Wallet Router (Agentic Wallet)
- **Namespace**: `wallet`
- **File**: `server/routers/walletRouter.ts`
- **Description**: Per-project budget limits and spend tracking. The `spend_log` table is insert-only by design.
- **Key Procedures**: `setBudget`, `getBudget`, `logSpend`, `getSpendLog`
- **Procedure Types**: `protectedProcedure`

### Virtual Card Router
- **Namespace**: `virtualCard`
- **File**: `server/routers/virtualCardRouter.ts`
- **Description**: Lithic virtual card issuance for agentic spending. Gated behind HITL approval and rate-limited (1 per 60 seconds per user). Returns null if LITHIC_API_KEY is unconfigured.
- **Key Procedures**: `issueCard`, `getCardStatus`
- **Procedure Types**: `protectedProcedure`

### Blender Router
- **Namespace**: `blender`
- **File**: `server/routers/blenderRouter.ts`
- **Description**: Headless Blender integration for rendering, script execution, and file exports.
- **Key Procedures**: `executeScript`, `render`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### KiCad Router
- **Namespace**: `kicad`
- **File**: `server/routers/kicadRouter.ts`
- **Description**: KiCad PCB and schematic operations including DRC, ERC, exports (PDF/SVG/Gerber), and BOM generation.
- **Key Procedures**: `exportSchematic`, `exportGerber`, `checkDRC`, `generateBOM`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### PCB Editor Router
- **Namespace**: `pcbEditor`
- **File**: `server/routers/pcbEditorRouter.ts`
- **Description**: PCB design persistence, versioning, AI-assisted review, and exports.
- **Key Procedures**: `createProject`, `saveDesign`, `getVersions`, `createAIReview`
- **Procedure Types**: `protectedProcedure`

### ESP Router
- **Namespace**: `esp`
- **File**: `server/routers/espRouter.ts`
- **Description**: ESP microcontroller integration via esptool for detection, flashing, erasing, and reading firmware.
- **Key Procedures**: `detect`, `flash`, `erase`, `read`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### Security Router
- **Namespace**: `security`
- **File**: `server/routers/securityRouter.ts`
- **Description**: File security scanning (YARA rules, magic bytes), AES-256-GCM encryption, and encrypted backup/restore.
- **Key Procedures**: `scanFile`, `encrypt`, `decrypt`, `backup`, `restore`
- **Procedure Types**: `protectedProcedure`

### Audit Router
- **Namespace**: `audit`
- **File**: `server/routers/auditRouter.ts`
- **Description**: Append-only audit log. Application code can never update or rewrite entries; the only deletion path is the time-based retention purge (default **14 days**, configurable to 28 days or permanent in Settings → Security; permanent shows a storage warning). All procedures are admin-only.
- **Key Procedures**: `getAuditLog`, `getAuditLogByActor`, `exportAuditLog`, `getRetention`, `setRetention`
- **Procedure Types**: `adminProcedure`

### Valet Router
- **Namespace**: `valet`
- **File**: `server/routers/valetRouter.ts`
- **Description**: Intelligent multi-API routing, GPU detection (NVIDIA/AMD), and training setup validation.
- **Key Procedures**: `getAvailableModels`, `detectGPU`, `setupTraining`
- **Procedure Types**: `protectedProcedure`

### Ollama Router
- **Namespace**: `ollama`
- **File**: `server/routers/ollamaRouter.ts`
- **Description**: Local Ollama model management (list, info, pull, delete). Proxies the local Ollama instance at `OLLAMA_URL`.
- **Key Procedures**: `listModels`, `modelInfo`, `pullModel`, `deleteModel`
- **Procedure Types**: `protectedProcedure`, `adminProcedure`

### Model Management Router
- **Namespace**: `modelManagement`
- **File**: `server/routers/modelManagementRouter.ts`
- **Description**: Model registry CRUD, versioning, lifecycle management, and provider sync automation.
- **Key Procedures**: `list`, `register`, `updateMetadata`, `setActive`
- **Procedure Types**: `protectedProcedure`

### MCP Router (Model Context Protocol)
- **Namespace**: `mcp`
- **File**: `server/routers/mcpRouter.ts`
- **Description**: MCP client management for connecting and managing external tool servers (stdio or websocket transport).
- **Key Procedures**: `listConnectedServers`, `connectServer`, `disconnectServer`
- **Procedure Types**: `protectedProcedure`

### Pipeline Router (GodMode)
- **Namespace**: `pipeline`
- **File**: `server/routers/pipelineRouter.ts`
- **Description**: GodMode pipeline framework for orchestrating multi-phase workflows with HITL approval gates.
- **Key Procedures**: `createPipeline`, `getPipeline`, `listPipelines`, `approvePhase`
- **Procedure Types**: `protectedProcedure`

### Image Generation Router
- **Namespace**: `imageGen`
- **File**: `server/routers/imageGenRouter.ts`
- **Description**: Multi-backend image generation (local, Fal.ai, OpenArt) with configurable model and dimensions.
- **Key Procedures**: `providers`, `generate`
- **Procedure Types**: `protectedProcedure`

### Cloud Compute Router
- **Namespace**: `cloudCompute`
- **File**: `server/routers/cloudComputeRouter.ts`
- **Description**: GPU rental session management (Vast.ai, RunPod, Lambda Labs) with billing tracking and wallet integration.
- **Key Procedures**: `startSession`, `stopSession`, `listSessions`, `registerSubscription`
- **Procedure Types**: `protectedProcedure`

### Integrations Router
- **Namespace**: `integrations`
- **File**: `server/routers/integrationsRouter.ts`
- **Description**: Third-party OAuth token management (GitHub, Notion, Slack, Google Drive). Tokens are encrypted at rest using AES-256-GCM with keys derived from `JWT_SECRET`.
- **Key Procedures**: `saveToken`, `getToken`, `testConnection`
- **Procedure Types**: `protectedProcedure`

### Integration Management Router
- **Namespace**: `integrationManagement`
- **File**: `server/routers/integrationManagementRouter.ts`
- **Description**: Unified integration lifecycle — health checks, token refresh automation, and disconnection.
- **Key Procedures**: `listAll`, `checkHealth`, `refreshToken`, `disconnect`
- **Procedure Types**: `protectedProcedure`

### Honcho Router (Memory Layer)
- **Namespace**: `honcho`
- **File**: `server/routers/honchoRouter.ts`
- **Description**: Honcho persistent session memory for chat context injection and long-term fact storage. Uses `publicProcedure` to work in zero-login mode.
- **Key Procedures**: `addMessage`, `getFacts`, `addFact`
- **Procedure Types**: `publicProcedure`

### Scheduling Router
- **Namespace**: `scheduling`
- **File**: `server/routers/schedulingRouter.ts`
- **Description**: Social media post scheduling with status tracking (scheduled, published, failed).
- **Key Procedures**: `listScheduledPosts`, `schedulePost`, `updatePost`, `deletePost`
- **Procedure Types**: `protectedProcedure`

### Curator Router
- **Namespace**: `curator`
- **File**: `server/routers/curatorRouter.ts`
- **Description**: Curated content lifecycle management (draft → pending review → approved → published).
- **Key Procedures**: `listByStatus`, `getPost`, `updateStatus`
- **Procedure Types**: `protectedProcedure`

### Discovery Router
- **Namespace**: `discovery`
- **File**: `server/routers/discoveryRouter.ts`
- **Description**: Article discovery pipeline with ingestion and processing status tracking.
- **Key Procedures**: `listUnprocessed`, `fetchArticles`, `markProcessed`
- **Procedure Types**: `protectedProcedure`

### Platforms Router
- **Namespace**: `platforms`
- **File**: `server/routers/platformsRouter.ts`
- **Description**: Social platform account management. Only safe columns are returned to clients; OAuth tokens never leave the server.
- **Key Procedures**: `listAccounts`, `addAccount`, `removeAccount`
- **Procedure Types**: `protectedProcedure`

### Analytics Router
- **Namespace**: `analytics`
- **File**: `server/routers/analyticsRouter.ts`
- **Description**: Platform analytics summaries across scheduled posts (impressions, likes, shares, comments).
- **Key Procedures**: `getPlatformSummary`
- **Procedure Types**: `protectedProcedure`

### Agent Settings Router
- **Namespace**: `settings`
- **File**: `server/routers/agentSettingsRouter.ts`
- **Description**: Agent posting schedule configuration per platform (posts per day, auto-approval flags).
- **Key Procedures**: `getScheduleConfig`, `updateScheduleConfig`
- **Procedure Types**: `protectedProcedure`

### OAuth Router
- **Namespace**: `oauth`
- **File**: `server/routers/oauthRouter.ts`
- **Description**: OAuth authorization flow (Twitter, LinkedIn, Instagram, TikTok, Facebook, YouTube, Google Drive, GitHub, Notion, Slack).
- **Key Procedures**: `getAuthorizationUrl`, `exchangeCode`, `getProfile`
- **Procedure Types**: `protectedProcedure`

### Attachments Router
- **Namespace**: `attachments`
- **File**: `server/routers/attachmentsRouter.ts`
- **Description**: File uploads with extension sanitization and MIME type validation. Base64 dataUrl input (max 10 MB).
- **Key Procedures**: `uploadFile`
- **Procedure Types**: `protectedProcedure`

### Neural Maps Router
- **Namespace**: `neuralMaps`
- **File**: `server/routers/neuralMapsRouter.ts`
- **Description**: Neural brain map persistence for graph visualization settings and project context metadata.
- **Key Procedures**: `list`, `save`, `delete`, `getSettings`
- **Procedure Types**: `protectedProcedure`

### Personas Router
- **Namespace**: `personas`
- **File**: `server/routers/personaRouter.ts`
- **Description**: Persona CRUD and arbitrary data persistence. Personas can be marked "always on" to activate system-wide.
- **Key Procedures**: `list`, `upsert`, `delete`
- **Procedure Types**: `protectedProcedure`

### HITL Router (Human-in-the-Loop)
- **Namespace**: `hitl`
- **File**: `server/routers/hitlRouter.ts`
- **Description**: Approval queue for critical actions (card issuance, high-spend operations, etc.). Real-time pushes use WebSocket channel "hitl:pending".
- **Key Procedures**: `getPending`, `approve`, `reject`
- **Procedure Types**: `protectedProcedure`

### Notifications Router (Unified Alerts)
- **Namespace**: `notifications`
- **File**: `server/routers/notificationRouter.ts`
- **Description**: Unified alert feed surfaced in the Notifications tab (main GUI + Android APK). Backed by the in-memory `NotificationService` (`server/_core/NotificationService.ts`); live pushes use WebSocket channel "notifications". Sources: new chat replies (`ai.chat`), task/job completion (`processManager` lifecycle), HITL approvals, and agentic-wallet budget alerts (`AiProviderService` budget pre-flight).
- **Key Procedures**: `list`, `unreadCount`, `markRead`, `markAllRead`, `clear`, `create`
- **Procedure Types**: `protectedProcedure`

### Agent Messenger Router
- **Namespace**: `agentMessenger`
- **File**: `server/routers/agentMessengerRouter.ts`
- **Description**: WhatsApp/Discord-style messenger threads with agents/personas, separate from project chats. One thread per persona (from `personaRouter`); replies are generated through each persona's `modelConfig` backend via `ctx.services.aiProvider.chat` (graceful offline fallback) and raise an `agent` notification. Threads live in the in-memory `AgentMessengerStore` (`server/_core/AgentMessengerStore.ts`).
- **Key Procedures**: `listConversations`, `getMessages`, `markRead`, `send`
- **Procedure Types**: `protectedProcedure`

---

## Formerly Phase 2 Routers (now in server/routers/)

These three were relocated from `server/phase2/routers/` into `server/routers/`; the services they call still live in `server/phase2/services/`.

### Agent Router
- **Namespace**: `agent`
- **File**: `server/routers/agentRouter.ts`
- **Description**: Agent orchestration for CrewAI, LiteAgent, and n8n workflows. Unified into main tRPC context.
- **Key Procedures**: `runCrew`, `runLiteAgent`, `runN8nWorkflow`
- **Procedure Types**: `publicProcedure`, `protectedProcedure`

### AI Provider Router
- **Namespace**: `aiProvider`
- **File**: `server/routers/aiProviderRouter.ts`
- **Description**: Multi-provider inference routing across Ollama, OpenAI, Anthropic, Gemini, Grok, HuggingFace, Forge, and llama.cpp. Unified into main tRPC context.
- **Key Procedures**: `getProviders`, `discoverOllamaModels`, `chatStream`
- **Procedure Types**: `publicProcedure`

### Model Marketplace Router
- **Namespace**: `modelMarketplace`
- **File**: `server/routers/modelMarketplaceRouter.ts`
- **Description**: Curated model library with automated sync across Ollama and HuggingFace repositories.
- **Key Procedures**: `search`, `featured`
- **Procedure Types**: `protectedProcedure`

---

## Notes

1. **Composition**: All routers are imported and registered in `server/routers.ts` (lines 42–84) and composed into the single `appRouter` export (line 90).

2. **Service Singletons**: Routers access shared services via `ctx.services.*` (e.g., `ctx.services.aiProvider`, `ctx.services.comfy`). These are initialized in `server/_core/index.ts`.

3. **Database Access**: Most routers use `getDb()` from `db.factory.ts` which selects MySQL or SQLite at startup based on `OMNECOR_DB` env var.

4. **Procedure Permissions**: 
   - Procedures requiring external cloud APIs use `cloudProcedure` so they're blocked in sovereign (air-gapped) mode.
   - Admin and owner procedures are gated by role checks in the tRPC middleware.
   - Audit logging is automatic for all `protectedProcedure` calls.

5. **WebSocket Integration**: Some routers (e.g., `hitlRouter`, `voiceRouter`) push real-time events via WebSocket using the broadcast channels wired in `WebSocketServer.ts`.

6. **Idempotency & Rate Limiting**: Some routers (e.g., `virtualCardRouter`) implement in-memory idempotency guards and rate limiters to prevent duplicate operations on retries or burst requests.
