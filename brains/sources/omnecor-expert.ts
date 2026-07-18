/**
 * @file brains/sources/omnecor-expert.ts
 * @description Source content for the built-in **Omnecor Expert** Brain Pack
 * (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * The ONE domain-specific expert: master of Omnecor's own architecture, system
 * boundaries, Sovereign security gates, tRPC tiers, database engine, OMMESH, and
 * core services. Unlike the other experts (general-purpose), this brain is
 * intentionally Omnecor-specific so an agent can reason about and extend this
 * codebase correctly. Original content, ships CC0. One durable fact per entry →
 * one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";
import { REASONING_BASE } from "./_reasoning-base.js";

export const OMNECOR_EXPERT_CHARTER = `${REASONING_BASE}

Domain layer — Omnecor internals. When working in the Omnecor codebase, ALSO apply:

1. Build complete, fix now. No half-built features, no deferred scope. Build each feature end-to-end and fix any defect or security risk on sight — "out of scope / later" is not an acceptable resolution for a real gap.
2. Enforce Sovereign mode correctly. Any procedure that calls an external cloud AI provider MUST be a \`cloudProcedure\` (or gate via \`assertProviderAllowedInMode\` before doing work). Sovereign blocks external AI inference ONLY — never email, OAuth, social, or git.
3. One engine, one schema. The database is unified libSQL/SQLite via Drizzle; \`getDb()\` always returns a live instance. Change \`drizzle/schema.ts\`, then \`pnpm build:push\` to regenerate + apply migrations. Never hand-edit generated migrations or reach for a second DB.
4. Respect the single server entry point (\`server/_core/index.ts\`) and the router/service split; register new routers in \`server/routers.ts\`; keep services as \`getInstance()\` singletons.
5. Test at the route level with the real \`appRouter.createCaller\`, stub \`AuditLogService\`, and never lower the coverage ratchet.
6. Follow the design tokens/UI rules and run \`imprint\` after UI work; use pnpm only, with security pins in \`pnpm-workspace.yaml\`.
7. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const OMNECOR_EXPERT_SOURCES: BrainFact[] = [
  // ── Server architecture ────────────────────────────────────────────────────
  {
    name: "arch-single-entry-point",
    text: `server/_core/index.ts is the ONLY server entry point. It bootstraps a single Express + tRPC server that serves the tRPC API at /api/trpc, a WebSocket at /ws (same HTTP server via upgrade), the static frontend / Vite dev server, and a health check at /health. Do not create parallel servers or listen on ad-hoc ports for app features — extend the single server. Optional Python microservices run as separate processes proxied by routers and must degrade gracefully when offline.`,
  },
  {
    name: "arch-router-service-split",
    text: `Omnecor separates ROUTERS from SERVICES. tRPC routers live in server/routers/ and are composed into one appRouter in server/routers.ts under namespace keys; they import router + procedure helpers from server/_core/trpc.ts and share a single TrpcContext. Business logic lives in services under server/core_services/services/ (getInstance() singletons). Three routers (agentRouter, aiProviderRouter, modelMarketplaceRouter) were relocated to server/routers/ from the now-empty server/core_services/routers/, but the services they call still live under core_services/services.`,
  },
  {
    name: "arch-add-router-steps",
    text: `To add a tRPC router in Omnecor: (1) create server/routers/myRouter.ts importing router + the appropriate procedure type from server/_core/trpc.ts; (2) register it under a new namespace key in server/routers.ts; (3) use cloudProcedure for any procedure that calls an external cloud API so Sovereign mode is enforced automatically. Keep the router thin (validation + ownership + orchestration) and put real logic in a service. The AppRouter type exported from server/routers.ts drives end-to-end client type safety.`,
  },
  {
    name: "arch-shared-dir",
    text: `shared/ holds types and constants used by BOTH server and client, imported via the @shared/ alias: shared/types.ts (domain types), shared/const.ts (cookie name, error codes, timeouts), shared/hitl.ts (Human-in-the-Loop event types). Put anything both sides depend on here and never duplicate a constant/type across the boundary. The frontend also has aliases @/ → client/src/ and @assets/ → attached_assets/ (defined in vite.config.ts).`,
  },
  {
    name: "arch-frontend-spa",
    text: `The frontend is a React 19 SPA at client/src/. Pages are lazy-loaded in App.tsx using wouter for routing, and each page is wrapped in a RouteBoundary for per-route error isolation. Global shell state (WS status, execution mode, command palette, sidebar) lives in a Zustand store at client/src/lib/store/app.store.ts. Data fetching is tRPC + TanStack Query, with full end-to-end type safety from the server's AppRouter type. Server data belongs to TanStack Query, not Zustand.`,
  },
  {
    name: "arch-python-microservices",
    text: `Optional Python microservices run as separate processes proxied by tRPC routers, all optional and degrading gracefully when offline: Whisper STT (8001) and TTS/Kokoro (8002) and RVC voice (8003) via voiceRouter; Fal AI bridge (8004) via falRouter; Valet Router inference (8010) via valetRouter; RecursiveMAS bridge (8011) via agentRouter; ComfyUI (8188) via comfyRouter. When one is offline the app stays up and the feature reports unavailable rather than crashing. VALET_AUTO_START=false prevents the Valet Router from auto-starting.`,
  },
  // ── tRPC tiers & security ──────────────────────────────────────────────────
  {
    name: "trpc-procedure-tiers",
    text: `Omnecor's tRPC procedure types (from server/_core/trpc.ts) form a privilege ladder: publicProcedure (unauthenticated), protectedProcedure (requires a session; auto-logs to the audit trail), cloudProcedure (protected AND blocked with FORBIDDEN when the user is in sovereign execution mode), adminProcedure (requires admin or owner role), ownerProcedure (owner only). RULE: any procedure calling an external cloud API must be a cloudProcedure so Sovereign mode is enforced automatically — never a plain protectedProcedure for a cloud call.`,
  },
  {
    name: "security-execution-modes",
    text: `Every user has an executionMode on their DB record: sovereign (air-gapped — cloudProcedure calls throw FORBIDDEN), scrapper (default — cloud allowed with spend tracking), big_spender (higher spend limits). Enforce Sovereign at the procedure tier (cloudProcedure) and inside services via assertProviderAllowedInMode(providerId, mode) called BEFORE any work runs, so an air-gapped user is blocked early and cleanly rather than after doing expensive setup.`,
  },
  {
    name: "security-sovereign-scope",
    text: `Sovereign mode blocks ONLY external AI inference (cloud providers like OpenAI/Anthropic/ElevenLabs/Fal). It NEVER blocks email, OAuth, social publishing, GitHub, or other non-AI-inference network calls — those are always allowed regardless of mode. This is a deliberate scope: Sovereign is about not sending prompts/data to a cloud model, not about full network isolation. When gating a feature, ask "is this external AI inference?" — if not, don't Sovereign-block it.`,
  },
  {
    name: "security-audit-logging",
    text: `protectedProcedure auto-logs authenticated actions to the audit trail via middleware. In route-level TESTS you must stub AuditLogService so the audit middleware doesn't touch the real file DB (e.g. vi.mock returning a no-op log). Never disable auditing to simplify a procedure — if an action shouldn't be audited it probably shouldn't be protectedProcedure. Never log secrets, tokens, or full PII into an audit record.`,
  },
  {
    name: "security-ommesh-auth",
    text: `OMMESH (server/ommesh/) is the distributed LAN node layer with two auth layers. Mobile node registration is guarded by OMMESH_SECRET (timing-safe SHA-256 comparison; FAILS CLOSED when the secret is unset). Cross-node inference runs on MeshServer (server/ommesh/core/MeshServer.ts) listening on MESH_PORT (3001) as a strict-mTLS HTTPS endpoint: requestCert + rejectUnauthorized + TLSv1.3, and each peer's cert fingerprint is PINNED at trust-time so even a valid CA-signed cert from an unknown peer is rejected. A Sovereign-mode guard prevents cloud providers tunnelling through mesh routing.`,
  },
  {
    name: "security-env-secrets",
    text: `Critical env vars: JWT_SECRET (session cookie signing — required in production), ZERO_LOGIN_MODE=true (skips auth — all requests become local admin; NEVER expose to a network), OMMESH_SECRET (mobile node registration; fail-closed when unset), SESSION_TTL_MS (session JWT + cookie lifetime, default one year; set 604800000 for 7 days on network installs). The session cookie is app_session_id. Read/validate env once at server/core_services/config/index.ts; fail loudly for required prod secrets.`,
  },
  // ── Database ───────────────────────────────────────────────────────────────
  {
    name: "db-unified-libsql",
    text: `Omnecor uses ONE unified engine: libSQL/SQLite via Drizzle ORM — one schema, one dialect, every mode. Local (default): an embedded file DB at ~/.omnecor/data/omnecor.db (zero-infra, air-gappable Sovereign mode, no external DB). Networked/multi-node: set LIBSQL_URL (or TURSO_DATABASE_URL) + LIBSQL_AUTH_TOKEN to use a libsql/Turso endpoint or embedded replicas. SQLITE_PATH overrides the local file. There is NO MySQL tier anymore — do not add one.`,
  },
  {
    name: "db-getdb-canonical",
    text: `The single schema lives in drizzle/schema.ts (sqlite-core). server/db.ts owns the connection: getDb() ALWAYS returns a live drizzle instance (never null) and applies generated migrations from drizzle/migrations/ on first connect. server/db.factory.ts re-exports db.ts and is the canonical import path — use getDb() freely in routers. For the embedded vector store, getLibsqlClient() shares the app's live libSQL connection (required so in-memory test DBs and the vector tables share one connection).`,
  },
  {
    name: "db-migrations-three-paths",
    text: `Three migration paths apply the SAME generated migrations in drizzle/migrations/, differing in when and whether they regenerate: pnpm build:push (drizzle-kit generate && migrate) — DEV: after editing drizzle/schema.ts, regenerate SQL then apply; pnpm db:migrate (server/scripts/migrate.ts) — PROD/CI: apply already-generated migrations before pnpm start (does NOT regenerate); server/db.ts init() auto-migrate — RUNTIME FALLBACK: applies pending migrations on first connect (non-fatal; a failure logs a warning and boot continues). db:migrate is the explicit fail-loud alternative to the runtime fallback.`,
  },
  {
    name: "db-sqlite-caveats",
    text: `Use Drizzle's query builder (not raw SQL) and $inferSelect/$inferInsert for types. SQLite caveats in this codebase: enums are text({ enum: [...] }); timestamps are integer({ mode: "timestamp" }) mapping to/from JS Date; JSON is text({ mode: "json" }); upserts use .onConflictDoUpdate({ target, set }); inserts return ids via .returning({ id }). Define FK cascades at table-create time (the ALTER-ADD-COLUMN cascade-drop gotcha means bolting a cascade on later doesn't reliably attach it).`,
  },
  // ── Testing ────────────────────────────────────────────────────────────────
  {
    name: "test-trpc-harness",
    text: `Tests are Vitest (*.test.ts under server/, client/, packaging/). Route-level tests drive the REAL appRouter.createCaller(ctx) rather than mocking the route. Shared helpers in server/__tests__/_helpers/trpcHarness.ts: createTestDb() spins up an in-memory libSQL DB with the real schema + migrations (FK cascade on) so ownership filters/upserts/cascades actually execute; seedUser() and makeContext(user, db, services?) build the context. Run one file with pnpm vitest run <path>.`,
  },
  {
    name: "test-db-mock-seams",
    text: `Mock the DB at the right seam. For routers that call db.factory helper functions (e.g. getChatSession) rather than getDb(), mock those helpers directly (see aiRouter.test.ts). For routers that call getDb(), redirect it via vi.mock("../db.factory.js", …) (see chatRouter.test.ts). For code using the embedded vector store, ALSO redirect getLibsqlClient() to the same test connection so brains/vector tables share one DB. Always stub AuditLogService in route tests so the audit middleware doesn't hit the real file DB.`,
  },
  {
    name: "test-coverage-ratchet",
    text: `pnpm test runs all tests; pnpm test:coverage produces a V8 coverage report (text + html + lcov in coverage/) and enforces RATCHETING thresholds in vitest.config.ts. Raise the thresholds as new suites land; NEVER lower them. Every non-trivial change ships with a test that would fail without it. This is a standing rule — a lowered coverage threshold is a regression to justify, not a convenience to reach for.`,
  },
  // ── Commands & tooling ─────────────────────────────────────────────────────
  {
    name: "cmd-core-scripts",
    text: `Core commands: pnpm dev (hot-reload server + Vite dev frontend on the same port); pnpm check (type-check, no emit); pnpm test / pnpm test:coverage; pnpm vitest run <file> (single test); pnpm build (Vite + esbuild bundle) then pnpm start; pnpm build:push (regenerate SQL from a schema change + apply); pnpm db:migrate (apply pending migrations only); pnpm format. Package manager is pnpm ONLY.`,
  },
  {
    name: "cmd-pnpm-overrides",
    text: `pnpm is the only package manager. All dependency overrides and security pins live in pnpm-workspace.yaml — NEVER in package.json's pnpm field, because pnpm 10 ignores that field in workspaces. When pinning a transitive dependency for a security fix or resolving a version conflict, add it to pnpm-workspace.yaml. packaging/electron-app/ is a separate pnpm workspace package for the Electron desktop build, independent of the web build.`,
  },
  {
    name: "cmd-ui-tokens-imprint",
    text: `UI work follows the design system: use the tokens in Context/UI-Tokens.md (never hard-coded colors/spacing), follow Context/UI-Rules.md, and run the imprint workflow after building a component so its patterns are recorded to the UI registry and future components match it. The app also maintains a UI registry that is auto-updated via an imprint workflow. Building UI isn't done at "it renders" — it's done when it uses tokens, handles all states, is accessible, and has been imprinted.`,
  },
  {
    name: "session-read-agents-md",
    text: `Start every session by reading AGENTS.md for project context. The standing directive (CLAUDE.md, 2026-06-22): "Build Complete, Fix Now" — no half-built features, no deferred scope; build each feature end-to-end the first time and fix any problem or security risk on sight. Deferring scope grows a never-ending TODO list and forces rediscovery of known gaps during slow (~40-min) package builds. Load relevant domain skills before working (not optional per AGENTS.md).`,
  },
  // ── Brains subsystem (this feature) ────────────────────────────────────────
  {
    name: "brains-overview",
    text: `Brain Packs (the Brains-Upgrade feature) give small local models (3-7B) a portable external "brain" — a curated, versioned knowledge+skill package attached at inference time, WITHOUT touching model weights. Retrieval runs fully on-device (zero external infra) so it works air-gapped in Sovereign mode. A brain is two-part: an always-on CHARTER (skills/rules, prompt-prepended) plus a large retrieved CORPUS (top-k RAG). "Load/attach" a brain augments the prompt; it never loads into weights. Distinct from a user's personal, writable neural maps.`,
  },
  {
    name: "brains-embedded-vector-engine",
    text: `The zero-infra foundation is libSQL-native vectors (F32_BLOB / libsql_vector_idx / vector_top_k / vector_distance_cos) in EmbeddedVectorStore, plus an on-device embedder (EmbeddingService: dependency-free BERT WordPiece tokenizer → onnxruntime-node running all-MiniLM-L6-v2, 384-dim, attention-masked mean pooling → L2 normalize). VectorStore.ts exposes an IVectorStore interface + getVectorStore() factory: default EMBEDDED; OMNECOR_VECTOR_BACKEND=chroma opts into the optional ChromaDB backend for scale-up. VectorDBService implements IVectorStore.`,
  },
  {
    name: "brains-obp-format",
    text: `A Brain Pack ships as a self-contained .obp file (server/core_services/brains/obpFormat.ts): a single gzip'd JSON holding a manifest (formatVersion, id, version, domain, embedder id+dim, provenance, charter SHA-256, chunk count), the charter, and chunks (stable id + text + metadata + PREBUILT embedding as base64 F32LE). packBrain/unpackBrain are pure and self-validating: unpack re-derives the charter hash + chunk count and rejects disagreement, and validates every embedding decodes to the declared dimension — a tampered/corrupt pack never partially imports.`,
  },
  {
    name: "brains-storage-and-import",
    text: `BrainPackService imports a pack (buffer/file/built-ins) → validate → embedder-match gate → persist a brains row + brain_chunks (durable, backend-agnostic source of truth) → load the corpus into the vector index ONLY when the embedder matches (a mismatch is flagged incompatible: corpus kept durably but NOT indexed so it's never mis-queried). It also does list/get/stats (user-scoped), delete (drops collection + cascade rows), export (lossless round-trip back to .obp), and rebuildIndex (re-derive the index from durable chunks). brains.id is the pack id (PK), so a pack id has a single owner; import refuses to clobber another user's brain of the same id.`,
  },
  {
    name: "brains-retrieval-injection",
    text: `server/_core/brainContext.ts injectBrainContext (sibling to injectMapRagContext) resolves a user's attached brain ids → charters ALWAYS-ON (every attached brain, embedder-independent, 8k-char budget) + a MERGED top-k corpus across all compatible brains (they share the running embedder, so cosine distances are comparable: dedupe identical text, sort by distance, fill a token budget) injected with per-source citations [Brain: <name> · <source>]. Corpus text is run through PromptSanitizer (possibly third-party); charters are trusted. It's wired into aiRouter.chat and aiProviderRouter.chatStream/agentChatStream after map RAG.`,
  },
  {
    name: "brains-attach-and-suggest",
    text: `Attachment is durable at the PERSONA level (personaBrainIds in a persona's data.brains; personaRouter.attachBrain/detachBrain, ownership-gated, capped at 16) UNIONed with per-chat brainIds at chat time via resolveAttachedBrainIds. Valet AUTO-SUGGEST (BrainPackService.suggest) combines corpus relevance (task run against each queryable brain's vector index) with category alignment (ValetRouterService classification + a token-set stemmer), score = 0.75·relevance + 0.25·aligned, floored at 0.3 — returning a CONFIRMABLE set, never auto-attached. Exposed as brainRouter.suggest.`,
  },
  {
    name: "brains-authoring-pipeline",
    text: `BrainAuthoringService builds a brain end-to-end: gather (pasted text + scraped URLs via ScraperService) → sanitize untrusted web content (PromptSanitizer) → chunk (boundary-aware, 1500/200) → OPTIONAL distillation (per-chunk synthetic Q&A via AiProviderService, tolerant) → on-device embed in batches → assemble charter + corpus with provenance → packBrain → write to the brains dir → import live. authorPack() produces the .obp buffer + stats with NO DB/import side effects (used by built-in build scripts); build() wraps it with persist + live-import. Distillation is the only cloud-capable step, gated per-provider via assertProviderAllowedInMode BEFORE any work.`,
  },
  {
    name: "brains-builtin-experts",
    text: `Omnecor ships a built-in "Team of Experts" — curated .obp packs in the in-repo brains/ directory, authored through the real pipeline from reviewable TS sources in brains/sources/ and built with pnpm brains:build:all (or per-brain scripts). Each is charter + a corpus of one-fact-per-chunk entries embedded on-device with all-MiniLM-L6-v2 (384-dim). The Coding brain was the Phase-6 exemplar (50 facts, proven +16.7pt fact-coverage on a live A/B against a local 3-7B model). Brains config (BRAINS_CONFIG): builtinDir (in-repo), userDir (~/.omnecor/brains), maxPackBytes; env OMNECOR_BRAINS_BUILTIN_DIR / OMNECOR_BRAINS_DIR / OMNECOR_BRAINS_MAX_BYTES.`,
  },
  {
    name: "brains-router",
    text: `server/routers/brainRouter.ts (registered as brains in server/routers.ts) is a thin ownership-scoped façade over BrainPackService: list / get / stats / import (base64 .obp) / importBuiltins / export (base64) / delete / rebuildIndex / suggest / build. All are protectedProcedure — every op is local (no cloud AI/external service) so brains work air-gapped, including authoring with raw ingestion or a local distiller. (Cloud distillation inside build is gated per-provider by Sovereign mode at the service layer, not by making the whole procedure a cloudProcedure.)`,
  },
];
