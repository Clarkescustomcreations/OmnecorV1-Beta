# Changelog

## [Unreleased]

### 2026-07-13 — Blueprint Studio enhancements (7 additions across 3 waves)

*A follow-on pass that deepens the engineering coverage, closes the workflow loop, and lets you bring in existing geometry. All additive; every change gated by `pnpm check` + the blueprint suite (56 → 86 tests), including a `/review` hardening pass.*

#### Added

- **Six new deterministic calcs** in `engineering_calc` (each with formula workings + safety factor): `fillet_weld` (throat/length capacity vs. electrode strength), `bolted_connection` (governs bolt-shear / plate-bearing / edge tear-out), `torsion` (round bar/tube shaft — max shear + angle of twist), `wood_joinery` (NDS lag/wood-screw withdrawal, end-grain refused), `printed_part` (FDM strength on the effective walls+infill section, layer-adhesion knockdown), and `heat_check` ("will this plastic part survive the sun / a hot car without softening" — service-temp vs. a scenario peak with a documented solar-gain model). +12 golden-value tests.
- **Cut-optimization → BOM link**: `optimize_cuts` now takes `writeToBom` to record the computed buy-quantity straight onto the matching BOM stock line (upsert by `materialKey`, else name) and saves the nesting run for provenance — no re-keying into `set_bom`.
- **Part revision history** (migration `0017`): recompiling (or re-importing) a part supersedes its prior file instead of piling up — `blueprint_files` gains `version` / `supersedesId` / `isLatest`; the Drawings/3D/PDF read the latest, and the Files tab shows the version and dims superseded rows (still downloadable).
- **Async FEA**: `run_fea` records a `running` row up-front and solves **decoupled from the chat-stream signal** — a client disconnect no longer kills a multi-minute solve; it finishes and updates the row in the background. The Simulation tab shows a RUNNING badge → completed.
- **Shopping export**: `blueprint.exportBom` produces an RFC-4180 CSV + a supplier-grouped printable buy-list with a known-price rollup (Sovereign-safe, no network); "Export list" button on the BOM tab.
- **Geometry import** (`blueprint.importGeometry`): bring in an existing **STL** (reuses `parseStl` → a full part: 3D viewer + drawings + FEA-ready) or a **DXF** outline (minimal LINE/LWPOLYLINE reader → outline-preview SVG + the original DXF). STEP/IGES intentionally out of scope (no heavy CAD kernel). "Import STL/DXF" control on the 3D tab.

#### Changed

- `ChatAgentRunner`-injected Blueprint tools' file persistence extracted to a shared `persistPlanFile` (fileStore.ts) carrying the revision-lineage logic, reused by compile_cad and geometry import.

#### Tests

- +30 (56 → 86): the 6 calcs (golden values), cut→BOM upsert + provenance, revision lineage, async-FEA running→completed + signal-decoupling, CSV/buy-list export, DXF reader + STL import, input-guard errors, plus two new files — `blueprintAgentStream.test.ts` (subscription-level turn persistence + empty-history filtering) and `blueprintPlanPdf.test.ts` (booklet structure + WinAnsi transliteration).

#### Fixed (`/review` pass)

- `heat_check` crashed on an out-of-enum scenario (`HEAT_SCENARIOS[bad].peakC`); `printed_part` silently treated an unknown mode as bending; `requiredSafetyFactor` returned `undefined` on a bad basis (→ every SF check silently false) — all three now throw a clear, guiding error. Persistence (`persistPlanFile`) now clears the old `isLatest` and inserts the new latest **atomically** via `db.batch` (crash-safe). Dropped an unused `printedPart` modulus param; corrected a non-existent `opacity-55` Tailwind class to `opacity-60`.

### 2026-07-13 — Blueprint Studio: AI-assisted fabrication planning (new page + agent toolset)

*A full general-purpose Creation/Fabrication planning system: describe any physical project (carpentry, metal fab, structures, vehicles, 3D printing, multi-part costumes) and an agentic session turns it into a persistent Build Plan — materials, cut lists with angles, dimensioned drawings, 3D geometry, true-scale patterns, deterministic engineering verification, and step-by-step assembly. Live-verified end-to-end: a real Gemini agent turn looked up catalog materials, ran the beam check (SF 12.54 PASS), wrote the BOM/cut list, compiled CAD geometry to mesh/STL/drawing/DXF, and the plan exported as a clean 3-page PDF booklet.*

#### Added

- **Blueprint Studio page** (`/blueprint-studio`): plans rail (attached to the active Neural Map) → planning conversation (reuses the agentic `AssistantStream` + `ModelSelector`) → Build Plan document tabs (Overview / BOM / Cut List / Drawings / 3D / Patterns / Simulation / Steps / Files). BOM and cut list are hand-editable; blueprint SVGs render inline; the 3D tab shows compiled parts with an FEA von-Mises heatmap overlay; Export PDF produces the full booklet.
- **`ChatAgentRunner` domain-tool extension**: `AgentRunParams.extraTools` (injectable `ExtraAgentTool[]`, dispatched before the MCP fallthrough, rendered as the existing mcp tool box) + `includeBuiltInTools:false` so a feature surface can run a pure domain toolset with no file-edit/shell access. Text-protocol prompt now renders injected tools generically from their JSON Schema; proven built-in wording unchanged.
- **Blueprint agent toolset** (11 tools): materials catalog search, deterministic `engineering_calc` (beam/column/fastener/rafter/stairs/compound-miter/triangle — results persisted with formula workings + safety factors), cut/sheet/fabric `optimize_cuts`, plan document writers (`update_plan`/`set_bom`/`set_cut_list`), `compile_cad`, `generate_pattern`, `run_fea`, `generate_concept_image`, and cloud-gated `search_materials_web` (omitted entirely for sovereign users).
- **Engineering calc engine** (`calcEngine.ts`): pure-TS, SI-metric, basis-aware safety factors (allowable/yield/ultimate + FDM layer-adhesion knockdown); 23 golden-value tests against textbook formulas.
- **Offline materials database** (~50 entries with real mechanical properties: NDS №2 lumber design values, ASTM A36/A500/6061/4130 metals, filament datasheets incl. layer-adhesion factors, fabrics/EVA/Worbla) — keeps Sovereign mode fully functional.
- **Dual-engine parametric CAD** (`BlueprintCadService`): JSCAD (`@jscad/modeling`) in a `node:vm` sandbox as the zero-install default; OpenSCAD as an optional external binary (Settings `openscadPath`, `--version` probe — same pattern as Blender/KiCad). Output: viewer mesh JSON, binary STL, dimensioned three-view drawing SVG (real feature-edge projection + title block), R12 DXF.
- **True-scale pattern PDFs** (`patternPdf.ts`): seam-allowance polygon offsetting, tiled US-Letter pages with 100 mm calibration square, registration crosses, glue-grid labels, cut vs stitch lines, grainline arrows.
- **Real FEA** (`fea_bridge.py` + `BlueprintFeaService`): Gmsh tet-meshing of compiled STLs + TET4 linear-static elasticity (numpy/scipy), von-Mises nodal field for the 3D heatmap; optional dependency (`pip install gmsh numpy scipy`) probed with graceful degradation.
- **Schema**: 6 new tables (`blueprint_plans/_bom_items/_cut_items/_files/_sim_results/_messages`), migration `0016`; all dimensions stored in mm, displayed per plan units.
- **Tests**: 56 new (calc golden values, CAD compile/sandbox/STL round-trip/drawings, router ownership + toolset against the real in-memory DB).

#### Fixed

- **Migration drift on live installs silently blocked all new migrations.** The runtime DB had an older-generation `0015` applied (different hash/timestamp than the regenerated file), so the auto-migrator re-ran it, failed on `model_assets already exists`, and **warn-and-continued — every future migration (including `0016`) was silently skipped**. Repaired the drifted DB (created the one missing unique index, recorded the current `0015` in `__drizzle_migrations`), after which `pnpm db:migrate` applies cleanly and `/health` reports `migrationOk: true`.
- **Gemini streaming returned empty responses with no error.** `chatGemini` called `:streamGenerateContent` without `alt=sse`, so Gemini answered with one pretty-printed multi-line JSON array; the per-line parser silently dropped every line and the stream "completed" with zero chunks. Added `alt=sse` (single-line `data: {...}` events the parser already handles).
- **`exportPdf` crashed in production builds** (`__dirname is not defined`): pdfkit/fontkit load font-metric data via `__dirname`-relative paths, which esbuild inlining breaks. Marked `pdfkit` + `svg-to-pdfkit` as bundle externals.
- **Blueprint conversation self-poisoning**: a failed/empty turn used to persist an empty assistant row that later turns replayed to providers (Gemini 400s on empty parts). Empty turns are no longer persisted, and history rows with empty content are filtered from provider requests.
- **Plan-PDF text fidelity**: Greek/math symbols in calc workings (σ τ δ ⁴ ≥ ✓) transliterated for pdfkit's WinAnsi Helvetica; wrapped table headers no longer overlap rows; cut-list notes no longer truncate.

### 2026-07-12 — `/review` + `/architect` pass: preview crash-isolation, dev HMR noise silenced

*A review pass on the 2026-07-11 model-download work. It fixed a real whole-page crash class, eliminated the dev-only console noise, and hardened the lazy-load recovery path. All changes live-verified via chrome-devtools against the running dev server (Chat + 3D Designer render clean; console error log empty; `/ws` still upgrades).*

#### Fixed

- **Chat & 3D Designer no longer crash when a preview panel's module graph faults.** `EnhancedPCBEditor` / `ThreeViewer` / `WebPreview` were statically imported at page top-level, so a throw during *their* module evaluation failed the *page's own* module and dropped the whole route to its RouteBoundary. They're now code-split and rendered behind a new **`LazyPreviewPane`** (Suspense + a per-pane `ErrorBoundary`), so a failure is contained to the pane with a Retry. Also reverted an inert import-alias change (`EditorToolbar as EditorToolbarComponent`) that had masqueraded as the fix — a named-import rename can't fix a `ReferenceError`; the real cause was the eager static import.
- **Dev HMR console noise gone.** `OmnecorWebSocketServer` bound `ws` with `{ server, path: "/ws" }`, which makes `ws` abort (HTTP 400) *every* non-`/ws` upgrade on the shared HTTP server — including the Vite HMR client's socket (`"WebSocket closed without opened."` + an unhandled promise rejection on every page load). Switched to `noServer` + a manual `upgrade` router that claims only `/ws` and leaves other upgrades (Vite HMR) untouched. Dev-only; `verifyClient`/origin/auth are unchanged (still applied by `handleUpgrade`), and mesh mTLS is a separate server. Verified: the app `/ws` still opens and the console error log is now empty.

#### Added

- **`lazyWithRetry()`** (`client/src/lib/lazyWithRetry.ts`) — a `React.lazy` drop-in that retries the dynamic import with exponential backoff before settling, so a transient chunk-load blip self-heals without surfacing an error. Used by the preview panels.
- **`ErrorBoundary` optional `fallback` prop** — `ReactNode | ((reset, error) => ReactNode)` (backward compatible; default full-screen UI unchanged). `LazyPreviewPane`'s Retry is error-aware: it **reloads** for a genuine chunk-load failure (the only thing that re-fetches a cached-rejected chunk / fixes a stale deploy) and **resets** in place for a transient render error.

#### Changed

- **`modelMarketplace.downloadModel` input `filename` → `filePath`** (it carries a repo-relative `.gguf` path that may include a subfolder, not just a basename); caller + test updated. No external-API change.

**Gates:** `pnpm check` ✅ · affected tests (`modelMarketplaceRouter`) ✅ · live-verified via chrome-devtools MCP.

---

### 2026-07-11 — Fixable-now gaps: MoE on the unified runtime, PCBWay closed, Hugging Face model download

*Three self-contained fixes with no hardware needed: local inference is now **fully** unified on Omnecor's own runtime (the standalone Python `llama.cpp` bridge is retired), the PCBWay manufacturing path got its missing test coverage, and you can now **download models from Hugging Face** — GGUFs to run locally, and whole base-model repos to fine-tune offline.*

#### Added

- **Hugging Face → local runtime downloads** (`ModelMarketplaceService` + `modelMarketplaceRouter`): browse Hugging Face (now **keyless** for public models) and download either
  - a single **GGUF quant** into the models dir — auto-indexed by `ModelIndexService`, runnable on the local `llama-server` with no Ollama, surfaced as a new **"HF GGUF"** tab in the Model Hub (search → open a repo → pick the exact quant with its real size → download with live progress); or
  - a whole **base-model repo** (config + tokenizer + safetensors — skipping GGUF/other-framework blobs and redundant PyTorch weights) into a new base-models dir for **offline/sovereign fine-tuning** — wired into the **LLM Builder** ("Browse HF" → downloads the full repo → sets the base model to the local path so training runs with no network).
  - Downloads stream atomically (`.part` → rename), are idempotent (an already-present file reports done), report byte/file progress via a polled status, and are **not** Sovereign-gated (a download is a fetch, not inference). A compatibility note tells users Omnecor isn't in HF's "Use this model" menu — pick a GGUF (the same files Ollama/llama.cpp use).
- **`AiProviderService.completeLocal()`** — single-model local completion on the managed `llama-server` runtime, bypassing Valet routing and the sub-agent harness (used by MoE-Chain).

#### Changed

- **MoE-Chain local steps now run on Omnecor's own `llama-server` runtime**, not the standalone Python bridge. Each step calls `completeLocal()`, which hot-swaps the runtime to that step's model (`ensureModelLoaded` — the swap itself frees the prior model's RAM), rendering the prompt with the model's real chat template. The old crude flat-prompt + manual `unload`/`preWarm` dance is gone. **Also fixes a latent bug** (self-review): a chain step's model is now resolved as `modelPath` (directory) **joined with** `ggufFile` (filename) — previously the bare directory was passed to the loader, so a local chain would have failed to resolve and silently served the wrong/loaded model. Guarded by a regression test.

#### Removed

- **Retired the standalone `llama.cpp` Python bridge** — `server/python_bridges/llamacpp_bridge.py`, `LlamaCppService.ts`, and the `:8013` startup health entry. It was fully dead once MoE-Chain migrated (its only live caller); local inference lives entirely on the managed `llama-server` runtime now. Cloud and Ollama paths are unaffected (they never went through this bridge).

#### Fixed

- **TD-042 (PCBWay) closed.** The quote/order path has been real since 2026-06-23 (parametric quote from extracted board specs + a real Gerber/drill ZIP multipart-uploaded at order time); the lingering gap was **test coverage** and a stale "Open" header. Added `pcbwayService.test.ts` (quote body with no path leaked, order multipart uploads the real ZIP bytes, config/HITL gates) + `kicadRouterPcbway.test.ts` (router wiring + HITL-deny) and corrected the record.

#### Fixed (self-review pass)

- **LLM Builder base model now actually reaches the trainer.** The **Start Training** button passes the selected/downloaded base model as `modelName` — previously the base-model field (pre-existing) was set in the UI but never sent, so the trainer silently used its default. (This is what completes the base-model download feature end-to-end.)
- **`LocalLlmRuntimeService.ensureModelLoaded` now throws for an unindexed model** instead of silently serving whatever model is already loaded — a wrong-weights/confidently-wrong-answer risk (e.g. a MoE step or a chat pinned to a specific local model). The caller surfaces a clear "not in the local index" error.
- **HF downloads: free-space pre-flight guard** (fails fast with a friendly message instead of streaming GBs into a full disk) and **concurrent-download de-dup** (a double-click on the same file returns the in-flight download rather than racing a second write). The in-memory download registry is also capped so finished entries don't accumulate.

**Live-verified** the real Hugging Face tree + resolve-URL contract (LFS sizes, 302→CDN redirect) via curl.

**Gates:** `pnpm check` ✅ · `pnpm test` **1504 passed / 4 skipped** (+35) · `pnpm build` ✅ · `pnpm audit --prod` ✅.

---

### 2026-07-10 — Model-Fabric Phase 8: local GGUF auto-discovery + hot-swap

*Omnecor's own runtime now hosts **every** local GGUF with no manual registration — the app models dir **and** the Ollama blob store — and hot-swaps between them on selection. Ollama can be stopped and every model it ever pulled is still served by Omnecor.*

#### Added

- **`ModelIndexService`** (`server/core_services/services/ModelIndexService.ts`) — singleton that auto-discovers every GGUF on the machine from two sources with no manual adds: (1) `PATHS.models` (any `.gguf` dropped in the app models dir, skipping the `valet-router/` classifier); (2) the **Ollama blob store** (`~/.ollama/models`, or `$OLLAMA_MODELS`) — parses Ollama's own manifests → the `model` layer digest → `blobs/sha256-*`, and reconstructs each model's **real name** (`deepseek-r1:14b`, not a `sha256-…` blob). Reads straight off disk, so it works **with the Ollama server stopped** — the blobs are just files, which is the whole point of Ollama being optional. Every entry is GGUF-magic-verified (first 4 bytes) and content-deduped by `size + sha256(first 64 KB)` so the same weights reached via two paths (a models-dir hardlink and its Ollama blob) collapse to one entry (models-dir wins). The scan is async (`fs/promises`) and cached (30 s); `list()`/`resolve()` are synchronous cache reads that never block the request hot path — a stale cache fires a background refresh, and `LocalLlmRuntimeService` awaits one `refresh()` at boot to prime it.
- **`aiProvider.loadLocalModel`** (`protectedProcedure`) — non-blocking hot-swap trigger: fires `LocalLlmRuntimeService.ensureModelLoaded()` fire-and-forget and returns `{ started: true, modelId }` immediately, so the picker never hangs on a multi-second model load and a background load failure never rejects the request.
- **`ModelSelector` "loading… → loaded" indicator** — selecting a cold local model calls `loadLocalModel`, drops the catalog `refetchInterval` to 2.5 s, and flips to a `bg-accent-success` "loaded" mark once the catalog's `loaded` flag confirms the warm model, with a ceiling so a failed load can't leave a stuck "loading…".

#### Changed

- **`LocalLlmRuntimeService` is now a multi-model host, not a single-static-model server.** New `ensureModelLoaded(idOrPath)` **hot-swaps** the managed `llama-server` (stop current → spawn requested). **All** lifecycle work — boot load, hot-swap, and crash respawn — is funnelled through **one serialization queue**, so overlapping requests can never orphan a second `llama-server` on the port. `--n-gpu-layers` is now computed **per model** (`_computeGpuLayers()` via `collectGpuTelemetry()` free-VRAM): fits → all layers, else a proportional partial offload — no OOM crash-loop for a 14B/27B on an 8 GB GPU. The last loaded model is persisted (`localLlmLastModel` setting); boot resumes it, otherwise the runtime stays idle and loads on first selection. Added `getLoadedModelId()` / `isAvailable()`.
- **`ModelCatalogService` lists all indexed models as `omnecor-runtime`** (not just the one that happens to be warm) — the warm one is flagged `loaded` (ready-gated: `isReady() ? getLoadedModelId() : null`, so a model mid-swap or one whose load failed is never falsely flagged), the rest hot-swap in on demand. When the local runtime is available it **skips the live Ollama API source**, since `ModelIndexService` already covers the Ollama store off disk — no double-listing, and no dependency on the Ollama daemon being up.

#### Fixed

- **`/review` on the Phase 8 diff found 6 issues, all fixed the same session** (1 Important, 5 Minor): serialized *all* runtime lifecycle work through one queue (nothing orphans a server on the port); `_waitForHealth` bails immediately on process death instead of polling a dead PID; the index scan is async/non-blocking off the request hot path; the `loaded` flag is ready-gated; the Ollama source-gating is content-clean (index vs. live API never double-count); GPU-layer computation falls back CPU-safe when telemetry is unavailable.

**Live-verified on DadsPC (`.201`, RTX 4060 Ti):** all 10 of the box's Ollama GGUFs render as **"Omnecor · This PC"** (0 Ollama-branded), and boot-resume + hot-swap + inference (answered `REVIEW_FIX_OK`) + last-model persistence were all confirmed on real hardware.

**Still open (at the time of Phase 8):** ~~a Hugging Face browse/download UI~~ and ~~MoE-Chain on the separate `LlamaCppService` / port-8013 bridge~~ — **both shipped 2026-07-11 (see the entry above)**; the APK picker's loaded-indicator UI (the `loaded` flag is mirrored in the type, but the mobile picker doesn't render it yet) remains.

**Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1469 passed / 4 skipped** (+22 from the 1447 Mesh-Delegation baseline; 1 new file `ModelIndexService.test.ts`, 8 tests)

---

### 2026-07-08 — Mesh Sub-Agent Delegation (Mesh-Delegation Phases 1–9)

#### Added

- **`shared/subagent.ts`** — wire contract for the peer-to-origin NDJSON relay: turn-request shape, sequenced envelope wrapping `AgentStreamEvent`, control shapes (approval/cancel), run-status enum, error codes, constants.
- **`subagent` `AssistantBlock` type** added to `shared/chatBlocks.ts` union (dot, node name, tap-through); `blockDotIntent` / `flattenBlocksToText` / `isToolBlock` extended; `ApprovableBlockType` gained `subagent`.
- **`SubAgentHostService`** (`server/core_services/services/SubAgentHostService.ts`) — runs a full `ChatAgentRunner` loop on the peer inside a `validatePath`-enforced sandbox (`~/.omnecor/delegation/<taskId>/` or an opt-in path shown in the spawn approval). Maintains a per-run registry, concurrency cap + kill-switch admin setting, isolated `ToolApprovalRegistry` broker, `executionMode` enforcement (sovereign origin → no cloud reach from the peer), cursor-replay buffer (for cursor re-attach), grace-window abort, and `start_job` continuation via `AsyncJobService`.
- **4 mTLS mesh endpoints** on the existing `:3001` listener (pinned-peer trust gate inherited): `POST /subagent` (spawn or follow-up turn, NDJSON stream with lazy headers so pre-stream policy errors surface as clean HTTP statuses), `GET /subagent/:id/stream?since=N` (cursor re-attach with attach header + replay + keepalive), `POST /subagent/:id/approval`, `POST /subagent/:id/cancel`.
- **`DelegationService`** (`server/core_services/services/DelegationService.ts`) — origin-side: opens the peer NDJSON stream over pinned-fingerprint mTLS; persists finished turns into an origin-owned conversation (tagged `taskId` / `targetNodeId` / `parentConversationId` in `chat_sessions`); re-publishes live turns via WebSocket; forwards ownership-checked HITL approvals and cancels; re-attaches the cursor after a drop; re-prompts the parent chat on completion via a synthetic `AsyncJobService` result (jobId = taskId).
- **`delegate_task` tool** in `ChatAgentRunner` — offered only when `allowDelegation` is set (trusted peer present). ALWAYS HITL-gated on the parent even when `autoApproveTools` is on; shows the requested scope and target node in the approval dialog. Emits a `subagent` block; ends the parent turn on approved spawn (start_job semantics — parent is re-prompted asynchronously with the condensed result).
- **`delegationRouter`** (`server/routers/delegationRouter.ts`) — `stream` (replay + follow-up subscribe), `sendTurn`, `cancel`, `status`. `aiProvider.resolveToolApproval` transparently forwards peer-owned approval IDs to the correct peer endpoint. `agentChatStream` sets `allowDelegation` from the active mesh peer set. New `delegationEvent` WebSocket broadcast covers lifecycle (started / turn-complete / done / failed).
- **Web client** — delegated chats appear in the conversation list with a **Network** badge and node name; `delegationEvent` WS message invalidates the list and shows a toast. Parent-side `SubAgentBox` chip (approve/deny inline + tap-through to the managed chat). `delegation.stream` folded live with `applyAgentEvent`; between-turn input posts via `delegation.sendTurn`. Stream banner shows the peer node name + a cancel button.
- **APK** — `subagent` case added to native `ToolChip` / `BlockDetail` / `assistant-stream.tsx`; `delegation` router mirror added to `lib/_core/app-router.ts`. `delegationEvent` WS message materializes the managed chat (transcript fetch) + node badge + header cancel. `delegation.stream` live fold; `sendMessage` delegated branch; `delegatedNodeName` persisted to the conversation record.
- **33 new tests**: `ChatAgentRunner.test.ts` +4 (delegate_task always-HITL gate); `SubAgentHostService.test.ts` 18 (run registry, sandbox, concurrency cap, kill-switch, isolated approval broker, executionMode enforcement, cursor-replay, grace-window abort, start_job continuation); `DelegationService.test.ts` 5 (peer NDJSON consume, persist turns, HITL forward, cursor re-attach, parent re-prompt); `meshServerSubAgent.test.ts` 5 (`/subagent` POST/GET/approval/cancel behind pinned-peer gate).

**Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1447 passed / 4 skipped** · `pnpm build` ✅ · `pnpm audit --prod` ✅

---

### 2026-07-07–08 — Model-Fabric: Ollama decoupling + unified model catalog (Phases 0–7)

#### Added

- **`LocalLlmRuntimeService`** (`server/core_services/services/LocalLlmRuntimeService.ts`) — supervises a managed `llama-server` (llama.cpp) subprocess exactly like `ValetServerService`: preflight → spawn → `/health` poll → auto-restart with backoff → graceful stop. Binary auto-discovered via `LLAMA_SERVER_BIN` env var, common install paths, or PATH. Model auto-discovered as the newest `.gguf` under `PATHS.models` (excluding `valet-router/`) or `LOCAL_LLM_MODEL_PATH` override. Wired into boot (fire-and-forget), graceful shutdown, and the `/health` payload (`checks.localLlm`, informational only). **Ollama is now optional**: the hard-budget-cap downgrade path, `listProviders()`, and the system health check all reflect the local runtime's actual ready-state instead of assuming Ollama.
- **`renderLocalLlmPrompt()`** — asks `llama-server`'s own `POST /apply-template` to render the full system+messages in the loaded model's real jinja template (Omnecor keeps full prompt/tool ownership; only turn-delimiter wrapping is delegated). Falls back to ChatML with a forced stop-string. Live-hardware-verified: Llama-3.2-3B answered correctly through the real `ChatAgentRunner` → `chatLocalLlm` → spawned llama-server path.
- **Dual tool-protocol** in `ChatAgentRunner` — `ToolProtocol` seam with two implementations: `TextToolProtocol` (universal floor — works on any GGUF, proven `<tool_call>` wording unchanged) and `NativeToolProtocol` (zero tool-instruction text in the system prompt; ships `tools` in the `ChatInput` instead). Both normalize to the same `{name, args}` → block → HITL → result pipeline; native decode prefers the provider's structured `toolCalls[0]` with a stray `<tool_call>` safety-net fallback for models that ignore the `tools` param.
- **`shared/types/modelCatalog.ts`** — unified `CatalogEntry` shape: `location` discriminated union (`{type:"local", backend:"omnecor-runtime"|"ollama"}` | `{type:"mesh-peer", nodeId, nodeName}` | `{type:"cloud", provider}` | `{type:"phone"}`) + `capabilities.nativeTools` (static/curated, never probed) + `vision` + `contextWindow` + `sizeMb`.
- **`describeCatalogHost()`** (single source of truth in `shared/types/modelCatalog.ts`, mirrored in the APK) — derives host **brand** (`omnecor` / `ollama` / `cloud` / `phone`) and **node** from each entry. Mesh peers read as "Omnecor · \<node\>" when their backend is the Omnecor-owned runtime, "Ollama · \<node\>" if Ollama-backed.
- **`ModelCatalogService`** (`server/core_services/services/ModelCatalogService.ts`) — aggregates 4 sources in parallel: local runtime (if ready), optional Ollama, OMMESH peers' advertised models, cloud providers with a configured key. Hash-based dedup (`(location node) + (contentHash ?? normalised name)`). `isSovereign` flag skips cloud sources entirely — the critical Sovereign-mode gate that was missing. Exposed as `aiProvider.catalog` (`protectedProcedure`).
- **Beacon-minimal mesh model advertising** — `hashModelList()` in `server/ommesh/crypto.ts` (16-char SHA-256, deterministic + order-independent). mDNS TXT carries only `modelsHash`; the full model list is fetched over authenticated mTLS on demand via a new `GET /models` endpoint on `MeshServer` (pinned-peer trust gate). `MeshNode.refreshModelCatalog()` populates `NodeCapabilities.models` at start and every 30 s telemetry tick; re-advertises on a changed hash or material GPU delta. `peer-trusted` event triggers an immediate retry. 41 new tests across 5 files.
- **`AiProviderService.selectPeerNode()`** — `targetNodeId` pin routes to an exact mesh peer (bypassing the VRAM auto-scorer) or forces local when set to the node's own id.
- **Model Hub "Omnecor" tab** — per-node self-hosted sections with a `Self-hosted / Ready` card; purple Omnecor branding.
- **`toolSchemas.ts`** — single JSON Schema source of truth for the 3 built-in agent tools (`edit_file` / `run_command` / `start_job`), projected into `toOpenAiToolSchemas()`, `openAiToolsToAnthropic()`, `buildLocalLlmToolGrammarSchema()`, and `buildLocalLlmToolReminder()`.

#### Changed

- **`ModelSelector.tsx`** (web) rewritten to source `trpc.aiProvider.catalog` directly. Groups: **Omnecor · This PC** (purple, leads) / **Ollama · This PC** / **Omnecor · \<node\>** (mesh) / **Cloud** (curated via the existing `getActiveModels()` toggle). Selecting a mesh-peer entry sets `SelectedModel.targetNodeId`, threaded into `agentChatStream`.
- **APK `ai-models.ts`** — `listCatalogGroups()` replaces the Ollama-direct `listModelsForProvider`. Groups: Phone / This PC / Mesh:\<node\> / Cloud; every non-phone entry carries a real `providerId` + `targetNodeId` for mesh peers. The dead `ommesh`-returns-`[]` branch is removed; `AGENT_PROVIDERS` gate and `runLegacyChat` one-shot fallback deleted (every catalog entry is agent-capable by construction).
- **`AiProviderService` `llamacpp` case rewritten** — `chatLocalLlm()` posts to `llama-server`'s raw template-free `/completion` endpoint (not the jinja-applying `/v1/chat/completions`) with real SSE streaming via the existing `handleStream` helper, replacing the old message-flatten / one-shot `llamacpp_bridge.py` Python call. The `llamacpp_bridge.py` (port 8013) is left untouched — still used by `MoeChainService` for multi-model chain stepping.
- **Native tool-call assembly** added to `chatOpenAI` (fragmented `delta.tool_calls`), `chatAnthropic` (`content_block_start`/`input_json_delta`/`message_stop`), and `chatOllama` (streaming path previously dropped `message.tool_calls` silently).
- **`LOCAL_LLM_GPU_LAYERS` default** changed to `"auto"` (llama.cpp's adaptive default). The previous hardcoded `999` hard-OOM'd on 2 GB GPUs — Vulkan does not overflow to CPU on alloc failure.
- **Hard-budget-cap downgrade path** now uses `pickLocalFallbackProvider()` (prefers local runtime, falls back to Ollama only if it has a model) instead of hardcoding `providerId = "ollama"`.

#### Fixed

- **`ai.catalog` Sovereign gate missing (Critical)** — `ModelCatalogService.getCatalog()` was unconditionally calling cloud provider model-list endpoints regardless of execution mode. Fixed: `getCatalog({ isSovereign })` skips `collectCloud()` when sovereign.
- **`/apply-template` fallback lost stop-string safety net** — `renderLocalLlmPrompt()` now returns `{prompt, usedFallback}`; the ChatML stop-string is injected only when the fallback fires.
- **`_resolveBinary()` explicit override** now fails loudly if the specified binary does not resolve, instead of silently falling through to system PATH.
- **`ensureReady()` returned false during restart gap** — `_restartScheduled` flag prevents premature "not ready" during a pending crash-recovery restart.
- **`chatOpenAI` / `chatAnthropic` tool-call accumulator** now attaches the latest snapshot on every line (not only the terminal sentinel) so a stream that ends without `[DONE]` / `message_stop` still delivers the assembled tool call.
- **`chatAnthropic` non-streaming path** dropped interleaved text blocks — now filters and joins all `text` content blocks.
- **mDNS TXT size limit** — `capabilities` key now excludes the `models` array; TXT stays flat regardless of catalog size (tested with 500-entry catalog, every field ≤ 255 bytes per RFC 6763).
- **Cloud `ModelSelector` overflow** — live catalog returned 200+ embeddings/TTS/moderation models; re-applied `getActiveModels()` curation to the cloud slice.

**Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1455 passed / 4 skipped** · `pnpm build` ✅ · `pnpm audit --prod` ✅

> **Note on test counts:** The 1455 figure above includes the +16 `describeCatalogHost` tests added in Phase 7 of this workstream. The Mesh-Delegation entry below reports **1447** — this is the final gate count recorded in `Mesh-Delegation.md` Phase 9 and reflects the same run that the delegation tests were measured against. The net addition from Mesh-Delegation was +33 tests from a 1414 baseline (pre-Phase 7); the Phase 7 +16 and the delegation +33 are both accounted for in the 1447 total. **1447 was the HEAD count at Mesh-Delegation Phase 9 close (2026-07-08)**; subsequent Model-Fabric **Phase 8** (local GGUF auto-discovery + hot-swap, 2026-07-10) added +22 → **1469 passing / 4 skipped**. `Context/Tracker-Docs/Verification-Pass.md` tracks the authoritative live HEAD baseline.

---

### 2026-07-04–07 — Agentic Chat Stream — web + APK (Chats-Agentic-Upgrade Phases 1–6)

#### Added

- **`shared/chatBlocks.ts`** — `AssistantBlock` union: `text` · `thinking` · `command` · `edit` · `job` · `mcp`. Status enums (`ToolBlockStatus`: `pending` / `pending_approval` / `running` / `success` / `error` / `denied`; `JobBlockStatus` mirrors `AsyncJobService`). `FileDiff` shape (before/after text, language, ±line counts). Helpers: `isToolBlock`, `blockDotIntent`, `flattenBlocksToText`, `TOOL_FAILURE_STATUSES`.
- **`shared/chatAgentEvents.ts`** — typed wire contract for the `agentChatStream` tRPC subscription: `text_delta`, `block_start`, `block_update`, `block_end`, `thinking_delta`, `done`, `error` event shapes.
- **`ChatAgentRunner`** (`server/core_services/services/ChatAgentRunner.ts`) — streaming typed-event tool loop extending `LocalSubAgentWorker`'s `<tool_call>` path. Three built-in tools: `edit_file` (search/replace → `FileDiff`, disk write only on HITL approval, paths scoped to the active neural map's `rootDirectories` via `validatePath`), `run_command` (arg-array via `ProcessManager.spawn`, streams stdout/stderr + exit code, no shell interpolation), `start_job` (non-blocking via `AsyncJobService`, ends the turn, re-prompts the AI on WS completion ping). MCP skills wired. `MAX_TURNS=8` guard. Streaming prose/tool splitter withholds a tag-length tail so a `<tool_call>` split across deltas never leaks as prose.
- **`ToolApprovalRegistry`** — per-session HITL broker: TTL auto-deny, supersede on re-submit, denial fed back to the model as a turn message.
- **`aiProvider.agentChatStream`** tRPC subscription (`protectedProcedure` + per-provider `assertProviderAllowedInMode` — intentionally NOT `cloudProcedure` so local agentic chat works in Sovereign mode). **`aiProvider.resolveToolApproval`** mutation (ownership-checked). **`aiProvider.runCodeSnippet`** mutation (writes to map root or `~/.omnecor/scratch`, spawns via `ProcessManager` + `AsyncJobService.track`).
- **`AssistantStream`** (`client/src/components/chat/agentic/AssistantStream.tsx`) — flush-left guide line + Streamdown markdown renderer. No card/bubble.
- **`ThinkingSection`** — collapsible (default-closed); real reasoning tokens or `LoadingQuote` typewriter fallback while streaming.
- **`AgenticBlocks.tsx`** — `StatusDot` (via `blockDotIntent`), `CommandBox` / `EditBox` / `JobBox` / `McpBox` chips, `SubAgentBox` (mesh delegation, added in Mesh-Delegation). Click → Radix Dialog overlay (native Esc-close + focus trap). `EditBox` overlay: hunk-only diff via `diff.structuredPatch` (`DiffView`, +/− coloured, 3-line context). `ApprovalRow`: inline approve/deny → `resolveToolApproval`.
- **`layout: "stream" | "bubble"` prop** on `ChatInterface`. Main chat passes `"stream"` (agentic blocks + guide line); all wrapper chats default `"bubble"` (unchanged).
- **FIFO message queue** — Zustand `messageQueue` slice (not persisted — no stale auto-fire on reload). `ChatInput` shows type-ahead while streaming (`enableQueue` prop, stream layout only). Enter/Send/⚡ enqueues the next turn; numbered `accent-cyan` chips render above the input with a "queued · press ↑ to edit last" hint. ↑ on an empty input pops the most-recently queued item back into the box for editing. Queue drains FIFO on stream `done` or user Stop; held (not drained) after an `error`; cleared on conversation switch + unmount.
- **Code block execution** — `▶ Run` (py/js/ts/sh) and `⚡ Preview` (html) buttons injected into Streamdown's per-block toolbar via `useCodeBlockActions` (MutationObserver for async shiki render). Run → `runCodeSnippet` → `JobBlock` message + toast + host-display GUI window. Preview → live `LivePreviewPanel`.
- **Auto-approve toggle** — chat-header `ShieldCheck`/`ShieldAlert` icon (stream layout only); persists to `chatDisplaySettings.autoApproveTools`; per-action HITL still always fires for `delegate_task`.
- **`wsAuthBridge.ts`** (`server/core_services/websocket/wsAuthBridge.ts`) — promotes the APK's `?token=` query param to `Authorization: Bearer` before the tRPC WS handler reads it. The mobile WebSocket subscription path was silently failing authentication in production; cookie/Bearer callers are untouched.
- **APK agentic chat** — full port to `packaging/android/omnecor-hq/`: tRPC WS subscription client (`getAgentTrpc()` with `splitLink` → `wsLink` + `httpBatchLink`); native block renderers (`assistant-stream.tsx` + `agentic-blocks.tsx`: guide-line stream, thinking section, command/edit/job/mcp chips, shared Modal overlay, inline `ApprovalRow`, LCS line-diff `computeLineDiff`); on-device GGUF/LiteRT token streaming folded into `AssistantBlock[]` with `<think>` parsing; component-state FIFO message queue with tap-to-recall chips; `LoadingQuote` typewriter (module-scoped no-repeat shuffle bag); 3 quote styles + show/hide + auto-approve shield toggle.
- **New tests (122 net new, 1193 → 1315 passing)**: `chatBlocks.test.ts` 8 (block union, `FileDiff`, helpers); `agentStream.test.ts` 12 (fold immutability, approval transitions, job correlation); `app.store.test.ts` 11 (queue FIFO/LIFO/remove/clear); `ChatAgentRunner.test.ts` 24 (prose split, edit approve/deny/no-root, run_command, start_job+denial, MCP nested-arg parse, diff/JSON helpers); `aiProviderRouter.test.ts` +6 (sovereign gate on `agentChatStream`, `resolveToolApproval` ownership); `wsAuthBridge.test.ts` 7.

#### Fixed

- **Messages "vanishing" during streaming** — conversation auto-switch race yanking the view off an active chat on session-list refetch. Now gated on an actual map/scope change (`prevMapScopeRef` in `Chat.tsx`).
- **`github://` pseudo-root blocked `run_command` code execution** — falls back to `~/.omnecor/scratch`.
- **shiki `textContent` stripped newlines** — changed to `innerText` in the Streamdown toolbar injector.
- **APK inline `<Image>` rendering in assistant markdown** regressed to a text link — restored.
- **APK on-device Stop + queue could start a second native completion on the single GGUF/LiteRT engine** (SIGSEGV risk) — `startPhoneStream` now waits for both engines idle before touching the model.

**Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1315 passed / 4 skipped** · `pnpm build` ✅

---

### 2026-07-05 — NPU-first on-device models + model lifecycle overhaul (Android APK)

#### Added

- **Real Hexagon NPU path for GGUF models — with zero patched native code.** A subagent's earlier attempt patched llama.rn C++ (`use_npu` flag) — review proved the patched block was dead code on Android GPU devices (llama.rn's own `configureBackendDevices` pre-fills the device list with Hexagon excluded before it ever ran). The actual supported path: llama.rn 0.12.4's `initLlama({ devices: ["HTP*"] })` expands to the real HTP device names natively, and the returned `context.devices`/`gpu` report what **actually** engaged. The whole `patches/llama.rn.patch` apparatus is deleted (plus a stray 0-byte mobile patch, unused `patch-package`/`postinstall-postinstall` devDeps, and the orphaned `wouter@3.7.1.patch`).
- **Backend-aware model catalog** (`lib/_core/model-catalog.ts`). ggml-hexagon executes only **Q4_0 / IQ4_NL / Q8_0 / MXFP4** weights — every previous catalog model was Q4_K_M, i.e. 0% NPU offload even with perfect plumbing. Each GGUF model now carries a quality variant (Q4_K_M) *and* an NPU-ready variant (IQ4_NL or Q4_0 — availability + `content-length` HEAD-verified per bartowski repo), plus new NPU-friendly picks (Qwen2.5-3B Q4_0, Llama-3.2-1B Q8_0). `pickVariant(accelMode)` drives which file the Settings download button fetches. 11 unit tests (`model-catalog.test.ts`) pin the quant classifier, catalog integrity, and variant selection.
- **App-wide Acceleration setting** (`lib/_core/acceleration.ts`): `AUTO | NPU | GPU | CPU`, both engines obey it. Auto = NPU when the file is NPU-capable and HTP hardware is present → GPU → CPU. **Manual modes are strict** — a clear failure instead of a silent downgrade — and the UI badge always shows the backend that *actually* engaged (GGUF: derived from `context.devices`; LiteRT: GPU/NPU loads run `validate: true`, a real test inference that catches Google's initialize-but-produce-no-tokens failure mode). Migrates the old LiteRT-only backend pref.
- **Attachment capability gating in chat.** Catalog models declare `capabilities` (`images`/`files`); all current on-device models are text-only, so the 📎/📷 buttons dim and explain ("text-only model") instead of erroring at send time. llama.rn ships multimodal (mtmd) support, so a future vision GGUF just flips the flag.

#### Changed

- **Model lifecycle: selection is the only verb** (`lib/_core/phone-model.ts`). One resident model, ever, across both engines — the manager serializes load/unload, evicts the other engine before loading, and persists the last model for auto re-arm at app start (now honoring engine *and* acceleration mode; previously LiteRT-only and always CPU). **Picking a phone model in the Chat picker loads it; picking a remote (Ollama/OMMESH/cloud) model never touches the phone model** — a mesh-worker phone stays armed while chatting against the PC. Settings loses its per-model Load buttons entirely: it now downloads/imports/deletes files, shows truthful status badges (⚡NPU/GPU/CPU + Loaded), and offers a single Unload on the resident-model card.
- **AI Node + Status tabs subscribe to the unified resident-model snapshot** — fixes AI Node showing "No model loaded" forever when a LiteRT model was serving (it only ever checked the GGUF engine), and its capabilities card's "Backend: Vulkan / NNAPI" fiction is replaced by the live backend + device names.

#### Fixed

- **Corrected the 2026-07-05 Progress-Tracker entry** that recorded the NPU feature as done: the patch was inert on the target device, `hasHexagon=true` was unnecessary (SM8750 is already in llama.rn's known-Hexagon SoC list — and forcing it re-risked the old `libcdsprpc.so` crash class), and "confirmed Vulkan fallback" was neither confirmed nor Vulkan (OpenCL).

### 2026-07-04 — LiteRT-LM model discovery & download (Android APK)

#### Added

- **LiteRT-LM model list on the phone.** The APK's LiteRT-LM (`.litertlm`) engine previously had only a single-file DocumentPicker importer, and it scanned just the app-private `<docDir>/models/` folder — so models a user had already downloaded (e.g. via the Google AI Edge Gallery app, which stores them in *its* private storage) were invisible with no way to select or load them. Three new paths in `packaging/android/omnecor-hq`:
  - **Download catalog** (`RECOMMENDED_TASK_MODELS` in `lib/_core/local-inference.ts`): one-tap download of the **ungated** `litert-community` `.litertlm` models — Qwen2.5-1.5B (1.5 GB), DeepSeek-R1-Distill-Qwen-1.5B (1.8 GB), Phi-4-mini (3.7 GB). Google's `google/gemma-*` and `litert-community/Gemma*` repos are gated (plain download → HTTP 401), so they're deliberately excluded — those are what Gallery/import/folder-scan cover.
  - **Device-folder discovery** (Storage Access Framework, `model-download.ts`): the user grants Omnecor a folder once (persisted across launches); every `.litertlm`/`.task` model in it is listed and loadable with one tap (copied into the app dir on load, since the native engine needs a POSIX path, not a `content://` URI). This is what surfaces models that were "in a hidden folder."
  - Model discovery now also recognises the legacy MediaPipe `.task` bundle Edge Gallery still exports (`TASK_EXTS`), not just `.litertlm`.
  - Settings → Phone AI Model rebuilt with Download / Load-from-folder / single-file-import / in-app sections. Gate: APK workspace `tsc` 0 errors.
- **On-device models are now selectable in Chat.** Previously the chat model picker only listed the PC's providers (Ollama/cloud) and the phone was a silent GGUF-only *fallback*. Added a **"📱 Phone (on-device)"** provider (`ai-models.ts` `listPhoneModels` — every downloaded/imported GGUF + `.litertlm`, id-encoded `phone:<engine>:<path>`) that's always available even with no PC. Selecting a phone model routes `handleSend` to on-device inference (`runPhoneModel`): loads the model if needed (llama.rn for GGUF, LiteRT-LM for `.litertlm`) and generates locally. Grouped as its own provider chip so PC/mesh and phone models stay in separate sections, not one jumble. Phone is the fallback default provider whenever the PC is unreachable (not just unconfigured), and the list re-scans on Chat-screen focus so a model just loaded in Settings appears without a restart. Live-verified: DeepSeek-R1-1.5B `.litertlm` selected in the picker answered a prompt fully on-device (PC offline).
- **LiteRT-LM compute-backend toggle (CPU / GPU / NPU).** New `litert-prefs.ts` persists the choice (default CPU); Settings shows a segmented selector; the pref flows into every `loadTaskModel` call (Settings loads + chat loads). Lets Gemma-class models (which want GPU) opt in, while keeping CPU as the stable default.
- **"Using Google AI Edge Gallery models" helper** in the LiteRT section: spells out the Samsung My Files → sub-folder → Choose-folder path, since Android forbids apps from reading Gallery's `Android/data/` folder directly (confirmed on-device: not reachable via SAF *or* All-Files permission; only adb/root/Samsung My Files can). Also confirmed on-device: Android's SAF **refuses to grant Downloads or the storage root** themselves ("Can't use this folder") — models must go in a *sub-folder* (e.g. `Download/OmnecorModels`), which the instructions now state. Full path verified end-to-end: Gemma-4-E4B `.litertlm` copied out of Gallery → sub-folder → folder-scan listed it → loaded on the **GPU** backend with no crash.

#### Fixed

- **GGUF model wouldn't load on the phone ("Load failed").** Root-caused live over adb on an S25 Ultra. `local-inference.ts loadModel` used `use_mlock: true` (pins the whole multi-GB model into physical RAM — fails when the model is larger than free RAM; Android's memlock rlimit is tiny) and `n_gpu_layers: 99` (full Adreno OpenCL offload of a 4.7 GB model into GPU/shared memory), so loads aborted in ~50 ms. Now: `use_mlock` dropped (mmap pages weights in on demand), a **GPU→CPU fallback** (attempt full offload, then retry CPU-only — mirroring the LiteRT engine), `n_ctx` 4096→2048, a preflight that catches missing/empty files, and an actionable error ("may not fit in RAM — pick a smaller model like Llama-3.2-3B") instead of a bare "Load failed". Verified end-to-end: Llama-3.2-3B downloads, loads (Context initialized ~3.2 s), and answers a chat prompt fully on-device.
- **Truncated downloads masqueraded as "✓ Downloaded".** `isModelDownloaded` checked *existence only*, so an interrupted download (app backgrounded mid-transfer) left a truncated GGUF that showed as ready and then failed to load cryptically (real case: a 2.40 GB partial of the 4.68 GB Qwen-7B). New `getModelFileState` compares on-disk size to expected; the catalog now shows **"⚠ Incomplete download — re-download"** for partials (never a Load), and (re)downloads delete any partial first. Applied to both the GGUF and LiteRT-LM catalogs.
- **Qwen2.5-7B was mislabeled the phone-recommended default** despite being too big for typical free RAM; demoted (`recommendedForPhone: false`) with an honest "needs ~5 GB free RAM" note. Llama-3.2-3B (2 GB) is the ★ phone default.
- **Loading a LiteRT-LM (`.litertlm`) model crashed the whole APK (native SIGSEGV).** `mediapipe-inference.ts loadTaskModel` looped `npu → gpu → cpu`, calling `_llm.close()` and recreating the Nitro engine after each failed delegate. Closing a `react-native-litert-lm` HybridObject whose native `loadModel` had just failed freed resources a pending JSI promise still referenced → use-after-free → Hermes null-write crash on the `mqt_v_js` thread (confirmed via tombstone: pure `libhermesvm.so` backtrace, no LiteRT frames). Now: **one engine, one `loadModel` call**, defaulting to the module's documented-safe **CPU** backend (GPU/NPU are opt-in via `opts.backend`, and the native module self-falls-back internally). A cleanly-loaded engine is released before switching models; a *failed* engine is never closed.
- **Fake "🟢 Connected" indicator on the chats page.** The badge (and the onboarding "🟢 PC connected" line) keyed off `isServerConfigured()` — merely whether a server IP was *saved*, not whether the PC answered — so it was permanently green once an IP existed. Both now use the live `useConnection()` health-probe state: chats shows `No server` / `Checking…` / `Connected` / `PC offline`. Swept the rest of the APK UI; all other status indicators are genuinely state-driven.

### 2026-07-01 — Hybrid social publishing, neural-map cascade fix, ESP32 hardware verification, stream-crash fix, full router test coverage

#### Added

- **Hybrid social publishing.** `PublishingService` rebuilt to publish two ways: **native** — Bluesky, Mastodon, Discord, Telegram (one per-account secret: app password / access token / channel webhook / bot token; no developer app) — and **webhook → n8n** — X (Twitter), LinkedIn, Facebook, Instagram (n8n holds the managed OAuth, connected once inside n8n). New `WebhookPublisher`; `N8N_URL` defaults to `http://127.0.0.1:5678`, and a non-loopback `N8N_URL` is refused in **Sovereign** mode. **YouTube** is intentionally unsupported (no text/community-post API → returns a clear "not supported" error). Blueprint served at `/n8n/omnecor-social-publish.blueprint.json` (source in `client/public/n8n/`). See `docs/social-publishing-n8n.md`. In passing: fixed a `publishNow` IDOR and made `addAccount` idempotent per (user, platform).
- **ESP32 hardware verification (2026-06-30).** `esp.compile` (arduino-cli) + `esp.flash` were driven through the real tRPC router against a physical **ESP32-D0WD-V3** on `/dev/ttyUSB0`: the merged image flashed at `0x0`, the board rebooted and BLE-advertised `OMNECOR_TEST_OK` (serial-confirmed).
- **Real STT/TTS bridge tests.** `voiceBridges.test.ts` runs `voice.transcribe` (faster-whisper) and `voice.synthesize` (XTTS-v2) through the real router, with the ComfyUI-style auto-skip when the servers are absent.
- **Full route-level router coverage.** Every namespace registered in `server/routers.ts` now has a dedicated route-level test. The suite grew to **1128 passing + 1 skipped (1129 total) across 103 files** (up from 412).

#### Fixed

- **Migration 0014 — neural-map cascade FKs.** Six child tables of `neural_maps` had NO-ACTION foreign keys in the actual DB (added via `ALTER … ADD COLUMN … REFERENCES`, which silently drops the ON DELETE action) despite `drizzle/schema.ts` declaring `onDelete: cascade` — so deleting a non-empty project/map threw an FK error and orphaned its child rows. `0014_fix_map_cascades.sql` rebuilds the six tables with real `ON DELETE cascade`, backed by an atomic app-level `db.batch` cascade in `neuralMaps.delete` (belt + suspenders).
- **TD-047 — AI stream disconnect crashed the server.** A stream timeout/disconnect threw `ERR_INVALID_STATE: Controller is already closed`, taking down the whole process. Now guarded via `guardedEmit` across all three `chatStream` subscriptions (`aiProvider.chatStream` + `aiRouter.chatStream` ommesh/main), with 6 regression tests.
- **`esptool_bridge.py` flash offset.** A hardcoded `0x1000` (bootloader slot) left any app image unbootable; offset + chip are now plumbed params (default `0x0`).
- **Valet routing timeouts too short.** The 5s route timeout caused constant keyword fallback for local/"thinking" models; now configurable via `VALET_ROUTE_TIMEOUT_MS` (default 60000 ms) and the bridge's `VALET_OLLAMA_TIMEOUT` (default 120 s).
- **`requirements.txt`** — added four deps surfaced by the live voice bridges: `python-multipart`, `torchaudio`, `transformers>=4.57,<5`, `torchcodec`.

**Gates:** root `tsc` 0 · `vitest` **1128 passing / 1 skipped** (103 files; `comfyRouter` auto-skips without ComfyUI — 1129/0 with it running).

---

### 2026-06-24 — Coverage tooling + first route-level tRPC tests; aiRouter IDOR fix

#### Added

- **V8 coverage tooling.** `@vitest/coverage-v8` + a new `pnpm test:coverage` script. `vitest.config.ts` gains a `coverage` block (text-summary/text/html/lcov reporters → `coverage/`, source-only include list) with **ratcheting thresholds** set to the current baseline (statements/lines ~9–10%, branches/functions ~6–7%) so coverage can only move up.
- **Route-level (integration) tests for `chatRouter` (15) and `aiRouter` (20).** These drive the real router via `appRouter.createCaller(ctx)` — exercising the `protectedProcedure` auth middleware, Zod input validation (incl. the `aiRouter` `baseUrl` SSRF guard), the per-provider Sovereign-mode gate, and the actual Drizzle queries. New shared harness `server/__tests__/_helpers/trpcHarness.ts`: `createTestDb()` backs tests with a **real in-memory libSQL DB** (actual schema + migrations, FK cascade on), plus `seedUser()` and `makeContext()`. `chatRouter` reaches 100% line coverage; `aiRouter` ~57%.

#### Fixed

- **Security — `aiRouter` chat-persistence IDOR (broken access control).** `aiRouter.getSession`, `getSessions`, `saveMessage`, and `summarizeAndPruneSession` were `protectedProcedure`s with **no ownership check**, so any authenticated user (or paired device) could read, append to, or summarize **another user's** chat session by UUID — and `summarizeAndPruneSession` is reachable from the UI's Memory Archiver, exfiltrating another user's conversation into the caller's episodic memory. All four now scope by `ctx.user.id` (non-owned → `null` / filtered out / `NOT_FOUND`), matching `chatRouter`'s existing per-user isolation. `createSession` already scoped on write (`userId: ctx.user.id`); the legitimate client paths are unaffected. Regression tests added.

**Gates:** root `tsc` 0 · `vitest` 412/412 (+35) · coverage thresholds pass.

---

### 2026-06-22 — Device pairing for the mobile app (replaces OAuth)

#### Added

- **Device pairing (Jellyfin Quick-Connect-style) — the phone authenticates to its own PC without OAuth.** The desktop (Settings → **Devices**) shows a one-time **6-digit code** + a **QR** encoding `{host, port, secret}`; the phone scans the QR (one step: sets the PC address *and* pairs) or types the code, redeems it at public `POST /api/pair/redeem`, and receives the same `app_session_id` JWT it already uses as a Bearer token. The QR carries a long high-entropy `secret` (brute-force-proof) while the short code is rate-limited (`authLimiter` on `/api/pair`, 3-min single-use codes). New `server/_core/pairing.ts` (`PairingService`), `server/routers/pairingRouter.ts` (`createCode`/`listDevices`/`revokeDevice`), `client/.../settings/PairDevicePanel.tsx`, and the mobile `lib/_core/pairing.ts` + `components/pair-flow.tsx` (QR scan via `expo-camera` + manual entry).
- **Persistent paired-devices + revocation.** New `paired_devices` table (survives PC restarts → a paired phone never has to re-pair). The session JWT carries a `deviceId` (`sdk.ts`); revoking a device (desktop list) flips `revokedAt` and an in-memory revoked-set rejects its tokens immediately on the auth hot path — no per-request DB read.
- **OMMESH zero-touch auto-pair.** On the same LAN with a shared `OMMESH_SECRET`, the existing `mobile_node_register` handshake now also returns a session token in `mobile_node_ack`, so the phone pairs with no code entry.

#### Changed

- **Mobile onboarding now leads with “Pair with my PC”**; the Google/Microsoft OAuth buttons were removed from the app (server OAuth routes stay for the web). This also moots a latent deep-link scheme mismatch (`manus…` vs `omnecor-hq://`) that had broken mobile OAuth. Local-account stays as the offline fallback. APK rebuilt (108 MB; `CAMERA` permission added).

#### Fixed

- `moeChainConfigs.steps` schema default `”[]”` (a string) → `[]` — it was a type error breaking `tsc` for a JSON-mode column typed `MoeChainStep[]`.

**Gates:** root `tsc` 0 · `vitest` 331/331 · mobile `tsc` 0 · `expo prebuild` clean · `assembleDebug` → 108 MB APK ✓

---

### 2026-06-21 — Android HQ: Expo SDK 55 / RN 0.83 upgrade, LiteRT-LM, mock-data wiring, tech-debt cleanup

#### Changed

- **Android HQ upgraded to Expo SDK 55 / React Native 0.83.6 / React 19.2.0.** All `expo-*` packages aligned to the SDK-55 `bundledNativeModules` map; `expo-share-intent`→`^6.1.1`; `react-native-reanimated`→`4.2.1`, `react-native-worklets`→`0.7.4`. Removed `newArchEnabled` (always-on in SDK 55) and `edgeToEdgeEnabled` (removed from `ExpoConfig`). New Architecture is mandatory and enabled. Verified: mobile `tsc` 0 errors, `expo prebuild --clean` clean, **`assembleDebug` produces a working APK**.
- **On-device LLM engine swapped: `react-native-llm-mediapipe` → `react-native-litert-lm`** (`^0.4.2`, + `react-native-nitro-modules`). Google's MediaPipe LLM Inference API is now maintenance-only; LiteRT-LM is its maintained successor. `lib/_core/mediapipe-inference.ts` rewritten onto `createLLM`/`loadModel`/`sendMessage`/`sendMessageAsync`/`close` with the same exported API (callers unchanged). Models move from `.task` → `.litertlm`. `expo-build-properties` now sets `minSdkVersion 26` + `buildArchs [“arm64-v8a”]` (LiteRT-LM is ARM64-only, API 26+).
- **`llama.rn` bumped `^0.9.0` → `^0.12.4`** (New Architecture). `react-native-gesture-handler` bumped to `^2.31.2` (resolves `2.32.0`) — `2.30.x` failed to compile against RN 0.83.6 (`ReactRoot.getRootViewTag()` became a function).
- **Mock data removed from the mobile chat & podcast screens.** Chat now wires real model selection (provider switch + `ollama.listModels` / cloud catalog mirroring the desktop `API_MODEL_CATALOG`) instead of a hardcoded `”llama3.2:latest”`; the fake neural-map (`Project A/B`) and agent (`Creative/Technical/Analyst`) fallback lists are replaced with the real `neuralMaps.list` / `personas.list` data + truthful empty states. Podcast: hardcoded model id replaced with real resolution; the fake 5-item voice list replaced with the only real control (RVC voice-conversion on/off). Shared `askAi` (3D Viewer) uses the same real model resolver.
- **Phase-2 routers relocated:** `agentRouter`, `aiProviderRouter`, `modelMarketplaceRouter` moved from `server/core_services/routers/` to the canonical `server/routers/` (services stay in `core_services/services/`). Import paths and docs (CLAUDE.md, AGENTS.md, ROUTER_INVENTORY.md, TRPC_API.md) updated. tRPC namespaces unchanged → no client impact.

#### Fixed

- **`apk:debug`/`apk:release`/`apk:install`: removed the `rm -rf app/.cxx app/build/generated/autolinking` workaround** (added 2026-06-16). The autolinking-codegen ordering bug it papered over is resolved by the SDK 55 / RN 0.83 toolchain — a fresh `expo prebuild` + `assembleDebug` builds cleanly through all codegen/NDK/autolinking tasks without it.
- **Dropped the obsolete `patches/llama.rn.patch`** (forced `hasHexagon=false` to dodge a Snapdragon `libcdsprpc.so` `UnsatisfiedLinkError`). `llama.rn` 0.12.4's `tryLoadLibrary` now catches that error and falls back to the `dotprod_i8mm` CPU variant — the guard is upstreamed. (Revisit if a Snapdragon device crashes on model load.)
- **`pnpm check` no longer fails on a stray `node_modules_broken/` directory** — deleted the untracked dir and added it to the mobile `tsconfig.json` `exclude` (it had been flooding `tsc` with ~30 errors from a quarantined node_modules snapshot).

#### Documentation

- Clarified the three migration paths (`pnpm build:push` dev / `pnpm db:migrate` prod-CI / `server/db.ts` runtime fallback) in CLAUDE.md and `server/db.ts` — `db:migrate` is complementary, not legacy.
- Added an Expo 55 / RN 0.83 upgrade record at the top of `Context/Progress-Tracker.md`.

**Gates:** mobile `tsc` 0 · `expo prebuild` clean · `assembleDebug` → 101 MB `app-debug.apk` ✓ · root `tsc` 0 · `vitest` 326/326

---

### 2026-06-19 — Security, Correctness & Design-Token Sweep

#### Changed

- **Export-default debt resolved:** All 77 files using default React component exports converted to named exports (matches `AGENTS.md` style rule); all import statements and dynamic lazy-load references updated across 19 importing files.
- **Real BPE tokenizer, then right-sized:** Added `js-tiktoken` for accurate per-model token counting, then replaced it same-day with a lightweight ~4-chars/token approximation after discovering the BPE rank files bloated the Chat bundle to 3.9 MB and broke module resolution in the browser. Chat chunk: 3.9 MB → 472 kB. `estimateTokens()` API unchanged.
- **Design-token sweep:** Hardcoded hex literals in `neuralNodeTree.ts`, `MeshTopologyGraph.tsx`, and `AgentNetworking.tsx` legend dots replaced with CSS variable references. Raw Tailwind color classes (`green-*`, `blue-*`, `red-*`, etc.) swept across 14 files to semantic tokens (`accent-success`, `accent-cyan`, `destructive`, etc.).
- **`AGENTS.md` hex-literal exceptions documented:** `PCBViewer3D` (Three.js integer colors), brand-identity SVGs in `SetupWizard` (Google/Microsoft palettes), `MeshTopologyGraph` (Canvas API), `OAUTH_PLATFORMS` buttons (brand-required platform colors).

#### Fixed

- Dead `if (!db)` branch removed from `agentMessengerRouter.ts` — `getDb()` never returns null; the branch was unreachable and misleading.
- Dev-mode rate limiter no longer 429s on cold Vite module fetches (added `skip` for non-`/api` paths).

#### Removed

- Leftover “Manus” AI dev-tooling: browser debug-collector script injected into every dev page, the ~150-line Vite plugin that injected it, and the wildcard `allowedHosts` entries.
- Stale Manus symlink that was blocking Vite production builds.

**Gates:** root `tsc` 0 · `vitest` 353/353

---

### 2026-06-16/17 — OMMESH Live Cross-Node Verification + Documentation Overhaul

#### Added

- **OMMESH cross-node mTLS inference routing (Phase 9 stub → real implementation):** New `server/ommesh/core/MeshServer.ts` — strict-mTLS HTTPS listener on `MESH_PORT` (3001); only CA-signed peers connect (`requestCert` + `rejectUnauthorized` + TLSv1.3). `MeshNode.executeLocal()` runs real inference via `AiProviderService.chat()`; `routeToRemote()` pins the peer's advertised certificate fingerprint (rejects MITM even with a different CA-signed cert). Sovereign-mode guard prevents cloud providers from ever tunneling through mesh routing.
- **LAN peer discovery fixed:** two real bugs found via live 3-machine testing — peers resolving to IPv6 link-local addresses instead of routable IPv4, and Windows multicast-DNS binding to the WSL/Hyper-V virtual adapter instead of the real LAN. New shared `server/_core/net-utils.ts` fixes both, wired into both `DiscoveryService` and the legacy `MeshDiscoveryService`.
- **OMMESH live-verified across real machines (2026-06-16):** Windows (`omnecor-win-clark`) ↔ Linux (`omnecor-lin-vis`) — bidirectional mDNS discovery and bidirectional mTLS inference both confirmed working end-to-end with real Ollama completions routed across the network.
- **Desktop Bearer-token auth (`client/src/lib/desktopAuth.ts`):** Fixed a Windows/Electron-specific auth bug — the desktop frontend runs on the privileged `app://omnecor` scheme and calls the embedded backend cross-origin at `localhost:<port>`; the `SameSite=Strict` session cookie never reached the backend on that path. Falls back to an `Authorization: Bearer` token returned from local-auth routes and persisted in `localStorage`; the web build is unaffected (still cookie-based).
- **New user guides:** `docs/setup/OMMESH_SETUP.md`, `docs/user-guides/3D_DESIGNER.md`, `docs/user-guides/ALWAYS_LISTEN.md`, `docs/user-guides/SLASH_COMMANDS.md`, `docs/user-guides/PODCAST_STUDIO.md`, `docs/user-guides/FICTION_MODE.md`, `docs/README.md` (full documentation index).
- **Android Always-Listen voice mode simplified:** wake-word matching moved from a Picovoice/Porcupine dependency to on-device Whisper-only matching — no third-party account, API key, or external wake-word service required.

#### Fixed

- `apk:debug` / `apk:release` / `apk:install` build scripts: replaced hardcoded `gradlew clean` with a targeted `rm -rf app/.cxx app/build/generated/autolinking` — the blanket clean was re-running CMake against not-yet-generated autolinking codegen JNI directories (`react-native-voice-processor`, etc.) and failing the build.
- `packaging/windows/BUILD-WINDOWS.md`: removed stale internal project name reference, updated version strings to match actual build output, corrected the Valet Router GGUF step from a Git LFS reference to the actual GitHub Release download flow (`scripts/fetch-valet-model.sh`).
- `README.md`: removed inaccurate MySQL/TiDB support claim (the backend has been libSQL/SQLite-only since the Phase 2 database unification); added Windows to the system requirements table.
- `FAQ.md`: corrected “Linux-only” system requirements answer to reflect native Windows + Linux + Android support.
- `QUICKSTART.md`, `CONTRIBUTING.md`, `docs/workflows/DEVELOPMENT_WORKFLOWS.md`: `npm run dev` → `pnpm dev` throughout (project has been pnpm-only for the entire beta).
- `ROADMAP.md`: updated v1.0 blocker status — Valet Router integration and Android APK build are both code-complete (previously marked pending).

#### Removed

- Obsolete planning docs no longer reflecting current architecture: `docs/MULTI-PLATFORM-COMPATIBILITY-AUDIT.md`, `docs/MULTI-PLATFORM-FIX-PLAN.md`, `docs/UPGRADE-PLAN.md`, `docs/june-3-doc-updates.md` (1,231-line dev session note that had been committed as a permanent doc).
- Duplicate documentation files: `docs/OAUTH_SETUP.md` (superseded by `docs/setup/OAUTH_SETUP.md`), `docs/neural brain map/NEURAL_BRAIN_MAP_UI.md` (superseded by `docs/frontend/NEURAL_BRAIN_MAP_UI.md`).

#### Environment Notes (not code bugs, but relevant if reproducing)

- Windows requires the network profile set to **Private** with inbound firewall allowances for TCP 3000/3001 for OMMESH discovery to work.
- Clock drift on a mesh node (observed: ~61 min fast, NTP disabled) affects the mTLS replay-protection window — keep NTP enabled on all OMMESH nodes.

**Gates (2026-06-16):** root `tsc` 0 · APK `tsc` 0 · `vitest` 338/338 · Linux AppImage/.deb ✓ · release APK ✓ · Windows installer ✓ (install/test pending on-device)

---

### 2026-06-15 — Out-of-Band Depth Pass: AI Context & Feature Gaps

#### Added

- **3D Viewer real model loading:** the `url` prop was previously declared but inert (no loader existed — the viewer only ever showed demo primitives regardless of input). Real GLTF/GLB loading via `GLTFLoader`, OBJ via `OBJLoader`. `buildSceneContext()` walks the loaded scene graph and feeds mesh names, parent hierarchy, vertex counts, and bounding-box dimensions into the AI context when using “Ask AI” or “Suggest Changes” — previously real models fell back to a bare mesh name with no description.
- **PCB AI panel real netlist context:** the AI system prompt previously sent only `{ nodes: N, edges: N, mode }` — node/edge counts with no component or connection detail. `buildDesignContext()` now serializes the actual canvas state into a readable netlist (component refs, types, values, source→target connections), capped at 2000 characters.
- **Podcast Studio session persistence, per-segment regeneration, and audio download** — see `docs/user-guides/PODCAST_STUDIO.md` for the full feature set.
- **Social media automation: failed-post visibility and retry** — posts with `status: “failed”` are now surfaced in the Calendar tab with a destructive badge and error message (previously silently invisible); new `scheduling.retryPost` procedure with ownership verification.
- **Per-platform character-limit enforcement** for the social post composer (Twitter/X 280, LinkedIn 3000, Instagram 2200, Facebook 63206, YouTube 5000, TikTok 2200) — composer now disables Schedule/Publish and shows a live counter when over limit.

#### Changed

- `AGENTS.md` rewritten with explicit skill trigger conditions, Process/Style/Safety rule categories, a Critical Schema & Import Rules section, and a Known Gotchas table sourced from real session history.

---

### 2026-06-14 — Documentation Consolidation

#### Changed

- **Consolidated all working/planning docs into a single local-only `Context/` folder.** Twelve scattered markdown files were merged into the ten thematic Context documents and then removed: `input-tracker.md` + `ui_audit_report.md` + `APK-input-tracker.md` → `UI-Registry.md`; `master-feature-plan.md` → `Project-Overview.md`; `jun14-review.md` (detailed findings) + `BUILD.md` + `APK-feature-plan.md` + `APK-todo.md` → `Build-Plan.md` (appendices A–D); `master-todo.md` + `FUNCTIONAL-AUDIT.md` + `Beta-Code-Sweep.md` → `Progress-Tracker.md` (archives A–C). No information was lost in the merge.
- **Consolidated working/planning docs now live in a single `Context/` folder**, alongside the agent/session files (`CLAUDE.md`, `AGENTS.md`, `memory.md`, `.claude/`). These remain in the repo as working docs — treat them as the local source of project context.

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
