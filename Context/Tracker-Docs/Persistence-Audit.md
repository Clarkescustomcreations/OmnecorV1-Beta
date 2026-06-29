# Persistence Audit

*A focused tracker for data storage lifecycle (Create, Update, Delete, Import, Export, Restart Persistence) across every key domain entity in the Omnecor system. Storage engine: libSQL/SQLite (`~/.omnecor/data/omnecor.db`). ORM: Drizzle ORM (sqlite-core dialect). Last audited: 2026-06-20.*

---

## Users

- **Storage**: SQLite — `users` table (`id` integer PK autoIncrement, `openId` unique, `name`, `email`, `loginMethod`, `passwordHash`, `role` enum, `executionMode` enum, `createdAt`, `updatedAt`, `lastSignedIn`)
- **Create**: Verified — via OAuth upsert (`.onConflictDoUpdate` on `openId`; sets `lastSignedIn`); also via local account creation (username + optional password)
- **Update**: Verified — `updateUserExecutionMode()` in `db.factory.ts`; role updates via `trpc.auth` RBAC procedures (`setUserRole`)
- **Delete**: Pending — no explicit user-delete procedure confirmed wired in `routers.ts` (cascade rules defined in schema via FK relations)
- **Restart Persistence**: Verified — embedded SQLite file at `~/.omnecor/data/omnecor.db`; survives server restarts
- **Import**: Not Applicable
- **Export**: Pending — no user-data export endpoint confirmed

---

## Chat Sessions

- **Storage**: SQLite — `chat_sessions` table (`id` UUID PK, `userId` integer FK → users nullable — added via `ALTER TABLE` in migration `0003`; SQLite cannot ALTER-ADD NOT NULL + FK, so legacy rows may be null; all new rows always set userId scoped by `ctx.user.id`; `projectId`, `title`, `providerId`, `modelId`, `systemPrompt`, `metadata` JSON, timestamps); indexed on `userId`
- **Create**: Verified — `trpc.chat.create` (protectedProcedure, auto-generates UUID)
- **Update**: Verified — title rename; session metadata updates on every message append; `trpc.chat.*` update procedures
- **Delete**: Verified — cascade delete (chatMessages deleted automatically via `onDelete: "cascade"` FK)
- **Restart Persistence**: Verified — full session and message history in SQLite; survives restart
- **Import**: Pending — no import endpoint; legacy localStorage scripts migrated server-side via one-time `useEffect` migration in `Chat.tsx`
- **Export**: Verified (partial) — context export button in `Chat.tsx`; exports current context to JSON

---

## Chat Messages

- **Storage**: SQLite — `chat_messages` table (`id` UUID PK, `sessionId` FK → chat_sessions cascade, `role` enum, `content`, `tokenCount`, `createdAt`); indexed on `sessionId`
- **Create**: Verified — inserted per turn by `aiRouter.chat` / streaming handlers
- **Update**: Not Applicable — messages are immutable once created
- **Delete**: Verified — cascade on session delete; `trpc.ai.summarizeAndPruneSession` prunes session (keeps last 6 messages + summary)
- **Restart Persistence**: Verified — full message history in SQLite
- **Import**: Not Applicable
- **Export**: Verified (partial) — via session context export

---

## Saved Scripts

- **Storage**: SQLite — `saved_scripts` table (`id` integer PK autoIncrement, `userId` FK, `mapId` FK to neuralMaps, `name`, `code`, `language`, `project`, timestamps); two indexes
- **Create**: Verified — `trpc.scripts.create` (protectedProcedure, always user-scoped — no IDOR); legacy localStorage scripts migrated on first Chat.tsx mount
- **Update**: Verified — `trpc.scripts.update` (rename, edit code); Drizzle type-safe update
- **Delete**: Verified — `trpc.scripts.delete` (user-scoped)
- **Restart Persistence**: Verified — SQLite-backed; migration `0001_equal_shiva.sql` applied
- **Import**: Verified (one-time) — `getLegacyLocalScripts()` / `clearLegacyLocalScripts()` migration helpers in `scriptStorage.ts`
- **Export**: Not Applicable

---

## Neural Brain Maps

- **Storage**: SQLite — `neural_maps` table (`id`, `userId`, `name`, `source`, `settings` JSON — includes `collapsedFolderIds`, `labelOverrides`, layout engine prefs, Visual Controller state)
- **Create**: Verified — `trpc.neuralMaps.create` (protectedProcedure)
- **Update**: Verified — `trpc.neuralMaps.update` (inline label editing, collapsed folder sync, Visual Controller prefs; auto-synced via `brainMapStore.ts` + `NeuralMapContext.tsx`)
- **Delete**: Verified — `trpc.neuralMaps.delete`
- **Restart Persistence**: Verified — full map config (collapse state, label overrides, layout prefs) restored from SQLite on reload; `collapsedFolderIds` DB-backed as of 2026-06-18
- **Import**: Pending — multi-source maps (`github://owner/repo`, `integration://provider`) not yet fully import-verified
- **Export**: Pending — no dedicated export endpoint confirmed

---

## Personas

- **Storage**: SQLite — `personas` table (`id`, `userId`, `name`, `role`, `bio`, `tone`, `postingSchedule`, `model`, `systemPrompt`, timestamps)
- **Create**: Verified — `trpc.personas.create`
- **Update**: Verified — `trpc.personas.update`
- **Delete**: Verified — `trpc.personas.delete`
- **Restart Persistence**: Verified — SQLite-backed
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Project Budgets

- **Storage**: SQLite — `project_budgets` table (`id` UUID PK, `projectId`, `limitCents` (0 = unlimited), `alertThreshold` (default 80%), `mode` enum: soft/hard, timestamps)
- **Create**: Verified — `trpc.wallet.setProjectBudget` (upsert via `.onConflictDoUpdate`)
- **Update**: Verified — same upsert procedure updates existing budgets
- **Delete**: Not Applicable — budgets are overwritten, not deleted
- **Restart Persistence**: Verified — SQLite-backed
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Spend Log

- **Storage**: SQLite — `spend_log` table (`id` UUID PK, `projectId`, `provider`, `modelId`, `promptTokens`, `completionTokens`, `estimatedCostMicrocents`, `sessionId`, `createdAt`); insert-only (no update/delete)
- **Create**: Verified — `AiProviderService.logSpend()` called after every chat + cloud compute; WS `budget:spend` event broadcast
- **Update**: Not Applicable — immutable append-only log
- **Delete**: Not Applicable (by design — audit trail; separate retention policy via `AuditLogService`)
- **Restart Persistence**: Verified — fully durable in SQLite
- **Import**: Not Applicable
- **Export**: Pending — no dedicated export endpoint

---

## Audit Log

- **Storage**: SQLite — `audit_log` table (`id` UUID PK, `eventType`, `actorId`, `actorType`, `procedure`, `args`/`result` JSON, `ipAddress`, `sessionId`, `createdAt`); indexed on `createdAt`; append-only
- **Create**: Verified — `auditMiddleware` in `trpc.ts` fires on every `protectedProcedure`; `sovereignCheck` middleware fires `sovereign_block` event (fire-and-forget) before FORBIDDEN throw; HITL/agent-spawn wiring
- **Update**: Not Applicable — append-only by design
- **Delete**: Verified — `AuditLogService.purgeExpired()` (6 h sweep, default 14 days retention; 28-day and permanent options); `trpc.audit.setRetention` (adminProcedure)
- **Restart Persistence**: Verified — fully durable in SQLite
- **Import**: Not Applicable
- **Export**: Pending — no export endpoint confirmed

---

## Pipelines & Pipeline Phases

- **Storage**: SQLite — `pipelines` table (status: pending/running/paused/complete/aborted; currentPhase: DEFINE/PLAN/EXECUTE/REVIEW/SHIP/DONE); `pipeline_phases` table (per-phase: inputText, outputText, approvedBy, approvedAt; status: pending/awaiting_approval/approved/rejected/complete)
- **Create**: Verified — `trpc.pipeline.createPipeline` (creates pipeline + all 5 phase rows atomically)
- **Update**: Verified — `trpc.pipeline.approvePhase` / `trpc.pipeline.rejectPhase` (update phase status + approvedBy/At; advance currentPhase on pipeline row)
- **Delete**: Pending — no pipeline delete procedure confirmed wired
- **Restart Persistence**: Verified — SQLite-backed; pipeline state survives restart (in-progress pipelines resume from last approved phase)
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## PCB Design Projects, Saves, Exports, AI Reviews, Component Library

- **Storage**: SQLite — `design_projects` (userId FK, name, mode: schematic/pcb), `design_saves` (projectId FK, canvas JSON), `design_exports` (type, filePath), `ai_design_reviews` (notes, suggestions JSON), `component_library_items` (type, label, properties JSON). Managed via `server/db-pcb.ts` with `db.transaction()` wrapping all multi-table operations.
- **Create**: Verified — `trpc.pcbEditor.createProject`, `trpc.pcbEditor.saveDesign` (atomic transaction), `trpc.pcbEditor.addComponent`; auto-creates "Default Design" on first open (`autoCreatedRef`)
- **Update**: Verified — auto-save debounced 1.5 s after canvas change (`suppressAutoSaveRef` prevents double-write on load); mark-old-saves + insert wrapped in `db.transaction()`
- **Delete**: Verified — `deleteProject` and `deleteDesign` both wrapped in `db.transaction()` (cascade: exports + reviews + saves atomically); N+1 batched with `inArray` per beta sweep fix
- **Restart Persistence**: Verified — last canvas state auto-saved to SQLite; restored on `loadedProjectRef` effect; `EnhancedPCBEditor.tsx` self-contained (no external projectId prop)
- **Import**: Verified (partial) — drag-and-drop onto canvas from `ComponentLibraryPanel.tsx`; component `dataTransfer.setData` wired for drag-start
- **Export**: Verified — `trpc.pcbEditor.exportDesign` (STEP, Gerber via KiCad bridge); `trpc.kicad.exportStep`, `trpc.kicad.exportGerber`, `trpc.kicad.generateBom`

---

## Platform Accounts (Social Media OAuth Tokens)

- **Storage**: SQLite — `platformAccounts` table (`id` integer autoIncrement PK, `userId`, `platform`, `accountName`, `oauthToken`, `oauthRefreshToken`, `tokenExpiresAt`, `accountMetadata` JSON, `isActive`, `lastSyncedAt`); indexed on `userId`
- **Create**: Verified — `trpc.oauth.handleCallback` after OAuth flow completes
- **Update**: Verified — `IntegrationManagementService.refreshToken()` (real `refresh_token` grant, persists rotated token + expiry, clears health cache)
- **Delete**: Verified — `trpc.platforms.disconnect` (removes platform account row)
- **Restart Persistence**: Verified — OAuth tokens survive restart in SQLite
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Discovered Articles / Curated Posts / Scheduled Posts / Post Analytics

- **Storage**: SQLite — `discoveredArticles` (url unique, urlHash unique, isProcessed flag), `curatedPosts` (status: draft/pending_review/approved/scheduled/published/failed), `scheduledPosts` (status: scheduled/published/failed/cancelled; errorMessage), `postAnalytics` (impressions, reach, likes, shares, comments, clicks)
- **Create**: Verified — `trpc.discovery.fetchArticles` (RSS ingest, dedup by `urlHash`); `trpc.curator.curateArticle` (AI draft generation); `trpc.scheduling.schedulePost` / `trpc.scheduling.publishNow`
- **Update**: Verified — post status transitions (draft→approved→scheduled→published/failed); `trpc.scheduling.retryPost` (reset failed→scheduled + clear errorMessage); `CHAR_LIMITS` enforced on create
- **Delete**: Pending — no explicit article/post delete endpoint confirmed
- **Restart Persistence**: Verified — all in SQLite; `publishWorker.ts` re-queues due posts on server start
- **Import**: Verified — RSS feed ingestion from `discoveryRouter.fetchArticles` (`ArticleDiscoveryService`)
- **Export**: Not Applicable

---

## OAuth States (PKCE / CSRF)

- **Storage**: SQLite — `oauthStates` table (`state` text PK, `platform`, `userId`, `codeVerifier`, `expiresAt` 10 min TTL, `createdAt`)
- **Create**: Verified — `trpc.oauth.getAuthorizationUrl` (creates state row + sets `social_oauth_state` httpOnly cookie sameSite=lax)
- **Update**: Not Applicable — ephemeral state
- **Delete**: Verified — `GET /api/oauth/callback/:platform` Express handler verifies cookie + DB state then deletes row; stale rows left to TTL expiry
- **Restart Persistence**: Verified — SQLite-backed; survives restart (TTL enforcement still applies)
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Cloud Compute Sessions & Subscriptions

- **Storage**: SQLite — `cloud_compute_sessions` (provider, planId, billingUnit: minute/hour, status: starting/running/stopped/error, totalCostMicrocents); `cloud_compute_subscriptions` (monthlyCents, renewalDate, isActive); indexed on userId + projectId
- **Create**: Verified — `trpc.cloudCompute.startSession`
- **Update**: Verified — status transitions; `totalCostMicrocents` updated on session events
- **Delete**: Pending — no explicit delete endpoint confirmed; subscription `isActive` flag deactivated
- **Restart Persistence**: Verified — session state in SQLite
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Integrations (Encrypted OAuth Tokens)

- **Storage**: SQLite — `integrations` table (`id` text PK, `provider`, `accessToken` AES-256-GCM encrypted, `refreshToken`, `expiresAt`, `tokenIv`, `tokenTag`, timestamps); additionally `~/.omnecor/integrations.json` (encrypted secrets at rest)
- **Create**: Verified — OAuth callback inserts via `integrationsRouter`
- **Update**: Verified — token rotation via `IntegrationManagementService.refreshToken()` (real grant, persists, clears health cache)
- **Delete**: Verified — `trpc.integrations.disconnect` removes integration row
- **Restart Persistence**: Verified — AES-256-GCM encrypted tokens in SQLite + `integrations.json`
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Mobile APK Secure Data

- **Storage**: Android KeyStore via `expo-secure-store` — `omnecor_ommesh_secret`, JWT session token; AsyncStorage (non-sensitive) — server IP, port, node name; AES-256-CBC + HMAC-SHA256 envelope encryption for chat histories (data key in SecureStore, ciphertext in AsyncStorage via `secure-crypto.ts`); legacy plaintext AsyncStorage transparently migrated on first read
- **Create**: Verified — `saveServerConfig()` writes OMMESH secret to SecureStore only; JWT stored after OAuth callback
- **Update**: Verified — secret rotation triggers SecureStore overwrite; chat history append triggers encrypted re-write
- **Delete**: Verified — logout clears SecureStore and session token
- **Restart Persistence**: Verified — SecureStore survives app restarts (hardware-backed on Android)
- **Import**: Verified (one-time) — `loadServerConfig()` migrates legacy plaintext AsyncStorage OMMESH secret to SecureStore then scrubs plaintext
- **Export**: Not Applicable

---

## Always-Listen Activation Log (Mobile)

- **Storage**: In-memory ring buffer — AES-256-CBC + HMAC-SHA256 encrypted activation-audit log (same `secure-crypto.ts` envelope encryption reuse); Picovoice API key stored in SecureStore
- **Create**: Verified — each wake-word trigger creates an encrypted audit entry
- **Update**: Not Applicable — ring buffer (oldest entries evicted)
- **Delete**: Not Applicable — ring buffer auto-eviction
- **Restart Persistence**: Not Verified — in-memory ring buffer (not persisted to disk)
- **Import**: Not Applicable
- **Export**: Not Applicable

---

## Knowledge Base / ChromaDB Vector Index

- **Storage**: ChromaDB (vector store) — `MemoryArchitectService`; semantic embeddings via `ONNXEmbeddingService.ts` (real BPE via `@anthropic-ai/tokenizer` — replaced whitespace pseudo-tokenizer in F11); ChromaDB per-agent isolation for RecursiveMAS
- **Create**: Verified — `trpc.knowledgeBase.ingestDirectory` triggers file parsing + embedding insertion
- **Update**: Verified — re-indexing overwrites existing embeddings for changed files
- **Delete**: Verified — `trpc.knowledgeBase.deleteCollection` removes ChromaDB collection. Map-scoped (2026-06-23): `neuralMaps.delete` drops the map's whole collection; `neuralMaps.update` removing a remote root calls `MemoryArchitectService.deleteRemoteSource` (→ `VectorDBService.removeDocumentsWhere({ sourceUri })`); re-index reconciles per-source (delete-where then re-add).
- **Remote-source ingest (2026-06-23)**: `integrations.indexMapSources` fetches real content from a map's `github://` / `integration://` roots and embeds it into `omnecor_{mapId}` (gated by `settings.indexingEnabled`); persists to ChromaDB disk like any other collection. Chat reads it via `ragContext.injectMapRagContext` when `settings.enableAIContext`.
- **Restart Persistence**: Verified — ChromaDB persists to disk (configured data directory). Note: the `integrations.indexMapSources` **job-status** map is in-memory only (a restart simply shows no in-flight job; the embedded vectors persist).
- **Import**: Verified — `trpc.knowledgeBase.ingestDirectory` (local folder path, validated by `validatePath`)
- **Export**: Not Applicable

---

## Valet Router Artifact Registry

- **Storage**: Filesystem — `~/.omnecor/models/valet-router/current.json` (app-data registry: `format`, `artifact_path`, `base_model`, `gguf_sha256`, `status`); GGUF weight file (~1.6 GB, gitignored, only on build machines); seeded from repo `models/valet-router/current.json` on first boot by `ValetArtifactRegistry.seedFromRepoIfMissing()`
- **Create**: Verified — registry seeded at boot if missing; GGUF placed by maintainer workflow
- **Update**: Verified — `ValetArtifactRegistry.ts` registry update on new build; hot-reload of manifest in `ValetRouterService`
- **Delete**: Not Applicable — weights persist on filesystem
- **Restart Persistence**: Verified — filesystem-based; `ValetServerService.ts` auto-starts on `pnpm dev` / `pnpm start`
- **Import**: Verified (manual) — GGUF copied into `models/valet-router/<tag>/` by maintainer; `pnpm db:migrate` not required (filesystem only)
- **Export**: Not Applicable
