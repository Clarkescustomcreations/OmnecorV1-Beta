# Technical Debt Register

*A centralized log of all known TODOs, FIXMEs, architectural compromises, and temporary workarounds across the Omnecor codebase. Entries are sourced from code-sweep audits, session notes, AGENTS.md, and Build-Plan appendices. Risk levels: Low / Medium / High / Critical. Last audited: 2026-07-10 (doc-reconciliation pass — **TD-054 resolved**: agentic + Mesh-Delegation UI now fully imprinted in UI-Registry Sessions 29–33). Prior 2026-07-08 (Chats-Agentic-Upgrade Phases 1–6, Model-Fabric Phases 0–7, Mesh-Delegation Phases 1–9 — TD-054–058 added; TD-053 partially resolved — `<think>` collapse now handled on web via the new `ThinkingSection` collapsible block; APK SAF size issue remains open).*

> **Path note (2026-07-12):** `server/phase2/` was renamed wholesale to `server/core_services/`. Any older entry below that references `server/phase2/services/…` or `server/phase2/websocket/…` now lives under `server/core_services/services/…` / `server/core_services/websocket/…` (filenames unchanged). Original paths are left in place to preserve the historical record — resolve them to `core_services/` when navigating.

---

## Debt Registry

### TD-001: Valet Router Electron Packaging Gap (BLOCKER)
- **File**: `packaging/electron-app/electron-builder.yml`
- **Reason**: `extraResources` ships only `dist/index.js` + assets. Does NOT bundle `server/python_bridges/valet_router_inference.py`, `docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md`, or `routing_manifest.json`. Without these, the Valet inference server cannot spawn in a packaged Electron installer. Also requires a Python runtime + `fastapi`, `uvicorn`, and optionally `llama-cpp-python` to be available in the packaged app environment.
- **Risk**: High → Medium (no longer crashes / dead-on-arrival; degrades cleanly)
- **Status**: **Substantially resolved (2026-06-23, code-sweep); packaged-installer test still pending on a build box.** The `.py` bridge + training docs (real manifest is `n.json`, not `routing_manifest.json`) are already bundled (`electron-builder.yml` L83-88). Remaining work split into what's buildable now vs. build-box-only:
  - **Graceful degradation (DONE, verified):** `ValetServerService` now runs a **runtime preflight** before spawning — resolves a venv-aware Python (`_resolvePythonBin`: prefers `~/.omnecor/valet-venv`, then `ml-venv`, else `PYTHON_BIN`/system) and checks `import fastapi, uvicorn, pydantic` (the only hard deps — `llama_cpp`/`transformers` are lazily imported & optional per the bridge; an Ollama backend needs none). On a fresh machine with no Python/deps it logs ONE actionable line and stays in rule-based keyword routing **instead of thrashing spawn→ENOENT→crash→backoff 5×/~30 s**. Distinguishes "Python missing" (ENOENT) from "deps missing". Verified: ENOENT→PYTHON_MISSING, valid+deps→READY; `tsc` 0.
  - **Provisioning (DONE):** new `packaging/scripts/setup-valet-python.{sh,ps1}` create an isolated `~/.omnecor/valet-venv` with the compiler-free base deps (fastapi/uvicorn/pydantic) and a **best-effort** optional GGUF backend (`llama-cpp-python` — non-fatal if no toolchain). `pnpm valet:setup-python` alias added; scripts auto-bundle via the existing `packaging/scripts → resources/scripts` rule. The venv is auto-detected at next launch (no env vars). Design choice: provision **on demand**, not at install — auto-compiling `llama-cpp-python` during a silent install is the exact fragility to avoid; default UX is keyword fallback, user opts into local inference.
  - **Still pending (build-box only):** run the actual Windows/Linux installer on a clean machine and confirm the bundled `current.json`+GGUF register and the venv path works end-to-end (overlaps TD-005/TD-006). Optional enhancement: a Setup-Wizard "Enable local Valet inference" button that invokes the provisioning script.

### TD-002: Valet Router `current.json` Hardcoded Windows Path
- **File**: `models/valet-router/current.json`
- **Reason**: `artifact_path` is currently set to an absolute Windows path (`C:\OmnecorV1-Beta\models\valet-router\kaggle-2026-06-11\valet-router-q8_0.gguf`). This is harmless for the Ollama backend (the loader ignores it), but **must** be made relative or portable before building an end-user installer on any target machine.
- **Risk**: High
- **Status**: **RESOLVED (2026-06-23).** `current.json` now stores a **relative** `artifact_path` (`"./kaggle-2026-06-11"`); `ValetArtifactRegistry.seedFromRepoIfMissing()` resolves it relative→absolute against the model dir at first launch (`ValetArtifactRegistry.ts` L95-98). No hardcoded `C:\…` path remains. (The 2026-06-23 ruthless review report still cited the old Windows path — that report was stale on this point.)

### TD-003: `OMMESH_SECRET` Not Set in Default `.env`
- **File**: `.env` / `packaging/android/omnecor-hq/.env`
- **Reason**: `OMMESH_SECRET` is not pre-configured in the default `.env`. Mobile nodes connecting to the PC are accepted with a security warning (`"OMMESH_SECRET not set — accepting with warning"`) — this is an intentional fail-open for developer convenience but represents a real security gap in any deployment where the mobile node is not trusted automatically.
- **Risk**: Medium
- **Status**: Open — developer must manually set `OMMESH_SECRET=<value>` in `.env` before production or any physical LAN deployment.

### TD-004: Linux System Clock NTP Drift (VIS Node)
- **File**: N/A — system-level issue
- **Reason**: The Linux development machine (`omnecor-lin-vis`, `192.168.1.252`) clock was found to be ~61 minutes fast (NTP disabled). This caused mTLS cert validation failures because certificate timestamps appeared to be in the future. The OMMESH 5-minute `verifyMessage` replay window is also affected.
- **Risk**: Medium
- **Status**: Open — fix: `sudo timedatectl set-ntp true`. Must be done before next OMMESH 3-way test with Android node.

### TD-005: Windows Installer — Not Run on Clean Machine
- **File**: `packaging/electron-app/dist/Omnecor-Setup-2.3.0-beta.1.exe`
- **Reason**: The Windows installer was built (1.69 GB NSIS) and smoke tests are static-analysis-only (338/338 passing). No one has yet run the installer on a clean Windows machine to confirm the app launches, the backend spawns, and the SQLite round-trip succeeds.
- **Risk**: High
- **Status**: Open — pending physical Windows machine test. See F27 remaining checklist in Progress-Tracker.

### TD-006: Android APK Physical Device Test Not Completed
- **File**: `packaging/android/omnecor-hq/android/app/build/outputs/apk/release/app-release.apk`
- **Reason**: The release APK (118 MB, JS-bundled, debug-signed) has been built and verified at the build level. On-device sideload testing, Vulkan/NNAPI on-device LLM inference verification, and 3rd-party GGUF download/load testing on a physical Samsung Galaxy S25 Ultra (Snapdragon 8 Elite) are all pending.
- **Risk**: High → **Low**
- **Status**: **Substantially resolved (2026-07-04, live on the physical S25 Ultra over adb).** The whole on-device stack was driven end-to-end and hardened:
  - **GGUF (llama.rn):** download → completeness-validate → load → chat verified (Llama-3.2-3B answered a prompt, PC offline). Fixed the real "Load failed" root causes — `use_mlock`+full-GPU-offload of a 4.7 GB model, and a **truncated download masquerading as "✓ Downloaded"** (existence-only check) → now `getModelFileState` size-validates and shows "⚠ Incomplete — re-download". Loader uses mmap (no mlock) + GPU→CPU fallback + `n_ctx` 2048.
  - **LiteRT-LM (`.litertlm`):** DeepSeek-R1-1.5B **and Gemma-4-E4B** both loaded + answered on-device (PC offline). Fixed a hard-crash: loading crashed the whole APK (Hermes SIGSEGV) via our `npu→gpu→cpu` close-and-recreate loop → now one engine / one load, CPU default, opt-in GPU/NPU toggle. **Gemma-4 verified on the GPU backend, no crash.**
  - **Model acquisition:** built a `.litertlm` download catalog (ungated litert-community), SAF **folder-scan** (grant a sub-folder → list + load; Android blocks `Android/data/` and Downloads/root grants), single-file import, and a chat **"📱 Phone (on-device)" provider** so any on-device GGUF/`.litertlm` is selectable and runs without a PC.
  - **Still pending:** broad GPU/NPU stability across *all* models (only Gemma-4 GPU + CPU paths proven — see TD-051); true NPU via AICore/Gemini Nano (TD-052). Vulkan/NNAPI-specific delegate confirmation is moot — llama.rn uses Adreno OpenCL + Hexagon HTP libs, LiteRT uses its own GPU/CPU delegates.

### TD-051: LiteRT-LM GPU/NPU Backend Not Validated Across All Models
- **File**: `packaging/android/omnecor-hq/lib/_core/mediapipe-inference.ts`, `lib/_core/litert-prefs.ts`
- **Reason**: The compute-backend toggle (CPU/GPU/NPU) is wired and persists, and **CPU is the stable default**. GPU verified working for **Gemma-4-E4B only**; NPU never exercised; the smaller `.litertlm` (DeepSeek/Qwen 1.5B) only proven on CPU. GPU/NPU on this Nitro native module is where the historical Hermes crash lived, so it stays opt-in with an in-UI "switch back to CPU if it crashes" note.
- **Risk**: Low
- **Status**: Open — validate GPU + NPU across the catalog + Gallery models on the physical device; if any model reliably crashes on a delegate, gate it per-model.

### TD-052: True On-Device NPU (AICore / Gemini Nano) Not Integrated
- **File**: (new) — would be a native module alongside `react-native-litert-lm`
- **Reason**: The Gemma `.litertlm` files run **GPU/CPU** per Gallery's `model_allowlist.json`, not the Hexagon NPU. The genuine NPU path on the S25 Ultra is **Android AICore / Gemini Nano** (`com.google.android.aicore`, ML Kit GenAI APIs) — a system-managed model, not a file. Per-SoC NPU `.litertlm` builds (`..._sm8750.litertlm`, ~689 MB) exist but their `dl.google.com` URLs 404 without Gallery's request signing, so they can't be downloaded directly.
- **Risk**: Low (CPU/GPU already deliver usable on-device inference)
- **Status**: Open (Enhancement) — integrate the AICore/ML-Kit GenAI SDK for a true NPU on-device path if the perf/battery win is wanted.

### TD-053: SAF Content-URI File Size Unreliable + DeepSeek `<think>` Tags Render Raw
- **File**: `packaging/android/omnecor-hq/lib/_core/model-download.ts` (`scanFolderForTaskModels`), `app/(tabs)/index.tsx`
- **Reason**: Two cosmetic issues seen during 2026-07-04 verification. (1) `getInfoAsync` on a SAF `content://` URI returns a wrong/absent size (folder-scan showed gemma-3n as "0.62 GB" for a 4.92 GB file); size is best-effort and hidden when 0, but the wrong value is misleading. (2) Reasoning models (DeepSeek-R1) emit `<think>…</think>` chain-of-thought that renders raw in the chat bubble — a collapse/hide would be cleaner.
- **Risk**: Low (cosmetic)
- **Status**: **Partially resolved (2026-07-07, Chats-Agentic-Upgrade).** Issue (2) — `<think>…</think>` rendering raw — is resolved on **web** by the new `ThinkingSection` collapsible block in `AgenticBlocks.tsx` (default-closed, collapse/hide UX is shipped). APK agentic stream renders the same block natively via `agentic-blocks.tsx` `ThinkingSection`. Issue (1) — SAF content-URI file size unreliable — remains open on APK: `getInfoAsync` on a `content://` URI returns a wrong/absent size (folder-scan shows gemma-3n as "0.62 GB" for a 4.92 GB file). Remaining work: read SAF sizes via a `DocumentFile`/columns query on the APK side.

### TD-007: Always-Listen Wake-Word `.ppn` Not Trained
- **File**: `packaging/android/omnecor-hq/lib/_core/always-listen.ts`
- **Reason**: The Always-Listen foreground service is built, type-checked, and APK build-verified. However, the custom "Hey Omnecor" Porcupine `.ppn` wake-word file has not been trained via the Picovoice console. The system currently falls back to the built-in `COMPUTER` keyword. The fallback works but responds to "computer" not "Hey Omnecor."
- **Risk**: Low
- **Status**: Open — low priority until on-device verification (F27). Train `.ppn` → bundle + `setKeywordPath`.

### TD-008: Mobile Tl;DR on-Device Verification Loop — F23b Background Listen
- **File**: `packaging/android/omnecor-hq/modules/mic-foreground-service/`
- **Reason**: The native Kotlin `MicForegroundService` was built and verified via `./gradlew :app:assembleDebug` (BUILD SUCCESSFUL). However, the end-to-end test (wake-word fires with app **backgrounded/closed**) requires a physical Android device — not verifiable in CI or emulator.
- **Risk**: Medium
- **Status**: Open — pending F27 on-device verification.

### TD-009: `tmp-valet-train/` Training Debris in Repo
- **File**: `tmp-valet-train/` (135 tracked files)
- **Reason**: `tmp-valet-train/` contains 135 tracked files of Valet Router training debris (archived/superseded by the Kaggle pipeline). An "Archived/Superseded" banner was added to `tmp-valet-train/README.md` (2026-06-19) but the files were not removed/gitignored due to removal risk without explicit sign-off.
- **Risk**: Low
- **Status**: Open — deferred. Decision required before next major version tag.

### TD-010: Valet Router Route Accuracy Below 0.85 Gate
- **File**: `models/valet-router/`, `server/python_bridges/valet_router_inference.py`
- **Reason**: The Valet Router V2 achieved 0.7385 route accuracy on Kaggle P100 eval (390 examples, beats keyword baseline ~2.7×). The configured accuracy gate is 0.85 before full production sign-off. The 0.85 gate was not met in the Kaggle run; the model is deployed but advisory-only.
- **Risk**: Medium
- **Status**: Open — requires another training run from a clean GPU box with full compute. `pnpm valet:build` sign-off still pending. Current model (`omnecor-valet-router:v2-q8`) is live on `192.168.1.78:11434` only.

### TD-011: `dangerouslySetInnerHTML` in PCB Schema Nodes
- **File**: `client/src/components/pcb/SchematicNode.tsx`, `client/src/components/pcb/PCBNode.tsx`, `client/src/components/pcb/ComponentLibraryPanel.tsx`
- **Reason**: These components inject SVG content via `dangerouslySetInnerHTML`. `SchematicNode.tsx` and `ComponentLibraryPanel.tsx` already wrapped the SVG in `DOMPurify.sanitize()`; **`PCBNode.tsx` did NOT** — it injected `component.footprintSvg` raw. Component SVG can originate from imported/3rd-party footprint libraries, so this was a real stored-XSS sink, not merely static content. The `ui/chart.tsx` instance is the standard shadcn CSS-var pattern, and `EnhancedPCBEditor.tsx` L532 is a static `<style>` template literal — both safe.
- **Risk**: Medium → was High for the `PCBNode.tsx` gap
- **Status**: **RESOLVED (2026-06-23, code-sweep).** `PCBNode.tsx` now imports `dompurify` and wraps `footprintSvg` in `DOMPurify.sanitize()`, matching its sibling. All SVG injection sinks are now sanitized or proven-static. `tsc` 0 errors.

### TD-012: Server `: any` Type Annotations (Behind Validated Boundaries)
- **File**: Multiple — `server/` codebase (untyped third-party libs: `bonjour`, ChromaClient; dynamic WS event payloads; `db: any` context field)
- **Reason**: All `as any` casts were eliminated (0 in `server/` after the beta sweep). However, `: any` **type annotations** remain intentionally behind validated boundaries where third-party libraries don't provide types (`bonjour`, ChromaClient) or where dynamic payloads are validated at runtime (WS event payloads). These are architectural decisions, not regressions.
- **Risk**: Low
- **Status**: Accepted — not sweep-fixable without significant effort or library type updates. Documented here for awareness.

### TD-013: `MapManager.tsx` "Cloud Indexing Coming Soon" Placeholder
- **File**: `client/src/components/neural/MapManager.tsx`, `server/routers/integrationsRouter.ts`, `client/src/pages/BrainMap.tsx`
- **Reason**: Neural Maps remote sources (`github://`, `integration://`) were decorative-label shells — stored + drawn as a single dot, never ingested. `settings.indexingEnabled` was stored-but-unconsumed.
- **Risk**: Low
- **Status**: **RESOLVED (2026-06-23).** Session 23 (2026-06-20) made the trees real (`integrations.fetchSourceTree` → recursive github tree + `integration://` listings, rendered via `fileTreeToNetwork`, gated by `indexingEnabled`; **GitHub live-verified**, 1500-node tree). The two follow-ons are now also done: (a) **content → VectorDB + chat RAG (2026-06-23)** and (b) **dropbox/onedrive adapters (2026-06-22)**. `indexingEnabled` is now consumed for real (the write-gate). See TD-038 (resolved) and the Progress-Tracker "Map RAG over Remote Sources" entry. Only live end-to-end runtime proof remains (needs ChromaDB + tokens).

### TD-014: `template-brand "Manus"` Leftover Comments in Server Core
- **File**: `server/_core/notification.ts`, `server/_core/map.ts`, `server/_core/sdk.ts`, `server/_core/storage.ts`
- **Reason**: These active (non-dead-code) files still contain "Manus" brand references in comments and default strings — leftover from the original template fork. `ManusDialog.tsx` was fully deleted (zero importers), but these server-side files were left because renaming comments in active files was deemed cosmetic risk. Not functional debt.
- **Risk**: Low
- **Status**: Open — cosmetic only; safe to rename in any future polish pass.

### TD-015: `AppRouter` Type Not Imported in Mobile APK
- **File**: `packaging/android/omnecor-hq/` tRPC client configuration
- **Reason**: The mobile APK does not import the PC's `AppRouter` type for full end-to-end tRPC type safety. tRPC calls from the APK are typed against a local stub or `any`. Full type safety requires importing `AppRouter` from the desktop workspace (cross-workspace type import).
- **Risk**: Medium
- **Status**: Open — deferred to "important" tier in APK remaining work. Requires pnpm workspace type-sharing setup.

### TD-016: Mobile `llm.ts` `fetchWithBackoff` Not Grafted into Server
- **File**: `packaging/android/omnecor-hq/lib/_core/llm.ts` (mobile-specific)
- **Reason**: The mobile APK has a `fetchWithBackoff` retry helper in `llm.ts` that provides resilient LLM request retry logic. This was not grafted into the main server's `server/_core/llm.ts`. The server LLM calls do not have equivalent retry/backoff logic.
- **Risk**: Low
- **Status**: Deferred — noted in APK deferred tasks. Low impact on server stability given existing error handling.

### TD-017: Dedup / Remove Dead Scaffolding in Mobile Workspace
- **File**: `packaging/android/omnecor-hq/server/`, `packaging/android/omnecor-hq/drizzle/`, `packaging/android/omnecor-hq/shared/`
- **Reason**: The mobile workspace contains dead `server/`, `drizzle/`, and `shared/` scaffolding directories inherited from the template fork (older Omnecor fork). Only the `AppRouter` type is imported from this stale tree. These files are never executed.
- **Risk**: Low
- **Status**: Deferred — safe to delete once `AppRouter` import is properly resolved via workspace type-sharing (TD-015).

### TD-018: OMMESH VRAM-Weighted Routing Not Implemented (Partially Resolved)
- **File**: `server/ommesh/core/MeshNode.ts`
- **Reason**: The original template debt was "temporary fallback routing implemented instead of dynamic mesh discovery." Dynamic discovery via mDNS (`MeshDiscoveryService`) and real mTLS remote inference are now LIVE-VERIFIED (Linux↔Windows, 2026-06-16). **Correction (2026-06-23 code-sweep):** the prior wording "selects the first responding peer" was inaccurate. `MeshNode.routeInference()` → `RoutingEngine.decide()` **does** score every peer and pick the highest (`calculateScore` = `vramWeight*0.6 + utilizationWeight*0.4`, `RoutingEngine.ts` L18-44). The real gap is the **telemetry producer**, not the consumer: peers are constructed with `gpu: { vram: 0, utilization: 0 }` hardcoded (`SecurityManager.ts` L50, L86), so `calculateScore` short-circuits to `0.1` for every node (`if (gpu.vram === 0) return 0.1`). With all scores tied, the weighting is **inert** — local/first-evaluated node always wins. So it behaves first-available in practice, but the missing piece is a VRAM/utilization telemetry feed, not the scoring math.
- **Risk**: Medium
- **Status**: **RESOLVED (2026-06-23, code-sweep).** Built the missing telemetry producer end-to-end:
  - New `server/ommesh/core/HostTelemetry.ts` — `collectGpuTelemetry()` (NVIDIA via `nvidia-smi`, AMD via `rocm-smi`, both `execFile`/no-shell) reports **free** VRAM headroom (MB) + utilization% + temp; `collectHostTelemetry()` adds CPU cores + free RAM. All-zero when no GPU.
  - `MeshNode` now **primes telemetry before the first mDNS beacon** (so the node's first advertisement carries real figures) and runs a **30 s refresh** that re-advertises only on a *material* change (>512 MB VRAM or >15% util delta) — fresh routing data without mDNS flapping.
  - `DiscoveryService`: extracted `publishBeacon()` + added `refreshAdvertisement()` (stops then re-publishes the service only, leaving the peer browser intact); retyped `PeerInfo.capabilities` `any[]` → `NodeCapabilities` (matches the client `PeerCard`/`ommesh.router` contract) with a hardened parse fallback; `broadcastFingerprintUpdate` now reuses `refreshAdvertisement` (fixes a pre-existing duplicate-browser-listener bug).
  - `RoutingEngine`: removed all `: any` (Code-Standards §1.1) and **fixed a latent routing bug** — `decide()` returned `best?.id`, but `PeerInfo` has no `id` (it's `name`), so a winning *peer* yielded `targetNodeId: undefined` → fell back to local → **no remote peer was ever selectable even with perfect telemetry.** Now tracks `targetNodeId` by `peer.name` (= remote node id).
  - Gates: `tsc` 0 errors · OMMESH tests 11/11 pass. **Live multi-node proof still pending** (needs ≥2 GPU nodes on a LAN); single-node telemetry collection + advertisement verified by typecheck/tests. (Optional future refinement: pull peer telemetry live over the mTLS channel at decision time instead of via mDNS TXT — marginal freshness gain, deferred.)

### TD-019: `publicProcedure` Intentional Exceptions — Security Decision on Record
- **File**: `server/_core/systemRouter.ts`, `server/routers/honchoRouter.ts`
- **Reason**: `systemRouter.getSettings` / `saveSettings` are `publicProcedure` intentionally — required for the Setup Wizard pre-login. `honchoRouter` is `publicProcedure` by design for zero-login mode. All `*.status` / `getProviders` / health probes are read-only public. These are **intentional security decisions** documented in the 10-domain sweep, not vulnerabilities.
- **Risk**: Low
- **Status**: Accepted — documented here so any future security review knows these are not oversights.

### TD-020: OAuth Live-Test Against Real Platform APIs Not Done
- **File**: `server/routers/oauthRouter.ts`, `server/routers/schedulingRouter.ts`, `server/oauth/oauthClients.ts`
- **Reason**: The social publishing OAuth flow (X/Twitter, LinkedIn, Instagram, Facebook, YouTube) is fully implemented end-to-end (RSS discovery → curation → schedule → publish). However, it has **not been live-tested against real platform APIs** — only code-level verification was performed. Platform API behavior, rate limits, and token expiry paths are untested in production.
- **Risk**: High → Medium (resilience gaps closed; only live-cred verification remains)
- **Status**: Open for **live-cred test only** — blocked on operator registering OAuth apps + entering credentials + callback URIs per platform. **Pipeline mechanics PROVEN LIVE (2026-06-20, Session 23):** with a dummy-token account, `createDirectPost` → `publishNow` ran the full executor (token lookup → curated⨝scheduled join → `PublishingService` dispatch → real `api.twitter.com/2/tweets` call → genuine 403 → `failed` status + real errorMessage persisted). `listAccounts` correctly does not expose raw tokens.
  - **Resilience hardening (DONE, 2026-06-23 code-sweep):** the report claimed "rate limits AND token-refresh entirely unhandled" — token refresh was **already** handled (`PublishingService.withAuth` refreshes once on 401 and the executor persists the new token + `tokenExpiresAt`). The genuine gap was **rate limits**: a 429 was marked permanently `failed`. Now `ensureOk` throws a typed `RateLimitError` on HTTP 429 (and Meta Graph rate-limit codes 4/17/32/613, which Graph returns as 400), with `parseRetryAfter` honoring `Retry-After` (delta-secs or HTTP-date) then Twitter's `x-rate-limit-reset`, clamped to [30 s, 6 h]. `publishExecutor` catches it and **reschedules** the post (`status:"scheduled"`, `scheduledAt = now+retryAfter`) so the due-time worker auto-retries after the window — instead of burning the post. True quota/permission errors stay 4xx → `failed`. `schedulingRouter.publishNow`/`retryPost` now report a `rescheduled`/`rescheduledCount` distinct from `failed`. Gates: `tsc` 0 · full suite 371/371.
  - **Minor known limitation (documented):** LinkedIn `/me` and Facebook `/me/accounts` *resolve* calls don't pass through `withAuth`, so an expired token on those two surfaces as a 401 error rather than auto-refreshing (the primary post calls do refresh). Low impact; threading `withAuth` through the resolves is a future refinement. Proactive pre-expiry refresh (using the persisted `tokenExpiresAt`) is also a possible enhancement over the current reactive-on-401 refresh.

### TD-021: Electron Toolchain Upgrade Deferred
- **File**: `packaging/electron-app/package.json`
- **Reason**: `electron-app` is on Vite 5 / Electron 39. The beta sweep flagged a recommended upgrade to Vite 7 / Electron 39+ security patch. This requires a build machine (native modules must be rebuilt). Deferred as a post-V1 task.
- **Risk**: Low (current versions have no known critical CVEs after 0 audit)
- **Status**: Deferred — planned for V2 toolchain update pass.

### TD-022: Valet Router Kaggle Training Pipeline Docs Still Reference GitHub-Release
- **File**: `tmp-valet-train/README.md`, `packaging/windows/BUILD-WINDOWS.md` (partially fixed 2026-06-19)
- **Reason**: `packaging/windows/BUILD-WINDOWS.md` was corrected (2026-06-19 doc pass) to reference `scripts/fetch-valet-model.sh` instead of `git lfs pull`. However, `tmp-valet-train/README.md` still references the old GitHub-Release GGUF distribution flow (now archived/superseded). A stale hardcoded path reference was also fixed in that file.
- **Risk**: Low
- **Status**: Open (cosmetic) — `tmp-valet-train/README.md` archived banner added but doc content still references old flow. Will be resolved when TD-009 (debris cleanup) is addressed.

### TD-023: Chat Streaming Display / Session Rename / Delete / Export (Mobile)
- **File**: `packaging/android/omnecor-hq/app/(tabs)/index.tsx`
- **Reason**: Mobile APK chat streaming display improvements, session rename, delete, and export are listed as "Enhancement" tier in the APK remaining work. Currently sessions exist but management UI is minimal (dropdown picker only).
- **Risk**: Low
- **Status**: Open (Enhancement) — post-F27 backlog.

### TD-024: *(Merged into TD-018)*
- **Status**: Removed — original entry was "Temporary Fallback Routing in OMMESH." Consolidated into TD-018 (OMMESH VRAM-Weighted Routing) to eliminate the circular forward/backward reference.

### TD-025: OAuth Login Screen + Token Expiry Handling (Mobile)
- **File**: `packaging/android/omnecor-hq/app/(tabs)/settings.tsx`, `packaging/android/omnecor-hq/lib/_core/server-config.ts`
- **Reason**: The APK auth flow supports local accounts and Google/Microsoft OAuth via the desktop PC. However, an explicit OAuth login screen and automatic token-expiry handling (re-auth prompt) have not been built in the mobile app. Users currently must manually logout + reconnect on token expiry.
- **Risk**: Medium
- **Status**: Open (Enhancement) — post-F27 backlog.

### TD-026: Podcast History — No Server-Backed Persistence
- **File**: `client/src/pages/PodcastStudio.tsx`
- **Reason**: Podcast episode history is stored in `localStorage["omnecor:podcast_session"]` (session-level) and in a `localStorage`-backed episode-history dialog (play/download/remove). No server-backed table exists for episode history — episodes are lost if the browser storage is cleared or the user switches browsers.
- **Risk**: Low
- **Status**: **RESOLVED (2026-06-23, code-sweep).** Built server-backed persistence end-to-end:
  - Schema: new `podcastEpisodes` table (`drizzle/schema.ts`) — `id` (=jobId UUID PK), `userId` (FK → users, cascade), `title`, `audioUrl`, `segmentCount`, `durationSeconds`, `createdAt`; indexed by `userId`. Migration `0008_solid_mentor.sql` generated and **verified to apply cleanly** through the full chain on a throwaway DB.
  - Router (`podcastRouter`): `generate` now **persists server-authoritatively** on a successful master mix (idempotent `onConflictDoUpdate` keyed by jobId — re-gen updates, never duplicates; a persistence failure logs and does not fail generation). Added `listEpisodes` (user-scoped, newest-first, capped 100) and `deleteEpisode` (IDOR-safe — scoped by `userId`, `.returning({id})`, 404 when absent).
  - Frontend (`PodcastStudio.tsx`): history now reads from `trpc.podcast.listEpisodes`; delete uses `deleteEpisode` + invalidate; generate invalidates the list. Removed the `localStorage` history store, loader, and local `PodcastEpisode` interface (audio still served from disk via the range-capable `audioUrl`). The editable **draft session** stays in `localStorage` (legitimate client-only working state). Episodes now survive cache clears and follow the user across browsers/devices.
  - Gates: `tsc` 0 errors. Note TD-027 (`scheduledPosts` lacks `userId`) is a *separate* table and unaffected; `podcast_episodes` was built with `userId` from the start.

### TD-027: `scheduledPosts` Table Has No `userId` Column
- **File**: `drizzle/schema.ts` — `scheduledPosts` table
- **Reason**: `scheduledPosts` table has no direct `userId` column. IDOR protection in `trpc.scheduling.retryPost` was implemented by verifying `platformAccounts.userId` matches the session user (join required). This is an awkward pattern and adds query complexity for any user-scoped scheduling query.
- **Risk**: Low
- **Status**: Open — schema migration required to add `userId` column to `scheduledPosts`. Low priority given the platform-accounts join works correctly.

### TD-028: Polling Instead of WebSocket Subscription on Kaggle Training Status
- **File**: `client/src/components/model-hub/KaggleTrainingCard.tsx`
- **Reason**: Kaggle training job status uses 60-second polling (`useInterval`) rather than a WebSocket subscription. This means 0–60 s lag between job completion and UI update. Acceptable for long-running Kaggle training (multi-hour) but inconsistent with the real-time WS-first design philosophy.
- **Risk**: Low
- **Status**: Open (cosmetic) — acceptable for V1. Would be upgraded to WS subscription in a future polish pass.

### TD-029: `if (!db)` Null-Guards Fully Removed (Resolved)
- **File**: All server files (resolved 2026-06-15)
- **Reason**: Pre-unification pattern — `getDb()` returned `null` in SQLite mode → 13 routers no-op'd. All 83 `if (!db)` null-guards were cleaned up (2026-06-15 beta sweep).
- **Risk**: N/A — Resolved
- **Status**: Resolved — `getDb()` always returns a live instance. No null-guards should be added going forward.

### TD-030: Default Export Debt (Resolved)
- **File**: 77 React component files + router files (resolved 2026-06-19)
- **Reason**: 77 files contained `export default function` instead of named exports (violation of AGENTS.md style rules).
- **Risk**: N/A — Resolved
- **Status**: Resolved — mass-renamed 2026-06-19. All import statements and lazy-load references updated across 19 importing files including `App.tsx` and `main.tsx`.

### TD-031: MySQL `insertId` Pattern (Resolved)
- **File**: `server/db-pcb.ts` lines 44, 169, 270, 356, 408 (resolved F9)
- **Reason**: 5 instances of `(result as any)[0]?.insertId` — MySQL-only pattern that returns 0 under SQLite/libSQL.
- **Risk**: N/A — Resolved
- **Status**: Resolved — all 5 replaced with `.returning({ id: table.id })` (F9, 2026-06-14).

### TD-046: Zustand Unselectored Subscription + Inline `[]` Default = Infinite Render Loop
- **Files**: `client/src/lib/stores/designerStore.ts`, `client/src/components/pcb/EnhancedPCBEditor.tsx`, `client/src/pages/3DDesigner.tsx`
- **Reason**: Two independent patterns combine to produce an infinite render loop that is trivially easy to write and very difficult to spot by reading code:
  1. **Inline `[]` default in TanStack Query**: `const { data: foo = [] }` creates a **new array reference on every render** while `data === undefined` (loading state). React's `Object.is` comparison sees a new reference and fires any `useEffect` that lists this value in its deps — every render, forever.
  2. **Zustand unselectored subscription**: `useStore()` without a selector subscribes to the *entire* store. Zustand's `set({ field: value })` always produces a new merged-state object (`Object.assign({}, state, partial)`), so **every `set()` call re-notifies every unselectored subscriber, even when the value hasn't changed**.

  When combined: `pcbProjects = []` inline default → new `[]` every render → `useEffect([pcbProjects])` fires → `setActivePCBContext(null)` → Zustand creates new merged state → all unselectored subscribers re-render → new `[]` → repeat → React hits 25-nested-update limit → throws "Maximum update depth exceeded" → RouteBoundary catches it → "Panel Error" white-screen. The failure only manifested on first boot (no projects in DB yet) and only without first visiting the Web Preview tab, giving it the feel of a timing or unmount race rather than the render-dep bug it actually was.

- **Risk**: High — unhandled crash + white-screen on the 3D Designer → PCB/Schematic tab first-boot navigation path
- **Status**: **RESOLVED (2026-06-28).** Three-part fix applied in concert:
  1. **Module-level constant** `EMPTY_PROJECTS` in `EnhancedPCBEditor.tsx` replaces the inline `= []` default — same reference every render, effect dep is stable.
  2. **Selective subscriptions** in `EnhancedPCBEditor.tsx` and `3DDesigner.tsx`: `useDesignerStore((s) => s.field)` instead of `useDesignerStore()` — component only re-renders when the specific field it reads changes.
  3. **Equality guard in `setActivePCBContext`** (`designerStore.ts`): `if (getState().activePCBContext === context) return;` before `set()` — short-circuits Zustand notification when the value is identical.

  **Prevention rule:** (a) Never use inline `= []` / `= {}` as TanStack Query defaults — always hoist to a module-level constant. (b) Always use selectors with Zustand: `useStore((s) => s.field)`. (c) Add equality guards to any Zustand setter that may be called with the same value from within a render/effect cycle. Equality guard = defence-in-depth for a missed selector; selector = defence-in-depth for a missing guard.

---

## Ruthless Beta Code-Sweep — new entries (2026-06-20, Session 23)

### TD-032: Sovereign guard not centralized in `AiProviderService` (Resolved at call sites)
- **File**: `server/_core/sovereign.ts` (new), `server/routers/{curator,pcbEditor,imageGen}Router.ts`, `server/phase2/services/AiProviderService.ts`
- **Reason**: `AiProviderService.chat()` takes no `executionMode`, so the Sovereign (air-gap) gate lives **per-router**. `aiRouter`/`podcastRouter`/`agentMessengerRouter` had it; `curatorRouter` (anthropic), `pcbEditorRouter.reviewDesign` (openai), and `imageGenRouter.generate` (fal/openart) did **not** → a sovereign user could tunnel a cloud call through them.
- **Risk**: High (security — Sovereign-mode bypass)
- **Status**: **Resolved** — added shared `assertProviderAllowedInMode` / `assertImageProviderAllowedInMode` (`server/_core/sovereign.ts`), wired into the 3 unguarded procedures. **Defense-in-depth recommendation (open):** thread `executionMode` into `AiProviderService.chat()` so no future router can forget the guard.

### TD-033: `pnpm build` broken under `node-linker=hoisted` (Resolved)
- **File**: `scripts/build-server.mjs`, `.npmrc`
- **Reason**: The Express-4 callable `path-to-regexp@0.1.x` resolver only scanned `node_modules/.pnpm`. `.npmrc` sets `node-linker=hoisted`, so `.pnpm` is empty and the non-callable v8 is hoisted to top-level while Express-4's 0.1.x is nested at `node_modules/express/node_modules/path-to-regexp`. The server bundle step threw; recent gates had been silently skipping `pnpm build`.
- **Risk**: High (production build broken)
- **Status**: **Resolved** — resolver now checks the hoisted nested path first (verifies `0.1.x`), then falls back to the `.pnpm` scan; works in both linker modes. `pnpm build` green.

### TD-034: Provider HTTP errors were opaque (Resolved)
- **File**: `server/phase2/services/AiProviderService.ts`
- **Reason**: All 8 chat methods threw only `response.statusText` ("Bad Request"/"Too Many Requests"), discarding the provider's real error body — so users saw uninformative errors (the actual cause of a "keys can't be tested" report).
- **Risk**: Medium (UX / debuggability)
- **Status**: **Resolved** — added `describeHttpError()`; errors now read e.g. `429 — You exceeded your current quota` / `400 — Your credit balance is too low`. (`PublishingService` already did this correctly.)

### TD-035: `undici` override floor footgun (Resolved)
- **File**: `pnpm-workspace.yaml`
- **Reason**: A naive `undici >=6.27.0` security floor let pnpm jump to **undici 8.0–8.4**, which reintroduce a TLS-validation-bypass + WS DoS (patched only in 8.5.0) — audit went 14→7 but **highs 2→3**.
- **Risk**: Medium (supply chain)
- **Status**: **Resolved** — pinned `undici >=8.5.0`; `pnpm audit --prod` → **0**. Lesson: when bumping a transitive dep's floor, check whether the latest satisfying major has *newer* advisories.

### TD-036: `getInstance()` → `ctx.services.*` migration needs context-factory expansion (Open)
- **File**: `server/_core/context.ts`, multiple routers (`mcpRouter`, `virtualCardRouter`, `valetRouter`, `kicadRouter`, `modelManagementRouter`)
- **Reason**: Many routers call `Service.getInstance()` instead of `ctx.services.*` (Code-Standards §2.2). `ctx.services` exposes hitl/mcpClient/aiProvider/etc. but **not** VirtualCardService, ValetRouterService, ValetServerService, PCBWayService, ModelManagementService, AuditLogService.
- **Risk**: Low (pure convention — functionally identical)
- **Status**: Open — do it as one pass: expose the missing singletons on `ctx.services` first, then migrate uniformly. Do NOT scatter partial edits. (My new `securityRouter` HITL calls already use `ctx.services.hitl`.)

### TD-037: ~506 raw Tailwind color classes remain (Open)
- **File**: `client/src/**` (~64 files)
- **Reason**: Raw color classes / hex vs AGENTS "no hardcoded colors". The semantic palette was incomplete (no warning/info token; accents were `.dark`-only) — now fixed: `--accent-warning` + `--accent-info` added to `Globals.css`. Always-on chrome migrated (UpdateBanner/ZeroLoginBanner/PeerCard/ExecutionModeBadge).
- **Risk**: Low (cosmetic)
- **Status**: Open — needs a **visually-verified** pass (dark theme can't be validated headless). Mapping table + exempt-file list in memory `beta-sweep-followups`. Exempt: three.js/PCBViewer3D, reactflow canvases, xterm, WebPreview iframe, MeshTopologyGraph canvas, brand OAuth colors.

### TD-038: Neural-map ingested content not fed to VectorDB; dropbox/onedrive no adapters (RESOLVED 2026-06-23)
- **File**: `server/routers/integrationsRouter.ts`, `client/src/pages/BrainMap.tsx`, `server/phase2/services/{VectorDBService,MemoryArchitectService}.ts`, `server/_core/ragContext.ts`, `server/routers/{aiProviderRouter,aiRouter,neuralMapsRouter}.ts`, `client/src/pages/Chat.tsx`
- **Reason**: Remote map sources rendered as real trees (TD-013) but their content was **not** pushed into `VectorDBService`, so map RAG over remote sources wasn't real. Dropbox/onedrive also couldn't connect.
- **Risk**: Low
- **Status**: **RESOLVED.** Built end-to-end (no deferrals): per-adapter **content** resolvers for all 8 source types → generic `MemoryArchitectService.reindexRemoteSource` (chunk/sanitize/redact) into `omnecor_{mapId}`; `integrations.indexMapSources` detached job (gated by `indexingEnabled`) + `getMapIndexStatus` polling + `BrainMap` Index button/auto-trigger; **read path** `ragContext.injectMapRagContext` wired into `aiProvider.chatStream` + `ai.chat` (gated by `enableAIContext`, Sovereign-safe), `Chat.tsx` passes `ragMapId`. Dropbox/onedrive adapters landed 2026-06-22. **Latent bug fixed in the same pass:** the local file watcher wrote a *raw* `omnecor_${projectId}` collection while the reader queried a *sanitized* one (divergent for hyphenated map UUIDs → RAG silently empty) — unified on exported `VectorDBService.sanitizeCollectionName`. Gates: tsc 0 · vitest 371/371 · build ✓. Outstanding: live runtime proof only (ChromaDB + real tokens).

### TD-039: Neural-map overlapping local roots → multi-parent nodes (Open)
- **File**: `client/src/pages/BrainMap.tsx` (`neuralNetwork` merge), `client/src/lib/fileTreeToNetwork.ts`
- **Reason**: Node ids are `node-${absolutePath}`. If a map has two local roots where one is an ancestor of the other (or they otherwise overlap), the same absolute path produces the same node id under both roots. The lazy-expansion merge dedupes the **node** by id but can still append a second parent **edge**, so a node can end up with two incoming edges — hierarchical layout in-degree and tree-view parent grouping then treat it as having multiple parents.
- **Risk**: Low — rare (requires deliberately mapping overlapping directories); the map still renders, the node just appears under both parents.
- **Status**: Open — **pre-existing** (predates the 2026-06-22 off-thread/bounded-loading work; surfaced during its `/review`, not introduced by it). Fix: dedupe edges by `target` (enforce one parent per node) or reject/merge overlapping roots at map-config time.

### TD-040: Neural-map layout Web Worker — first Web Worker in `client/src` (By design — recorded)
- **File**: `client/src/lib/neuralLayout.worker.ts`, `client/src/lib/neuralLayoutClient.ts`
- **Reason**: The 2026-06-22 off-thread layout fix introduces the **first Web Worker** in the client (Vite `new Worker(new URL(…), { type: "module" })`, bundled as its own chunk; synchronous main-thread fallback when `Worker` is unavailable). New build/runtime surface worth tracking.
- **Risk**: None — intentional and verified (worker chunk builds clean; fallback covers SSR / locked-down envs).
- **Status**: **By design — no action.** Recorded because `/review` flagged the new pattern as deserving a conscious decision (acknowledged). Reuse `neuralLayoutClient` for any future off-thread compute rather than spawning ad-hoc workers.

### TD-041: Neural-map tree-view drill-in — deliberate scope addition (By design — recorded)
- **File**: `client/src/components/neural/NeuralTreeView.tsx`
- **Reason**: Bounded-loading lazy expansion (graph view) was also wired into the **tree view**, slightly beyond the literal request. Without it, truncated folders would render as misleading empty leaves in tree view.
- **Risk**: None — intentional, keeps the two views consistent.
- **Status**: **By design — no action.** Recorded for the record.

### TD-042: PCBWay quote/order path sends a file-PATH string, not real Gerbers (RESOLVED)
- **File**: `server/core_services/services/PCBWayService.ts`, `server/routers/kicadRouter.ts`, `client/src/components/designer/ManufacturingPanel.tsx`
- **Reason**: The manufacturing quote/order flow is an integration facade at the PCBWay boundary. `ManufacturingPanel` calls `kicad.getQuote({ pcbPath: activeFile || "main.kicad_pcb" })` — when no file is open it literally sends the placeholder string `"main.kicad_pcb"`. `kicadRouter.getQuote` `validatePath`s it then calls `PCBWayService.getQuote(path)`, which POSTs `{ partnerId, gerberFile: <path string> }` to `api.pcbway.com/.../GetQuote`. **No Gerbers are generated, zipped, or uploaded** — PCBWay receives a server-local file *path*, which it cannot read. A separate `kicadRouter.exportForManufacturing` *does* generate real Gerbers to a tmpdir, but **nothing in the quote/order path calls it**, and even it produces a dir, not an uploaded multipart payload. The flow is gated behind `PCBWAY_API_KEY` (`isConfigured()` → `PRECONDITION_FAILED` when unset), so it fails cleanly today; with a key it would fail at PCBWay. The PCBWay REST endpoints/shape are also unverified against PCBWay's actual (approval-gated) OEM API.
- **Risk**: Medium → Low (facade replaced with a real, contract-correct implementation)
- **Status**: **BUILT (2026-06-23, code-sweep).** The facade is gone — replaced end-to-end with the real PCBWay partner-API contract (researched online: base `https://api-partner.pcbway.com`, `POST api/Pcb/PcbQuotation`). Key correction discovered during the build: **the quote is parametric, not file-based** — PCBWay prices a board from its dimensions + layer count; Gerbers are attached only at *order* time. So:
  - **Board-spec extraction** — new `kicadBoardSpecs.ts`: parses the `.kicad_pcb` for the `Edge.Cuts` bounding box (Length×Width) and counts `*.Cu` stackup layers (snapped to a PCBWay-supported count), with prototype-default fallbacks. Unit-tested.
  - **Dependency-free ZIP** — new `zipArchive.ts`: DEFLATE writer on Node `zlib` (crc32 + deflateRaw), no third-party archiver added (avoids phantom-dep/lockfile churn). Round-trip unit-tested via `inflateRawSync`.
  - **Real fab package** — `KiCadService.buildFabricationPackage()`: exports Gerbers **+ drills** to a temp dir → zips to a Buffer (throws on empty/failed export).
  - **Real PCBWayService** — `getQuote(specs, qty)` POSTs the documented parametric `PcbQuotation` request (standard 2-layer FR-4 defaults overridden by extracted specs) and parses `priceList`/`Shipping`/`Status` defensively; `submitOrder()` **multipart-uploads** the fab zip + board spec + shipping to `api/Pcb/PcbOrder`. Auth is env-configurable (`PCBWAY_API_KEY` + `PCBWAY_API_AUTH_HEADER`, default `Authorization: Bearer`) and `PCBWAY_API_BASE` is overridable — because the partner API is approval-gated, **the exact auth header/order-endpoint are confirmed at PCBWay partner onboarding** (the request/response *schemas* follow the published docs).
  - **Router/UI** — `kicadRouter.getQuote` extracts specs → real quote; `exportForManufacturing` returns the zip (base64) for download; `placeOrder` keeps HITL + audit, builds the zip, and submits. `ManufacturingPanel` shows real dims/layers/qty/price and adds a "Download Fabrication Files (.zip)" button. Old `{quoteId}` contract replaced with `{pcbPath, qty, shippingAddress}`.
  - Gates: `tsc` 0 · full suite **377/377** (6 new) · build ✓. **Still fails-clean** without `PCBWAY_API_KEY` (PRECONDITION_FAILED). **Live verification requires an approved PCBWay partner key** (and confirming the exact auth header against their onboarding docs) — that's the only remaining unknown; everything is built to the published contract.
  - **Automated test coverage added 2026-07-11** (the one real gap that remained — the code had been built since 2026-06-23 but the quote/order HTTP shape was untested): `pcbwayService.test.ts` (8 — mocked `fetch` + `ENV`: parametric quote body with *no path leaked*, PartnerId gating, priceList/shipping parse, HTTP-error + `Status!=ok` mapping, and the **order multipart uploading the real ZIP bytes** — asserts a `Blob` of the archive length with no `Content-Type` override so the boundary is derived) and `kicadRouterPcbway.test.ts` (3 — router wiring: `getQuote` parametric path, `placeOrder` HITL-deny → FORBIDDEN with no `submitOrder`, HITL-approve → `buildFabricationPackage` ZIP bytes reach `submitOrder`). This closes the header ("Open — untracked") that had lingered even though the body already recorded the build; the only remaining item is the operator-gated live PCBWay partner-API run.

### TD-043: `aiRouter` chat-persistence IDOR — non-owner could read/append/summarize sessions (RESOLVED)
- **File**: `server/routers/aiRouter.ts`
- **Reason**: `aiRouter.getSession`, `getSessions`, `saveMessage`, and `summarizeAndPruneSession` were `protectedProcedure`s that took a `sessionId`/`projectId` and called the shared `db.factory` helpers (`getChatSession`/`getChatSessions`/…) with **no `ctx.user.id` scoping**. Any authenticated user (or paired device) could read another user's conversation by UUID, append messages to it, or summarize it into *their own* episodic memory. `summarizeAndPruneSession` is reachable from the UI (`MemoryArchiverPanel`), so this was exploitable end-to-end, not just via raw tRPC. The parallel `chatRouter` already scoped every equivalent query by `ctx.user.id`; `aiRouter` was an older unscoped copy.
- **Risk**: High (broken access control / cross-user data exposure) → Resolved
- **Status**: **RESOLVED (2026-06-24).** All four procedures now scope by `ctx.user.id`: `getSession` returns `null` for a non-owned session (and never fetches its messages), `getSessions` filters to the caller's rows, `saveMessage`/`summarizeAndPruneSession` throw `NOT_FOUND`. `createSession` already set `userId` on write. Found while writing the first `aiRouter` route-level tests (TD-044); locked with 6 IDOR regression tests in `server/__tests__/aiRouter.test.ts`. Legitimate client paths unaffected. Gates: `tsc` 0 · `vitest` 412/412.

### TD-044: Route-layer (tRPC) + service test coverage near-zero (In progress)
- **File**: `server/routers/*` (50 routers), `server/phase2/services/*` (49), `server/ommesh/core/*`, `server/_core/{llm,voiceTranscription,imageGeneration}.ts`
- **Reason**: Until 2026-06-24 the suite had **no coverage tooling** and effectively **no route-level tests** — only `auth.logout` drove `appRouter`. Tests passed/failed with no line/branch metrics, so regressions in untested code (the entire API boundary, the Sovereign/admin enforcement middleware, the OMMESH mTLS/cert-pinning path, HITL/pipeline services) were invisible. A re-verified audit confirmed the gap (the earlier "0% routers / 4-of-40 services" figures were directionally right but imprecise: `auth.logout` already hit one route; ~8 service modules had tests).
- **Risk**: Medium (no functional defect; absence of a safety net for security-sensitive code)
- **Status**: **In progress (2026-06-24).** Installed `@vitest/coverage-v8`, added `pnpm test:coverage`, and set **ratcheting thresholds** in `vitest.config.ts` at the measured baseline (stmts/lines ~9–10%, branches/funcs ~6–7% — floor only, raise as suites land). Added a reusable route-test harness (`server/__tests__/_helpers/trpcHarness.ts`, real in-memory libSQL + migrations) and the first two route suites — `chatRouter` (15 tests, 100% lines) and `aiRouter` (20 tests, ~57%). Remaining priority order: auth/`admin`/`owner` procedure middleware → `walletRouter`/`virtualCardRouter` route layer → `HITLApprovalService` → `MeshServer` mTLS + cert pinning → `AiProviderService` spend/fallback → `PipelineEngineService`.

### TD-045: Zero-login default execution mode and context source-of-truth configuration (RESOLVED)
- **File**: `server/_core/context.ts`, `server/_core/env.ts`, `client/src/pages/Settings.tsx`
- **Reason**: The zero-login local admin execution mode default has been updated to `"scrapper"` to align with the product directive that the system defaults to scrapper and only locks down to sovereign mode if explicitly configured. To prevent setting reverts and system-wide overrides, `createContext` was refactored to use the database user's `executionMode` as the source of truth if it exists, rather than forcing the environment default `zeroLoginExecutionMode` on every API request. The selector in `Settings.tsx` has also been enabled for zero-login users. Changing this back or re-introducing a forced override in context configuration will cause the user's Settings preferences to be ignored or silently overwritten back to the environment default.
- **Risk**: High (potential regression causing user settings to be silently overwritten and default to wrong modes)
- **Status**: **RESOLVED (2026-06-25).** Default mode changed to `scrapper`, context override removed, and Settings selector enabled. Fully checked (`tsc --noEmit` clean, 416 tests pass) and rebuilt in Debian package version `2.4.1~beta.1`.

### TD-048: Terminal/CLI PTY WebSocket message envelope silently drifted apart (RESOLVED)
- **File**: `client/src/components/terminal/EmbeddedTerminal.tsx`, `server/phase2/websocket/WebSocketServer.ts`
- **Reason**: The user reported the Chats page "Terminal/CLI" (the live xterm.js + node-pty shell) couldn't run commands at all. Root cause: the client and server each declared their **own, independent copy** of the `pty:*` WS message types instead of sharing one — and the two shapes had silently drifted apart with zero compiler error. Every keystroke was sent as `{type:"pty:input", data: "<char>"}` (a bare string), but the server read `message.data.input` — property access on a string returns `undefined`, so `proc.write()` was **never called and every keystroke was silently dropped**. Symmetrically, server output came back as `{type:"pty:output", data:{output, sessionId}}` but the client did `term.write(msg.data)`, feeding xterm.js an object instead of a string. `pty:resize` was sent flat (`{cols, rows}`) instead of nested under `data`, which would throw when the server destructured `undefined`. The client also never handled a server `error` message at all, so any backend failure (e.g. node-pty native binding missing) looked like the terminal simply doing nothing — a silent failure with no diagnostic.
- **Risk**: High → Resolved (core advertised feature was completely non-functional)
- **Status**: **RESOLVED (2026-07-02).** Extracted the canonical contract into `shared/types/terminal.types.ts` (`PtyClientMessage`/`PtyServerMessage`), imported by **both** `EmbeddedTerminal.tsx` and `WebSocketServer.ts` — this class of drift is now a compile-time error instead of a silent runtime bug, since both sides use the same type instead of two independently-hand-written copies. Also fixed `pty:output`/`pty:exit` parsing (`msg.data.output`, `msg.data.exitCode`/`signal`) and added handling for the previously-ignored `error` message type. Live-verified via chrome-devtools MCP: real bash PTY spawn, keystroke round-trip (`echo` → real shell output), HITL approve/deny gate. **Prevention rule:** any two sides of a WS/IPC boundary that exchange typed JSON messages should import one shared type, never hand-write matching interfaces on each side — the compiler can only catch a mismatch it can see.

### TD-049: `MeshDiscoveryService` bonjour service had no `error` listener — LAN name collision crashed the whole server (RESOLVED)
- **File**: `server/phase2/services/MeshDiscoveryService.ts`
- **Reason**: Found while live-testing the TD-048 fix — running a second Omnecor instance for verification crashed the **entire server process** twice. `MeshDiscoveryService.startMdns()` calls `bj.publish({...})` and only wraps the *synchronous* call in try/catch; the real error ("Service name is already in use on the network") is emitted **asynchronously** on the returned `Service` EventEmitter once bonjour's mDNS probe detects a name collision — with no listener attached, Node rethrows it as an unhandled `error` event, killing the process. This is trivially reproducible: the default node name is derived from the LAN IP (`omnecor-${ip.replace(/\./g,"-")}`), so **any two Omnecor instances on the same machine/interface** (e.g. a leftover dev server + a fresh one, or the packaged Electron app running alongside a dev server) collide immediately. The sibling `server/ommesh/core/DiscoveryService.ts` — a newer, separate mDNS advertiser doing the same job (see the new gotcha bullet below) — already had this exact fix for the identical bonjour quirk; `MeshDiscoveryService.ts` was simply never updated to match.
- **Risk**: High (remote/local-triggerable full-process crash) → Resolved
- **Status**: **RESOLVED (2026-07-02).** Added the same `service?.on("error", ...)` defensive listener already present in `DiscoveryService.ts`, logging a warning and degrading mDNS discovery gracefully instead of crashing. Verified: the dev server survived past the exact point it crashed twice before the fix, running alongside another live Omnecor instance on the same LAN interface.

### TD-050: No isolated test-construction path for `OmnecorWebSocketServer` (Open)
- **File**: `server/phase2/websocket/WebSocketServer.ts`, `server/__tests__/_helpers/trpcHarness.ts`
- **Reason**: The TD-048 PTY protocol fix was verified live (chrome-devtools MCP against a running dev server) but has no permanent automated regression test for the full WS+PTY round-trip, because `OmnecorWebSocketServer`'s constructor calls the real `createContext()` → `getDb()` (not the isolated in-memory `createTestDb()` harness the route-level tRPC tests use) plus instantiates 7 singleton services (FileSystemWatcherService, ProcessManagerService, HashTrackerService, VoiceService, HITLApprovalService, AgentService, NotificationService). Standing one up in a test today would touch the real `~/.omnecor/data/omnecor.db` and share process-wide singletons with whatever else is running in the same test process — an unsafe side effect, not just a slow test.
- **Risk**: Low (no functional defect; the shared-type fix in TD-048 already prevents the specific bug class at compile time) — but it does mean any *future* protocol change on this WS surface has no automated safety net.
- **Status**: Open — needs a DB-path-injectable/isolated construction mode for `OmnecorWebSocketServer` (or a narrower test seam directly around `handlePtySpawn`/the message switch) before a real integration test can be added safely. See `Context/Tracker-Docs/Verification-Pass.md` Section 12 "Session-30 addendum" for the tracked backlog item.

### TD-047: `chatStream` subscriptions crash the whole server on emit-after-close (RESOLVED)
- **File**: `server/routers/aiProviderRouter.ts`, `server/routers/aiRouter.ts`, `server/_core/streamEmit.ts`
- **Reason**: All three tRPC streaming subscriptions — `aiProvider.chatStream` and `aiRouter.chatStream` (both the `ommesh` and the main-provider branches) — ran a detached async producer that called `emit.next` / `emit.error` / `emit.complete` **unguarded**. When a client disconnected mid-stream (browser navigated away, WS dropped, or the request aborted on an Ollama timeout), tRPC had already closed the subscription's underlying `ReadableStream` controller; the late `emit.error(err)` then threw `ERR_INVALID_STATE: Controller is already closed` from the `.catch()` in the detached IIFE — an **unhandled rejection that crashed the entire Node process**. Hit live 2026-07-01: a slow LAN-Ollama stream timed out after the Playwright driver had navigated away, and the server went down. Any AI stream timeout/disconnect could take the process down (remote-triggerable).
- **Risk**: High (remote-triggerable full-process crash / DoS) → Resolved
- **Status**: **RESOLVED (2026-07-01).** Added `guardedEmit` (`server/_core/streamEmit.ts`): it drops any emit after completion or teardown and swallows a closed-controller throw, and exposes `.closed` so the producer stops pulling tokens from the model promptly. Wired into all three subscription sites — the stream loop now `break`s on `g.closed`, the observable teardown calls `g.close()`, and the terminal `.catch` uses `g.error`. `WebSocketServer`'s `streamChat` consumer was already safe (wrapped in try/catch with `session.aborted` guards). Locked with 6 unit tests in `server/__tests__/streamEmit.test.ts` (incl. the exact "controller already closed" throw). Gates: `tsc --noEmit` 0 errors · new tests 6/6.

### TD-054: Agentic Chat UI not yet imprinted into UI-Registry (RESOLVED)
- **File**: `client/src/components/chat/agentic/AssistantStream.tsx`, `AgenticBlocks.tsx`, `client/src/pages/Chat.tsx`, `client/src/components/chat/ConversationList.tsx`
- **Reason**: The `/imprint` step for the agentic chat UI was tracked as deferred to the Phase 7 close-out. On review during the 2026-07-10 doc-reconciliation pass, the web agentic surface was in fact already captured (UI-Registry **Session 29** guide-line stream / `ThinkingSection` / `StatusDot` / block chips / `DiffView` / `ApprovalRow`; **Session 30** message chrome; **Session 31** message queue) and the APK port in **Session 32** — the only genuinely-missing piece was the Mesh-Delegation UI.
- **Risk**: Low (no functional defect; consistency risk for future component additions that reference the registry)
- **Status**: **Resolved (2026-07-10).** UI-Registry **Session 33** imprints the Mesh-Delegation UI (parent `SubAgentBox` chip + HITL, managed-chat `accent-cyan` banner + cancel, `ConversationList` Network badge, between-turn peer routing, APK mirror). The registry is now current across the entire agentic surface (Sessions 29–33); the Chats-Agentic-Upgrade Phase 4 `/imprint` checkbox is closed. No dependence on the live-mesh hardware session — that gates only the runtime `/review`, not the visual imprint.

### TD-055: APK encrypted chat persistence broken on-device — secure random failure (Open)
- **File**: `packaging/android/omnecor-hq/lib/_core/chat-store.ts`
- **Reason**: `[ChatStore] Failed to persist encrypted chats: Native crypto module could not be used to get secure random number` — recurring on the S25 Ultra (also hit in Session-31). `react-native-get-random-values` is not providing `crypto.getRandomValues` reliably. This is a real data-loss risk: chats are not being persisted to device storage. Violates the "Operational Memory Never Escapes" principle.
- **Risk**: High (data loss — user chat history not persisted on-device)
- **Status**: Open — investigate `react-native-get-random-values` initialization order (must be imported before `uuid`/`nanoid` in the entry point); consider replacing with `expo-crypto` `getRandomBytes` polyfill which runs in the Hermes native binding and does not rely on the JS crypto global.

### TD-056: APK user prompt bubble text low-contrast on blue background (Open)
- **File**: `packaging/android/omnecor-hq/components/agentic/assistant-stream.tsx` (user bubble styles)
- **Reason**: User prompt bubble text renders black/dark on the blue background in the APK \u2014 low contrast, hard to read. The same bug was already fixed in the web app; the fix was not mirrored into the APK. Found during on-device verification 2026-07-07.
- **Risk**: Low (cosmetic/accessibility)
- **Status**: Open — mirror the web `userBubble` text-color fix (use `var(--color-primary-foreground)` or equivalent token) into the APK native styles.

### TD-057: APK model picker Omnecor Server "Test" button false-negative (Open)
- **File**: `packaging/android/omnecor-hq/app/(tabs)/settings.tsx` (or equivalent server-test screen)
- **Reason**: Settings → Omnecor Server → "Test" shows a sticky "Cannot reach server" even when the WebSocket connection actually establishes successfully (the footer goes 🟢 Connected immediately after). The "Test" preflight is a different, broken code path from the real WS connection. Found during on-device verification 2026-07-07.
- **Risk**: Low (UX confusion; real connectivity still works)
- **Status**: Open — align the "Test" button to use the same connection probe as the footer health-check, or simply report the WS connection state rather than running a separate preflight fetch.

### TD-058: Agentic tool-loop + mesh dual-sided live verify deferred to hardware session (Open)
- **File**: N/A — verification gap, not a code defect
- **Reason**: The full live verification of the agentic tool-loop dual-sided (web + APK WS stream + HITL + Run/Preview + queue), the `targetNodeId` mesh-pin path, and the Mesh-Delegation `delegate_task` round-trip all require DadsPC (RTX 4060 Ti — owner's fastest reasoning node, but its build is stale) and the `.201` node both redeployed with the current build. This is a known deferred step in both `Chats-Agentic-Upgrade` Phase 7, `Model-Fabric` Phase 7, and `Mesh-Delegation` Phase 10; all three explicitly note it.
- **Risk**: Medium (unit-tested, build-verified; live end-to-end not yet confirmed on real multi-peer hardware)
- **Status**: Open — bundle with the next available joint hardware session. Steps: deploy current build to DadsPC + .201, confirm "Omnecor · DadsPC" group renders in the APK picker, spawn a `delegate_task` from the APK parent chat, approve a `run_command` on the peer, confirm the parent re-prompt.

---

## Key Insights & Gotchas (2026-06-20 sweep + live verification)

*Operational learnings — not "debt" to fix, but things that cost time to discover. Read before touching auth, the dev server, or tRPC clients.*

- **THREE separate connection systems — don't conflate them.** (1) **Login OAuth** (Google/Microsoft sign-in) → identity, users/session. (2) **Integrations** (GitHub/Notion/Drive **PAT/OAuth**) → `~/.omnecor/integrations.json`, powers **neural-map sources**. (3) **Platform accounts** (social publishing) → `platformAccounts` table. Connecting Google *login* does NOT make GitHub/Drive show as connected in the Integrations list. This caused a "still says not connected" report.
- **`ZERO_LOGIN_MODE` execution mode is configurable; defaults to `sovereign`** (`context.ts` creates the local-zero-login user with `role:"admin"` and `executionMode = ENV.zeroLoginExecutionMode`, driven by `ZERO_LOGIN_EXECUTION_MODE`, default `sovereign`). Default → `cloudProcedure`s are **blocked** (true air-gap). Set `ZERO_LOGIN_EXECUTION_MODE=scrapper` (or `big_spender`) to allow cloud (spend-tracked) for testing — the env flag is authoritative and overrides any value persisted on the local-zero-login user. *(Was hardcoded `scrapper` before 2026-06-21; the docs/UI claimed sovereign, the code did scrapper — reconciled via this flag. See [docs/development/LOCAL_TESTING.md](../../docs/development/LOCAL_TESTING.md).)*
- **Two ways to get a real test session — NOT zero-login (which defaults to sovereign/cloud-blocked).** **(A) Emulated OAuth:** set `GOOGLE_EMULATOR_URL` / `MICROSOFT_EMULATOR_URL` (the `google`/`microsoft` skills' `npx emulate` servers) → `oauth.ts` points the auth/token/userinfo endpoints at the emulator (real URLs otherwise) → sign in through the real flow with no real creds. **(B) Seed script:** `pnpm tsx server/scripts/dev-seed-user.ts` (git-ignored) mints a valid `app_session_id` cookie (default `scrapper`) for headless Playwright/curl. Both need `JWT_SECRET` + `VITE_APP_ID` set — `verifySession()` rejects a token with an empty `appId` **or** empty `name`. Full guide: [docs/development/LOCAL_TESTING.md](../../docs/development/LOCAL_TESTING.md).
- **Sovereign blocks by CATEGORY, and the integration "block AI only" toggle.** `trpc.ts` meta now carries `cloudKind: "ai" | "service"`. `cloudProcedure` = AI inference (OpenAI/Anthropic/Gemini/Fal/voice/training) → **always** blocked in sovereign. `externalServiceProcedure` = non-AI external calls (GitHub/Notion/Drive sync — the 4 integration procs `connect`/`sync`/`fetchSourceTree`/`updateSettings`) → blocked in sovereign **unless** the `sovereignBlockAiOnly` setting is on (Settings → Security, default OFF = strict air-gap). That setting is **admin-gated**: it persists only through the `system.setSovereignBlockAiOnly` `adminProcedure` and is explicitly **stripped from the public `saveSettings`** endpoint (it weakens the air-gap, so it must not be settable unauthenticated). Email (gmailRouter) and web search were never `cloudProcedure`, so they already work in sovereign. Use `externalServiceProcedure` (not `cloudProcedure`) for any new non-AI external call so it respects the toggle.
- **The Settings execution-mode selector is per-USER (DB) and is OVERRIDDEN under zero-login.** `system.setExecutionMode` writes `users.executionMode`; the nav `ExecutionModeBadge` reads the Zustand store hydrated from `auth.me`. This works for real sessions. But in **zero-login**, `context.ts` re-forces the mode to `ZERO_LOGIN_EXECUTION_MODE` on every request, so changing it in Settings appears to "have no effect" — the selector is therefore **disabled with a note** when `me.loginMethod === "zero-login"`. (Also: a static/demo build has no backend, so the mutation just errors — another "no effect" cause.)
- **Microsoft OAuth real endpoints were malformed** (`/common/v2.0/oauth2/<verb>` — segments swapped; 404s against real Entra ID). Fixed 2026-06-21 to `/common/oauth2/v2.0/<verb>` in `oauth.ts`. The endpoints are now resolved via `microsoftEndpoints()` / `googleEndpoints()`, which switch to the local emulator when `*_EMULATOR_URL` is set.
- **AI key env var names must be EXACT:** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (read via `env.ts` → `process.env.*`, with `SettingsService.getSecret(key, ENV.fallback)`). Custom names like `Open_AI_Token` are silently ignored → "API Key not configured". Server loads `.env` via `import "dotenv/config"` at startup → **a `.env` edit needs a server restart**.
- **Free OpenAI/Anthropic accounts need purchased credits even for low usage.** Valid keys authenticate but completions fail: OpenAI `429 insufficient_quota`, Anthropic `400 credit balance too low`. Not a config bug. Free local alternative: Ollama (works in scrapper mode, no key).
- **Stale `tsx watch` processes hold `:3000`** → a new `pnpm dev` fails to bind (`exit 144`) and the OLD process (stale env) keeps serving — which looks like "my fix didn't take." Before restarting: `fuser -k 3000/tcp` + `pkill -9 -f "tsx watch server/_core"`, then confirm the port is free (`curl` fails) before starting one fresh server.
- **superjson tRPC encoding (when cur/scripting the API):** query input is `?input={"0":{"json":<value>}}`; a `Date` needs `meta:{values:{<field>:["Date"]}}`; **the null-input meta `{"values":["undefined"]}` OVERRIDES any `json` you pass** — only use it when the value really is null/undefined.
- **Headless screenshots can't capture the BrainMap graph** — the force-graph canvas animates forever, so Playwright never reaches a stable frame (`screenshot` times out). Use the **tree-view DOM** or `page.evaluate` text capture as evidence instead.
- **Setup wizard gates routes** until `localStorage["omnecor:setup_complete"]==="true"` — set it via `addInitScript` before navigating, or you'll be redirected to `/setup`.
- **Drive the app via the DEV server for ZERO_LOGIN** (production forbids it; local OAuth portal is a dummy). The rate limiter now `skip`s non-`/api` paths, so a Playwright dev-mode page load no longer 429s.
- **`platforms.addAccount` accepts a RAW token** — social posting can be tested by pasting a token from a platform's own token tool (Graph API Explorer, etc.) instead of implementing the full client-id/secret OAuth flow. "Sign in with Google/Microsoft" can NOT authorize posting to Twitter/LinkedIn/Meta (separate platforms require their own app).
- **Zustand + TanStack Query infinite loop trap (TD-046).** `const { data: foo = [] }` in a TanStack Query destructure is not just a minor inefficiency — it creates a **new array reference on every render** while `data` is undefined (loading state). `Object.is` sees a new value, so any effect with `foo` in its deps fires every render. Amplifier: an unselectored `useDesignerStore()` (no selector) subscribes to the entire Zustand store; every `set()` call — even with the same value — produces a new merged-state object and re-notifies all subscribers. The combination creates a render → effect → `set()` → re-render → render loop that hits React's 25-nested-update limit with "Maximum update depth exceeded." The failure only appears on the specific first-boot state where loading data is still undefined — once data arrives, the inline `[]` is replaced by the real array and the loop stops. Diagnosis: add render-count and per-effect `console.log` with the dep values; if an effect fires every render, its deps contain an unstable reference. Fix: hoist empty arrays/objects to module-level constants; always use selectors (`useStore((s) => s.field)`); add equality guards to Zustand setters that run in tight loops.
- **Two independent mDNS advertisers exist for the same job (TD-049).** `server/ommesh/core/DiscoveryService.ts` (newer, OMMESH mesh discovery) and `server/phase2/services/MeshDiscoveryService.ts` (older, `system.aiProviders`/mesh-peer-card plumbing) both call `bonjour().publish(...)` independently. A defensive fix applied to one (the bonjour `error`-listener crash guard) does **not** propagate to the other — they're separate classes with separate bugs, not two call sites of shared code. When touching mDNS/bonjour behavior, grep for **all** `bonjour(` call sites, not just the one you're looking at; assume any fix needs to be mirrored, not shared.
- **A WS/IPC message envelope split across two hand-written type declarations WILL drift (TD-048).** `EmbeddedTerminal.tsx`'s `pty:*` client/server message types and `WebSocketServer.ts`'s `ClientMessage`/`ServerMessage` interfaces were two independent, unlinked declarations describing the same wire protocol — TypeScript has no way to catch a mismatch between two types that never reference each other, even with `pnpm check` fully green. The bug (every keystroke silently dropped) shipped and stayed invisible through the type checker, tests, and casual code review. **Diagnosis pattern:** if a client/server or IPC feature "does nothing" with no error, suspect a message-shape mismatch before suspecting business logic — check literally what key names/nesting each side sends vs. reads. **Fix pattern:** extract the shared shape into one type in `shared/` (or equivalent common module) and import it on both sides; never hand-write the same wire contract twice.
- **Android forbids app access to another app's `Android/data/` — and SAF won't grant Downloads/root either.** Google AI Edge Gallery stores its `.litertlm` models in `/sdcard/Android/data/com.google.ai.edge.gallery/files/<Model>/<hash>/`. On Android 11+ **no app can read another app's `Android/data/` subtree** — not via the SAF folder picker, not even with `MANAGE_EXTERNAL_STORAGE` ("All files access", which explicitly excludes `Android/data` + `Android/obb`). Only adb/root/Samsung "My Files" can. Additionally, SAF's `requestDirectoryPermissionsAsync` **refuses to grant the Downloads folder or the primary-volume root** ("Can't use this folder — choose another") — the user must pick a **sub-folder** (e.g. `Download/OmnecorModels`). So the only user-facing bridge for Gallery models is: My Files → copy `.litertlm` into a sub-folder → Omnecor folder-scan grants that sub-folder. The `dl.google.com/google-ai-edge-gallery/...` CDN URLs in Gallery's `model_allowlist.json` **404 without Gallery's request signing** (tested from the phone), so they can't be re-downloaded into another app.
