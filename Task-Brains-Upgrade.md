# Task — Brains Upgrade (Portable "External Brains" for Local Models)

> **Goal:** Give small local models (3–7B) a portable **external brain** — a
> curated, versioned knowledge + skill package they attach to at inference time
> to gain domain expertise, without touching the model's weights. Retrieval runs
> fully on-device (zero external infra), so it works air-gapped in Sovereign mode.

**Status:** Phase 7 complete (2026-07-14) — OMMESH Brain Pack sync shipped, on top
of the full **Team of Experts** (8 brains). Next: Phase 8 Brains manager UI.
Blueprint locked. Building sequentially.
**Standing directives:** No half-built features, no deferred scope — build each
phase end-to-end and fix defects on sight (`CLAUDE.md` / `AGENTS.md`).

---

## 1. The Reframe (what already existed vs. what's new)

Omnecor already had the full **RAG spine** before this task:

- `VectorDBService` (ChromaDB) — per-project/map "isolated brains".
- `MemoryArchitectService` — 3-layer memory (working / long-term vector / episodic), chunking, ingestion, consolidation.
- `server/_core/ragContext.ts` — the read path: injects a map's knowledge into chat when a chat is anchored via `ragMapId` + `enableAIContext`.
- `knowledgeBase` router, `neuralMaps` table, Curator/Dataset/Scraper services.

**Therefore this task does NOT rebuild RAG.** The genuinely-new work is:

1. Portable, curated, **model-agnostic Brain Packs** (distinct from a user's personal, writable neural maps).
2. A **distillation pipeline** (large cloud model → synthetic instruction sets/Q&A → ingested corpus).
3. **Attaching a brain to a model/persona** (today RAG binds to a *chat*), and Valet **auto-selecting** the right brain.
4. **Zero-infra, air-gapped** operation (the old vector path required a ChromaDB Docker sidecar).

---

## 2. Locked Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Abstraction** | New first-class **Brain Pack** artifact that *reuses* the MemoryArchitect/vector retrieval engine but is curated / versioned / read-only / model-agnostic — **separate** from personal writable neural maps. |
| 2 | **Content model** | **Two-part**: a small always-on **charter** (skills/rules, prompt-prepended) + a large retrieved **corpus** (top-k RAG). |
| 3 | **Vector infra** | **Embedded** libSQL-native vectors by default (zero infra, air-gapped). ChromaDB stays optional for scale-up. |
| 4 | **Attach + route** | Durable attach at **persona/agent** level + **per-chat** toggle + Valet **auto-suggest** (user-confirmable, not forced). |
| 5 | **Packaging** | Self-contained **`.obp` Brain Pack** (manifest w/ embedder id+dim + provenance, charter, corpus, **prebuilt** embeddings). Built-ins ship in-repo; users import; syncs over OMMESH. |
| 6 | **v1 scope** | Full system end-to-end **+ 1–2 real exemplar brains** (Coding). Other domains become user-authorable. "Fully built" = mechanism complete; corpora are content added over time. |
| 7 | **Embedder** | **all-MiniLM-L6-v2** (384-dim, mean-pooled) — the same model ChromaDB uses by default, so the embedded backend is vector-compatible. |

### Language we agreed on
- **Brain** — portable, curated, versioned knowledge+skill package attached at inference time; not a personal neural map.
- **Skill / instruction set** — always-on procedural guidance (the *charter*), vs. reference *knowledge* retrieved on demand (the *corpus*).
- **Load / attach** — bind a brain so its content augments the prompt. **Never** loads into model weights.
- **Learn / remember** — the corpus grows by *ingestion* (RAG); the model is never retrained. Episodic recall stays in the existing memory layer.
- **Built-in** — ships with Omnecor; works offline with zero external infra.

---

## 3. Phased Plan

### Phase 0 — Blueprint & decisions ✅
Architect session; 7 decisions locked (above).

### Phase 1 — Embedded vector engine ✅ (2026-07-13)
The zero-infra foundation everything else rides on.

- **`server/core_services/services/EmbeddingService.ts`** — real on-device embedder:
  dependency-free BERT WordPiece tokenizer → onnxruntime-node (all-MiniLM-L6-v2) →
  attention-masked mean pooling → L2 normalize. Model resolves env → cache →
  one-time SHA-256-gated download. Deleted dead/broken `ONNXEmbeddingService.ts`.
- **`server/core_services/services/EmbeddedVectorStore.ts`** — libSQL-native vectors
  (`F32_BLOB` / `libsql_vector_idx` / `vector_top_k` / `vector_distance_cos`), per-collection
  table+index, INSERT-OR-REPLACE upsert (index stays consistent), `json_extract`
  metadata deletes, injection-safe identifiers. Uses new `getLibsqlClient()` (shares the
  app's live connection — required for in-memory test DBs).
- **`server/core_services/services/VectorStore.ts`** — `IVectorStore` interface +
  `getVectorStore()` factory. Default **embedded**; `OMNECOR_VECTOR_BACKEND=chroma` opts in.
  `VectorDBService implements IVectorStore`. Single seam rewired
  (`ctx.services.vectorDB`, `MemoryArchitectService`, file-watcher) → no writer/reader split-brain.
- **Config** (`server/core_services/config/index.ts`): `EMBEDDING_CONFIG`.
- **Env:** `OMNECOR_VECTOR_BACKEND` (`embedded`|`chroma`), `OMNECOR_EMBED_MODEL_DIR`,
  `OMNECOR_EMBED_MODEL_URL`, `OMNECOR_EMBED_OFFLINE`.
- **Tests:** 22 new (embedder, real KNN/upsert/delete/injection, factory). Full suite
  1613 pass / 0 fail; typecheck clean.

**Outcome:** Omnecor's semantic memory now runs with **zero external infrastructure**
in Sovereign mode — the prerequisite for built-in, air-gapped brains.

### Phase 2 — Brain Pack format + storage ✅ (2026-07-14)
The portable, self-contained pack format + durable storage + loader/validator.

- **`server/core_services/brains/obpFormat.ts`** — the `.obp` container: a single
  **gzip'd JSON** file (zero new deps) holding `manifest` (formatVersion, id,
  version, domain, embedder id+dim, provenance, charter SHA-256, chunk count),
  `charter`, and `chunks` (stable id + text + metadata + **prebuilt** embedding as
  base64 F32LE). `packBrain`/`unpackBrain` are pure + fully self-validating:
  unpack re-derives the charter hash + chunk count and rejects any disagreement,
  and validates every embedding decodes to the declared dimension (tamper/corrupt
  packs never partially import).
- **Schema** (`drizzle/schema.ts` → migration `0018_marvelous_leopardon.sql`):
  `brains` (metadata + charter + embedder id/dim + `embedderMatch` + `status`
  ready|incompatible|error + collectionName + provenance + builtin) and
  `brain_chunks` (durable, vector-backend-agnostic source of truth: text +
  metadata + base64 embedding, FK **cascade** defined at table-create so the
  ALTER-ADD-COLUMN cascade-drop gotcha is avoided). User-scoped + unique
  (brainId, chunkId).
- **`BrainPackService`** — import (buffer/file/built-ins) → validate →
  embedder-match gate → persist row + chunks → load corpus into the vector index
  **only when the embedder matches** (mismatch ⇒ flagged `incompatible`, corpus
  kept durably but NOT indexed, so it's never mis-queried); plus list/get/stats
  (user-scoped), delete (drops collection + cascade rows), **export** (lossless
  round-trip back to `.obp` from the chunk store), and **rebuildIndex**
  (re-derive the vector index from the durable chunks, re-evaluating
  compatibility — survives a vector-backend switch).
- **Vector store primitive** — new `IVectorStore.addDocumentsWithEmbeddings`
  (stable ids + prebuilt vectors, dimension-guarded) implemented in both
  `EmbeddedVectorStore` (INSERT-OR-REPLACE + `vector32`) and `VectorDBService`
  (Chroma `upsert`). Distinct from `addWithEmbeddings` (which mints throwaway
  ids) so re-import is idempotent and targeted deletes work.
- **Config** (`BRAINS_CONFIG`): in-repo `builtinDir`, `~/.omnecor/brains`
  `userDir`, `maxPackBytes` cap. Env: `OMNECOR_BRAINS_BUILTIN_DIR`,
  `OMNECOR_BRAINS_DIR`, `OMNECOR_BRAINS_MAX_BYTES`.
- **Tests:** 24 new (12 format: codec round-trip + hash/count/dim/version tamper
  rejection + empty corpus; 10 service: match/mismatch import, idempotent
  re-import, user scoping + cross-user clobber refusal, stats, cascade delete,
  export round-trip, rebuild; 2 vector-store prebuilt-embedding path). Full suite
  **1637 pass / 0 fail**; typecheck clean.

**Note on ownership:** `brains.id` is the pack id (PK), so a given pack id has a
single owner; import refuses to clobber another user's brain of the same id. This
fits the single-user Omnecor-HQ workstation; per-user copies of a shared built-in
would need an (userId, packId) surrogate key — deferred until multi-user demand
is real (not a v1 gap).

### Phase 3 — Retrieval + injection ✅ (2026-07-14)
The chat-time read path + management router.

- **`server/_core/brainContext.ts`** — `injectBrainContext` (sibling to
  `injectMapRagContext`, same dual-carrier contract): owner-scoped resolve of
  attached brain ids → **charters always-on** (every attached brain, embedder-
  independent, clipped to an 8k-char budget) + **merged top-k corpus** across all
  *compatible* brains (all share the running embedder ⇒ cosine distances are
  directly comparable, so merge = dedupe identical text keeping the closest, sort
  by distance, fill a token budget) injected **with per-source citations**
  (`[Brain: <name> · <source>]`). Corpus text is run through `PromptSanitizer`
  (reference knowledge from a possibly third-party pack); charters are trusted
  (author-intended guidance). Incompatible brains contribute charter only (their
  vectors are never indexed). Best-effort: any failure passes the prompt through
  unchanged.
- **Wired into both AI routers** at all three map-RAG injection sites, layered
  *after* map RAG so both knowledge sources augment the same prompt:
  `aiRouter.chat`, `aiProviderRouter.chatStream`, `aiProviderRouter.agentChatStream`.
  Added `brainIds: string[]` (owner-scoped, max 16) to both chat input schemas —
  the per-chat attach mechanism Phase 4's UI/persona resolution builds on.
- **`server/routers/brainRouter.ts`** (registered as `brains` in `routers.ts`):
  `list` / `get` / `stats` / `import` (base64 `.obp`) / `importBuiltins` /
  `export` (base64) / `delete` / `rebuildIndex`. All `protectedProcedure` — every
  op is local (no cloud AI/external service), so it works air-gapped. Thin,
  ownership-scoped façade over `BrainPackService`; size cap + validation +
  embedder-match all enforced in the service. (Cloud distillation is Phase 5's
  `cloudProcedure`; persona-durable attach/detach + Valet auto-suggest are
  Phase 4.)
- **Tests:** 15 new (8 `brainContext`: guards + ownership scoping + charter-only
  incompatible + dual-carrier + retrieve/cite + cross-brain merge/dedupe/rank +
  compatible-only query; 7 `brainRouter` route-level via `createCaller`:
  import/list/get/stats, incompatible flag, malformed reject, export round-trip,
  delete cascade, rebuild, cross-user no-leak). Full suite **1652 pass / 0 fail**;
  typecheck clean; production build clean.

### Phase 4 — Attachment + Valet routing ✅ (2026-07-14)
The durable persona attach + per-chat toggle resolution + Valet auto-suggest.

- **Persona-durable attach** — `personaBrainIds` lives in a persona's free-form
  `data.brains` (no migration). New `personaRouter.attachBrain` / `detachBrain`
  make it a first-class, ownership-gated API (both the persona *and* the brain
  must be owned by the caller; idempotent; capped at 16; preserves other `data`
  fields) rather than forcing the client to hand-craft the blob.
- **Chat-time resolution** — new `resolveAttachedBrainIds({ userId, personaId,
  brainIds })` in `brainContext.ts` **unions** a persona's durable brains with
  the per-chat `brainIds` (deduped, non-empty, capped at 16, best-effort on a
  missing/foreign persona). `injectBrainContext` now takes `personaId` and calls
  it; `personaId` added to both chat schemas + threaded at all three injection
  sites (`aiRouter.chat`, `aiProviderRouter.chatStream` + `agentChatStream`).
- **Valet auto-suggest** — `BrainPackService.suggest(userId, task, {limit,
  executionMode})` combines two signals: (1) **corpus relevance** — the task run
  against each *queryable* brain's vector index (best cosine similarity), the
  strong local signal; (2) **category alignment** — `ValetRouterService`
  classifies the task, and a tiny built-in stemmer (`code`↔`coding`,
  `generation`↔`generate`) does token-set overlap against the brain's
  domain/name/description. Score = `0.75·relevance + 0.25·aligned` for queryable
  brains, or `aligned ? 0.4 : 0.12` for charter-only (incompatible) brains — so a
  brain with no vectors can still be proposed on its label. Ranked, floored at
  0.3, capped at `limit`. Degrades gracefully when Valet is offline (semantic
  relevance still drives it). Exposed as `brainRouter.suggest` (`protectedProcedure`
  query — all local, air-gapped). Returns a **confirmable** set; never auto-attached.
- **Tests:** 12 new (5 `brainContext` persona-union: union/dedupe, foreign-persona
  ignore, malformed `data.brains`, 16-cap, persona→charter inject; 3 `brainRouter.
  suggest`: relevance ranking + classification, empty-when-no-brains, charter-only
  domain-alignment; 4 `personaRouter` attach/detach: idempotent attach, foreign-
  brain refusal, foreign-persona refusal, detach preserves other data). Full suite
  **1664 pass / 0 fail**; typecheck clean; production build clean.

### Phase 5 — Authoring / distillation pipeline ✅ (2026-07-14)
The end-to-end "build a brain" flow that turns raw sources into an `.obp`.

- **`server/core_services/services/BrainAuthoringService.ts`** — composes the
  existing primitives into one pipeline: **gather** (pasted `text` + scraped
  `url`s via `ScraperService`) → **sanitize** untrusted web content
  (`PromptSanitizer`, before it becomes corpus *or* distiller input) → **chunk**
  (boundary-aware, mirrors MemoryArchitect's 1500/200 chunker) → **optional
  distillation** (per-chunk synthetic Q&A via `AiProviderService`, tolerant —
  a model/parse failure skips that chunk, never aborts the build) → **embed**
  on-device in batches (`EmbeddingService`, all-MiniLM-L6-v2) → **assemble**
  charter + corpus with derived provenance (`source`:
  ingested|distilled|mixed, model, source URIs, license, notes) → **`packBrain`**
  → **write** to `BRAINS_CONFIG.userDir/<id>.obp` → **import live** through
  `BrainPackService`. Bounded throughout (≤50 sources, ≤500k chars/source,
  ≤4000 total chunks, ≤500 distilled chunks). Charter-only brains (no sources)
  and distilled-only corpora (`includeRawChunks:false`) both supported.
- **Sovereign posture** — distillation is the *only* cloud-capable step, gated
  per-provider via `assertProviderAllowedInMode` **before any work runs**, so an
  air-gapped user is blocked only when they request a *cloud* distiller; raw
  ingestion or a local (ollama/llamacpp) distiller authors a brain fully
  offline, and the resulting pack is 100% local at query time (embeddings
  prebuilt on-device + bundled).
- **`brainRouter.build`** (`protectedProcedure`, not blanket `cloudProcedure`, so
  local authoring stays air-gapped) — full input schema (sources, distill opts,
  charter, license, notes); returns the serialized brain + build stats
  (raw/distilled/total chunk counts, scrape failures, file path). Preserves a
  Sovereign `FORBIDDEN`; wraps other failures as `BAD_REQUEST`.
- **Tests:** 10 new (7 `BrainAuthoringService`: raw-ingest build + disk write +
  live import, distill→mixed provenance + Q&A chunk shape, URL scrape +
  sanitize + failure reporting, Sovereign cloud-distill block *before work*,
  Sovereign local-distill allowed, charter-only empty corpus,
  `includeRawChunks:false`→distilled-only; 3 `brainRouter.build` route: serialize
  + exec-mode passthrough, FORBIDDEN preserved, generic→BAD_REQUEST). Full suite
  **1674 pass / 0 fail**; typecheck clean; production build clean.

### Phase 6 — Coding exemplar brain ✅ (2026-07-14)
The first real, shipped built-in brain — authored through the pipeline and proven
to measurably improve a local 3–7B coding model.

- **Curated content** — `brains/sources/coding.ts`: a high-signal always-on
  **charter** (9 non-negotiable engineering rules) + a **corpus** of 50 original,
  durable software-engineering reference facts (JS/TS pitfalls, async/concurrency,
  security/OWASP, algorithms & complexity, data structures, errors, SQL, git,
  testing, HTTP/distributed, regex/encoding/time). One fact per entry so each maps
  1:1 to a clean, citable retrieval chunk. Original text, shipped CC0.
- **Authoring refactor** — extracted `BrainAuthoringService.authorPack()` (produce
  a `.obp` buffer + stats with **no** DB/import side effects) out of `build()`
  (now a thin wrapper: authorPack → write → live-import). This lets a built-in be
  produced with zero DB, and cleanly separates authoring from install. Also fixed a
  latent footgun: sources exceeding `MAX_SOURCES` are now `log.warn`'d instead of
  silently dropped (matching the existing chunk-cap warning).
- **Build script** — `server/scripts/buildCodingBrain.ts` (`pnpm brains:build:coding`)
  runs the charter+corpus through the REAL pipeline (chunk → on-device
  all-MiniLM-L6-v2 embed → pack) and writes the shippable `brains/coding.obp`
  (50 chunks, 384-dim, ~92 KiB). Fully local/air-gapped; deterministic given source.
- **Proof — retrieval (deterministic test)** —
  `server/core_services/brains/__tests__/codingBrain.test.ts` drives the REAL stack
  (BrainPackService import → real EmbeddedVectorStore libSQL vectors → real embedder)
  against the shipped pack: valid `.obp`, imports **ready/queryable** with the full
  corpus indexed, semantic search ranks the **correct curated fact #1** for the
  majority of representative questions and top-3 for all, and a **persona attach →
  `injectBrainContext`** case confirms charter + cited corpus injection.
- **Proof — model answers (live A/B)** — `server/scripts/evalCodingBrain.ts`
  (`pnpm brains:eval:coding`) holds model + system prompt + temperature identical
  across BASELINE vs BRAIN, changing only the injected charter+top-k corpus, and
  grades answers by objective fact-coverage. Live run against **qwen2.5-coder:7b**
  (the real 3–7B coding model on the DadsPC 4060 Ti, via a raw OpenAI-compatible
  endpoint so the model gets our controlled prompt with no agent/guardrail layer):
  **baseline 73.3% → brain 90.0% fact-coverage (+16.7pt absolute, +22.7% relative),
  5/10 questions improved, 0 regressed**, gains concentrated exactly where the base
  model was vague (SQL injection, password hashing, path traversal, N+1). Retrieval
  surfaced the correct primary fact for every question. Harness is runtime-agnostic
  (swap `OMNECOR_EVAL_BASE_URL` to point at Omnecor's own llama-server).

- **Extension — full "Team of Experts" (8 brains, all Phase-6-grade)** — the
  single Coding exemplar was generalized into a roster of 8 built-in experts,
  each curated to Phase-6 quality (24–50 one-fact-per-chunk entries) and proven
  by the SAME live A/B methodology. Seven are **general-purpose** (Software
  Architect, PCB & Schematics Engineer, 3D Modeler, Audio & Podcast Producer,
  Content Writer, Workflow Blueprinter, Coding); only **Omnecor Expert** is
  Omnecor-internal. Sources are reviewable TS modules in `brains/sources/*.ts`
  (registry `brains/sources/index.ts`), built via `pnpm brains:build:all`
  (`server/scripts/buildBrains.ts`). A generalized eval harness
  (`server/scripts/evalBrain.ts` + per-domain question sets in
  `brains/eval/*.cases.ts`, `pnpm brains:eval:all`) grades all 8. **Live run on
  the DadsPC .201 endpoint (qwen2.5-coder:7b for code domains, qwen2.5:7b for
  the rest): 8/8 brains posted a measurable, regression-free net win** — Omnecor
  Expert 27.8→88.9 (+61.1pt), Software Architect 58.3→97.2 (+38.9pt), Workflow
  Blueprinter 61.1→97.2 (+36.1pt), PCB 75.0→97.2 (+22.2pt), Audio 77.8→100.0
  (+22.2pt), 3D Modeler 80.6→100.0 (+19.4pt), Content Writer 72.2→91.7
  (+19.4pt), Coding 73.3→90.0 (+16.7pt). Deterministic retrieval for every
  built-in is covered by
  `server/core_services/brains/__tests__/builtinBrains.test.ts`. Doc:
  `docs/ai-agents/CUSTOM_BRAIN_PACKS.md` (full scoreboard).

### Phase 7 — OMMESH sync ✅ (2026-07-14)
Transfer a Brain Pack to a peer node over the existing strict-mTLS mesh transport;
verify embedder-match on receive.

- **New mesh route `POST /brain`** (`server/ommesh/core/MeshServer.ts`,
  `handleBrain`) — sits behind the identical fail-closed gate as `/sync` and
  `/discourse`: the upstream pinned-peer mTLS trust check (`isTrusted`) + a fresh
  **HMAC-SHA256 signature** over the whole envelope (`verifyHmacSig` /
  `OMMESH_SECRET`) + a **5-minute replay window**. A dedicated 48 MB body cap
  (`MAX_BRAIN_BYTES`) bounds a hostile oversized push (admits ~36 MB raw packs —
  far above any real brain). Relays the receiver's import result; a genuine
  import failure returns 400, an incompatible-embedder import is a success (200)
  flagged in the payload.
- **Receive** (`MeshNode.receivePeerBrain`) — decodes the base64 `.obp`, resolves
  the **local owner account** (`resolveLocalOwnerId`: prefer `owner` role → `admin`
  → lowest-id user; fail closed if the DB has no user), and imports via
  `BrainPackService.importFromBuffer`. **Embedder-match is verified there**: a
  mismatch is persisted `incompatible` (charter kept, corpus never indexed) and
  the verdict (`embedderMatch` / `status` / `vectorsLoaded`) is returned so the
  sender learns whether the brain landed queryable. Best-effort (empty/corrupt
  pack, no owner, DB error ⇒ `{ ok: false }`, never throws). Broadcasts
  `ommesh:brain_received` over WS so the Phase-8 manager UI refreshes live.
- **Send** (`MeshNode.sendBrainToPeer` / `sendBrainToPeerByName`) — base64 +
  signed, timestamped envelope pushed over the pinned mTLS channel (`postToPeer`,
  now with a caller-set timeout; 120 s for the larger brain payload).
- **Router** — `brainRouter.syncToPeer({ brainId, peerId })`
  (`protectedProcedure`, peer-to-peer local compute so it works in Sovereign
  mode): losslessly `export`s the owned brain from its durable chunk store, then
  `sendBrainToPeerByName`. Ownership-checked (foreign/missing brain ⇒ NOT_FOUND);
  transport failure or peer-side rejection ⇒ BAD_REQUEST with the reason.
- **Tests:** 19 new (`meshServerBrain.test.ts` 7: trusted import + verdict relay,
  incompatible-still-200, import-fail→400, untrusted→403, bad-sig→401, replay→401,
  missing-brain→400; `meshNodeBrainSync.test.ts` 8: owner-resolve + import + verdict
  + WS broadcast, incompatible surfaced, no-owner/empty/error fail-closed, peer-not-
  found, signed-base64 envelope, discovery routing; `brainRouter.test.ts` +4:
  export+push success, foreign→NOT_FOUND, transport-fail→BAD_REQUEST, peer-reject→
  BAD_REQUEST). Full suite **1721 pass / 0 fail**; typecheck clean; production
  build clean.

### Phase 8 — UI ✅ (2026-07-15)
A "Brains" manager surface + per-chat toggle, extending the neural-map/knowledge
navigation. Follows `Context/UI-Tokens.md` + `Context/UI-Rules.md`; imprinted.

- **`client/src/pages/BrainsManager.tsx`** (route `/brains`) — the management
  home. Lists every brain as a `Card` with a live **health + embedder-match
  indicator** (status badge ready/incompatible/error using semantic accent
  tokens; embedder id/dim with a match ✓ / mismatch ⚠︎ line; chunk count).
  Actions per brain: **export** (download the `.obp`), **rebuild index** (shown
  when incompatible), **sync to peer** (Phase-7 dialog over `ommesh.discover` +
  `brains.syncToPeer`), **delete**, and **attach/detach to a selected persona**
  (`personas.attachBrain` / `detachBrain`). Header actions: **import built-ins**
  and **import a `.obp` file** (chunked base64, client-side). Empty-state CTA.
  All calls local tRPC → works air-gapped.
- **`client/src/components/chat/BrainToggle.tsx`** — the **per-chat toggle**: a
  compact accent-purple pill in the chat input toolbar (DropdownMenu of
  checkboxes) that selects which brains augment the current chat. Incompatible
  brains are shown-but-disabled (no queryable corpus). Selection persists in the
  app store (`activeBrainIds`) and is threaded into
  `aiProvider.agentChatStream` as `brainIds` at stream time in `Chat.tsx` — the
  server injects charter + top-k corpus, unioned with persona-durable brains.
- **Navigation** — new sidebar entry + Command Palette command (`nav-brains`) +
  lazy route, using the `BrainCircuit` icon, placed next to the Neural Brain Map.
- **Store** — `activeBrainIds` + `setActiveBrainIds` / `toggleActiveBrain`
  (persisted) added to `app.store.ts`.
- **Imprinted** — `BrainsManager` + `BrainToggle` captured to
  `Context/UI-Registry.md`. Typecheck clean; production build clean.

### Phase 9 — Tests + verify (gate every phase) ✅ (end-to-end live-proven 2026-07-15)
- Unit (vector KNN, pack import/embedder-match rejection, charter-always-on + top-k merge), route tests via `appRouter.createCaller`, and an end-to-end drive: attach the Coding brain → real local-model chat → confirm grounded, cited output. Typecheck + coverage ratchet each phase.
- **Live end-to-end drive (2026-07-15) — brain over OMMESH to Omnecor's own model hosting (NOT Ollama):**
  Linux node (`omnecor-linux`) ↔ DadsPC `.201` (`omnecor-dadspc`) over strict-mTLS OMMESH, mutual
  fingerprint approval. Coding brain imported (`omnecor-coding`, status `ready`, 53 chunks, embedder
  match). `ai.chat` called with `providerId:"llamacpp"` + `targetNodeId:"omnecor-dadspc"` +
  `brainIds:["omnecor-coding"]` against **qwen2.5-coder:7b on .201's own `llama-server` runtime**
  (proven remote: this box has no local runtime, and a pinned `targetNodeId` throws on offload failure
  rather than falling back — a returned answer *must* have executed on .201).
  - **Grounded:** baseline gave muddled/incorrect dynamic-SQL-identifier advice; with the brain the
    model returned the exact curated guidance ("Allow-List for Any Dynamic Identifier … reject input
    not in the allow-list", "No String Concatenation of User Input into SQL Ever").
  - **Cited:** model emitted real source tags — `[Brain: Coding · sec-sql-dynamic-identifiers-allowlist]`
    and `[Brain: Coding · sec-sql-injection-parameterized]`.
  - **Impossible→success:** Omnecor Expert brain (`omnecor-expert`, ready, 32 chunks) on an
    Omnecor-internal question. Baseline hallucinated ("Omnecor is part of Alibaba Cloud", invented
    "Standard/Enterprise" modes); with the brain the 7B answered correctly — Sovereign/Scrapper/
    Big-Spender modes + `cloudProcedure` as the Sovereign-enforcing tier, cited
    `[Omnecor Expert · security-execution-modes]`.
  - **Static gate:** `pnpm check` ✅ 0 errors · `pnpm test` **1741 passed / 4 skipped (152 files)** ✅.

---

## 4. Status Tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Blueprint & decisions | ✅ Done |
| 1 | Embedded vector engine (libSQL vectors + on-device embedder + backend factory) | ✅ Done 2026-07-13 |
| 2 | Brain Pack `.obp` format + `brains`/`brain_chunks` schema + loader/validator | ✅ Done 2026-07-14 |
| 3 | Retrieval + injection (charter + corpus) + `brainRouter` | ✅ Done 2026-07-14 |
| 4 | Persona/chat attach + Valet auto-suggest | ✅ Done 2026-07-14 |
| 5 | Authoring / distillation pipeline | ✅ Done 2026-07-14 |
| 6 | Coding exemplar brain (real, proven) | ✅ Done 2026-07-14 |
| 7 | OMMESH pack sync | ✅ Done 2026-07-14 |
| 8 | Brains manager UI | ✅ Done 2026-07-15 |
| 9 | Tests + end-to-end verification (per-phase gate) | ✅ Live-proven 2026-07-15 (brain→OMMESH→.201 own runtime; grounded + cited; `pnpm check`✅ / `pnpm test` 1741✅) |

---

## 5. Key Files (living index)

**Phase 1 (shipped):**
- `server/core_services/services/EmbeddingService.ts`
- `server/core_services/services/EmbeddedVectorStore.ts`
- `server/core_services/services/VectorStore.ts`
- `server/db.ts` (`getLibsqlClient()`), `server/db.factory.ts`
- `server/core_services/config/index.ts` (`EMBEDDING_CONFIG`)
- Wiring: `server/_core/context.ts`, `server/_core/index.ts`, `server/core_services/services/MemoryArchitectService.ts`
- Tests: `server/core_services/services/__tests__/{EmbeddingService,EmbeddedVectorStore,VectorStore}.test.ts`

**Phase 2 (shipped):**
- `server/core_services/brains/obpFormat.ts` (+ `__tests__/obpFormat.test.ts`)
- `server/core_services/services/BrainPackService.ts` (+ `__tests__/BrainPackService.test.ts`)
- `drizzle/schema.ts` (`brains`, `brainChunks` + relations), `drizzle/migrations/0018_marvelous_leopardon.sql`
- `server/core_services/config/index.ts` (`BRAINS_CONFIG`)
- `server/core_services/services/{VectorStore,EmbeddedVectorStore,VectorDBService}.ts` (`addDocumentsWithEmbeddings`)

**Phase 3 (shipped):**
- `server/_core/brainContext.ts` (`injectBrainContext`) — wired into `server/routers/aiRouter.ts` + `server/routers/aiProviderRouter.ts` (`brainIds` on both chat schemas)
- `server/routers/brainRouter.ts` (registered as `brains` in `server/routers.ts`)
- Tests: `server/__tests__/brainContext.test.ts`, `server/__tests__/brainRouter.test.ts`

**Phase 4 (shipped):**
- `server/_core/brainContext.ts` (`resolveAttachedBrainIds` + `personaId` on `injectBrainContext`) — `personaId` threaded through `aiRouter` + `aiProviderRouter` chat schemas
- `server/routers/personaRouter.ts` (`attachBrain` / `detachBrain`)
- `server/core_services/services/BrainPackService.ts` (`suggest` + `tokenStems`), `server/routers/brainRouter.ts` (`suggest`)
- Tests: `server/__tests__/brainContext.test.ts`, `server/__tests__/brainRouter.test.ts`, `server/__tests__/personaRouter.test.ts`

**Phase 5 (shipped):**
- `server/core_services/services/BrainAuthoringService.ts` (`build` pipeline: gather→sanitize→chunk→distill→embed→pack→write→import)
- `server/routers/brainRouter.ts` (`build` procedure)
- Tests: `server/core_services/services/__tests__/BrainAuthoringService.test.ts`, `server/__tests__/brainRouter.test.ts` (build route)

**Phase 6 (shipped):**
- `brains/sources/coding.ts` (curated charter + 50-entry corpus, source of truth)
- `brains/coding.obp` (built-in pack, authored through the pipeline)
- `server/scripts/buildCodingBrain.ts` (`pnpm brains:build:coding`)
- `server/scripts/evalCodingBrain.ts` (`pnpm brains:eval:coding` — live A/B proof)
- `server/core_services/services/BrainAuthoringService.ts` (`authorPack()` split from `build()` + source-cap warning)
- Tests: `server/core_services/brains/__tests__/codingBrain.test.ts`

**Phase 6 extension — full Team of Experts (shipped):**
- `brains/sources/_types.ts` + `brains/sources/index.ts` (registry) + the 7 new
  expert sources: `software-architect.ts`, `omnecor-expert.ts`, `pcb-engineer.ts`,
  `3d-modeler.ts`, `audio-producer.ts`, `content-writer.ts`, `workflow-blueprinter.ts`
- `brains/{software-architect,omnecor-expert,pcb-engineer,3d-modeler,audio-producer,content-writer,workflow-blueprinter}.obp` (built-in packs)
- `server/scripts/buildBrains.ts` (`pnpm brains:build:all`)
- `server/scripts/evalBrain.ts` (`pnpm brains:eval:all`) + `brains/eval/_types.ts`,
  `brains/eval/index.ts`, `brains/eval/*.cases.ts` (8 per-domain question sets)
- Tests: `server/core_services/brains/__tests__/builtinBrains.test.ts` (all 8, deterministic)
- Doc: `docs/ai-agents/CUSTOM_BRAIN_PACKS.md` (8 experts + eval scoreboard)

**Phase 7 (shipped):**
- `server/ommesh/core/MeshServer.ts` (`POST /brain` route + `handleBrain` + `MAX_BRAIN_BYTES`)
- `server/ommesh/core/MeshNode.ts` (`receivePeerBrain` + `resolveLocalOwnerId` + `sendBrainToPeer` / `sendBrainToPeerByName` + `BrainSyncResult`; `postToPeer` timeout arg)
- `server/routers/brainRouter.ts` (`syncToPeer` procedure)
- Tests: `server/__tests__/meshServerBrain.test.ts`, `server/__tests__/meshNodeBrainSync.test.ts`, `server/__tests__/brainRouter.test.ts` (syncToPeer routes)

**Phase 8+ (to be added):** Brains manager UI under `client/src/`.
