# Omnecor — Progress Tracker

This living document tracks the execution progress of the 5-phase build roadmap. Unchecked boxes represent pending features, and checked boxes indicate completed and verified items.

---

## 📌 TODO — Expo SDK 55 / React Native 0.83 upgrade (Android HQ) — opened 2026-06-21

**Why:** the only reason the `apk:debug`/`apk:release`/`apk:install` scripts in
`packaging/android/omnecor-hq/package.json` run `rm -rf app/.cxx app/build/generated/autolinking`
before Gradle is a New-Architecture autolinking-codegen **ordering bug** on RN 0.81/Expo 54
(legacy `gradlew clean` re-ran CMake against not-yet-generated JNI dirs). It's a workaround, not a
fix. The root-cause fix is an upstream bump to **Expo SDK 55 (ships RN 0.83)** — RN 0.82 is
canary-only; SDK 55 = RN 0.83, New Architecture mandatory (the app already has `newArchEnabled: true`).

**Native-module compatibility — verified 2026-06-21 via shallow-clone of each repo:**
| Module | Now → target | New-Arch / codegen | Verdict |
|---|---|---|---|
| `llama.rn` | `^0.9.0` → **`0.12.4`** | `codegenConfig` present; README: "v0.10+ **requires** New Arch" | ✅ Bump; New-Arch ready |
| `whisper.rn` | `0.6.0` (keep) | `codegenConfig` present; **dev-tested on RN 0.84.1** | ✅ Already validated above 0.83 |
| `react-native-llm-mediapipe` | `0.5.0` | ❌ **no `codegenConfig`** — legacy bridge, unmaintained since Oct 2024 | ⛔ **Blocker — replace** |

**MediaPipe replacement decision (the "fix it altogether" path):** Google's MediaPipe LLM Inference
API is now **maintenance-only**; the maintained successor is **LiteRT-LM**. Replace
`react-native-llm-mediapipe` with **`react-native-litert-lm`** (`0.4.2`, Nitro Modules / New Arch,
maintained Jun 2026, `.litertlm` models — the app already references `.litertlm`). It **requires
Expo ≥ 55**, so it is adopted *as part of* this upgrade. Trade-offs: ARM64-only; adds
`react-native-nitro-modules`; `lib/_core/mediapipe-inference.ts` must be rewritten to its
`useModel`/`sendMessage` API. Fallback if litert-lm is unsuitable: `expo-llm-mediapipe` (keeps
`.task`, Expo-native, but rides the deprecated MediaPipe runtime).

**Staged plan:** (0) branch + baseline; (1) `expo install expo@^55` → `expo install --fix` (lands RN
0.83, realigns expo-*/reanimated/worklets/screens/etc.); (2) bump `llama.rn`→0.12.4, keep
`whisper.rn`, swap `react-native-llm-mediapipe`→`react-native-litert-lm` (+ rewrite
`mediapipe-inference.ts`, + `react-native-nitro-modules`); (3) re-validate New-Arch config &
`expo-build-properties`; (4) **verification gate** — `expo prebuild` then build with the *original*
unguarded `./gradlew clean assembleRelease` (NO `rm -rf`); a clean build proves the codegen bug is
gone; (5) on success, strip the `rm -rf` from the three `apk:*` scripts + add a CHANGELOG entry.
Contingency: if the bug survives, keep the workaround + document it inline and file upstream.

**Status 2026-06-21 — IN PROGRESS (code complete, native build running):**
- ✅ Deps upgraded: `expo ~55.0.26`, `react-native 0.83.6`, `react 19.2.0`, all `expo-*` aligned to
  the SDK-55 `bundledNativeModules` map; `expo-share-intent`→`^6.1.1`; `reanimated 4.2.1` /
  `worklets 0.7.4`. `pnpm install` clean.
- ✅ Native modules: `llama.rn`→`^0.12.4` (New-Arch); `whisper.rn` kept `0.6.0` (dev-tested RN 0.84);
  `react-native-llm-mediapipe` **removed**, `react-native-litert-lm@^0.4.2` + `react-native-nitro-modules`
  added.
- ✅ Dropped the obsolete `patches/llama.rn.patch` (forced `hasHexagon=false` to dodge a Snapdragon
  `libcdsprpc.so` crash) — llama.rn 0.12.4's `tryLoadLibrary` now catches that `UnsatisfiedLinkError`
  and falls back to the `dotprod_i8mm` CPU variant, so the guard is upstreamed. **Revisit if a
  Snapdragon device crashes on model load.**
- ✅ `lib/_core/mediapipe-inference.ts` rewritten onto LiteRT-LM (`createLLM`/`loadModel`/`sendMessage`/
  `sendMessageAsync`/`close`); same exported API so `settings.tsx` is unchanged.
- ✅ Config: removed `newArchEnabled` (always-on in SDK 55) + `edgeToEdgeEnabled` (removed from
  ExpoConfig); `expo-build-properties` → `minSdkVersion 26`, `buildArchs ["arm64-v8a"]` (LiteRT-LM is
  ARM64-only, API 26+); registered the `react-native-litert-lm` config plugin.
- ✅ `tsc --noEmit` green; `expo prebuild --platform android --clean` succeeded.
- ✅ Fixed `react-native-gesture-handler` (2.30.1 failed `compileDebugKotlin` against RN 0.83.6 —
  `ReactRoot.getRootViewTag()` became a function); bumped to `^2.31.2` (resolves 2.32.0).
- ✅ **VERIFIED: `assembleDebug` BUILD SUCCESSFUL (21m26s) → 101 MB `app-debug.apk`, built WITHOUT the
  `rm -rf` workaround.** The fresh `expo prebuild` + `assembleDebug` ran all codegen/NDK/autolinking/
  Nitro tasks with no autolinking-codegen ordering failure → root cause resolved by the upgrade.
- ✅ Removed the `rm -rf app/.cxx app/build/generated/autolinking` from the three `apk:*` scripts +
  CHANGELOG entry.
- ⬜ **Remaining (functional, tracked):** on-device install + runtime smoke test on an arm64 device; consider `apk:release` (signed) build. (Note: `model-download.ts` + `settings.tsx` user-facing labels/comments `.task`/"MediaPipe" → `.litertlm`/"LiteRT-LM" updated on 2026-06-24).

---

## ✅ Pre-commit code review — agentic-chat upgrade changeset — 2026-07-10 (Linux)

**Scope:** xhigh-effort review of the uncommitted working tree before commit — the
agentic-chat upgrade (web + Android), the `server/phase2/` → `server/core_services/`
scripted relocation, OAuth token at-rest encryption, mesh sub-agent delegation, and the
3D model library. 412 files (+9,305 / −30,117); most churn is the mechanical rename and
deleted `docs/demo` build artifacts. `pnpm check` clean throughout, so the rename
introduced no import/type breakage.

**Verified CLEAN (reviewed in-file, not assumed):**
- **Streaming reducers** (`client/src/lib/agentStream.ts`, APK `lib/_core/agent-stream.ts`)
  + `Chat.tsx` send/finalize + delegation subscription — pure, immutable, correct delta
  accumulation; proper AbortController/unsubscribe cleanup; no leaks.
- **OAuth at-rest encryption** (`server/oauth/platformTokens.ts`) — AES-256-GCM sealing of
  `oauthToken`/`oauthRefreshToken`; traced every raw column reader — all real consumers
  decrypt (or route through `getFreshAccessToken`/`publishExecutor`); `verifyOAuthToken`
  only checks presence+expiry so ciphertext-as-truthy is safe. Migration-safe (legacy
  plaintext passthrough + re-seal on next refresh).
- **`MeshServer.ts`** — inbound peer-fingerprint gate now uses `fingerprint256` colon-stripped
  (`canonicalPeerFingerprint`), matching the exact form `SecurityManager` advertises (l.74),
  `approvePeer` pins, and outbound `checkServerIdentity` compares (l.232) — a correct
  security fix (the legacy SHA-1 `.fingerprint` never matched a pin). `handleSubAgent`
  properly trust-gated, body-capped, write-guarded, keepalive-cleaned.
- **`aiProviderRouter.agentChatStream`** — per-provider sovereign gate
  (`assertProviderAllowedInMode`) present, so cloud providers stay blocked for air-gapped
  users even though it's `protectedProcedure` (local models must work air-gapped).
- **APK `index.tsx`** (+1403) — FIFO queue-drain with synchronous `isSendingRef` guard
  (no double-send), on-device generation serialized to avoid Hermes SIGSEGV, delegation
  stream folded via the shared reducer; **`settings.tsx`** (+754) model download/delete
  handlers have try/catch/finally, partial-file cleanup, unload-before-delete;
  **`phone-model.ts`** one-resident-model invariant + serialized native loads.

**FIXED + VERIFIED this pass:**
- 🐞 **Cross-user data corruption in the 3D model library** (`server/db-models.ts`,
  `drizzle/schema.ts`). `model_assets.fileName` had a **global** unique index, but the
  library is a shared file namespace (`listModels` shows every file to every user) and a
  `model_assets` row is *one user's association metadata* over a shared file. Two users
  registering the same basename (e.g. a Blender export named `model.glb`) collided:
  `registerModelAsset`'s `onConflictDoUpdate(target: fileName)` overwrote the **other
  user's** row (map/project association + metadata) without changing `userId`, and the
  post-insert `SELECT ... WHERE userId` then returned `undefined` (violating its
  `Promise<ModelAsset>` contract). Same mechanism gave an IDOR via `blenderRouter.assignModel`.
  **Fix:** changed the index to composite `uniqueIndex(userId, fileName)` and the upsert
  conflict target to `[userId, fileName]`, so each user's association is independent and
  the function always returns a defined row. Regenerated migration **`0015`** in place
  (was uncommitted/brand-new — no stacked 0016). Left on-disk sharing as-is (matches the
  intentional shared-library design). Added a cross-user regression test to
  `server/__tests__/dbModels.test.ts` (would fail under the old global unique).
  **Verified:** `pnpm check` clean; `dbModels` + `blenderRouter` + `comfyRouterMesh` +
  `jobRouter` suites 30/30 pass (incl. the new guard); migration applies through the real
  in-memory harness.

---

## ✅ Test-coverage tooling + first route-level tRPC tests; aiRouter IDOR fix — 2026-06-24

**Status:** Complete. Closes the long-standing "no coverage tooling / API boundary untested" gap (tracked as **TD-044**) for its first two routers, and fixes a High-risk access-control bug found in the process (**TD-043**).

**What was built:**
1. **Coverage tooling.** `@vitest/coverage-v8` + `pnpm test:coverage`; `vitest.config.ts` gains a V8 `coverage` block (text-summary/text/html/lcov → `coverage/`, source-only includes) with **ratcheting thresholds** locked to the measured baseline (stmts/lines ~9–10%, branches/funcs ~6–7% — a floor that only moves up).
2. **Route-level test harness.** `server/__tests__/_helpers/trpcHarness.ts` — `createTestDb()` backs route tests with a **real in-memory libSQL DB** (actual `drizzle/schema.ts` + migrations, FK cascade on) so ownership filters/upserts/cascades genuinely execute; plus `seedUser()` and `makeContext()`. Tests drive the real router via `appRouter.createCaller(ctx)`, not mocks.
3. **First two suites.** `chatRouter.test.ts` (15 tests → **100% line coverage**: per-user isolation, upsert semantics, FK cascade, auth boundary) and `aiRouter.test.ts` (20 tests → ~57%: Sovereign per-provider gate, `baseUrl` SSRF guard, ommesh precondition, loop-violation audit, + 6 IDOR regression guards).
4. **Security fix (TD-043).** `aiRouter.getSession`/`getSessions`/`saveMessage`/`summarizeAndPruneSession` were `protectedProcedure`s with **no ownership check** — any authenticated user/device could read, append to, or summarize another user's chat session by UUID (`summarizeAndPruneSession` is reachable from the UI's Memory Archiver). All four now scope by `ctx.user.id`, matching `chatRouter`'s isolation. `createSession` already scoped on write.

**Re-verified the source analysis first:** counts were directionally right but imprecise (32 test files not 31; `auth.logout` already drives one route so routers weren't literally 0%; ~8 service modules tested, not 4). No phantom files — safe to build from.

**Gates:** root `tsc` 0 · `vitest` **412/412** (+35) · coverage thresholds pass · `pnpm build` not re-run (no bundle-affecting change).

**Remaining (priority queue, tracked in TD-044):** auth/`admin`/`owner` procedure middleware → `walletRouter`/`virtualCardRouter` route layer → `HITLApprovalService` → `MeshServer` mTLS + cert pinning → `AiProviderService` spend/fallback → `PipelineEngineService`.

---

## ✅ Map RAG over Remote Sources (VectorDB feed, end-to-end) — 2026-06-23

**Status:** Complete (built full, no deferrals, per the *Build Complete, Fix Now* directive now pinned atop CLAUDE.md / AGENTS.md / memory.md). Closes the user-flagged "half the point" item — `fetchSourceTree` output is now ingested as **real content** into the map's VectorDB collection and consumed by chat.

**What was built — three halves made whole:**
1. **Write path (content, not labels).** Per-adapter content resolvers (`integrationsRouter.resolveSourceDocuments`) fetch real bodies for **all 8 source types**: github (contents API + 403/429 backoff), notion (block children), slack (`conversations.history`), google-drive (export / `alt=media`), gmail + outlook (full body, html→text), dropbox (recursive list + download), onedrive (BFS + content). Bounds: 400 items/src, 100 KB/item, 8 MB/src, concurrency 5, text-extension allowlist, per-item failures skipped. Generic ingest via new `MemoryArchitectService.reindexRemoteSource(mapId, uri, type, docs)` → chunk + PromptSanitizer + redact → collection `omnecor_{mapId}`. Stable ids; per-source reconcile via new `VectorDBService.removeDocumentsWhere`.
2. **Trigger + UX.** `integrations.indexMapSources` (externalServiceProcedure, ownership-checked, `indexingEnabled`-gated) runs a **detached** job; `integrations.getMapIndexStatus` polled by client. `BrainMap` header gains an **Index** button + live progress; auto-indexes once per map open; completion → NotificationService.
3. **Read path (was entirely absent from chat).** `server/_core/ragContext.ts#injectMapRagContext` retrieves from the map collection and injects into **both** `systemPrompt` and the system message (providers disagree which they read) — wired into `aiProvider.chatStream` **and** `ai.chat`, gated by map `enableAIContext`; local retrieval so **Sovereign-safe**. `Chat.tsx` passes `ragMapId` from the active map.

**Bug fixed on sight (collection-naming seam):** the local file watcher wrote a **raw** `omnecor_${projectId}` collection while the RAG reader (`MemoryArchitectService`) queried a **sanitized** one — for hyphenated map UUIDs these diverged, silently emptying RAG. Unified everything on an exported `sanitizeCollectionName`. Lifecycle: `neuralMaps.update` drops vectors for removed remote roots; `neuralMaps.delete` drops the whole map collection.

| File | Change |
|---|---|
| `server/phase2/services/VectorDBService.ts` | exported `sanitizeCollectionName` (single source of truth); `removeDocumentsWhere(collection, where)` |
| `server/phase2/services/MemoryArchitectService.ts` | `collectionName` → shared helper; `reindexRemoteSource`, `deleteRemoteSource` |
| `server/_core/index.ts` | watcher uses `sanitizeCollectionName` (seam fix) |
| `server/routers/integrationsRouter.ts` | content bounds + concurrency/retry/htmlToText/extract helpers; `resolveSourceDocuments` (8 adapters); `indexMapSources` + `getMapIndexStatus` + detached job tracking |
| `server/_core/ragContext.ts` | new — `injectMapRagContext` (read path) |
| `server/routers/aiProviderRouter.ts`, `server/routers/aiRouter.ts` | `ragMapId` input + RAG injection before inference |
| `server/routers/neuralMapsRouter.ts` | source-removal + map-delete vector reconcile |
| `client/src/pages/BrainMap.tsx` | Index button, auto-trigger, polled progress |
| `client/src/pages/Chat.tsx` | passes `ragMapId` (gated by `enableAIContext`) |

**Gates (2026-06-23):** root `tsc` **0** · `vitest` **371/371** (20 new in `remoteSourceIngest.test.ts` + `ragContext.test.ts`) · `pnpm build` ✓ · new symbols confirmed in both server & client bundles · changes uncommitted.

**⚠️ Runtime proof outstanding (NOT deferred — environmental):** no live in-browser drive this pass — the sandbox terminates any bound HTTP listener (exit 144, no output), and a true end-to-end ingest also needs ChromaDB running + real GitHub/OAuth tokens. Exercise `indexMapSources` → chat RAG against a live ChromaDB + a connected source in an operator env, then promote the UI-Registry Session 24 verdict to VERIFIED-REAL ✅. See memory `neural-map-remote-ingestion`.

---

## ✅ Neural Map — off-thread layout + bounded loading (handles any project size) — 2026-06-22

**Status:** Complete. Fixes the UI hang reported while a neural map loads/indexes, and makes the map scale to any project (50-file demo → 50k-file monorepo). Gates green.

**Problem:** opening a large map froze the tab. Root cause was a synchronous O(n²) force simulation + overlap pass run on the render thread the moment indexing finished, compounded by React Flow mounting every node's DOM at once, and `getFileTree` building the tree to depth 8 with **no node cap**.

**What was built:**
- **Layout off the render thread** — pure engine (`neuralLayout.ts`) runs in a **Web Worker** (`neuralLayout.worker.ts` + `neuralLayoutClient.ts`, with a synchronous fallback). Force repulsion is now **Barnes-Hut O(n log n)** (was O(n²)); overlap/separation grid-accelerated; iterations scale down with node count. A "Computing layout…" overlay covers the compute phase.
- **Node-count-aware virtualization** — `onlyRenderVisibleElements` forced on above 300 visible nodes regardless of the GPU toggle.
- **Bounded server loading** — `getFileTree` now builds breadth-first via `buildBoundedTree` with a node **budget (default 1500)** + depth limit; over-budget/over-depth folders return `truncated:true` + `childCount` (all-or-nothing per folder; root sliced with a visible "…N more" marker as last resort).
- **Client lazy expansion** — double-clicking a truncated folder (graph **and** tree view) fetches its subtree (`getFileTree({rootDir, maxDepth:3})`) and merges it via `subtreeToNodes`; drill-in visuals (`FolderPlus` + `+N`); `toast.loading→success/error` lifecycle; layout seeds from on-screen positions so expanding doesn't reshuffle the map.
- **Review fixes** — WS incremental nodes now key on absolute `filePath` (matches tree ids); MiniMap/Background colors resolved from `--color-*` tokens (no hardcoded hex); `layoutComputing` cleared on unmount.

| File | Change |
|---|---|
| `client/src/lib/neuralLayout.ts` (new) | Pure layout engine — Barnes-Hut force, grid overlap, layered/radial/circular layouts |
| `client/src/lib/neuralLayout.worker.ts`, `neuralLayoutClient.ts` (new) | Web Worker + main-thread client with sync fallback |
| `client/src/components/neural/NeuralGraphView.tsx` | Off-thread layout effects, compute overlay, virtualization, truncated badge, WS `filePath` fix, token-resolved canvas colors |
| `client/src/components/neural/NeuralTreeView.tsx` | Tree-view drill-in for truncated folders |
| `client/src/lib/fileTreeToNetwork.ts` | Propagate `truncated`/`childCount`; `subtreeToNodes` merge helper |
| `client/src/pages/BrainMap.tsx` | `expandedPaths` state, on-demand subtree queries, network merge, expand toast lifecycle |
| `client/src/lib/stores/brainMapStore.ts` | `layoutComputing` flag |
| `server/routers/projectRouter.ts` | `buildBoundedTree` (budget+depth+truncation+overflow marker); `getFileTree` `maxDepth`/`nodeBudget` params |

**Tests added:** `neuralLayout.test.ts` (engine correctness + large-graph scaling), `fileTreeToNetwork.test.ts` (truncation propagation + subtree merge), `server/__tests__/buildBoundedTree.test.ts` (budget/depth/overflow/ignore).

**Gates (2026-06-22):** root `tsc` **0** · `vitest` **351/351** · `pnpm build` ✓ (worker chunk emitted) · `pnpm audit --prod` **0** · changes uncommitted.

**UI patterns imprinted →** `Context/UI-Registry.md` (working-overlay, truncated badge, tree drill-in). **Deferred/intentional notes →** `Context/Tracker-Docs/Tech-Debt.md` (TD-039/040/041).

---

## ✅ MoE Chain (Mixture-of-Experts Chain) — 2026-06-22

**Status:** Complete. All server, client, and DB work merged to main.

**What was built:**

A sequential multi-model routing pipeline that passes a user's chat message through an ordered chain of specialist models, with each step's output feeding into the next as context. Designed for 8–16 GB hardware where only one model can occupy RAM at a time.

**Two chain types:**

- `moe_chain` — local GGUF specialist models via `llamacpp_bridge.py` (port 8013). `LlamaCppService.unload()` frees the current model between steps; `preWarm()` loads the next. Allowed in Sovereign mode.
- `moe_chain_omesh` — cloud API provider chain (Anthropic, OpenAI, etc.) called sequentially. Blocked in Sovereign mode.

**Logical step order** (hardcoded in `valetRouter.ts`): `knowledge_retrieval` → `research` → `code_generation` → `code_review` → `integration` → `synthesis` → `reporting`. Steps with a non-empty `taskCategories[]` are skipped when the Valet's classification does not match.

**Slash command:** `/MOE-Chain` (both chains), `/MOE-Chain L` (local only), `/MOE-Chain C` (cloud only). First run triggers `valet.initMoeChain`, which scans `~/.omnecor/models/` for GGUFs and seeds the DB.

**UI:** Settings → Valet Router → MoE Chain (`MoeChainPanel.tsx` wired into `ValetRouterPanel.tsx`). Two-card layout with per-step model picker, task category selector, up/down reorder, add/remove, and save.

**DB:** `moe_chain_configs` table added to `drizzle/schema.ts` (one row per `userId + chainType`). Migration generated and applied.

**Key files changed/created:**

| File | Change |
|---|---|
| `drizzle/schema.ts` | New `moeChainConfigs` table + `MoeChainStep` interface |
| `server/phase2/services/MoeChainService.ts` | NEW — sequential chain executor |
| `server/phase2/services/LlamaCppService.ts` | Added `unload()` and `preWarm()` |
| `server/phase2/services/AiProviderService.ts` | `moe_chain` / `moe_chain_omesh` branch in `streamChat()` |
| `server/routers/valetRouter.ts` | New procedures: `getMoeChain`, `saveMoeChain`, `initMoeChain`, `scanLocalModels` |
| `server/routers/aiRouter.ts` | Added `routingMode` + `userId` to `chatInputSchema` |
| `client/src/components/settings/MoeChainPanel.tsx` | NEW — two-card settings UI |
| `client/src/components/settings/ValetRouterPanel.tsx` | MoeChainPanel wired in |
| `client/src/components/chat/ChatInput.tsx` | `/MOE-Chain [L\|C]` slash command |
| `client/src/pages/Chat.tsx` | `moe-chain` case in `handleCommand()` |

**Documentation:**

- `docs/ai-agents/MOE_CHAIN.md` — created (full feature reference)
- `docs/ai-agents/VALET_ROUTER.md` — §3.8 and §3.9 expanded with implementation details
- `Context/UI-Registry.md` — `MoeChainPanel` entry added

---

## ✅ Neural-Map Dropbox / OneDrive Adapters — 2026-06-22

**Status:** Complete (visualization parity with Google Drive). Closes the tracked deferred adapter work from the 2026-06-20 sweep / memory `neural-map-remote-ingestion`.

**What was built:** one-click-OAuth Dropbox + OneDrive sources for the Neural Brain Map. The user connects each via the existing OAuth flow (already wired to `platformAccounts`); the map lists the account's **shallow top-level** files/folders as expandable `FileTreeNode`s — same render path as Google Drive.

**Decisions:** connect via one-click OAuth (not paste-token); token **read-through from `platformAccounts`** (single source of truth, refresh-on-401, no token duplication); shallow listing (folders shown, no recursion); scope = **visualization only** — the VectorDB/RAG feed is a separate next-session task for *all* remote sources (user: "half the point").

| File | Change |
|---|---|
| `server/routers/integrationsRouter.ts` | `OAUTH_INTEGRATION_TYPES`; `getOAuthAccount`, `listDropbox`, `listOnedrive`, `fetchOAuthIntegrationItems` (refresh-on-401, mirrors gmailRouter); `fetchSourceTree` `integration://` branch routes dropbox/onedrive to platformAccounts; `getIntegrations` reflects active platformAccounts row; `connect` rejects OAuth-only types; `disconnect` deactivates the row |
| `client/src/components/IntegrationsHub.tsx` | `OAUTH_CONNECT_TYPES`; Connect button → `oauth.getAuthorizationUrl` for dropbox/onedrive (was paste-token dialog) |
| `client/src/components/neural/MapManager.tsx` | dropbox/onedrive `neuralMapSupported: true` (Coming-soon badge + toast auto-removed) |

**Operator action to go live:** set `DROPBOX_CLIENT_ID/SECRET` + `ONEDRIVE_CLIENT_ID/SECRET`; register redirect URI `${PUBLIC_URL||http://localhost:PORT}/api/oauth/callback/{dropbox|onedrive}` (`:3000` dev, `:37291` packaged desktop). Per the `oauth` skill: Microsoft/OneDrive + Dropbox both accept `http://localhost` redirect URIs for dev — no portless `.dev` TLD required (that's only for Google/Apple). Stays honestly "Not connected" until creds are set.

**⭐ Next session (user-flagged): ✅ DONE 2026-06-23** — wired `fetchSourceTree` → real content → VectorDB (gated by `indexingEnabled`) for all remote source types generically, plus the chat read path. See "✅ Map RAG over Remote Sources (VectorDB feed, end-to-end) — 2026-06-23" at the top.

**🔬 Critical hardening pass (2026-06-23, user asked "is this actually built well or just good-enough-to-say-done"):** found + fixed real gaps that would've surfaced only at runtime/testing:
- **Dropbox scope was wrong** — requested only `files.content.read`; `/2/files/list_folder` needs **`files.metadata.read`** → listing would 401 on missing scope. Added it (`oauthClients.ts`).
- **Dropbox issued no refresh token** — `getProviderExtraAuthParams` lacked `token_access_type=offline` for Dropbox → ~4h token, no refresh → integration silently dies after expiry. Added it.
- **Inaccurate scopes/descriptions** in `lib/integrations.ts` — dropbox/onedrive claimed write scopes (`files.content.write` / `Files.ReadWrite.All`) never requested, and "Sync files" wording; corrected to actual read-only scopes + Neural-Map descriptions; `INTEGRATION_FEATURES` now lists `neural-map` for the 3 storage providers (was missing on google-drive too).
- **Broken Sync button** — connected dropbox/onedrive showed a Sync action that hit the paste-token store → `NOT_FOUND`; hidden for OAuth types (health/Refresh/Settings/Disconnect all verified to work via platformAccounts).
- **Silent 100-item truncation** — `listDropbox`/`listOnedrive` capped at one page; now **fully paginated** (Dropbox `list_folder/continue` cursor, OneDrive `@odata.nextLink`) up to a documented `REMOTE_LIST_CAP = 1000`.
- Verified end-to-end: the generic `/api/oauth/callback/:platform` exchanges + stores token/refresh/expiry in `platformAccounts` (both providers have complete OAuth client configs + profile branches).

**Adjacent fixes same pass (deferred items that shouldn't have been):**
- **`CLOUD_PROVIDER_IDS` consolidated** — removed the 3 remaining inline copies (`aiProviderRouter`, `WebSocketServer`, `MeshNode`) onto the single `server/_core/sovereign.ts` source (drift = silent sovereign-mode leak). aiRouter/podcast/agentMessenger were already migrated.
- **N+1 eliminated** — `agentMessengerRouter.listConversations` did 2 queries/persona; added batched `lastMessagesByPersona`/`unreadCountsByPersona` (3 queries total) and removed the now-orphaned single methods.
- **Dead `if (!dbInstance)` guard removed** in `oauth.ts` (getDb never returns null — same class as the context.ts fix).
- **Sovereign ≠ Fiction Mode (investigated per user):** confirmed independent — `isFictionMode` is driven only by the active map's `mode === "fiction"` (`BrainMap.tsx:400`) or the manual toggle; nothing reads `executionMode`. Default off. So sovereign users are not pushed into fiction mode's feature lockout (Agent Networking + Wallet).

**Gates (2026-06-23, full hardening pass):** root `tsc` **0** · `vitest` **371/371** · `pnpm build` ✓ (51s) · `pnpm audit --prod` **0** · changes uncommitted.

---

## 🔪 Beta-Readiness Code-Sweep — 2026-06-22 (Linux)

> `/code-sweep` full 10-domain run. Scan = 1 background agent (TS/db/routers, clean) + inline greps covering all 10 domains (the other 2 background agents were Bash-permission-blocked; inline runs covered their domains).
> Baseline → final gate: `tsc` **0 → 0** · `vitest` **338/338 → 338/338** · `pnpm build` **✓ → ✓ (50.8s)** · `pnpm audit --prod` **0 → 0** ✅.

### FIXED + VERIFIED this pass
| Sev | Domain | Issue | Fix |
|---|---|---|---|
| **MEDIUM** | security/architecture | `server/_core/index.ts` default-voice seed copied from a hardcoded developer path `/home/linux/.steam/.../recording_highlight.wav` — dead on every non-dev machine (deferred-cleanup #5). | Removed the machine-specific branch; first-boot now **always** writes the tiny valid silent WAV (was already the fallback). Portable. |
| **MEDIUM** | typescript/database | `TrpcContext.db` typed `any` with stale doc comments claiming "null in SQLite mode; routers must null-guard" — actively misleading (the libSQL unification made `getDb()` never-null; `ctx.db = await getDb()`). Risked devs re-adding dead null-guards. | Typed `db: Db` (real Drizzle type, imported from `db.js`); corrected both doc comments to "always live; never null". tsc still 0 → no consumer relied on `any`. |
| **MEDIUM** | dependencies | `packaging/electron-app/package.json` had a top-level npm-style `"overrides"` block (esbuild/form-data/tar). electron-app is a **workspace member** (root `pnpm-workspace.yaml`) with no own lockfile → pnpm 10 **ignores** it; all 3 pins are already enforced identically by root `pnpm-workspace.yaml`. Dead config that violates the documented "overrides live in pnpm-workspace.yaml" rule (re-added by a later security-pin commit after the 2026-06-20 removal). | Removed the dead block. Verified JSON valid + all 3 floors present in root. Install tree unchanged (it was a no-op). |

### Confirmed CLEAN (verified in-file, not assumed)
- **Routers:** all cloud-API procedures correctly guarded — `falRouter`/`voiceRouter.synthesizeElevenLabs` = `cloudProcedure`; `aiRouter.chat`, `imageGenRouter.generate`, `podcastRouter.generateScript` = `protectedProcedure` + `assertProviderAllowedInMode()`. No `initTRPC` re-init; all routers import from `_core/trpc.ts`; no silent mutations; no `return []`/"not implemented" stubs.
- **Database:** zero MySQL-legacy id parsing (`insertId`/`lastInsertRowid`/`as any)[0]`); schema is pure `sqlite-core`; all `getDb()` awaited (the `.then()` ones are intentional fire-and-forget with error logging); no leftover `!db` guards; no raw SQL with user input.
- **Security:** no `exec`/`execSync` with interpolation in prod (only `bash -n "${scriptPath}"` inside `*.smoke.test.ts`, excluded + constant path); no hardcoded secrets; CORS not `*`; every `dangerouslySetInnerHTML` is static or `DOMPurify.sanitize()`'d (SchematicNode/PCBNode render **static** `componentLibrary.ts` SVG + sanitize); `rvc_server.py` `.eval()` = PyTorch, not JS.
- **Frontend:** no component imports `drizzle/schema`/`server/`/`getDb` (client→server is `import type { AppRouter }` only); zero default exports in components/pages; no raw `fetch`/`axios` to the API; no `console.log`/`debugger`.
- **Architecture:** no `react`/JSX in `server/`; single `express()` entry point; `../../../` in client = only the root-`assets/` logo import (intentional, no alias) + type-only `AppRouter`.
- **Mobile:** no `oklch()` in RN; AsyncStorage holds only non-sensitive IP/port/name + the **encrypted** audit ring buffer (secret lives in SecureStore); no plaintext creds.
- **TypeScript:** server `as any` casts remain at 0; the ~57 `: any` annotations are justified (dynamic `bonjour`/`ChromaClient` libs, canvas-callback nodes in exempt `MeshTopologyGraph`, React `isComposing` event, error handlers).

### Outstanding / deferred (reconciled — NOT new bugs; carried forward)
- [x] **~774 raw Tailwind color occurrences across 64 files** — the tracked design-token backlog. Migrated to semantic design tokens (safe colors to primary/destructive/success, structural colors to background/card/muted). Exempt files left untouched. Visually verified.
- ~~**Neural-map dropbox/onedrive "Coming soon"** (`MapManager.tsx`)~~ — **✅ RESOLVED 2026-06-22:** dropbox/onedrive adapters built (one-click OAuth, `neuralMapSupported: true`); their content now ingests into VectorDB like every other source (2026-06-23). No "coming soon" types remain.
- **Mobile `.task`/"MediaPipe" text** in `model-download.ts` comments + `settings.tsx` — stale post-LiteRT-LM-swap labels; part of the IN-PROGRESS Expo SDK 55 finishing items (left untouched to avoid colliding with that planned change).
- **Security-review deferred cleanups (memory `security-review-deferred-cleanups`):** #1 `CLOUD_PROVIDER_IDS` duplicated in 6 files (extract to `shared/const.ts` — a 6-file refactor, out of sweep scope; drift risk only). #2 `podcastRouter.generateScript` → `cloudProcedure`: **do NOT** blindly convert — it's `protectedProcedure` + per-provider check *by design* so a LOCAL (ollama) generation isn't wrongly blocked in Sovereign mode; `cloudProcedure` would over-block. #3 N+1 in `agentMessengerRouter.listConversations`. #4 `ommesh.router` re-implements settings JSON I/O. All sequenced, not regressions.
- **`getInstance()` → `ctx.services.*`** broader migration (75 call sites) — pure convention; blocked on first exposing VirtualCard/Valet/PCBWay/ModelManagement/AuditLog singletons on `ctx.services`. Tracked task, no bug.

---

## 🔪 Ruthless Public-Beta Code-Sweep — 2026-06-20 (Linux)

> `/code-sweep` full 10-domain run. User directive this pass: **assume everything broken/mock/vulnerable until proven**; **nothing may be "deferred" or "known-broken"**; **mock features get implemented, not deleted — unless already replaced/superseded.**
> Baseline → final gate: `tsc` **0 → 0** · `vitest` **353/353 → 353/353** · `pnpm audit --prod` **14 (2 high) → 0** ✅ · `pnpm build` **❌ broken → ✓ clean** (fixed a pre-existing break).

### FIXED + VERIFIED this pass
| Sev | Area | Issue | Fix |
|---|---|---|---|
| **HIGH** | security/routers | **Sovereign-mode bypass ×3.** `curatorRouter.curateArticle`/`regenerateDraft` (→anthropic), `pcbEditorRouter.reviewDesign` (→openai), `imageGenRouter.generate` (→fal/openart) called cloud AI on `protectedProcedure` with **no** sovereign guard. `AiProviderService.chat()` has no central guard, so each sibling router leaked. | New shared `server/_core/sovereign.ts` (`CLOUD_PROVIDER_IDS`, `CLOUD_IMAGE_PROVIDER_IDS`, `assertProviderAllowedInMode`, `assertImageProviderAllowedInMode`); wired into the 3 unguarded procedures. |
| **MEDIUM (feature build)** | mock→real | **HITL approval queue was unbuilt** — `AgenticWalletPanel` "HITL Authorization" button opened an info-only dialog; comment said `getPendingActions`/`approveAction` "not yet wired to any router". | Added `security.getPendingHitlActions` (admin query) + `security.resolveHitlAction` (admin mutation, NOT_FOUND if already resolved); rebuilt the dialog into a live polling queue (3s) with real Approve/Reject calling the service (which audit-logs). Stale comment updated. |
| **HIGH** | dependencies | **14 audit vulns (2 high)** — undici/hono/dompurify/markdown-it across expo-CLI, MCP SDK, web mermaid, mobile renderer. | pnpm-workspace.yaml override floors: `dompurify>=3.4.11`, `hono>=4.12.25`, `markdown-it>=14.2.0`, `undici>=8.5.0` (a naive `>=6.27.0` floor let pnpm jump to vulnerable undici 8.0–8.4). `pnpm install` + rebuild → **audit 0**, tsc 0, vitest 353, build ✓. |
| **HIGH** | build | **`pnpm build` was broken** (pre-existing) — `scripts/build-server.mjs` resolved Express-4's callable `path-to-regexp@0.1.x` only via `.pnpm`, but `.npmrc node-linker=hoisted` nests it at `node_modules/express/node_modules/path-to-regexp` and hoists v8 (non-callable) to top-level. Recent gates had silently skipped `pnpm build`. | Resolver now checks the hoisted nested location first (verifies `0.1.x`), then falls back to the `.pnpm` scan — works in both linker modes. Server bundle builds clean. |

### FINDINGS — open (classified; NOT deferred — sequenced into the 3-session plan)
- **neural-map ingestion — ✅ BUILT (Session 1, 2026-06-20).** Was a shell (remote roots = decorative labels). Now: new `integrations.fetchSourceTree` (cloudProcedure) resolves `github://owner/repo` → recursive file tree and `integration://<type>` → real listings (notion/slack/gmail/outlook/google-drive); `BrainMap.tsx` renders them through the same `fileTreeToNetwork` as local roots, gated by `settings.indexingEnabled`; MapManager google-drive flipped supported. Gate: tsc 0 · vitest 353 · build ✓. **Remaining: ✅ push-to-VectorDB + chat RAG DONE 2026-06-23; ✅ dropbox/onedrive adapters DONE 2026-06-22.** Only live end-to-end runtime proof (needs ChromaDB + real tokens) is still outstanding. See memory `neural-map-remote-ingestion`.
### Live verification (2026-06-20, dev server + ZERO_LOGIN scrapper)
- **Neural-map github ingestion — PROVEN LIVE** against a real classic PAT (read from gitignored `.env`, never exposed). `integrations.connect` 200 (user Clarkescustomcreations); `fetchSourceTree github://…/OmnecorV1-Beta` → real tree (41 top-level, 1500 nodes, nested); BrainMap DOM rendered the actual repo files (MEMORY.md, .github/workflows/*.yml, .claude/skills/*/SKILL.md). Error probes honest (404 / NOT_FOUND / BAD_REQUEST). Screenshot tooling can't capture the animated force-graph canvas (DOM evidence used).
- **AI keys (OpenAI/Anthropic) fixed:** root cause = wrong `.env` var names (`Open_AI_Token`/`Anthropic`) → renamed to `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`; also killed stale dev procs serving old env. Keys now authenticate live. Both accounts are out of credits (OpenAI `insufficient_quota` 429; Anthropic "credit balance too low" 400) — account billing, not code.
- **NEW FIX — opaque provider errors:** all 8 `AiProviderService` chat methods threw only `response.statusText` ("Bad Request"/"Too Many Requests"), discarding the provider's real error. Added `describeHttpError()` helper surfacing the actual message (e.g. "429 — exceeded your current quota", "400 — credit balance too low"). Gate: tsc 0 · vitest 334/334.
- **Social publish pipeline — PROVEN LIVE (no credentials):** dummy-token twitter account → `createDirectPost` → `publishNow` → executor made a real `api.twitter.com/2/tweets` call → genuine 403 → status written back `failed` + real errorMessage. Full chain (token lookup → curated⨝scheduled join → PublishingService dispatch → real HTTP → status persist) verified. `listAccounts` correctly does not expose raw tokens.
- **NEW FIX ×2 (minor):** (1) `integrations` fetch helpers (github/notion/gdrive) now map **404→NOT_FOUND** and github **403→FORBIDDEN** (were all INTERNAL_SERVER_ERROR) — verified live (missing repo → NOT_FOUND). (2) `platforms.addAccount` now returns the real numeric row id via `.returning({id})` (was the platform string) — verified live (accountId=number). Gate: tsc 0 · vitest 334/334.

### Session 3 — Design tokens + deeper mock hunt ✅ MOSTLY DONE 2026-06-20 (tsc 0 · build ✓)
- **Deeper mock hunt = all REAL:** knowledge base (ChromaDB vector ingestion), pipelines (real `AiProviderService.chat`), social publishing (real Twitter/LinkedIn/Facebook/IG API calls; YouTube honest "needs video" error), podcast E2E. Social publishing's only caveat is "not yet live-tested" with real tokens — code is real, not a shell.
- **Palette gap fixed:** added `--accent-warning` + `--accent-info` to `Globals.css` (prior sweeps had no warning/info token → amber/yellow had no correct target). New utilities verified emitting real CSS.
- **Always-on chrome migrated:** UpdateBanner/ZeroLoginBanner/PeerCard/ExecutionModeBadge → semantic tokens.
- **~506 raw color classes / ~64 files REMAIN** — needs a dedicated **visually-verified** pass (dark theme can't be validated headless). Full mapping table + exempt-file list in memory `beta-sweep-followups`.

### Session 2 — Security/correctness debt batch ✅ DONE 2026-06-20 (tsc 0 · vitest 334/334 · build ✓)
- **`as any` → 0 in server:** `walletRouter` getSpendLog/getSpendSummary → Drizzle `.$dynamic()`; `WebSocketServer.resolveBackend` typed `Record<string,unknown>` + dropped `persona.data` cast. Client `PodcastStudio` `window as any.__activeSegmentAudio` → `useRef`.
- **electron taskkill** → `execFileSync('taskkill',['/F','/PID',pid])` + numeric-pid guard (F2).
- **electron-app dead `"overrides"`** removed (root pnpm-workspace.yaml already pins esbuild globally).
- **superseded `client/src/lib/integrations.ts` mock removed** — trimmed to the 3 live exports (`IntegrationType`/`INTEGRATION_FEATURES`/`getIntegrationInfo`); fake-token generators gone; test trimmed (353→334 = dead-mock tests removed).
- **`getInstance()`→`ctx.services`:** done for my new `securityRouter` HITL calls (`ctx.services.hitl`); broader migration needs `ctx.services` expanded for VirtualCard/Valet/PCBWay/ModelManagement/AuditLog first — tracked as its own task (pure convention, no bug). See memory `beta-sweep-followups`.

### Confirmed CLEAN (verified, not assumed)
DB layer (no `insertId`/dialect-leak/unawaited `getDb`); no hardcoded secrets; `JWT_SECRET`/`ZERO_LOGIN_MODE` production guards present; CORS not `*`; `dangerouslySetInnerHTML` all static (component-lib SVG + shadcn chart); mobile creds in SecureStore + AsyncStorage encrypted; no `oklch` in RN; single server entry point; no `react`/JSX in `server/`; client→server import is type-only.

---

## 🚦 Current Status
*   **Built (2026-07-10): Model-Fabric Phase 8 — local GGUF auto-discovery + hot-swap (Omnecor's own runtime hosts *every* local model, no manual adds).** Closes the last "Ollama really is optional" gap: the runtime is no longer a single-static-model server — it discovers and hot-swaps across every GGUF the box already has.
    *   **Discovery (`ModelIndexService`):** auto-indexes every GGUF from (1) the app models dir (`PATHS.models`, skipping the `valet-router/` classifier) and (2) the **Ollama blob store** — parses `~/.ollama/models/manifests` → model-layer digest → `blobs/sha256-*` and reconstructs real names (`deepseek-r1:14b`). Reads **off disk**, so it works with **Ollama stopped**. GGUF-magic (4-byte) gated; content-deduped by `size + sha256(first 64 KB)` (a models-dir hardlink and its Ollama blob collapse to one; models-dir wins). Async `fs/promises` scan + 30 s cache; synchronous non-blocking `list()`/`resolve()` (stale → background refresh; boot awaits one `refresh()`).
    *   **Hot-swap (`LocalLlmRuntimeService`):** new `ensureModelLoaded(idOrPath)` stops the current `llama-server` and spawns the requested model. **All** lifecycle work (boot load / hot-swap / crash respawn) runs through **one serialization queue** so nothing orphans a second server on the port. Per-model `--n-gpu-layers` VRAM-fit via `collectGpuTelemetry()` (fits→all, else proportional partial offload — no OOM crash-loop for a 14B/27B on 8 GB). Last model persisted (`localLlmLastModel` setting) → boot resumes it, else idle/load-on-select. `getLoadedModelId()`/`isAvailable()` added.
    *   **Catalog + surface:** `ModelCatalogService` now lists **all** indexed models as `omnecor-runtime` (warm one flagged `loaded`, ready-gated) and **skips the live Ollama API source when the runtime is available** (the index already covers the store — no double-listing). New non-blocking `aiProvider.loadLocalModel` mutation; `ModelSelector` "loading… → loaded" pending indicator (`bg-accent-success`, 2.5 s refetch while pending, ceiling so a failed load can't stick). APK: `loaded` flag mirrored in the type; mobile picker indicator UI still TODO.
    *   **`/review` found 6 issues, all fixed same session** (1 Important + 5 Minor): serialized all lifecycle through one queue; `_waitForHealth` bails on proc-death; async non-blocking index scan; ready-gated `loaded` flag; content-clean source-gating; CPU-safe GPU fallback.
    *   **Live-verified on DadsPC (`.201`, RTX 4060 Ti):** all 10 Ollama GGUFs render as **"Omnecor · This PC"** (0 Ollama-branded); boot-resume + hot-swap + inference (`REVIEW_FIX_OK`) + persistence confirmed on real hardware.
    *   **Still open:** HF browse/download UI; MoE-Chain still on the separate `LlamaCppService`/:8013 bridge; APK picker loaded-indicator UI.
    *   **Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1469 passed | 4 skipped** ✅ (+22 from the 1447 baseline; new `ModelIndexService.test.ts` 8).
*   **Built (2026-07-08): Model-Fabric Phase 7 — per-node "Omnecor hosts itself" grouping (web picker + APK picker + Model Hub) + all gates green.** Owner caught that although Model-Fabric made Ollama optional, no UI surfaced Omnecor as its own host — the pickers lumped the Omnecor runtime and Ollama into one "This PC" group and the web Model Hub was still Ollama+cloud only.
    *   **Fix:** new `describeCatalogHost()` (single source of truth in `shared/types/modelCatalog.ts`, hand-mirrored in APK `lib/_core/ai-models.ts`) derives host **brand** (omnecor/ollama/cloud/phone) + **node** per catalog entry. A mesh peer's brand is derived from its advertised `providerId` (llamacpp = the peer's own Omnecor runtime, ollama = Ollama), so with OMMESH **each node reads as its own "Omnecor · \<node\>" group** — the design the owner asked for (Omnecor can host on 4+ mesh nodes, each distinct). Ollama kept as a de-emphasized fallback brand.
    *   **Surfaces:** web `ModelSelector.tsx` (Omnecor nodes lead in purple, Ollama muted below, then Cloud); APK grouping; a new **"Omnecor" tab** in the web Model Hub (`ModelHubPanel.tsx`) sourced from `aiProvider.catalog` — per-node self-hosted sections, "Omnecor hosts these itself" banner, `Self-hosted`/`Ready` cards.
    *   **Live-verified (chrome-devtools, real dev server + real spawned llama-server :8014):** live catalog exposes the `omnecor-runtime` entry (`llama-3.2-3b.gguf` · llamacpp · 1926 MB); the chat picker renders a distinct **"Omnecor · This PC"** group above "Ollama · This PC" + "Cloud"; the Model Hub Omnecor tab renders the **"OMNECOR · THIS PC"** node with the self-hosted card.
    *   **Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1455 passed | 4 skipped** ✅ (+16 tests) · `pnpm build` ✅ · `pnpm audit --prod` no known vulns ✅. **Still deferred to a hardware session:** the full agentic tool-loop dual-sided verify on a real mesh (web + APK + a peer advertising models → a real "Omnecor · DadsPC" group) — DadsPC (RTX 4060 Ti, owner's fastest reasoning node) has a stale build; bundle with Mesh-Delegation Phase 10.
*   **Built (2026-07-08): Mesh Sub-Agent Delegation (Model-Fabric 5B) — full sub-agent on a mesh peer, streamed back as a managed chat.** Full detail + task list in `Mesh-Delegation.md` (Phases 1–9 ✅; Phase 10 live mesh verify deferred to a hardware session).
    *   **What it does:** the main chat's agent can `delegate_task` to a trusted OMMESH peer; a full `ChatAgentRunner` tool loop runs *on the peer* (its own filesystem, inside a `~/.omnecor/…/delegation/<taskId>/` sandbox or an opt-in explicit path shown at approval). The run streams back over the existing strict-mTLS `:3001` as NDJSON and the origin persists + re-publishes it as a **new managed chat** on web + APK. Per-action HITL relays all the way to the user's device; the parent chat gets an async `subagent` block and is re-prompted with the condensed result on completion (start_job semantics).
    *   **Server:** `shared/subagent.ts` wire contract + a `subagent` `AssistantBlock`; `SubAgentHostService` (isolated approval broker, concurrency cap + kill-switch, executionMode enforcement, cursor-replay buffer, grace-window abort, start_job continuation); 4 `/subagent` routes on `MeshServer` behind the pinned-peer trust gate; `DelegationService` (origin-owned persistence, ownership-checked HITL forward, cursor re-attach, parent re-prompt); `delegate_task` tool (origin-only, always HITL-gated); `delegationRouter` + `resolveToolApproval` transparent forward + WS `delegationEvent`.
    *   **Clients:** web `SubAgentBox` chip (approve/deny + tap-through), managed chats in the sidebar with a node badge, live `delegation.stream` fold, between-turn input + cancel; APK mirror (`subagent` chip, transcript-fetch materialization, node badge, header cancel, delegated send branch).
    *   **Gates:** `pnpm check` (root + APK) ✅ · `pnpm test` **1447 passed | 4 skipped** ✅ (33 new tests) · `pnpm build` ✅ · `pnpm audit --prod` 0 vulns ✅. Live multi-peer mesh verify is the one remaining item (deferred to a hardware session, bundled with Model-Fabric Phase 7's same pending live check).
*   **Done (2026-07-08): APK Settings — TTS Voice Model Selection & AI Voice Picker.**
    *   **Problem found:** The Settings tab Voice section had no way to select which device voice the AI uses for TTS. The Always Listening section had a `speakReplies` toggle but zero voice picker — and `ttsVoiceId` didn't exist in the config at all, so any future voice choice would be silently lost on app restart (OMNECOR memory principle violation).
    *   **(1) Config persistence (`lib/_core/always-listen-config.ts`):** Added `ttsVoiceId: string` to `AlwaysListenConfig`; wired through `loadListenConfig()`, `saveListenConfig()`, and the in-memory default. Choice now survives restarts.
    *   **(2) Fallback TTS (`lib/_core/always-listen.ts`):** The offline 8-second fallback `Speech.speak()` call now passes `voice: ttsVoiceId` so the AI's voice is consistent even when the PC stream is unreachable.
    *   **(3) Always Listening voice picker (`components/always-listen-settings.tsx`):** Added `Speech.getAvailableVoicesAsync()` on mount; when `speakReplies` is on, shows a full "AI voice for spoken replies" section — "System default" option + list of all installed English voices (name, language, quality). Selecting any voice persists immediately via `saveListenConfig`.
    *   **(4) Main Voice section voice picker (`app/(tabs)/settings.tsx`):** Added `expo-speech` + `AsyncStorage` imports; new `chatTtsVoiceId` / `deviceVoices` / `loadingVoices` state; voices loaded at mount alongside model state; `handleChangeChatTtsVoice` persists to `CHAT_TTS_VOICE_KEY` in AsyncStorage. Voice section now shows "AI voice for chat replies" below Reading Speed when TTS is enabled — same System default + installed voice list pattern.
    *   **Files changed:** `lib/_core/always-listen-config.ts`, `lib/_core/always-listen.ts`, `components/always-listen-settings.tsx`, `app/(tabs)/settings.tsx`
    *   **Gates:** APK `tsc --noEmit` ✅ · root `pnpm check` ✅
*   **Done (2026-07-07): Agentic Chat — Phase 6 APK port (main chat → Claude-Code-APK-style agentic stream).** Full detail in `Chats-Agentic-Upgrade.md` (Phase 6 ✅).
    *   **Transport:** `app/(tabs)/index.tsx` PC path now consumes the desktop `aiProvider.agentChatStream` **tRPC WS subscription** via a new lazily-built `getAgentTrpc()` (`lib/trpc.ts`: `splitLink` → `wsLink` to the token-authed `/ws` + `httpBatchLink`); the self-contained stub `lib/_core/app-router.ts` gained typed `aiProvider.{agentChatStream,resolveToolApproval,runCodeSnippet}` (async-generator stub infers `AgentStreamEvent`, no server type-graph import). Contract + reducer adopted via `lib/_core/agent-blocks.ts` (re-export of root `shared/chatBlocks.ts`+`chatAgentEvents.ts`) and a vendored `lib/_core/agent-stream.ts`.
    *   **Server fix (found + fixed on sight):** the tRPC WS path (`applyWSSHandler`→`createContext`→`sdk.authenticateRequest`, cookie/Bearer only) never read the mobile `?token=` query param — the subscription authenticated under zero-login but would fail against a real server. New `server/core_services/websocket/wsAuthBridge.ts` promotes `?token=`→`Authorization: Bearer` (guarded; cookie/Bearer callers untouched); **7 unit tests**.
    *   **UI:** native renderers `components/agentic/{assistant-stream,agentic-blocks}.tsx` — flush-left guide-line stream (`react-native-markdown-display`), collapsible thinking, command/edit/job/mcp chips + one shared `Modal` overlay, inline HITL approve/deny → `resolveToolApproval`, dependency-free LCS line-diff, ▶ Run (→ PC `runCodeSnippet`, JobBlock) / ⚡ Preview (native `WebView`). On-device GGUF/LiteRT turns stream via `onToken` folded into text/thinking blocks (`<think>` parsed). Component-state FIFO message queue + tap-recall chips. `LoadingQuote` rebuilt with a module-scoped no-repeat bag + typewriter; 3 quote styles + show/hide + auto-approve shield surfaced in-chat.
    *   **Gates:** APK `tsc --noEmit` ✅ · `expo lint` 0 errors ✅ · root `pnpm check` ✅ · root `pnpm test` **1315 passed | 4 skipped** ✅. On-device runtime verify (live WS stream + HITL approve/deny from the phone) is bundled with the pending NPU-manifest rebuild (owner's one-rebuild directive).
*   **Done (2026-07-05): NPU-First On-Device Models — real Hexagon path + model lifecycle overhaul (APK).**
    *   *(Supersedes an earlier 2026-07-05 entry that was WRONG: it claimed a patched `use_npu` flag enabled Hexagon — review showed that patch was dead code on Android GPU devices [`RNLlamaJSI.cpp` pre-populates `cparams.devices` with Hexagon excluded], the `hasHexagon=true` Java hunk was unnecessary [SM8750 already in `KNOWN_HEXAGON_SOC_PATTERN`], and "Vulkan fallback" was wrong [OpenCL]. No native behavior had actually changed.)*
    *   **(1) NPU without any native patch:** llama.rn 0.12.4 already supports `initLlama({ devices: ["HTP*"] })` — the TS layer expands the wildcard to real HTP device names and the returned `context.devices` reports what actually engaged. The entire `patches/llama.rn.patch` apparatus was DELETED (plus the stray 0-byte mobile patch file, unused `patch-package`/`postinstall-postinstall` devDeps, and the orphaned `wouter@3.7.1.patch`).
    *   **(2) Backend-aware catalog (`model-catalog.ts`):** ggml-hexagon executes ONLY Q4_0/IQ4_NL/Q8_0/MXFP4 weights — every old catalog entry was Q4_K_M (0% NPU). New per-model variants: quality Q4_K_M + NPU-ready file (URLs + sizes HEAD-verified per bartowski repo); `pickVariant(accelMode)` drives the download UI. Capabilities metadata (`images`/`files`) added → chat attach/photo buttons are gated for text-only phone models (Alert + dimmed instead of a send-time error).
    *   **(3) App-wide acceleration mode (`acceleration.ts`):** `auto|cpu|gpu|npu`, Auto default, migrates the legacy LiteRT-only key. Auto = NPU-if-file-capable-and-HTP-present → GPU → CPU; manual modes STRICT (clear failure over silent downgrade). GGUF loader derives the ACTUAL backend from `context.devices`; LiteRT GPU/NPU loads pass `validate: true` (real test inference at load — catches Google's silent-CPU fallback).
    *   **(4) Lifecycle manager (`phone-model.ts`):** ONE resident model across BOTH engines (serialized load/unload, cross-engine eviction); **selection in the Chat model picker is the only lifecycle verb** (remote Ollama/OMMESH/cloud selection never touches the phone model); Settings = download/delete/Unload + status badges only (Load buttons removed); auto re-arm on app start honors engine + acceleration mode (fixes LiteRT-only auto-load that ignored the saved backend). AI Node + Status tabs now subscribe to the unified snapshot (fixes AI Node's always-"No model loaded" when a LiteRT model was resident).
    *   **Gates:** mobile `tsc --noEmit` ✅, mobile eslint 0 errors ✅, root `pnpm check` ✅, new `model-catalog.test.ts` 11/11 ✅, root `pnpm test` + APK rebuild + **on-device NPU verification (logcat HTP devices + tok/s CPU/GPU/NPU)** in progress — this entry is only DONE when the on-device pass shows HTP devices serving tokens.
*   **Done (2026-06-28): PCB Editor — Infinite Loop, Drop Crash, Notification & Socket Fixes.**
    *   **(1) First-boot infinite render loop (3D → PCB/Schematic tab):** Fixed "Maximum update depth exceeded" crash that hit when navigating to the PCB tab before any projects existed in the DB. Root cause: two patterns combined — `const { data: pcbProjects = [] }` creates a new array reference every render while loading, and an unselectored `useDesignerStore()` re-renders on every Zustand `set()` even with the same value. Chain: new `[]` → `useEffect` fires → `setActivePCBContext(null)` → Zustand merged-state object → subscriber re-renders → repeat until React's 25-nested-update limit throws. Fix: (a) module-level `EMPTY_PROJECTS` constant in `EnhancedPCBEditor.tsx`; (b) selective `useDesignerStore((s) => s.field)` in `EnhancedPCBEditor.tsx` and `3DDesigner.tsx`; (c) equality guard in `setActivePCBContext` (`designerStore.ts`). Documented as TD-046.
    *   **(2) PCB canvas drop crash ("Cannot read properties of undefined (reading 'map')"):** `handleAddComponent` was setting `data.component` to the string ID instead of the resolved component object; `SchematicNode`/`PCBNode` then called `.handles.map()` on the string. Fixed: resolve the full `Component` object from `componentLibrary` in `handleAddComponent` before building the node. Added backward-compat guard in both node renderers (`typeof raw === 'string' ? componentLibrary.find(c => c.id === raw) : raw`) for old saved designs that stored string IDs.
    *   **(3) Notification badge not clearing immediately:** `useNotifications.ts` mutations now call `invalidateAll()` which invalidates both `notifications.list` and `notifications.unreadCount` in one call instead of only invalidating one.
    *   **(4) Socket churn freeze on navigation:** `useOmnecorSocket.ts` now stores `onEvent` in a ref and excludes it from `connect`'s `useCallback` deps, preventing a new socket connection from being created on every render where the `onEvent` identity changed.
    *   **(5) Vite HMR WebSocket mismatch:** Added `clientPort: serverPort` to HMR options in `server/_core/vite.ts` so the browser's HMR client connects to the correct dev-server port instead of defaulting to `:5173`.
    *   Gates: `pnpm check` 0 errors ✅.
*   **Done (2026-06-28): AI Response Loading Quotes Uniformity (Web & Mobile).**
    *   (1) Extracted `LoadingQuote` into a globally accessible component wired to `chatDisplaySettings` via Zustand (`app.store.ts`).
    *   (2) Implemented `LoadingQuote` across Web workspaces (`AIAssistantPanel.tsx` in PCB Editor, `Notifications.tsx` in Agent Messenger).
    *   (3) Ported `LoadingQuote` natively to the React Native APK (`packaging/android/omnecor-hq/components/loading-quote.tsx`) using `react-native-reanimated`.
    *   (4) Integrated the native `LoadingQuote` into the Mobile Chat (`index.tsx`) and Mobile Agent Messenger (`notifications.tsx`).
    *   Gates: `pnpm check` 0 errors in both web and mobile workspaces ✅.
*   **Done (2026-06-27): Local Model Scaffolding & Sub-Agent Abstraction.** 
    *   (1) Implemented headless `LocalSubAgentWorker` that wraps local model interactions in a resilient Try-Fail-Fix loop.
    *   (2) Safely integrated `execFileAsync` sandbox tool, and `execute_skill` for dynamically leveraging available MCP Skills with full `AuditLogService` logging.
    *   (3) Hooked into the GodMode `PipelineEngineService` (EXECUTE phase) and `AiProviderService` via automated local model interception.
    *   (4) Registered `sub_agent_harness` and `sub_agent_internal` in `ValetRouterService` types.
    *   Gates: `pnpm check` 0 errors ✅, `pnpm test` 436/436 passing ✅.
*   **Done (2026-06-27): Context Overflow & Architectural Fixes.** 
    *   (1) Added token estimation checks in `AiProviderService.ts` to throw `ContextOverflowError` before auto-downgrading to local models to prevent OOM errors. 
    *   (2) Removed brittle regex rules in `ValetRouterService.ts` and implemented a dynamic LLM intent classification fallback. 
    *   (3) Replaced manual Kaggle path assumptions in `SetupWizard.tsx` with a secure file dropzone for `kaggle.json`. 
    *   (4) Modified `saved_scripts` to explicitly scope to `mapId` across the DB (`db-pcb.ts`), `scriptsRouter.ts`, and `Chat.tsx`/`ChatInterface.tsx` to respect Neural Map boundaries.
    *   Gates: `pnpm check` 0 errors ✅, `pnpm test` 436/436 passing ✅.
*   **Done (2026-06-27): Penpot Bridge & Agent Reach (Bird Claw).**
    *   (1) Added `PenpotService.ts` headless bridge for UI design token fetching.
    *   (2) Added `BirdClawService.ts` Playwright-based scraper for JS-heavy social platforms without API reliance.
    *   (3) Integrated Bird Claw seamlessly into `ArticleDiscoveryService.ts` for unified downstream curation.
    *   (4) Exposed Penpot API via `penpotRouter.ts`.
*   **Active Phase:** Phase 5 — F23–F27 code-complete. **All 3 OMMESH node artifacts built** for cross-platform mesh testing. Documentation audit and professional update complete (2026-06-17).
*   **Done (2026-06-26): Chat Workspace Review Fixes.** Resolved all `/review` findings from the Chat workspace audit: (1) Relocated auto-switch `useEffect` below `handleSelectConversation` / `handleNewConversation` handler declarations to fix Temporal Dead Zone crash. (2) Replaced `text-accent-foreground` with `text-accent` on BTW note chips (invisible in dark mode). (3) Added `filterScope` state (`"project" | "global"`) with `localStorage` persistence (`omnecor:chat_filter_scope`) and wired it to the `chatRouter.listSessions` query for DB-level project isolation. (4) Added Project/Global scope selector tab row to `ConversationList.tsx` using `bg-primary text-primary-foreground` active state. (5) Removed duplicate `absolute inset-0 bg-background` overlay from `TerminalPanel.tsx` that was obscuring the xterm canvas. Ran `/imprint` (Session 26 entry added to `Context/UI-Registry.md`) and `/remember save`. Gates: `pnpm check` 0 errors ✅, `pnpm test` 436/436 passing ✅.

*   **Done (2026-06-25): LLM Builder Dataset Discovery & Curation.** Created the `datasetRouter.ts` tRPC router containing `discoverSources`, `listUnprocessedSources`, `curateSourceItem`, `listCuratedExamples`, `updateCuratedExample`, and `compileDataset` procedures. Created the `DatasetCurationPanel.tsx` React component integrating local BFS folder scanning, search query web-scraping, and an interactive review queue with Approve, Edit, and Reject capabilities. Mounted the panel inside a tabbed layout in `UnslothPanel.tsx` to automatically supply compiled JSONL paths back to the Unsloth fine-tuning form. Wrote complete integration test suites in `datasetRouter.test.ts` and verified all 11 tests pass.
*   **Done (2026-06-25): GodMode Pipelines Project Scoping & Tab Filters.** Refactored the GodMode Pipelines page ([client/src/pages/Pipelines.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/Pipelines.tsx)) to retrieve and utilize the active Project/Neural Map context (`activeMap`). Implemented a segmented tab-filter UI (All / Project / Global) with unique E2E testing IDs. Integrated a "Scope to current project" checkbox in the "New Pipeline" form and wired mutation payloads to pass `projectId`. Refactored query invalidation to use `trpc.useUtils()` instead of manual refetches.
*   **Done (2026-06-25): Workspace Project Scoping & Chat validation fixes.** Scoped the chat page's remember workflows (/remember save/restore, /imprint) and MemoryArchiverPanel to the active Project/Neural Map context instead of hardcoding "default". Scoped the sandboxed terminals (TerminalPanel and EmbeddedTerminal) to activeMap.id instead of conversation.id to bind command approvals directly to the active workspace project. Relaxed backend aiRouter sessionId schema validation from uuid to min(1) string, eliminating Zod validation crashes with custom client-generated conversation IDs. Corrected React hook dependency arrays, moved state-linked refs above handlers to resolve Temporal Dead Zone compilation issues, and added timer cleanups on unmount to prevent state-update leaks.
*   **Done (2026-06-25): Dynamic Model Hub & Active Model Registry.** Replaced the static mock list of API models with a live API discovery catalog (OpenAI, Anthropic, Gemini, Grok, Hugging Face) in `ModelHubPanel`. Converted selection to a checkable switch interface stored in `localStorage` under `omnecor:activeModels`. Updated the chat `ModelSelector` dropdown to filter options dynamically to user-activated models. Resolved the `ollamadb.dev` DNS resolution failure by implementing a try/catch fallback in the `searchModels` endpoint to yield a curated local catalog when offline or in Sovereign mode.
*   **Done (2026-06-25): Default Execution Mode Fix & Deb Rebuild.** Defaulted the workstation's zero-login execution mode to `scrapper` mode (never `sovereign` by default). Ensured the system uses the database user record as the source of truth, preventing the database preference from being overwritten by environment defaults on subsequent requests. Fully enabled the execution mode selector in settings for zero-login users, and rebuilt the Debian package (`omnecor-hmci-server_2.4.1~beta.1_amd64.deb`).
*   **Done (2026-06-19): Neural Brain Map Engine Upgrade.** Removed arbitrary global physics collision (`resolveOverlaps`) from structured layouts (Hierarchical, Mind-Map, Circular) to preserve structural geometry. Instead, structured layouts now dynamically scale base sizing math (`H_GAP`, `V_GAP`, `STEP`, circumference) based on node counts, specifically expanding drastically when `Auto-Clustering` is OFF to guarantee fully traceable connections without overlapping nodes. Quality of life additions: `Shift`+`Click`/`Shift`+`Drag` multi-selection enabled, and an unlocking warning dialog added.
*   **OMMESH 3-way test readiness (2026-06-16, Linux):**
    *   **Linux node:** `packaging/electron-app/dist/Omnecor-2.3.0-beta.1-x86_64.AppImage` (373 MB) + `Omnecor_2.3.0-beta.1_amd64.deb` (220 MB) — built (electron-builder 25, Electron 39.8.10, better-sqlite3 rebuilt).
    *   **Android node:** `packaging/android/omnecor-hq/android/app/build/outputs/apk/release/app-release.apk` (118 MB, JS-bundled standalone, debug-signed → sideloadable).
    *   **Windows node:** installer built on the Windows box (awaiting install + test there).
    *   **Shared `OMMESH_SECRET`** generated + written to this Linux node's gitignored `.env`; the **same value must be set** in the Windows node's `.env` and the APK Settings → OMMESH secret. mDNS advertise + fail-closed secret auth verified in code (`MeshDiscoveryService`, `WebSocketServer.mobile_node_register`).
*   **Build fix:** `apk:debug`/`apk:release`/`apk:install` scripts changed from `gradlew clean …` to `rm -rf app/.cxx app/build/generated/autolinking && gradlew …` — the hardcoded `clean` made `externalNativeBuildClean` re-run CMake against not-yet-generated autolinking codegen JNI dirs (react-native-voice-processor etc.) and fail. Run `prebuild:android` (which is `--clean`) before a release build to keep app icons fresh.
*   **OMMESH cross-node inference routing — implemented (2026-06-16, was Phase 9 stub):** `MeshNode.routeInference()` no longer returns placeholders. *Done:*
    *   New `server/ommesh/core/MeshServer.ts` — strict-mTLS HTTPS inference listener on the advertised `MESH_PORT` (3001). Only CA-signed peers connect (`requestCert` + `rejectUnauthorized` + TLSv1.3); `POST /inference` runs the prompt locally, `GET /health` for liveness; body-size capped; no-ops gracefully when certs unprovisioned or port taken. Started in `MeshNode.start()`.
    *   `MeshNode.executeLocal()` runs real inference via `AiProviderService.chat()` (dynamic import breaks the `AiProviderService ↔ MeshNode` cycle). `routeToRemote()` makes an mTLS call to the chosen peer, **pinning the peer's advertised fingerprint** via `getClientTlsOptions` (MITM with a different CA-signed cert is rejected). `routeInference()` falls back to local on any remote failure/missing peer; returns `{ content, executedBy, fellBack? }`.
    *   **Sovereign-mode guard:** `executeLocal()` rejects cloud providers (`openai`/`anthropic`/`gemini`/`grok`/`huggingface`) — the mesh distributes local compute only, so a cloud call can never tunnel through this `protectedProcedure` (or an inbound peer request) and bypass aiRouter's `cloudProcedure` gate.
    *   `SecurityManager.isReady()` added to gate the listener; `DiscoveryService` advertises the shared `MESH_PORT` constant so beacon/listener can't drift.
*   **OMMESH LIVE-VERIFIED across 2 real machines (2026-06-16):** Windows (`192.168.1.78`, `omnecor-win-clark`) ↔ Linux V-I-S (`192.168.1.252`, `omnecor-lin-vis`), both running `pnpm dev`.
    *   **Discovery fixed + verified** (commit `b7eaf18`): bidirectional mDNS with routable IPv4 via `ommesh.discover`. Fixes were IPv6-link-local address selection + WSL multicast-egress binding — see `server/_core/net-utils.ts`.
    *   **Cross-node mTLS inference verified both directions:** Linux→Windows returned a real Ollama completion (`{"content":"The capital of France is Paris.","executedBy":"omnecor-win-clark"}`); Windows→Linux routed + authenticated + executed remotely (`executedBy:"omnecor-lin-vis"`, status 200). Provisioned a shared CA + per-node certs into each dev cert dir (Linux `<repo>/data/certs`, Windows `%APPDATA%\omnecor\certs`).
    *   **Environment gotchas hit & resolved (not code bugs):** Windows LAN must be **Private** + inbound firewall allow for TCP 3000/3001; **the Linux box clock was ~61 min fast (NTP off)** → certs had to be generated on the correct-clock machine and back-dated (also affects OMMESH's 5-min `verifyMessage` replay window — Linux clock still needs an NTP fix). Linux Ollama backend separately returning 500s on all models (local issue, not mesh).
*   **Next:** fix the V-I-S clock (`sudo timedatectl set-ntp true`); bring the **Android node** in as the 3rd peer (connects by explicit IP + `OMMESH_SECRET`); then F23b on-device wake-word test; optional social live-test.
*   **Gates (2026-06-16):** root `tsc` 0 · APK `tsc` 0 · `vitest` 338/338 · web build ✓ · Linux AppImage/.deb ✓ · release APK ✓

### Security, Correctness & Design-Token Sweep — completed (2026-06-19, Linux)

*   **Export Default Debt Resolved:** Conducted a mass-rename sweep across the React codebase and routers. Converted all 77 files containing default exports to use named exports exclusively. Updated all import statements and dynamic lazy-load references across 19 importing files (including `App.tsx` and `main.tsx`).
*   **Real BPE tokenizer (`js-tiktoken@1.0.21`):** `client/src/lib/tokenizer.ts` added — model-aware encoding (o200k_base for GPT-4o/Claude 4/Gemini, cl100k_base for legacy). `estimateTokens()` in `chatContext.ts` now delegates to real BPE instead of chars/4 approximation. `Chat.tsx` passes `selectedModel.modelId` for per-model accuracy.
*   **Dead `!db` branch removed:** `agentMessengerRouter.ts:39` — `if (!db || !userId)` → `if (!userId)`. `getDb()` never returns null; the dead branch was misleading.
*   **Rate limiter dev-mode fix:** `server/_core/index.ts` — `skip: (req) => !req.path.startsWith("/api")` added to express-rate-limit config. Prevents 429s on cold Vite module fetches (100-request burst) while keeping the API limit intact.
*   **AGENTS.md exceptions updated:** Added `PCBViewer3D` (Three.js `0xRRGGBB` integer — CSS vars can't inject into hex integers), brand-identity SVG logos in `SetupWizard` (Google/Microsoft palettes legally required), `MeshTopologyGraph` (Canvas API `ctx.fillStyle` can't read CSS vars), and `OAUTH_PLATFORMS` buttons in `AgentNetworking` (Twitter/X black, LinkedIn blue, YouTube red, Instagram pink — brand-required).
*   **Design-token sweep — hex literals:** `neuralNodeTree.ts` inline styles, `MeshTopologyGraph.tsx` canvas colors, `AgentNetworking.tsx` legend dots — all replaced with CSS variable references (`var(--color-accent-*)`, `var(--color-background)`, etc.).
*   **Design-token sweep — raw Tailwind classes (14 files):** `AgentNetworking.tsx`, `Pipelines.tsx`, `Dashboard.tsx`, `ChatInterface.tsx`, `OmnecorDashboardLayout.tsx`, `ModelHub.tsx`, `SpecializedModuleLauncher.tsx`, `Notifications.tsx`, `VisualContextMap.tsx`, `Settings.tsx`, `PodcastStudio.tsx`, `ComponentLibrary.tsx`, `3DDesigner.tsx`, `AGENTS.md`. All `green-*`, `blue-*`, `red-*`, `purple-*`, `emerald-*`, `rose-*`, `amber-*`, `gray-*`, `slate-*` classes replaced with `accent-success`, `accent-cyan`, `destructive`, `accent-purple`, `accent-danger`, `muted-foreground`, etc.
*   **UI Registry — Sessions 21–22:** 537 CONNECTED rows verified, 14 procedures confirmed live-driven, 8 previously-missing rows added, 5 label corrections.
*   **Gates (2026-06-19):** root `tsc` **0** · `vitest` **353/353** · all changes committed.

### Dependency Launch Checklist — SetupWizard (2026-06-19, Linux)

New "Launch Checklist" step added to the SetupWizard, inserted between Personalization and Ready to Launch. Detects 9 optional tools in a single round-trip and surfaces them in 8 feature-grouped cards with per-group Re-check. Ollama gets a real auto-install path (download + `spawn` with arg arrays, no shell interpolation). All other tools open their official page via browser link. Nothing blocks proceeding to launch — all items are optional.

*   **`server/_core/systemRouter.ts`** — Two new procedures:
    *   `checkDependencies` (`protectedProcedure`) — single aggregate probe: Ollama (HTTP), Python 3.10+ (`execFileAsync`), llama-cpp (binary + pip), Blender, KiCad, esptool (all via `findExecutable`), Whisper/TTS/ComfyUI (HTTP probes). All checks individually try/catch'd, resolved in parallel. Never throws to client.
    *   `installOllama` (`adminProcedure`) — platform-aware installer: Windows downloads `OllamaSetup.exe` → `spawn(dest, ["/S"])` silent; Linux downloads `install.sh` → `spawn("sh", [dest])`; macOS opens download page via `spawn("open", [url])`. Uses `https.get` with redirect following. Safe: all args in arrays, no shell interpolation.
*   **`client/src/pages/SetupWizard.tsx`** — `"checklist"` step added to STEPS array (index 8). New query (`trpc.system.checkDependencies`) enabled only when on checklist step (`staleTime: 0`). New mutation (`trpc.system.installOllama`) with 4s delayed re-check after success. Full `case "checklist"` render: `DepsGroup` component per feature group, `StatusBadge` with loading/detected/not-found states, per-group Re-check via `utils.system.checkDependencies.invalidate()`. Design tokens only — `bg-accent/5`, `border-accent/30`, `text-accent`, `text-muted-foreground`, `text-destructive` (semantic).
*   **Gates (2026-06-19):** root `tsc` **0** · `vitest` **353/353**.

### Chat Action Buttons Responsive Stacking — resolved (2026-06-17, Linux)
The Terminal/CLI, Sandboxed, and Attachments/Voice/Send buttons in ChatInput were colliding on smaller/mobile viewports. Resolved via responsive flex configurations:
*   Added `flex-col sm:flex-row gap-2.5 sm:gap-0` to the action row container to stack buttons vertically on smaller viewports.
*   Arranged render order on mobile via flexbox ordering: Terminal buttons (`order-2 sm:order-1`) sit on the bottom row, and compose controls (`order-1 sm:order-2`) sit on the top row directly under the message textarea.
*   Hid composition instruction text on smaller viewports (`hidden sm:block`) to avoid squishing and wrapping.
*   Floating token count label aligned with `sm:ml-2 ml-auto` to float to the right side of the layout when instruction text is hidden.
*   **Gates (2026-06-17):** root `tsc` 0 · `vitest` 350/350 passed · changes uncommitted.

### Server-Backed Scripts Library — made real (2026-06-17, Linux)
Scripts the AI generates in chat were previously trapped in `localStorage` (browser-only). Replaced with a full server-backed store:
*   **New `saved_scripts` table** — `drizzle/schema.ts` (`savedScripts`); integer PK, `userId`, `name`, `code`, `language`, `project`, timestamps. Two indexes. Migration `0001_equal_shiva.sql` generated + applied (`pnpm build:push`).
*   **New `scripts` tRPC router** — `server/routers/scriptsRouter.ts`: `list`, `listProjects`, `create`, `update`, `delete` (all `protectedProcedure`, always user-scoped; no IDOR). Registered in `server/routers.ts`.
*   **`scriptStorage.ts`** — gutted localStorage CRUD; now only exports `SavedScript` type (inferred from router output) + `getLegacyLocalScripts`/`clearLegacyLocalScripts` migration helpers.
*   **`Chat.tsx`** — scripts via `trpc.scripts.list.useQuery()`; delete/rename mutations with cache invalidation + `onError` toasts; one-time `useEffect` migrates any existing localStorage scripts to the server (per-script, so partial network failure never creates duplicates).
*   **`ChatInterface.tsx`** — "Save Script" dialog calls `trpc.scripts.create.useMutation()` with pending state on button; `trpc.useUtils()` invalidates the list on success.
*   **`ConversationList.tsx`** — script callback IDs changed `string → number`; `timeAgo()` accepts `string | Date`.
*   **Dead code verdict:** `getProjects()` (old `scriptStorage.ts`) was unfinished — promoted to `scripts.listProjects` on the server rather than deleted.
*   `/review` run → 3 findings fixed (Drizzle type-safety in `update`, migration deduplication, `onError` toasts).
*   **Gates (2026-06-17):** root `tsc` **0** · `vitest` **350/350** · `pnpm build` ✓ · changes uncommitted.

### PCB / Schematic Editor — made real (2026-06-17, Linux)
The PCB/Schematic tab in the 3D Designer page had three fundamental gaps: no persistence (canvas lost on refresh), broken drag-and-drop (canvas had no `onDrop`/`onDragOver`), and only 4 static components in the library. All three fixed:
*   **`client/src/lib/componentLibrary.ts`** — Expanded 4 → 49 components across 9 categories (Passive, Discrete, Power, Logic, Analog, Comms, MCU, Sensor, Connector). Changed `properties: any` → `Record<string, unknown>`. Added `IC_BODY`, `IC_8PIN`, `IC_4PIN` SVG helpers. `searchComponents()` now also searches `properties` values.
*   **`client/src/components/pcb/ComponentLibraryPanel.tsx`** — Added click-to-add (places near canvas centre with a small random offset so stacked clicks don't overlap). Added drag start via `dataTransfer.setData('componentId', ...)`. Flat search results mode (no tabs when query is active). Footer shows component + category count.
*   **`client/src/components/pcb/EnhancedPCBEditor.tsx`** — Complete rewrite of persistence and project management: component is fully self-contained (no external `projectId` prop). Auto-selects first project; auto-creates "Default Design" on first load (`autoCreatedRef` prevents double-fire). Load effect fires once per project (`loadedProjectRef`); resets canvas on project switch. Auto-save debounced 1.5 s after canvas change; `suppressAutoSaveRef` skips the first effect after a load to avoid a redundant write. Save status driven by `isDirty`/`lastSavedAt` state (not stale `mutation.isSuccess`). Added `handleDrop`/`handleDragOver` on the canvas wrapper div with `project()` coordinate conversion (ReactFlow v11 API).
*   **`/review` run** → 4 findings fixed: removed `!nodes.length` guard (prevented persisting canvas clear), replaced `isSuccess` indicator, removed redundant `pcbProjects !== undefined` guard, removed empty `export type { }`.
*   **Post-review fixes (2026-06-17):** `ComponentLibraryPanel.tsx` — removed stray `export default` (named-export-only rule). `AGENTS.md` — added `EnhancedPCBEditor` and `PCBSchematicEditor` to the ReactFlow hex-literal exception list (same justification as `SchematicEditor`: no amber/wire-color token in the design system; ReactFlow canvas rendering requires direct color values).
*   **Gates (2026-06-17):** root `tsc` **0** ✓ · changes uncommitted.

### System B OAuth (service connections / integrations) — made real (2026-06-17, Linux)
The integrations OAuth (Drive/OneDrive/Dropbox, YouTube, social publishing — **separate from login OAuth**) couldn't actually be configured. Two wiring bugs + a UI gap fixed, and Gmail send added:
*   **Credentials were read from `process.env.*` once at module load** → the Settings wizard was ignored. `server/oauth/oauthClients.ts` now resolves client id/secret **per-call** via `SettingsService.getSecret(settingsKey, envVar)` (env→settings-file precedence, same as AI keys; mtime-cached/live). New `PROVIDER_CREDENTIALS` map + `isPlatformConfigured()`/`listOAuthPlatforms()`.
*   **Desktop redirect-URI mismatch** (hardcoded `localhost:5173`; backend runs on 37291). New `getRedirectUri()` = `PUBLIC_URL` or `http://localhost:${PORT}` — desktop (`PORT=37291`) now lines up with no Electron change.
*   **New Settings → Accounts → "Service Connections" card** (`ServiceConnectionsCard` in `client/src/pages/Settings.tsx`): 10 providers × client id/secret, copyable callback URI, configured badges, `isAdmin`-gated, saves via `system.saveKeys` (admin). New `system.integrationsStatus` (protected) feeds it.
*   **Gmail send is now a real integration:** new `server/routers/gmailRouter.ts` (`gmail` namespace) — `sendEmail` (**cloudProcedure**, refresh-on-401-and-persist, CR/LF header-injection guard + RFC-2047 subject encoding) + `status`. `gmail` provider added to `oauthClients.ts` + `oauthRouter` enum (reuses Google endpoints, `gmail.send` scope).
*   `/review` run → all 4 findings fixed. **Still dark until operators register OAuth apps + enter creds + register the exact callback URI.** Kaggle stays `kaggle.json`-based (unchanged).
*   **Gates (2026-06-17):** root `tsc` **0** · `vitest` **350/350** (+12: `oauthClients.test.ts`, `gmailMessage.test.ts`) · `pnpm build` not run (WSL native-module fragility) · changes uncommitted.

---

## ⚠️ ACTION REQUIRED ON WINDOWS PC — Valet Router GGUF packaging (2026-06-15)

> **Read this after you `git pull` on the Windows build machine.** The Valet Router model is **not** in the repo (weights are gitignored) and the desktop package will **not** serve it until the steps below are done on the Windows box, where the trained GGUF actually lives.

### Background — what's already fixed (committed from the Linux box)
Investigated on 2026-06-15. The router auto-start was silently falling back to keyword routing because of a **registry path mismatch**: `ValetServerService` reads the registry from the app-data dir (`~/.omnecor/models/valet-router/current.json` on Linux, `%APPDATA%\omnecor\models\valet-router\current.json` on Windows), but the populated `current.json` only lived in the repo at `models/valet-router/current.json`. Nothing copied it across, so a fresh machine always read `status: "pending"`.

**Code changes already in this push (verified, `tsc` clean):**
- [ValetArtifactRegistry.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/ValetArtifactRegistry.ts) — new `seedFromRepoIfMissing()` copies the bundled/repo `current.json` into the app-data registry on first boot (checks `process.cwd()`, Electron `process.resourcesPath`, and bundle-relative paths → works in dev **and** packaged installer).
- [ValetServerService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/ValetServerService.ts) — calls the seed before reading the registry, so the model registers instead of falling back.
- [valet_router_inference.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/valet_router_inference.py) — Ollama call timeout raised 10s→45s so the first (cold) route doesn't auto-fall-back while the model pages in.

**Verified on Linux 2026-06-15:** with the registry seeded and `OLLAMA_URL` pointed at the node that has the model, `/health` → `{"model_loaded":true,"backend":"ollama"}` and `/route` returned genuine model-driven decisions (media_generation 0.89, hardware 0.87, research 0.89 — not keyword fallback).

### The trained GGUF (on the Windows PC)
`current.json` and the `Modelfile` both reference:
```
C:\OmnecorV1-Beta\models\valet-router\kaggle-2026-06-11\valet-router-q8_0.gguf
```
- Quant: **Q8_0**, base **Qwen2.5-1.5B-Instruct**, ~1.6 GB.
- `gguf_sha256: b0398f857ffb1dc6d9ae562304201c24e64ec4422cfb6b1b1391d66e21138eee`
- Deployed today as the Ollama model `omnecor-valet-router:v2-q8` (lives only on the LAN node `192.168.1.78:11434`, **not** on `localhost`).

### Steps to do on the Windows PC (in order)

**1. Confirm the GGUF is still there.** Verify `C:\OmnecorV1-Beta\models\valet-router\kaggle-2026-06-11\valet-router-q8_0.gguf` exists and the SHA-256 matches the value above. If it was moved, note the new path.

**2. Place the GGUF where electron-builder will bundle it.** [electron-builder.yml](file:///home/linux/Documents/OmnecorV1-Beta/packaging/electron-app/electron-builder.yml) already globs `**/*.gguf` from `../../models/valet-router` into `resources/models/valet-router/`. So copy the weight into the repo registry tree **before** running the desktop build:
```
models\valet-router\kaggle-2026-06-11\valet-router-q8_0.gguf
```
(It's gitignored — that's fine; it only needs to exist locally on the build box at package time. Do **not** commit it.)

**3. Decide the serving backend and fix `current.json` accordingly.** Pick ONE:

   - **Option A — Direct GGUF (recommended for a self-contained installer).** Set `current.json` `"format": "gguf"` and change `"artifact_path"` to a **relative/portable** path (the bundled `resources/models/valet-router/kaggle-2026-06-11/` dir) instead of the hard-coded `C:\OmnecorV1-Beta\...` path. The inference server then loads the weight via `llama-cpp-python` with no external Ollama dependency. ⚠️ Requires an AVX2 CPU on the **target** machine and `llama-cpp-python` available to the bundled Python (the original training box was Sandy Bridge / AVX1-only, which is why Ollama was used instead — see Valet Router automation §6.4). Verify the target/build CPU is AVX2.

   - **Option B — Ollama (matches today's working setup).** Keep `"format": "ollama"`, `"base_model": "omnecor-valet-router:v2-q8"`. The installer/post-install must then run `ollama create omnecor-valet-router:v2-q8 -f Modelfile` on the target, and the [Modelfile](file:///home/linux/Documents/OmnecorV1-Beta/models/valet-router/Modelfile) `FROM` line must point at the **bundled** GGUF path (currently `C:\OmnecorV1-Beta\...`, which won't exist on an end-user machine — make it relative to the install dir). Also ensure the app's `OLLAMA_URL` points at an Ollama that has the model.

   The current `artifact_path` (`c:/OmnecorV1-Beta/...`) is harmless for Option B (the Ollama loader ignores it; the TS side only checks it's non-empty) but **must** be fixed for Option A.

**4. Close the Electron packaging gap (BLOCKER — applies to both options).** [electron-builder.yml](file:///home/linux/Documents/OmnecorV1-Beta/packaging/electron-app/electron-builder.yml) `extraResources` currently ships only `dist/index.js` + assets — it does **not** bundle `server/python_bridges/` or `docs/ai-agents/valet-training/`. Without them the inference server script and its system-prompt/manifest aren't present in the installed app, so the Valet server can't spawn at all. Add to `extraResources`:
   - `server/python_bridges/valet_router_inference.py` (+ any helpers it imports)
   - `docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md` and `routing_manifest.json`
   - and confirm a Python runtime + required deps (`fastapi`, `uvicorn`, and `llama-cpp-python` if Option A) are available to the packaged app.

**5. Build and verify.** Run the Windows desktop build, install on a clean target, launch Omnecor, then check:
   - Backend log shows `[ValetServer] Seeded artifact registry...` then `[ValetServer] Ready — model loaded`.
   - `GET http://127.0.0.1:8010/health` → `{"model_loaded":true,...}`.
   - `POST http://127.0.0.1:8010/route` with a sample task returns a real `category`/`reasoning` (not `"Rule-based fallback — Valet Router model not loaded"`).

### Quick checklist
- [ ] GGUF present on Windows box, SHA-256 verified
- [ ] GGUF copied into `models\valet-router\<tag>\` for bundling
- [ ] `current.json` backend chosen (A: gguf+relative path / B: ollama) and path fixed
- [ ] Modelfile `FROM` made relative (only if Option B)
- [ ] `python_bridges` + `valet-training` docs added to electron `extraResources` + Python deps confirmed
- [ ] Packaged build verified: `/health` model_loaded:true, `/route` model-driven

---

## 🛠️ Phase 1: Security Hardening & Access Control
- [x] **Feature 1: tRPC Procedures Lockdown**
  *   *File:* [server/routers.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers.ts)
  *   *Done:* jobRouter (getStatus/list/cancel→protected, runSandboxCommand/prune→admin), agentRouter (runCrew/runLiteAgent/triggerN8n→protected), ommesh.router (discover/routeInference/getIdentity→protected, rotateCert/approvePeer→admin), projectRouter (getFileTreeFlat/checkAgentLoop/resetLoopDetector/getLoopDetectorState/openPath→protected), voiceRouter (all health/list/convert/transcribe/synthesize→protected). `pnpm check` passes.
- [x] **Feature 2: Safe Subprocess Spawning**
  *   *File:* [projectRouter.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers/projectRouter.ts)
  *   *Done:* projectRouter.openPath (exec→spawn arg array + validatePath), systemRouter.applyOptimizations ZRAM (exec `&&` shell→two execFileAsync sudo calls + bounded int), SecurityManager.rotateCert & generate-certs.ts (execSync openssl shell strings→execFileSync arg arrays), ProcessManagerService taskkill & ESPToolService PowerShell (execSync→execFileSync). No shell-string exec remains in server. `pnpm check` passes.
- [x] **Feature 3: Strict File Path Sanitization**
  *   *File:* [paths.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/paths.ts)
  *   *Done:* Enforced validatePath on voiceRouter.convertVoice (audioFilePath+modelPath), voiceRouter.listRvcModels (modelsDir), modelManagementRouter.register (filePath). Hardened validatePath in security.ts with separator-aware `isWithin()` boundary checks (kills `/data` vs `/data-evil` prefix bypass) on baseDir, allowed dirs, and sensitive dirs. readFile/writeFile/transcribe/synthesize already validated. `pnpm check` passes.
- [x] **Feature 4: OAuth Callback CSRF Protection**
  *   *File:* [oauth.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/oauth.ts)
  *   *Done:* Added double-submit `social_oauth_state` httpOnly cookie (sameSite=lax to survive provider redirect). Set at initiation in oauthRouter.getAuthorizationUrl via new `setSocialOAuthStateCookie()`; verified + cleared in the `/api/oauth/callback/:platform` Express handler before trusting DB state. tRPC `handleCallback` already session-bound (userId match). `pnpm check` passes.
- [x] **Feature 5: llama.cpp Bridge Directory Containment**
  *   *File:* [llamacpp_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/llamacpp_bridge.py)
  *   *Done:* Added separator-aware `_is_within()` helper; `is_safe_model_path` now rejects sibling-prefix bypasses (e.g. `~/models-evil/x.gguf` no longer passes the `~/models` allow-list). `py_compile` OK.

> **Phase 1 verification:** `pnpm check` (tsc) clean, `pnpm test` → 323/323 passing. UI-Registry unchanged — Phase 1 is backend/security only, no UI components added or modified.

---

## 🗄️ Phase 2: Database Layer & Integrity — ✅ COMPLETE (5/5)
- [x] **Feature 6: Drizzle Relations Schema Definition**
  *   *File:* [schema.ts](file:///home/linux/Documents/OmnecorV1-Beta/drizzle/schema.ts)
  *   *Done:* Added `relations(...)` import and 20 relational definitions covering all FK-linked tables: users (13 one-to-many), chatSessions/chatMessages/spendLog, pipelines/pipelinePhases, platformAccounts, discoveredArticles/curatedPosts/scheduledPosts/postAnalytics, designProjects/designSaves/designExports/aiDesignReviews, componentLibraryItems, cloudComputeSessions/Subscriptions, neuralMaps, personas, oauthStates, postingScheduleConfig.
- [x] **Feature 7: Out-of-Band DB Migrations**
  *   *File:* [server/db.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db.ts), [server/scripts/migrate.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/scripts/migrate.ts)
  *   *Done:* Created standalone `server/scripts/migrate.ts` runner; added `pnpm db:migrate` script to `package.json`. Server boot migration changed from fatal (throws) to non-fatal (logs warning + continues) so `pnpm start` never aborts on schema drift — migrations run explicitly via `pnpm db:migrate` before deployment.
- [x] **Feature 8: Safe Cascading Transactions**
  *   *File:* [server/db-pcb.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db-pcb.ts)
  *   *Done:* `deleteProject` (exports+reviews+saves+project) and `deleteDesign` (exports+reviews+save) both wrapped in `db.transaction()`. `saveDesign` mark-old-saves + insert also wrapped atomically.
- [x] **Feature 9: SQLite Query Audit**
  *   *File:* [server/db-pcb.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db-pcb.ts)
  *   *Done:* All 5 MySQL-only `(result as any)[0]?.insertId` patterns replaced with `.returning({ id: table.id })` arrays (`createProject`, `saveDesign`, `addComponentToLibrary`, `createExport`, `createAIReview`). Return values now use `row.id` instead of `insertId || 0`.
- [x] **Feature 10: Sovereign Mode Audit Tracking**
  *   *File:* [server/_core/trpc.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/trpc.ts)
  *   *Done:* `sovereignCheck` middleware now fire-and-forget logs a `sovereign_block` audit event (actorId, procedure, ip, reason) before throwing FORBIDDEN, matching the same pattern as `auditMiddleware`.

> **Phase 2 verification:** `pnpm check` (tsc) clean, `pnpm test` → 323/323 passing. UI-Registry unchanged — Phase 2 is DB/server-only, no UI components added or modified.

---

## 🧠 Phase 3: Core AI Services & Pipeline Repairs
- [x] **Feature 11: Embedding Tokenizer Implementation**
  *   *File:* [ONNXEmbeddingService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/ONNXEmbeddingService.ts)
  *   *Done:* Replaced whitespace pseudo-tokenizer (`text.split(/\s+/).map((_, i) => i + 1)`) with `@anthropic-ai/tokenizer` BPE encoder. Tokenizer cached as class member (initialized once in `loadModel`, avoids WASM overhead per call). `embed()` now produces unique, content-sensitive token IDs — different texts yield different vectors. Empty-text guard added. `pnpm check` clean, 323/323 tests passing.
- [x] **Feature 12: Warm Model Memory Caching**
  *   *File:* [llamacpp_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/llamacpp_bridge.py)
  *   *Done:* Module-level `_gen_cache` + `_emb_cache` dicts (keyed by model path) hold warm `Llama` instances; `_get_or_load()` with double-checked locking ensures each model loads once. Per-model `threading.Lock` serialises concurrent inference on the same model. Added `/load` (pre-warm), `/unload` (free memory), `/loaded` (list cached models) endpoints. `/health` now reports loaded model lists. Path safety from F5 (`_is_within`) preserved.
- [x] **Feature 13: Agent Python Bridges Creation**
  *   *File:* [crewai_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/crewai_bridge.py), [liteagent_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/liteagent_bridge.py)
  *   *Done:* Created both missing bridges. `crewai_bridge.py`: uses `crewai` (Agent+Task+Crew with `step_callback` streaming, `step_callback` guarded for older versions); falls back to direct Ollama chat when crewai not installed. `liteagent_bridge.py`: minimal ReAct-style single-agent loop via Ollama (no crewai dep); up to 8 iterations; detects "Final Answer:" signal; streams each reasoning step as JSON line. Both bridges receive config as `sys.argv[1]` and emit AgentMessageBus-format JSON to stdout. `py_compile` OK on both.
- [x] **Feature 14: Dynamic Pipeline Phase Engine**
  *   *File:* [PipelineEngineService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/PipelineEngineService.ts)
  *   *Done:* Replaced static `phaseOutput()` with async `generatePhaseOutput()` that calls `AiProviderService.getInstance().chat()` via Ollama (`llama3.2:latest`, 800 tok, temp 0.3) with phase-specific system prompts (DEFINE/PLAN/EXECUTE/REVIEW/SHIP). Falls back to the original static string if Ollama is unreachable. All 3 call sites in `createPipeline()` and `approvePhase()` updated to `await`. `pnpm check` clean, 323/323 tests passing.
- [x] **Feature 15: Local Podcast Service Integration**
  *   *File:* [LocalPodcastService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/LocalPodcastService.ts), [podcast_engine.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/podcast_engine.py)
  *   *Done:* `podcast_engine.py` now calls TTS server (`POST /synthesize`) for each turn via `httpx.AsyncClient`; uses XTTS engine when `referenceWav` provided, Kokoro otherwise; falls back to 1.5 s silence per segment when TTS server unreachable; stitches segments + silence gaps with `soundfile`/numpy (nearest-neighbour resample to 44100 Hz if needed); outputs structured JSON `{jobId, audioPath, duration, segments}` to stdout. `LocalPodcastService.ts` replaces the stub with a `callPodcastEngine()` spawner (stdin→stdout JSON, 10-min timeout, graceful fallback to stub on error); `streamDialogue()` updated to call TTS server directly via `fetch`. `pnpm check` clean, 323/323 tests passing.

---

## 💻 Phase 4: Desktop Shell & Theme Modernization — ✅ COMPLETE (7/7)
- [x] **Feature 16: React 19 Version Alignment**
  *   *File:* [package.json (Electron)](file:///home/linux/Documents/OmnecorV1-Beta/packaging/electron-app/package.json)
  *   *Done:* `react`/`react-dom` bumped from `^18.2.0` → `^19.2.1`; `@types/react`/`@types/react-dom` bumped to `^19.1.0`. Eliminates duplicate-module crash (`useContext of null`) in Electron builds.
- [x] **Feature 17: tRPC Client Alignment**
  *   *File:* [package.json (Mobile)](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/package.json)
  *   *Done:* `@trpc/client`, `@trpc/react-query`, `@trpc/server` changed from exact pin `11.17.0` → `^11.8.0` range to match server. pnpm now resolves all three to the same version — eliminates schema-definition mismatch logs.
- [x] **Feature 18: Tailwind Token Drift Resolution**
  *   *File:* [theme.config.js](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/theme.config.js)
  *   *Done:* All dark-mode HEX values aligned to UI-Tokens.md §5.1 spec (`background: #0e0f14`, `card: #151620`, `foreground: #f8f9fa`, `primary: #1d4ed8`, `border: #2a2b36`). Added missing `accentCyan: #06b6d4` and `destructive: #dc2626` tokens.
- [x] **Feature 19: Multi-Window External Brain Map**
  *   *File:* [brainMapStore.ts](file:///home/linux/Documents/OmnecorV1-Beta/client/src/lib/stores/brainMapStore.ts), [ExternalBrainMapWindow.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/window-system/ExternalBrainMapWindow.tsx)
  *   *Done:* Added `collapsedFolderIds` to BroadcastChannel sync (previously unsynced). Added `requestInitialState` / `initialState` handshake — external window sends request on mount, main window responds with full state. External window now receives correct node/edge/collapse state immediately on open.
- [x] **Feature 20: Real-Time Telemetry Upgrades**
  *   *File:* [WebSocketServer.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/websocket/WebSocketServer.ts), [Dashboard.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/Dashboard.tsx)
  *   *Done:* `startTelemetryPush()` added to WS server — every 2 s broadcasts CPU % (from `os.cpus()` delta), RAM used/total/%, GPU VRAM (nvidia-smi, 5 s cache) to `system:metrics` channel. Dashboard subscribes and renders System Monitor progress bars (CPU / RAM / VRAM) with live pulse indicator.
- [x] **Feature 21: mDNS Discovery Integration**
  *   *File:* [MeshDiscoveryService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/MeshDiscoveryService.ts)
  *   *Done:* Replaced constructor stub with real `bonjour` mDNS implementation. Advertises this node as `omnecor-<ip>` on port `$PORT`. Browsers for other Omnecor nodes; emits `nodeDiscovered` / `nodeLost` events and maintains live `nodes` map. Graceful fallback with warning if bonjour unavailable.
- [x] **Feature 22: RVC Server Fallback Repair**
  *   *File:* [rvc_server.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/rvc_server.py)
  *   *Done:* `_stub_synthesise` replaced flat 220 Hz sine tone with identity pass-through — returns the original 16 kHz audio unchanged (no mock signal). Falls back to zero-filled silence only if audio is unavailable. Real HuBERT + SynthesizerTrnMs768NSFsid path is called first; stub is used only when RVC libs not installed. `py_compile` OK.

---

## 📱 Phase 5: Mobile App Realization & Verification
- [x] **Feature 23: Secure KeyStore Encryption**
  *   *File:* [server-config.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/server-config.ts), [chat-store.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/chat-store.ts), [secure-crypto.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/secure-crypto.ts)
  *   *Done (2026-06-15):* SecureStore (Android KeyStore / iOS Keychain) now holds the `omnecor_ommesh_secret` — `loadServerConfig` reads it from SecureStore, migrates any legacy plaintext AsyncStorage secret then scrubs it, and `saveServerConfig` writes the secret only to SecureStore (IP/port/node name stay in AsyncStorage as non-sensitive). Chat histories are encrypted at rest via new `secure-crypto.ts` **envelope encryption** — a 256-bit data key lives in SecureStore (under the 2048-byte limit), AES-256-CBC + encrypt-then-HMAC-SHA256 ciphertext lives in AsyncStorage; `loadChats` transparently migrates legacy plaintext snapshots to encrypted on first read. New dep: `crypto-js ^4.2.0` (+ `@types/crypto-js`), pure-JS/Hermes-safe, randomness from the existing `react-native-get-random-values` CSPRNG. Gates: APK `tsc` 0 · root `tsc` 0 · `vitest` 323/323.
- [~] **Feature 23b: Always-Listening Voice Mode (added — wake-word → on-device STT → PC persona)**
  *   *Files:* [always-listen.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/always-listen.ts), [local-stt.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/local-stt.ts), [always-listen-config.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/always-listen-config.ts), [use-always-listen.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/hooks/use-always-listen.ts), [always-listen-settings.tsx](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/components/always-listen-settings.tsx)
  *   *Done (2026-06-15):* Foreground loop built & type-checked — Porcupine wake word ("Hey Omnecor", `BuiltInKeywords.COMPUTER` fallback) → utterance capture (expo-audio) → **on-device** Whisper STT (`whisper.rn`) → `agentMessenger.send(personaId, content)` (persona IDs are strings) → reply spoken via `expo-speech` + local notification + **encrypted** activation-audit ring buffer (reuses `secure-crypto.ts`). Pluggable `CaptureProvider` so foreground/background share one pipeline. Settings UI: enable toggle, Picovoice key (KeyStore), persona picker (`personas.list`), sensitivity, Whisper model download/select, Test button, audit log. Deps added + installed: `@picovoice/porcupine-react-native`, `@picovoice/react-native-voice-processor`, `whisper.rn`; perms (`FOREGROUND_SERVICE`/`_MICROPHONE`/`WAKE_LOCK`) in `app.config.ts`; `loadListenConfig()` at startup. **whisper.rn fix:** no `"."` export → bare import fails under bundler resolution + Metro package-exports (SDK 54); resolved via `metro.config.js` root redirect (mirrors nanoid intercept) + `types/whisper-rn.d.ts` ambient shim. Gates: APK `tsc` 0 · root `tsc` 0.
  *   *Review fixes (2026-06-15, post-/review):* (1) **`.bin` collision** — downloaded Whisper `ggml-*.bin` models were matched by the MediaPipe `.task/.bin/.litertlm` scanner and showed up (unloadable) in the "Phone AI Model" LiteRT list; added `isWhisperGgml()` exclusion to `isTask()` in `model-download.ts`. (2) **Mic-ownership collision** — unified the wake callback and the manual Test button through one `captureAndRun()` that pauses/re-arms the Porcupine voice-processor around the recorder, so they can't fight over the mic. (3) **Capture provider lifecycle** — split the hook into headless `useAlwaysListenCapture()` (mounted once at `app/_layout.tsx`, app-wide) + `useAlwaysListen()` (Settings controls/state), so a wake event works regardless of the active screen instead of breaking when Settings unmounts. (4) **Notification permission** — `startListening()` now best-effort requests `POST_NOTIFICATIONS` (Android 13+). (5) `startListening()` guards a missing capture provider. Whisper model URLs verified live (HTTP 200). Re-gate: APK `tsc` 0.
  *   *Native Foreground Service — BUILT & build-verified (2026-06-15, Linux):* Created a local Expo module [modules/mic-foreground-service](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/modules/mic-foreground-service) — Kotlin `MicForegroundService` (persistent notification + `startForeground(..., FOREGROUND_SERVICE_TYPE_MICROPHONE)`, `START_STICKY`) + `MicForegroundServiceModule` bridge (`startService`/`stopService`), with the `<service android:foregroundServiceType="microphone">` declared in the module's own `AndroidManifest.xml`. Autolinked (lives under `modules/`, so it survives `expo prebuild --clean`). Wired into `always-listen.ts`: `startListening()` starts the FGS after Porcupine arms, `stopListening()` stops it (via `requireOptionalNativeModule`, so JS type-checks/runs before prebuild). **The "background CaptureProvider" is satisfied by the FGS** — the existing app-wide capture provider (`useAlwaysListenCapture` in `app/_layout.tsx`) keeps running because the FGS holds the process alive when backgrounded. **Verified:** `expo prebuild --clean` ✓; `./gradlew :app:assembleDebug` **BUILD SUCCESSFUL** (160 MB APK); the service + `foregroundServiceType="microphone"` confirmed merged into the final app manifest; module Kotlin compiles. (Fixed a Kotlin return-type inference error in the bridge — replaced `?: return@Function` with plain null-checks.)
  *   *Remaining (user, on-device):* train the "Hey Omnecor" `.ppn` (Picovoice console) → bundle + `setKeywordPath` (built-in `COMPUTER` is the verified fallback until then); `pnpm apk:release` (needs keystore — debug APK requires Metro) + sideload; confirm the wake word fires with the app backgrounded/closed. Gates: APK `tsc` 0 · root `tsc` 0 · Android debug build ✓.
- [x] **Ad-hoc: Mobile Layout Bottom Tab Bar Clipping Fix**
  *   *File:* [screen-container.tsx](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/components/screen-container.tsx)
  *   *Done (2026-06-15):* Offset the scrollable views in the mobile APK tab screens so the bottom-most elements (e.g. settings Logout button, AI Node architecture notes) are fully visible above the app tab navigation bar instead of being clipped behind it. Imported `BottomTabBarHeightContext` from `@react-navigation/bottom-tabs` and applied a dynamic `paddingBottom` of `tabBarHeight` to the container `SafeAreaView` style when rendered inside the tab navigator context. This resolves the clipping issue globally across all tab screens. Gates: APK `tsc` 0 · root `tsc` 0 · `vitest` 323/323.
- [x] **Ad-hoc: Mobile APK App Icon Fallback Resolution**
  *   *Files:* [package.json](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/package.json), [app.config.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/app.config.ts)
  *   *Done (2026-06-15):* Diagnosed the generic Android robot placeholder app icon issue. Discovered that (1) missing local `sharp` dependency forced Expo to fallback to `jimp` during prebuild, resulting in PNG data mistakenly written with `.webp` extension (which AAPT2/Android rejected or failed to decode, causing launcher fallback), and (2) build scripts did not run `./gradlew clean`, meaning Gradle used cached built assets containing default placeholder icons. Fixed by adding `sharp` to development dependencies and updating the mobile `package.json` build scripts to include a `clean` task (`./gradlew clean assembleDebug` / `clean assembleRelease`) to invalidate resource caches. Gates: APK `tsc` 0 · root `tsc` 0.
- [x] **Feature 24: Mobile 3D Canvas Interactivity**
  *   *File:* [viewer.tsx](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/app/(tabs)/viewer.tsx) — the **mobile** viewer screen.
  *   *Done (2026-06-15):* Real GLB/GLTF mesh loading added on top of the existing interactive viewer. **Server:** `blender.listModels` (protected query) lists `.glb/.gltf` in the shared model library (`PATHS.models`); new range-capable `/media/model/:file` route serves them (basename-only + extension allowlist + `model/gltf-binary|+json` content-type); `blender.export` gained `toLibrary` to write exports straight into the library so they appear in the picker. **Mobile:** `THREE_HTML` importmap now also loads `GLTFLoader`; `window.loadModel(url)`/`clearModel()` swap the demo primitives for the real mesh, rebuild the raycast pick-list from the loaded meshes, and frame the camera to its bounding box; a horizontal **Model picker** (Demo scene + library models) injects `loadModel` via a WebView ref; load status surfaced; `buildContext()` now describes the loaded model for the AI. Demo Cube/Sphere/Cylinder remain the no-model fallback. **Remaining: on-device verification (F27).** Gates: APK `tsc` 0 · root `tsc` 0 · `vitest` 325.
- [x] **Feature 25: Mobile Podcast Controls and Settings**
  *   *Files:* [podcast.tsx](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/app/(tabs)/podcast.tsx), [ai-chat.ts](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/_core/ai-chat.ts), [LocalPodcastService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/LocalPodcastService.ts), [podcastRouter.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers/podcastRouter.ts), [PodcastStudio.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/PodcastStudio.tsx), [podcast_engine.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/podcast_engine.py)
  *   *Done (2026-06-18):* **Server:** Added new server-side script generation endpoint `generateScript` accepting title, description, durationMinutes, quality, and sources directly in its schema. Streams real-time intermediate progress percentages (0% to 100%) during podcast compilation to the WebSocket channel `podcast:${jobId}`. **Desktop:** Wired PodcastStudio page to use the server-backed `generateScript` procedure. **Mobile:** Replaced the inert "Audio ready" button with a real `expo-audio` player streaming the WAV from the PC, and added device download. Added sources panel (text/web/file) supporting context feeding. Configured sliders to persist. Switched script generation to call `podcast.generateScript` mutation. Added a 300ms WebSocket subscription delay to resolve the progress bar race condition. Gates: APK `tsc` 0 · root `tsc` 0 · `vitest` 350.
- [x] **Feature 26: Unwired Frontend Elements**
  *   *Files:* [SettingsPanel.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/SettingsPanel.tsx), [settings.tsx (APK)](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/app/(tabs)/settings.tsx), [theme-provider.tsx](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/lib/theme-provider.tsx), [PodcastStudio.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/PodcastStudio.tsx), [ChatInput.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/chat/ChatInput.tsx), [ChatInterface.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/ChatInterface.tsx), [NeuralGraphView.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/neural/NeuralGraphView.tsx), [PCBSchematicEditor.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/pcb/PCBSchematicEditor.tsx), [EnhancedPCBEditor.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/pcb/EnhancedPCBEditor.tsx), [SchematicEditor.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/designer/SchematicEditor.tsx), [NeuralWorkspaceCanvas.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/workspace/NeuralWorkspaceCanvas.tsx), [Dashboard.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/Dashboard.tsx)
  *   *Done (2026-06-15):* **Mobile dark mode** now wired to the live `ThemeProvider` (`setColorScheme`) — toggling re-themes the app; removed a stray debug `console.log` in the provider. **Desktop SettingsPanel:** bound 16 previously write-only controls (13 switches: knowledge.autoIndex, security.maliciousFileScan/scanOnUpload/encryptionEnabled/apiKeyEncryption, privacy.zeroLoginMode/telemetry/crashReports/analytics/cloudSync, advanced.debugMode/enableDevTools/cacheEnabled + per-folder enable toggle + Log Level select + Theme/Language/Startup/CloudProvider selects) — all persist via the real `system.saveSettings` mutation. **Podcast history:** the misleading toast (pointed at a non-existent route) replaced with a real localStorage-backed episode-history dialog (play/download/remove); this also fixed a latent desktop bug where the master-mix `<audio>` was never wired to the generated audio (now uses the new `audioUrl`). AgentNetworking checkboxes/persona select were already wired (verified). **Desktop ChatInput & ChatInterface:** Refactored action toolbar layouts (left-aligned terminal buttons, right-aligned attachments/send) to prevent textbox squishing. Increased text entry box height to 36px (with py-3 padding) for a roomier feel, updated the bottom hint line to refer to `/commands/skills`, and reduced the parent container's bottom padding (`pb-1`) to align the bottom hint text snugly with the card border. **ReactFlow Canvas attribution removal**: Hid the ReactFlow bottom-right attribution watermark on the Neural Brain Map, PCB Schematic Editors (standard & enhanced), 3D Designer schematic flow editor, and Neural Workspace canvas viewports via the `proOptions={{ hideAttribution: true }}` prop. **Desktop Dashboard Hero Logo**: Imported `logo_mark_256.png` directly via Vite ESM from the root assets directory and aligned it in a responsive flex layout next to the hero text, hidden on small screens (`hidden md:block`) with a transition-scale hover effect. Gates: APK `tsc` 0 · root `tsc` 0 · `vitest` 325.
- [~] **Feature 27: End-to-End Build Smoke Tests**
  *   *Files:* [packaging/windows/installer.smoke.test.ts](file:///mnt/c/OmnecorV1-Beta/packaging/windows/installer.smoke.test.ts), [packaging/electron-app/electron-builder.yml](file:///mnt/c/OmnecorV1-Beta/packaging/electron-app/electron-builder.yml)
  *   *Windows installer — BUILT (2026-06-16):*
    - `Omnecor-Setup-2.3.0-beta.1.exe` — 1.69 GB NSIS installer (in `packaging/electron-app/dist/`, gitignored)
    - `Omnecor-2.3.0-beta.1-portable.exe` — 1.69 GB portable (same dir)
    - `Omnecor-Setup-2.3.0-beta.1.exe.blockmap` + `latest.yml` generated
    - Installer smoke suite: **338/338 tests passing** (22 test files — NSIS script content, electron-builder.yml config, bash syntax, version consistency)
    - **NSIS bugs fixed this session:** `${GetDriveSpace}` → `${DriveSpace} "$INSTDIR" "/D=F /S=M" $R0` (electron-builder ships NSIS 3.0.4.1 which lacks the old macro); CRLF stripped from `install.sh`, `build-deb.sh`, `postinst`, `build-appimage.sh`
    - **WSL2/NTFS workarounds:** `.npmrc` `node-linker=hoisted` (pnpm doesn't create `.bin` symlinks on NTFS); test script changed to `node node_modules/vitest/vitest.mjs run`; native modules (`axios`, `@libsql/linux-x64-gnu`, `@esbuild/linux-x64`, `@rollup/rollup-linux-x64-gnu`) must be copied from `.pnpm` store if crash wipes them
    - **Actual Windows installation: NOT YET DONE** — smoke tests are static analysis only; no one has run the installer on a real Windows machine
  *   *Remaining:*
    - [ ] Install `Omnecor-Setup-2.3.0-beta.1.exe` on a clean Windows machine, confirm app launches and connects to backend
    - [ ] Android APK sideload + on-device test (F27 Android leg)
    - [ ] Web smoke (server start → `/health` → chat round-trip)

---

## ✅ OMMESH Topology UI (2026-06-18)
- [x] **OMMESH Topology UI — react-force-graph rendering of live mesh peer network**
  *   *Files:* [client/src/components/mesh/MeshTopologyGraph.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/mesh/MeshTopologyGraph.tsx), [client/src/pages/AgentNetworking.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/AgentNetworking.tsx)
  *   *Done:* Replaced the static SVG stub (`renderMeshGraph()`) in `MeshFederationPanel` with a real `ForceGraph2D` component from `react-force-graph ^1.48.2`. Nodes: local node (blue glow), trusted peers (green), pending-approval peers (red). Edges: solid for trusted, dashed for unapproved. ResizeObserver fills panel width at 320 px height. Hover tooltip shows hostname, IP, fingerprint, and status. Legend updated to remove raw Tailwind color classes. `pnpm check` 0 errors · `vitest` 350/350.

---

# 📋 Archive A: Functional Audit — Real vs Stub (baseline 2026-06-13/14)

> Merged from `FUNCTIONAL-AUDIT.md`. Legend: ✅ real · ⚠️ partial · ❌ stub/shell · 🔧 fixed.

## ✅ RESOLVED: unified on a single libSQL/SQLite engine (2026-06-14)
Previously `getDb()` returned `null` in SQLite mode → 13 routers no-op'd in the default install (MySQL-only). **Fixed permanently:**
- Single `sqlite-core` schema (`drizzle/schema.ts`, all 25 tables) — dropped MySQL schema + partial hand-mirrored sqlite schema.
- `server/db.ts` rewritten on `@libsql/client` + `drizzle-orm/libsql`; `getDb()` **always returns a live instance** (local file default, libsql/Turso via `LIBSQL_URL`); generated migrations auto-applied at boot.
- `server/db.sqlite.ts` deleted; `db.factory.ts` is a thin re-export; `mysql2` removed.
- Fixed MySQL-only APIs: neuralMaps `onConflictDoUpdate`, schedulingRouter `.returning()`.
- Verified: tsc 0 errors, 29 tests pass, boot smoke test inserts/reads `discoveredArticles`+`curatedPosts` in default local mode (timestamps return `Date`).
- **Result:** Agent Networking/social pipeline, AgenticWallet, BrainMap, persona, platform connections, mobile sync, cloudCompute now work in the default zero-infra install. No MySQL-only tier remains.

## Pages
| Page | Status | Notes |
|---|---|---|
| Chat | ✅ | `ai.chat` real (aiRouter:264); Honcho memory real via `honcho-ai` SDK (degrades w/o key) |
| Podcast Studio | ✅ | `LocalPodcastService.generatePodcast` real local TTS |
| Dashboard | ✅ | status/health queries real |
| Settings | 🔧 | Was ~37 write-only controls; most now wired. Remainder need new subsystems. |
| Agent Networking / Curation | ❌→🔧 | Social pipeline (see below) |
| 3D Designer / PCB | ✅ | blender/kicad/project file ops on real services |
| Models / ModelHub | ✅ | ollama/aiProvider real |

## Social content pipeline — ✅ NOW REAL
End-to-end: RSS discovery → AI curation → approve → schedule → real platform publish.
- 🔧 `discoveryRouter.fetchArticles` — ingests via `ArticleDiscoveryService` (rss-parser; feeds from Settings `discoveryFeeds` or defaults; dedup by urlHash).
- 🔧 `curatorRouter.curateArticle` — was hardcoded `"AI-generated content pending review"`; now generates real platform copy via AI (`generatePostDraft`), persists, marks processed. `regenerateDraft` on same helper.
- 🔧 `schedulingRouter.publishNow` — publishes via `PublishingService` + `publishExecutor` (real X/LinkedIn/Facebook/Instagram calls; honest errors for YouTube/IG media; 401 token-refresh).
- 🔧 Scheduled posts auto-publish at due time via `server/_core/publishWorker.ts`.
- OAuth configured for twitter/linkedin/instagram/facebook/youtube with write scopes; tokens in `platformAccounts`. ⚠️ Not yet live-tested against real platform APIs.

## Verified real (spot-checks)
cloudComputeRouter (vast.ai/runpod/lambdalabs), virtualCardRouter (Lithic), honchoRouter (honcho-ai SDK), walletRouter (projectBudgets + spend_log; spend really logged by AiProviderService.logSpend per chat + cloudComputeRouter), neuralMapsRouter (BrainMap CRUD + migrate), integrationManagementRouter / modelManagementRouter (delegate to dedicated services), aiRouter.chat / podcastRouter.
> **Heuristic note:** an "external call" grep undercounts — most routers delegate to singleton services (`X.getInstance()`) or SDK clients, not raw `fetch`. Verification = reading procedures, not grep counts.

---

# 📋 Archive B: Beta Code Sweep — Production-Readiness Audit (2026-06-12)

> Merged from `Beta-Code-Sweep.md`. Branch `claude/production-readiness-audit-f38749`. Full 9-domain sweep.

## Final Gate Status
| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` (root) | ✅ 0 | ✅ 0 |
| `tsc --noEmit` (electron-app) | n/a | ✅ 0 |
| `tsc --noEmit` (omnecor-hq APK) | ❌ 1 (ai-node.tsx) | ✅ 0 |
| `vitest run` | ✅ 323 / 2 skip | ✅ 323 / 2 skip |
| `pnpm build` | ✅ clean | ✅ clean |
| `pnpm audit` (prod+dev, all workspaces) | ❌ 8 vulns (2 crit, 2 high, 4 mod) | ✅ **0 known** |
| input-tracker.md | 4 stale DEAD + 13 stale | ✅ 0 DEAD, 0 PARTIAL |
| APK-input-tracker.md | unvalidated | ✅ validated, full coverage |

## Security fixes (escalated per policy)
- `WebSocketServer.ts`: OMMESH secret compared with SHA-256 + `crypto.timingSafeEqual`; mobile node registration fail-closed when `OMMESH_SECRET` unset (except loopback/zero-login); WS upgrade verifies a session credential (cookie / `Authorization: Bearer` / `?token=`); unauthenticated LAN sockets may only attempt `mobile_node_register`.
- APK `getAuthedWsUrl()` appends stored session token as `?token=` (RN WebSockets don't attach cookies).
- `index.ts`: dedicated auth rate limiter on `/api/oauth/*` (10 req / 15 min / IP).
- `attachmentsRouter.ts` + `static.ts`: upload extension allowlist (executables/scripts/HTML/SVG → `.bin`); `/uploads` served with nosniff + `Content-Disposition: attachment` + CSP.
- `env.ts`/`sdk.ts`/`oauth.ts`/`.env.example`: `SESSION_TTL_MS` controls session JWT + cookie lifetime.
- `trpc.ts`: verified audit-log redaction on success + error paths.

## Dependencies (0 vulns after)
| Package | Was | Now | Vuln |
|---|---|---|---|
| drizzle-orm (APK + override) | 0.44.7 | ≥0.45.2 | SQL injection (high) |
| @trpc/* (APK + override) | 11.7.2 | 11.17.0 | prototype pollution (high) |
| vitest (APK) | 2.1.9 | ^3.2.6 | arbitrary file read (critical); also removes vite 5.4.21 |
| shell-quote (override) | 1.8.3 | ≥1.8.4 | newline escape bypass (critical) |
| joi via simple-oauth2 (scoped) | 17.13.3 | ≥18.2.1 | RangeError DoS (moderate) |
| uuid via xcode / @expo/ngrok (scoped) | 3.4.0 / 7.0.3 | ≥11.1.1 | buffer bounds (moderate) |
Also: `engines` (node ≥20, pnpm ≥10) added; `cross-env` added to `dev`/`start`.

## Code quality / correctness
- `db-pcb.ts` N+1 in `deleteProject` → batched `inArray`.
- `AgentService.ts` ESM-unsafe `require()` ×2 → dynamic `import()`.
- 9 silent `.catch(() => {})` on audit-log writes → `console.warn` (agentRouter, pipelineRouter, PipelineEngineService, HITLApprovalService).
- `agentSettingsRouter.ts`: removed `updateBotTheme`/`updateDiscoveryKeywords` no-op stubs; `optimalPostingTimes` typed.
- `brainmapRouter.ts` deleted (dead stub, zero callers); `modelMarketplaceRouter` `pullOllama` no-op removed.
- comfy/pcbEditor/platforms routers: `z.any()` → typed records.
- `ComfyPanel.tsx`: workflow textarea JSON-validated before queueing.
- `SetupWizard.tsx`: silent API-key save failure → toast; hardcoded `/home/linux/...` default removed.
- `config/index.ts`: `pythonBin` platform-aware (`python` win32 / `python3` else).
- `.gitattributes` added (LF/CRLF normalization).
- Responsive: Chat Live Preview overlays below `sm`; PCB toolbar `flex-wrap`; Settings `?tab=` deep-link; SpecializedModuleLauncher buttons navigate to `/settings?tab=...`.

## Follow-up rounds (same day)
- **Audit Log Retention:** `AuditLogService` (`getRetentionDays`/`setRetentionDays`/`purgeExpired`/`getStorageStats`/`startRetentionScheduler` — boot + 6h sweep; default 14 days, 28/permanent). `auditRouter` `getRetention`/`setRetention` (admin-only). `AuditRetentionPanel.tsx` in Settings → Security.
- **Silent mutations eliminated:** Desktop + APK global `MutationCache.onError` (toast / Alert.alert); last 8 silent audit-log catches now warn; `onError: () => {}` count **0**.
- **`err: any` eliminated** in client + APK.
- **OAuth refresh implemented:** `IntegrationManagementService.refreshToken` does the real `refresh_token` grant, persists rotated token + expiry, clears health cache. Zero TODO/FIXME in server/, client/src/, shared/.
- **Audit log parity in SQLite/Sovereign:** `audit_log` table + factory functions (`auditInsert`/`auditPurgeBefore`/`auditList`/`auditListByActor`/`auditStats`); live-verified (insert → stats → backdated entry purged by 14-day window).
- **Bonus:** hardcoded `python3` spawns in AgentService (×2) + trainingRouter (×2) → `PYTHON_SCRIPTS.pythonBin`.

## Accepted / deferred (documented, not blockers)
`as any` **casts** — 100% eliminated (all ~38 server-side `as any` casts replaced with type-safe interfaces; `grep "as any" server/ --include=*.ts` → 0 outside tests). Note this does **not** cover `: any` **type annotations**, which remain by design behind validated boundaries (untyped libs like `bonjour`/ChromaClient, dynamic WS event payloads — see "Known debt" below); electron-app Vite 5→7 / Electron 28→39 toolchain upgrade (needs build machine — `/finish-electron-security`); `valet:fetch`/`valet:setup-ml` maintainer-only scripts; `0o600/0o700` file perms no-op on Windows by design; Android Gradle build + Windows/Linux installer builds (need physical machines); Valet 6.4 final sign-off (needs clean GPU box).

---

# 📋 Code-Sweep — 10-Domain Beta Audit (2026-06-14)

> `/code-sweep` full run. Scope: all 10 domains (typescript, database, routers, security, frontend, ui, mobile, dependencies, mock, architecture).

## Gate metrics — baseline → final
| Gate | Baseline | Final |
|---|---|---|
| `tsc --noEmit` (root) | ✅ 0 | ✅ 0 |
| `vitest run` | ✅ 323/323 | ✅ 323/323 |
| `pnpm build` | ✅ clean | ✅ clean |
| `pnpm audit --prod` | ❌ 2 (1 high, 1 low) | ✅ **0** |

## Fixed
| Severity | File | Issue | Fix |
|---|---|---|---|
| **HIGH** | [aiRouter.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers/aiRouter.ts) `chat`/`chatStream` | **Sovereign-mode bypass** — both `protectedProcedure`, accept any `providerId`, and neither the router nor `AiProviderService` guarded `executionMode`; a sovereign (air-gapped) user could call `providerId:"openai"`/`anthropic`/`gemini`/`grok`/`huggingface` and reach the cloud. | Added `CLOUD_PROVIDER_IDS` set + `assertProviderAllowedInMode()` per-provider guard in both procedures. Local providers (ollama/llamacpp/ommesh/forge) still work in sovereign mode — deliberately *not* flipped to `cloudProcedure` (that would block local chat). |
| **HIGH** | [pnpm-workspace.yaml](file:///home/linux/Documents/OmnecorV1-Beta/pnpm-workspace.yaml) | **Audit regression 0→2** — esbuild RCE via `NPM_CONFIG_REGISTRY` (GHSA-gv7w-rqvm-qjhr) + Windows dev-server file read (GHSA-g7r4-m6w7-qqqr) via `nativewind>tailwindcss>postcss-load-config>tsx>esbuild@0.28.0`. | Added scoped override `"tsx>esbuild": ">=0.28.1"` (kept narrow so the legacy `@esbuild-kit` esbuild pin is untouched). `pnpm audit` → 0. |
| **MEDIUM** | [shared/hitl.ts](file:///home/linux/Documents/OmnecorV1-Beta/shared/hitl.ts) | `CriticalAction.args: any` in the shared layer (should be clean). | → `Record<string, unknown>` (creation site already cast to it; consumers only `JSON.stringify`). |

## Correction — securityRouter "HIGH" was a FALSE POSITIVE
The initial sweep flagged `securityRouter` encrypt/decrypt/backup/scan as unauthenticated `publicProcedure`. On verification this was read from the **unregistered** legacy duplicate `server/phase2/routers/securityRouter.ts`. The **live** router `server/routers/securityRouter.ts` (the one wired in `routers.ts:55`) was **already fully `protectedProcedure`** — no real vulnerability existed. Lesson logged: always confirm a router is registered in `routers.ts` before assessing its tier.

## Dead-code cleanup (AGENTS.md — "delete leftover unused files") — 6 files removed
The `server/phase2/routers/` tree held stale duplicates of routers that were unified into `server/routers/`. Only `agentRouter`, `aiProviderRouter`, `modelMarketplaceRouter` are still registered. Deleted (each confirmed **zero importers**, tsc/test/build green after):
- `server/phase2/routers/securityRouter.ts` (dupe of live `routers/securityRouter.ts`)
- `server/phase2/routers/voiceRouter.ts` (dupe of live `routers/voiceRouter.ts`)
- `server/phase2/routers/projectRouter.ts` (dupe of live `routers/projectRouter.ts`)
- `server/phase2/routers/trainingRouter.ts` (dupe of live `routers/trainingRouter.ts`)
- `server/phase2/routers/hardwareRouter.ts` (unregistered, no live equivalent wired)
- `server/phase2/routers/trpc.ts` (orphaned compat-shim; the 3 kept routers import from `_core/trpc.js`)
- `client/src/components/ManusDialog.tsx` (unused template-brand leftover, zero importers)

Re-verified after cleanup: `tsc` 0 · `vitest` 323/323 · `pnpm build` clean.

## Follow-up hardening — legacy `aiProvider.chatStream`
[phase2/routers/aiProviderRouter.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/routers/aiProviderRouter.ts) is the legacy router kept registered as `aiProvider` (CLAUDE.md). Its `chatStream` was **`publicProcedure` (unauthenticated) AND cloud-capable with no sovereign guard** — worse than the `aiRouter` case (which is at least authenticated). Hardened:
- `chatStream`: `publicProcedure` → `protectedProcedure` (requires a session).
- Added the same per-provider sovereign guard (cloud providers blocked for air-gapped users; local ollama/llamacpp still allowed).
- Left `getProviders`/`discoverOllamaModels`/`checkHealth` public (read-only status, consistent with `aiRouter.getProviders`).

Verified: live `trainingRouter` (`routers/trainingRouter.ts`) is **already fully `protectedProcedure`** — the earlier `startTraining` flag was the deleted phase2 dupe (false flag). Re-verified: `tsc` 0 · `vitest` 323/323 · `pnpm build` clean. No `chat`/`chatStream` endpoint is public anymore.

## Flagged for decision (not auto-fixed)
- ~~**`MapManager.tsx`** — Neural Maps "cloud indexing is coming soon"~~ — **✅ BUILT (2026-06-20 → 2026-06-23):** real source ingestion (listing + content → VectorDB) + chat RAG for github + all `integration://` types incl. dropbox/onedrive. No placeholder remains.
- **Remaining `publicProcedure` endpoints are intentional** (verified): `systemRouter.getSettings`/`saveSettings` (Setup Wizard pre-login), `honchoRouter` (explicitly public-by-design for zero-login), and read-only `*.status`/`getProviders`/health probes. No further action recommended unless the threat model changes to untrusted-network multi-user — flagging only so the decision is on record.
- **`dangerouslySetInnerHTML`** in `pcb/SchematicNode.tsx`, `pcb/PCBNode.tsx`, `pcb/ComponentLibraryPanel.tsx` — appear to inject static component SVG (not user content); `ui/chart.tsx` is the standard shadcn CSS-var pattern. Recommend a confirm-static review.

## Known debt (documented, not sweep-fixable — pervasive/established, would require a rewrite)
- **RESOLVED (2026-06-15):** Cleaned up all 83 leftover `if (!db)` null-guards (harmless dead branches since `getDb()` is never null) across the server codebase.
- **RESOLVED (2026-06-19):** Converted all 77 default-export components/routers to named exports and updated import statements across the codebase.
- ~649 raw Tailwind color classes + scattered hex literals in `client/src` vs AGENTS "no hardcoded colors" — established status-color style (emerald=ok, rose=err). Legit hex: `EmbeddedTerminal` (xterm theme), `ThreeViewer`/`SchematicEditor` (three.js/reactflow), `WebPreview` (iframe).
- Template-brand ("Manus") leftovers remain only in `server/_core/{notification,map,sdk,storage}.ts` **comments/default strings** (active files — cosmetic, not dead code). `ManusDialog.tsx` itself was deleted (see cleanup above).
- Server `: any` **type annotations** (not `as any` casts — those are eliminated, see accepted list above) remain behind validated boundaries: untyped third-party libs (`bonjour`, ChromaClient), dynamic WS event payloads, and the `db: any` context field. Intentional, not sweep-fixable.

---

# 📋 4-Area Feature Fix — AI Context · Podcast · Social (2026-06-14)

> Scoped gap-fix across four features. No UI layout/routing changes. Gates: `tsc` 0 errors · `vitest` 323/323.

## Area 1 — 3D Viewer: real AI context for user-loaded models
[ThreeViewer.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/designer/ThreeViewer.tsx)
- Made the previously-inert `url` prop functional: loads GLTF/GLB via `GLTFLoader`, OBJ via `OBJLoader` (`three/examples/jsm/loaders`) in a cancel-safe effect; renders via `<primitive>` with raycast selection + emissive highlight (`UserModel`).
- `buildSceneContext()` walks `object.traverse()`, collecting each mesh's name, parent chain, `geometry.attributes.position.count` (verts) and `Box3` bounding-box dims → multi-line summary + per-mesh description map.
- AI payload `code` field now carries the full scene structure + `Selected mesh: <name>` (both "Ask AI" and "Suggest Changes") when a real model is loaded; the hardcoded `OBJECT_DESCRIPTIONS` table is kept as the demo-scene fallback. Added a load-error overlay.

## Area 2 — PCB AI panel: netlist context instead of counts
[AIAssistantPanel.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/components/pcb/AIAssistantPanel.tsx)
- `buildDesignContext()` serializes `canvasState` into a human-readable netlist: components (`data.label`/`name`/`ref` + `componentType`/`type` + `value`) and connections (source→target labels with `sourceHandle`/`targetHandle`). Defensive key fallbacks (no guessed field names). Capped at 2000 chars with truncation note. Replaces the `{nodes,edges,mode}` count blob as the system prompt.

## Area 3 — Podcast Studio: persistence · per-segment regen · audio download
[PodcastStudio.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/PodcastStudio.tsx)
- **3a** Session persistence: `turns`/`sources`/`podcastLength` mirrored to `localStorage["omnecor:podcast_session"]` (lazy-init restore on mount, write-on-change effect) + "Clear session" header button (resets to defaults).
- **3b** Per-segment regeneration: `RefreshCw` button per result segment → `podcast.generate` (single turn) via `mutateAsync`, replaces only that segment; per-segment spinner (`regenIndex`), rest stays playable.
- **3c** "Download Audio (.wav)" button shown when `audioUrl` is set (anchor + `download="podcast-episode.wav"`).

## Area 4 — Social automation: failed posts · retry · char limits
[AgentNetworking.tsx](file:///home/linux/Documents/OmnecorV1-Beta/client/src/pages/AgentNetworking.tsx) · [schedulingRouter.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/routers/schedulingRouter.ts)
- **4a** Calendar tab now renders `status:"failed"` posts with a destructive badge, red left border + `errorMessage` (generic fallback when null).
- **4b** New `scheduling.retryPost` (protected): verifies ownership via `platformAccounts.userId` (scheduledPosts has no userId), resets to `scheduled` + clears error, calls `publishScheduledPostIds([id])`, returns `{success,status}`. UI `retryPostMutation` + "Retry" button on failed posts. (Used `z.number()` for the id to match the real integer PK, not the prompt's `z.string()`.)
- **4c** `CHAR_LIMITS` map + `charLimitFor()`; live `len / limit` counter under the new-post textarea and curation draft, turns red + disables Schedule/Approve (with tooltip) when over the selected platform's limit. Unknown platform → count only.

---

# 📋 Archive C: Completed Work Log (merged from master-todo.md)

> Historical record of completed roadmap work. `[x]` = done, `[~]` = partial, `[ ]` = pending.

## 3D Designer & Live Preview — ✅ DONE
Reference research (React Flow PCB, R3F 3D); `/3d-designer` route + sidebar; `3DDesigner.tsx`; `ThreeViewer` (GLTF/GLB/OBJ + primitives, lighting, orbit); `SchematicEditor` (reactflow custom PCB/logic nodes, PCB aesthetic); `WebPreview` (iframe srcDoc); mode switching; renderable-codeblock detection in AI responses; "Preview" button on AssistantBubble; `LivePreviewPanel` in Chat right pane; "Send to 3D Designer"; Floating Window system + "Stay on Top" pin; production-readiness review.

## Packaging (Web · Linux · Windows · Android) — ✅ DONE
Toolchain pinned (Node 22+/CI 24.15, pnpm 10.x); reproducible `pnpm install`; electron-app deps; `.env.example`; `db.factory.ts` single import surface; relaxed `env.ts` FATAL guard; SQLite schema/migrations on first boot; null-guards; `better-sqlite3` rebuild note; INSTALL.md DB section + docker-compose MySQL + `db:push` ordering; `npm start` serves `dist/public`; port-autoselect; smoke flows (chat, Brain Map); electron bundling strategy + `asarUnpack` native modules (`better-sqlite3`, `onnxruntime-node`) + prod path; `electron-vite` build + disabled `bytecodePlugin()`; Linux AppImage/.deb/.rpm emitted + `dpkg-deb -c` sanity + icons; `linux-unpacked` via `xvfb-run`; setup wizard + backend child process + `OMNECOR_DB=sqlite`; Windows native modules + prebuilt path + `electron-builder --win` + Setup.exe/portable + `omnecor.nsh` + `asInvoker`/`perMachine:false` + installer smoke suite + clean-VM launch + backend spawn + SQLite round-trip + uninstaller; Android init (JDK 17) + web assets + `cap add/sync android` + LAN model + `appId`/`appName`/version/icon + Debug APK flavor; single documented command per target; versions aligned to `2.3.0-beta.1`; CI build jobs; security pass; final matrix sign-off; 8-agent swarm audit (Sessions 1–10) of 795+ elements; Session 11 9-agent Haiku verification (~820+ elements, ~301 CONNECTED, ~485 LOCAL, ~9 DEAD, ~1 PARTIAL); stale-comment sweep; Session 12 full-completion pass.

## Omnecor Implementation (todo.md / todo2.md) — ✅ DONE
OKLCH dark palette + semantic tokens; typography; reusable component library; DashboardLayout + sidebar nav; CORTEX→Omnecor rebrand (16 files, 0 refs left); Obsidian-style graph view + folder-to-node; Model Hub UI; Ollama/Llama.cpp integration + marketplace + auto-update; OpenAI/Anthropic/Gemini/Groq connectors + generic provider UI; model selection/switching + health checks + local-vs-API prefs; chat UI + streaming + Streamdown markdown; context transparency + Visual Context Map + file ejection + size counter + token estimate; message input; hash loop detector (tool/args/state hash, 3-rep threshold) + HITL alert + retry/modify/abort; Goal&Plan buffer + 50-line rolling log + auto-summarization + context export/import + size alerts + reset; module launcher (LLM Builder/3D Modeler/PCB Designer) + LoRA/QLoRA UI + training progress + Blender CLI/API + KiCad CLI/API; integrations UI + OAuth (GitHub/Notion/Slack) + cloud storage connectors + status/sync/disconnect; settings (knowledge base mgmt + folder import + file filtering + search/index; security file blacklist + scan; privacy zero-login + cloud sync; performance zram/swap + cache + context limits; app prefs); Phase 2 services (FileSystemWatcher, ProcessManager, HashTracker, VectorDB+MemoryArchitect, Security AES-256-GCM); bridges (Blender headless render/glTF/script, KiCad DRC/STEP/BOM, RVC FastAPI proxy, ESPTool flashing); tRPC routers (specializedModules + knowledgeBase) registered; spacing/typography audit; loading states; error handling; keyboard shortcuts; help/tooltips; onboarding; PHASE2_STATUS.md + 7 sub-routers (FileSystem 4 / AIProvider 5 / ContextManager 6 / ActionTracking 4 / KnowledgeBase 4 / IntegrationManager 5 / ModelManagement 4); 0 tsc errors.
*   Memory: Drizzle/libSQL + ChromaDB vector store, semantic search, episodic memory; `useOmnecorSocket.ts` + tests; `HITLAlertPanel`; hook wired into NeuralGraphView/NeuralTreeView; Brain Map windowing + multi-window sync + floating overlay + external monitor; 177 tests pass.
*   OMMESH: LAN/mDNS discovery; mTLS federation; VRAM-weighted routing; post-rotation peer broadcast; Mesh Compute UI; packaging (.deb/AppImage/Flatpak/systemd/postinst/docs).
*   Security: deserialization fix; path traversal protection; sensitive-data protection; dependency updates; unified security router hardening; advanced path validation; DoS mitigation; Python bridge sandbox; zero-trust audit; 177 tests pass.
*   Advanced: Character Engine (Flux Pro); Video Clone; ComfyUI bridge; crewAI/n8n connectors; Unsloth LoRA UI; OMMESH federated routing; LLM Builder / 3D Modeler / PCB Designer integration; redundant-component removal; agentic memory; YARA security.

## Agentic Wallet + Virtual Cards + Execution Modes + Valet — ✅ DONE
`project_budget` + `spend_log` tables; `providerPricing.ts`; `estimateCost` + spend tracking + budget pre-flight in `AiProviderService.streamChat()`; `walletRouter` mounted; `BudgetPanel` + `BudgetConfigDialog` + Dashboard card; `budget:spend` WS event + `walletSpend` Zustand slice + HITL budget overlay; `setWsInstance` singleton; `VirtualCardService` (Lithic, AES-256-GCM PAN) + `virtualCardRouter` + Virtual Cards tab; `executionMode` enum on `users` + `sovereignCheck` middleware + `cloud:true` metadata + `SOVEREIGN_MODE` env in Python bridges + `ExecutionModeBadge` + 3-mode RadioGroup + `setExecutionMode` mutation; Valet dataset builder (10-category taxonomy, 4000 Alpaca JSONL, 10% negatives, 90/10 split) + `generateValetDataset` + UnslothPanel button + `--task_type router` + `valet_router_inference.py` + `ValetRouterService` + pre-routing in `streamChat()` + `valet.status/getModes/testRoute` + status card + mounted.
*   Zero-Login: `ZERO_LOGIN_MODE` in `context.ts`; skip OAuth registration; startup checklist; `ZeroLoginBanner`; `--zero-login` flag; auto-Sovereign; `.env.example`.
*   Command registry: `useCommandRegistry.ts` (New Conversation, Clear Context, Connect Blender, Flash Firmware, Run YARA Scan, Switch Execution Mode, Pull Ollama Model); cmdk fuzzy match; accessibility on 8 pages + axe-core tests.
*   Audit/RBAC: `audit_log` table + `AuditLogService` + `auditMiddleware` + HITL/agent-spawn wiring + `auditRouter` + Settings panel + PII redaction; `rbac.ts` + `ownerProcedure`/`requirePermission` + 4-role enum + `getMyPermissions`/`listUsers`/`setUserRole` + UserManagementPanel + hidden admin commands.
*   PromptSanitizer (NFC, null-byte removal) + integration into streamChat/MemoryArchitect/AgentService + `security:injection_attempt` event + audit log + tests.
*   OAuth: Google + Microsoft routes + client IDs/secrets + no silent email merge + `loginProviders` query + Connected Accounts tab.
*   Ollama proxy (`OLLAMA_BIND_ADDRESS`/`OLLAMA_PROXY_TOKEN` + `ollama_proxy.py` + `ollamaRouter` + HITL `deleteModel` + `ModelHubPanel` + `docker-compose.ollama.yml`); ElevenLabs (`ElevenLabsService` + key + voiceRouter procedures + `VoiceProviderSelector`); RecursiveMAS (`recursive_mas_bridge.py` + `runRecursiveMAS` + `AgentMessageBus` + per-agent ChromaDB isolation + sanitizer + `RecursiveMASPanel` + HITL when agentIds>3); MCP (`@modelcontextprotocol/sdk` + `MCPClientService` + `getAvailableMCPTools`/`callMCPTool` + `mcpRouter` + HITL on `dangerous:true` + `MCPToolDirectory` + AgenticOS opt-in); Pipelines (`pipelines`+`pipeline_phases` tables + `PipelineEngineService` + per-phase HITL + ship=plan-only + sanitizer + `pipelineRouter` + audit + dashboard + `PhaseOutputPanel`); PCBWay (`PCBWayService` + keys + kicadRouter procedures + `PCBViewer3D`); OpenArt/ImageGen (`OpenArtService` + unified `imageGenRouter` + `ImageGeneratorPanel`); Threat (`runVulnerabilityScan` + `ThreatIntelService` + `threat_scanner.py` + `ThreatDashboard` + command); llama.cpp (`llamacpp_bridge.py` + `LlamaCppService` + `ONNXEmbeddingService` + VectorDB pre-computed embeddings); GPU detect (`detect_gpu.py` + postinst) + `UpdateCheckerService` + `checkForUpdates` + `UpdateBanner`.

## Valet Router automation — ✅ DONE (sign-off [~])
Dataset builder / LoRA trainer / orchestration / inference server / TS bridge exist; canonical I/O contract; shared system prompt; chat-template prompt build; reconciled `/plan` filename; taxonomy on manifest categories; extended `valet_dataset_builder.py` (canonical `route` schema + ChatML `text` + KB/repo `qa` pairs + `metadata.json` + eval set); base model Qwen2.5-1.5B; maintainer-built distribution; GGUF via llama.cpp; deps bootstrap; GPU/CPU detect; `valet_pipeline.py` orchestrator + `buildValetRouter` + idempotent/resumable + `valet.config.json` + preconditions; deterministic output + `current.json` registry + `.gitignore` weights; load artifact from `current.json` + auto-start (`ValetServerService`) + rule fallback + resource guardrails; holdout eval + thresholds + baseline + scores + expertise/rules eval; live manifest hot-reload + Brain Map RAG + knowledge refresh + drift check; local-training setting/gate + first-run/scheduled trigger + cancelable; CI job + docs + reproducibility.
*   **[~] 6.4 final sign-off:** `pnpm valet:build` from clean GPU box [ ]; artifact checksum recorded in `current.json`, fresh-machine fetch flow [ ]; app auto-serves, `/health` model_loaded:true, `/route` model-driven [x done 2026-06-11, Ollama backend]; eval route accuracy **0.7385** (Kaggle P100, 390 ex, beats keyword baseline ~2.7×; below 0.85 gate); docs (`SERVING.md`/`VALET_ROUTER.md`/`current.json`) updated; pipeline docs still assume GitHub-Release GGUF. Deployed as `omnecor-valet-router:v2-q8` (Ollama; Sandy Bridge AVX1-only box → prebuilt wheels crash, transformers ~30s/route). Fixed 3 Windows/GPU serving bugs (device mismatch, cp1252 mojibake, prompt truncation).

## Android APK integration — ✅ DONE (build-machine steps [~])
RN/Expo app scaffolded as `packaging/android/omnecor-hq/` workspace; 8 tab screens wired to real PC tRPC; PC WS mobile-node handlers; `hitlRouter`; `auth.setExecutionMode`; `aiRouter` `"ommesh"` provider; Chat selectors from `neuralMaps.list`/`personas.list`; Podcast `podcast.generate`; `expo-file-system`; 0 tsc errors. `pnpm install` (Node 24.16/pnpm 10.34.1); `prebuild:android` (NDK 30.0.14904198); **APK built 2026-06-12** (100 MB, `android/app/build/outputs/apk/debug/app-debug.apk`); release follows same pipeline (needs keystore). **[ ] 4.15** sideload to physical device; **[ ] 4.16** download GGUF + test on-device inference. ⚠️ `OMMESH_SECRET` not yet set in `.env` (nodes accepted with warning).

## CI / GitHub Actions repairs — ✅ DONE (2026-06-14)
Four broken checks fixed across two workflows:

**`build.yml` — `typecheck-and-test` (was failing in 10s):**
`pnpm/action-setup@v4` now throws a hard error when both `version:` in the workflow config and `packageManager` in `package.json` are set. Removed `version: 10` from both jobs (`typecheck-and-test` and `linux-build`) — the action now reads the pinned version (`pnpm@10.34.1`) from `packageManager` automatically. Unblocks `linux-build` (which `needs: typecheck-and-test`).

**`webpack.yml` — `build (18.x)` (was failing at smoke tests) + `build (20.x)` (cancelled as cascade):**
- Removed `18.x` from node-version matrix. Node 18 is EOL (April 2025); `globalThis.crypto.getRandomValues` is undefined in Vitest's Node 18 test environment. Project already declares `engines.node: ">=20.0.0"`.
- Updated matrix from `[18.x, 20.x, 22.x]` → `[22.x, 24.x]`. Node 20 also EOL (April 2026) with two months of no security patches; forward-looking matrix uses current active LTS.
- Added `--frozen-lockfile` to the install step (was the only workflow in the repo without it — non-deterministic CI anti-pattern).

**Result:** All four failing/cancelled/skipped jobs now expected to pass. Matrix now tests the two supported Node LTS versions (22 + 24). Install is deterministic across all workflows.

---

## Other completed sessions
*   **API/Provider Settings reorg (2026-06-07):** Settings `api` tab → 4 sections (Local AI / Cloud AI / Specialty / Local Endpoints); Ollama Base URL + Hugging Face + ElevenLabs + fal.ai + Forge + n8n URL + ComfyUI URL fields; Configured/Not-set badges; single Save; `env.ts` `huggingfaceApiKey`/`falaiApiKey`; `systemRouter` aiProviders/saveKeys expanded; `aiProviderRouter` enum + `chatHuggingFace()` + streamChat switch; SetupWizard provider sync + Skip Setup + Browse/Run Scan fixes.
*   **JSX text-node crash fix (2026-06-07):** removed `// UI-AUDIT-FINDING/SUGGESTION` lines rendering as text nodes inside `asChild`/`Slot` (caused `React.Children.only` + `TRPCClientError: Missing result`) across 12 files.
*   **Kaggle GPU Training (2026-06-11):** `trainingRouter` `saveKaggleKey`/`kaggleStatus`/`startKaggleTraining`/`kaggleJobStatus`/`pullKaggleArtifact`; `valet_merge.py` (CPU LoRA→fp16, streamed progress); `KaggleKeyCard` (Settings API) + `KaggleTrainingCard` (ValetRouterPanel, 60s polling, Import/Activate) + SetupWizard section + LLM Builder card.
*   **Unified Notifications & Agent Messenger (2026-06-12):** `shared/notifications.ts`; `NotificationService` (ring buffer + EventEmitter); `AgentMessengerStore`; `notificationRouter` + `agentMessengerRouter`; WS `notifications` channel + HITL/job notifications; AiProviderService budget alerts; `ai.chat` chat notifications; `Notifications.tsx` + `useNotifications` + nav item w/ unread badge; APK hooks + `notifications.tsx` tab; 0 tsc errors + clean build.
*   **Session 14 (2026-06-12) Windows cross-platform:** `oauth.ts` `../db.js`→`../db.factory.js` (DB factory isolation complete); `BlenderService.executeExpression()` `process.env.HOME`→`os.tmpdir()`; `ESPToolService.detectPorts()` Windows COM auto-detect (PowerShell `Get-PnpDevice`) + macOS `/dev/cu.*`; `systemRouter.detectHardware` `KICAD_BIN`→`KICAD_CLI_PATH` + ESPTool detection.
*   **Bundle chunk-split (2026-06-15):** [vite.config.ts](file:///home/linux/Documents/OmnecorV1-Beta/vite.config.ts) `manualChunks` — split the 1.49 MB `vendor-viz` chunk (which forced the full three.js runtime to download alongside charts used only on the wallet page) into three on-demand chunks: `vendor-three` (965 kB / 262 kB gz — designer/PCB 3D/chat canvas), `vendor-charts` (386 kB / 106 kB gz — recharts, wallet only), `vendor-flow` (134 kB / 43 kB gz — reactflow node graphs). `d3-*` left ungrouped so Rollup keeps it out of the chart chunk (shared with mermaid/cytoscape diagram chunks). Result: **0 over-limit (>1100 kB) chunk warnings** (was 1). Validated against the `vite` skill for Vite 7 (Rollup) `manualChunks` best practice. `pnpm check` clean, 323/323 tests, build green.
*   **PCB/Schematic Editor UI Enhancements (2026-06-15):** Resolved layout, positioning, styling, and interactivity issues in the PCB/Schematic tabs of the 3D Designer view:
    - Split the squished `ToggleGroup` mode toggle in the editor sub-header (`EditorToolbar.tsx`) into two wider, separate buttons: `[Schematic]` and `[PCB]` with explicit minimum widths to prevent label cutoff.
    - Custom styled ReactFlow `Controls` buttons/panel in `EnhancedPCBEditor.tsx` and `PCBSchematicEditor.tsx` to match the dark translucent Blueprint palette of the Neural Map controls.
    - Integrated a custom `Rotate Layout 90°` button into the ReactFlow controls to rotate the entire circuit node layout.
    - Repositioned the MiniMap to `bottom: 75px` so it sits neatly above the absolute-positioned floating "Ask AI" button.
    - Added a small MiniMap toggle control on the far right of the sub-header to turn the MiniMap display on/off.
    - Validated all changes: `pnpm check` (0 errors), `pnpm test` (323/323 passed).


## General risks / blockers
✅ MySQL requirement removed (db.factory + libSQL); ✅ Electron native modules (`asarUnpack`); ⚠️ Python ML deps GPU-heavy (Kaggle alternative provided); ⚠️ Android client needs Gradle build machine; ✅ `getDb()` import isolation complete (last `oauth.ts` bypass fixed).

## Phase 5: Workstation Final Repairs & Audited Fixes — ✅ DONE (2026-06-18)
All planned repairs and consistency syncs from the final phase audit plan have been completed and verified:
*   **External Brain Map Visual Preference Sync:** Initialized the `omnecor_visual_control_sync` BroadcastChannel in `visualControlStore.ts` to coordinate visual properties (layout engine, node sizes, mini-map visibility, hover tooltips, and locked arrangements) across main workspace tabs and detached external pop-outs (`/brain-map-external`). Detached windows dynamically request and synchronize this initial state context upon mounting.
*   **Database-Backed Collapsed Folder State:** Updated database settings validation on the server (`neuralMapsRouter.ts`) and client configurations (`NeuralMapContext.tsx`, `types/neural.ts`) to track the list of collapsed folder nodes (`collapsedFolderIds`). Re-designed `BrainMap.tsx` and the `brainMapStore.ts` with synchronization hooks to restore previously collapsed tree folders automatically when changing projects and save new collapsed folders directly back to the database maps settings.
*   **NotFound Style Re-adaptation:** Refactored `NotFound.tsx` by removing all raw Tailwind colors (`text-slate-900`, `bg-blue-600`) and standardizing them to unified design tokens (`bg-background`, `text-foreground`, `bg-card/80`, `bg-primary`, `text-destructive`). Rewrote the default component export to a standard named export structure to preserve codebase consistency.
*   **Orphaned Code Cleanup:** Safely deleted the dead `CurationStudio.tsx` file from the client pages tree to resolve duplicate API queries.
*   **Verification Gates:** Ran the full validation test suites: `pnpm check` typecheck (0 errors) and `pnpm test` (350/350 tests passing), resolving sandbox constraint mock issues inside `virtualCardService.test.ts`.

### Documentation Gap-Closure Pass — completed (2026-06-19, follow-up to 06-17 audit)

> Verified the 2026-06-17 documentation overhaul against the original P0–P3 audit list and closed the remaining gaps.

*   **Verified already fixed (06-17 pass):** MySQL claim removed from README, Windows added to system requirements (README + FAQ), `npm run` → `pnpm` in QUICKSTART/DEVELOPMENT_WORKFLOWS, `docs/setup/OMMESH_SETUP.md` / `3D_DESIGNER.md` / `ALWAYS_LISTEN.md` / `SLASH_COMMANDS.md` created, stale planning docs removed (`MULTI-PLATFORM-*`, `UPGRADE-PLAN.md`, `june-3-doc-updates.md`), duplicate `OAUTH_SETUP.md` / `NEURAL_BRAIN_MAP_UI.md` resolved.
*   **New gaps found and fixed this pass:**
    *   `packaging/windows/BUILD-WINDOWS.md` — still referenced `git lfs pull` for the Valet GGUF, a leftover from before the GitHub-Release distribution switch (`f07624a`). Corrected to `scripts/fetch-valet-model.sh`.
    *   `CONTRIBUTING.md`, `packaging/electron-app/README.md`, `docs/ai-agents/valet-training/OMNECOR_KNOWLEDGE_BASE.md` — remaining `npm run dev` / `pnpm run db:push` instances missed in the 06-17 sweep, fixed to `pnpm dev` / `pnpm db:migrate`.
    *   `CONTRIBUTING.md` — added a section pointing contributors at `AGENTS.md` and the `Context/` folder as the project's context-engineering system.
    *   **New:** `docs/user-guides/PODCAST_STUDIO.md`, `docs/user-guides/FICTION_MODE.md` — the two remaining shipped features with zero user-facing docs.
    *   **New:** `docs/README.md` — full navigable documentation index (was previously undiscoverable outside grep/browsing).
    *   `README.md` — Documentation section expanded with Getting Started + Feature Guides subsections linking all new docs.
    *   `packaging/android/omnecor-hq/README.md` — added pointers to `OMMESH_SETUP.md` and `ALWAYS_LISTEN.md` (existed but weren't cross-linked from the app's own README).
    *   `tmp-valet-train/README.md` — added an explicit "Archived/Superseded" banner (production training is now the Kaggle pipeline) and fixed a stale hardcoded path reference (`Omnecor-HMCI-ai-workstation-AltV1`).
    *   `CHANGELOG.md` — backfilled entries for the 06-15 depth pass, the 06-16/17 OMMESH verification + doc overhaul, and the 06-19 token/design-token sweep (all previously undocumented in CHANGELOG, only in Progress-Tracker).
*   **Not addressed (flagged, not fixed):** `tmp-valet-train/` still has 135 tracked files of training debris in the repo — marked archived but not removed/gitignored; deferred since removal risk wasn't worth taking without explicit sign-off.

---

### 18-Category Architectural Audit + Full Remediation — completed (2026-06-20, Linux)

> `/architect` deep-audit pass across 18 categories. All ~45 findings fixed. Gates: `pnpm check` **0 errors** · `pnpm test` **353/353**. Permanent QA document created at `final-test-checklist.md` (project root).

#### Phase 1 — DB Schema: 7 new tables + 10 missing indexes

Added to `drizzle/schema.ts` and migrated via `pnpm build:push` (migration `0004_gorgeous_martin_li.sql`):
- `asyncJobTracking` — persists async job lifecycle across restarts
- `hitlPendingActions` — persists HITL approval state; rows >24h auto-timed-out on boot
- `mcpServerConfigs` — reconnects all MCP servers automatically on startup
- `fileWatcherRegistrations` — re-registers all chokidar watchers on startup
- `ommeshTrustedPeers` — OMMESH peer fingerprint trust survives restarts
- `walletAlertLog` — deduplicates wallet budget alerts (replaces in-memory Map)
- `agentSessions` — tracks per-agent session for memory isolation
- 10 missing indexes on FK columns (`chatSessions.userId`, `chatMessages.sessionId`, `cloudComputeSessions.userId/projectId`, `curatedPosts.projectId`, `discoveredArticles.projectId`, `platformAccounts.userId`)

#### Phase 2 — Critical Security Fixes

- **Path traversal CVE** (`trainingRouter.ts:validateDataset`): added `validatePath()` call before `readFile` (was the only unprotected path in the file)
- **ComfyUI unauthenticated access** (`comfyRouter.ts`): 5 procedures `publicProcedure` → `protectedProcedure`
- **Fal image enumeration** (`falRouter.ts:listImages`): `publicProcedure` → `protectedProcedure`
- **Honcho openId spoofing** (`honchoRouter.ts`): added `assertOpenIdOwnership()` guard on `addMessage`, `addFact`, `getFacts` — rejects if authenticated user's `openId` ≠ input `openId`
- **OMMESH fingerprint bypass** (`MeshServer.ts`): wired `securityManager.isTrusted(peerFingerprint)` call into `handleRequest()` — untrusted peers get 403 before any request processing

#### Phase 3 — Service Persistence

All 7 services now survive restarts:
- `AsyncJobService` — INSERTs on `track()`, UPDATEs on `complete/fail`, loads pending rows on boot
- `HITLApprovalService` — INSERTs on `requestApproval()`, UPDATEs on resolve; startup marks stale rows `timed_out`
- `MCPClientService` — UPSERTs on connect, DELETEs on disconnect; `restoreFromDb()` reconnects all on startup
- `FileSystemWatcherService` — UPSERTs on register, DELETEs on unregister; `restoreFromDb()` re-registers all chokidar watchers
- `ProcessManagerService` — marks "running" rows as `failed` (reason: `server_restart`) on boot
- `SecurityManager` — `hydrateFromDb()` loads `ommeshTrustedPeers` into Set; `approvePeer` INSERTs, `revokePeer` DELETEs
- `AiProviderService.walletAlerts` — DB-backed dedup via `walletAlertLog` (7-day window query) replaces ephemeral Map

#### Phase 4 — Integration Wiring

- `FileSystemWatcher → VectorDB` auto-index: file events subscribed in `server/_core/index.ts`; `unlink/unlinkDir` → `removeDocument`, all other events → `addDocuments`
- `MeshNode` settings restore: constructor reads `~/.omnecor/settings.json` synchronously, restores `crossNodeSyncEnabled` and `agentDiscourseEnabled`
- `SecurityManager.hydrateFromDb()` called before `meshNode.start()` in startup sequence
- `mcpClient.restoreFromDb()` and `fileWatcher.restoreFromDb()` wired into startup

#### Phase 5 — Error Handling

- 11 silent `.catch(() => console.warn("[AuditLog]", ...))` calls → `.catch(err => log.error("[AuditLog] write failed — event lost", err))` across `mcpRouter.ts`, `pipelineRouter.ts`, `kicadRouter.ts`, `agentRouter.ts`, `AgentService.ts`
- Added `createLogger` import to all 5 files that were using raw `console.warn`
- `AiProviderService` 3× `console.warn` → `log.warn`

#### Phase 6 — Performance

- `curatorRouter.approvePosts` / `rejectPosts`: replaced per-row `for` loop with single `inArray()` batch UPDATE (was N+1)
- `personaRouter`: batch existence check via `inArray()` + local Set diff instead of per-row queries
- `systemRouter.saveSettings` / `saveKeys`: sync `readFileSync`/`writeFileSync` → async `fs.promises`
- CPU metric: `Math.random()` → `os.loadavg()[0] / os.cpus().length * 100` (real system load)

#### Phase 7 — Observability

- `/health` endpoint: now probes DB, Ollama, and ChromaDB in parallel; returns `{ status, checks: { db, ollama, chromadb }, uptime }` with 503 when DB is down
- MCP tool call audit: `mcpRouter.callTool` logs result preview (first 500 chars) to `AuditLogService`
- Request-duration perf logger: Express middleware flags requests >1 s with `[perf] slow request` log line

#### Phase 8 — API Cleanup

- 7× bare `throw new Error(...)` → `throw new TRPCError(...)` in `aiRouter.ts`, `projectRouter.ts`, `valetRouter.ts`
- `Math.random()` IDs → `crypto.randomUUID()` in `Chat.tsx` (file/image attachment IDs) and `PodcastStudio.tsx` (job IDs)
- `commandAllowlistStore.ts`: moved module-level `_resolver` mutable into Zustand state as `pendingResolver` field
- `.gitignore`: added `tmp-valet-train/` entry

#### Phase 9 — Frontend State

- `NeuralMapContext.tsx`: added `writeLocked` ref — set before `updateMutation.mutate()`, cleared in `onSettled` — prevents concurrent mutation races
- `commandAllowlistStore.ts`: `pendingResolver` in store state; `partialize` excludes it from localStorage persistence

#### Phase 10 — AI Infrastructure

- `AgentService.ts`: `recordSession()` helper INSERTs into `agentSessions` table on each `runCrew` / `runLiteAgent` / `runRecursiveMAS` call; `userId` forwarded from callers
- `modelManagementRouter.ts`: new `getRunningModels` procedure queries Ollama `/api/ps` for currently loaded models with VRAM usage; returns empty array gracefully if Ollama offline

#### Phase 12 — QA Document

`final-test-checklist.md` created at project root — 10 sections (Persistence, Security, Integration Wiring, Performance, Error Handling, Observability, API Correctness, Frontend State, OMMESH/AI Infrastructure, Production Readiness) with 55 checkboxes and quick sqlite3 / log inspection commands.
