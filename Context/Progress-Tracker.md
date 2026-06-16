# Omnecor — Progress Tracker

This living document tracks the execution progress of the 5-phase build roadmap. Unchecked boxes represent pending features, and checked boxes indicate completed and verified items.

---

## 🚦 Current Status
*   **Active Phase:** Phase 5: Mobile App Realization & Verification (F23–F26 code-complete; F27 Windows installer built ✅, on-device verification remaining)
*   **Next Task:** Install `Omnecor-Setup-2.3.0-beta.1.exe` on a real Windows machine, confirm app launches; then F23b on-device wake-word test, Android APK sideload
*   **Gates (2026-06-16):** root `tsc` 0 · APK `tsc` 0 · `vitest` 338/338 passing

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
  *   *Files:* [podcast.tsx](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/app/(tabs)/podcast.tsx), [LocalPodcastService.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/phase2/services/LocalPodcastService.ts), [static.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/_core/static.ts)
  *   *Done (2026-06-15):* **Server:** `generatePodcast` now returns an `audioUrl`; new range-capable `/media/podcast/:jobId` route streams the master mix (UUID-validated, `audio/wav`, `Accept-Ranges`). **Mobile:** the inert "Audio ready: <path>" text button was replaced with a real `expo-audio` player (play/pause + progress/buffering) streaming from the PC, plus a device download via `expo-file-system`. **Add Sources** (your request): new panel for text-paste / website-URL (fetched + tag-stripped) / file-pick (`expo-document-picker`); selected sources feed the AI script generator as context (mirrors the desktop sidebar). Gates: APK `tsc` 0 · root `tsc` 0 · `vitest` 325.
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
- **`MapManager.tsx`** — Neural Maps "cloud indexing is coming soon" (toast + badge). Genuine unbuilt feature, not in Phase 5 list. Build it, or keep as honest placeholder?
- **Remaining `publicProcedure` endpoints are intentional** (verified): `systemRouter.getSettings`/`saveSettings` (Setup Wizard pre-login), `honchoRouter` (explicitly public-by-design for zero-login), and read-only `*.status`/`getProviders`/health probes. No further action recommended unless the threat model changes to untrusted-network multi-user — flagging only so the decision is on record.
- **`dangerouslySetInnerHTML`** in `pcb/SchematicNode.tsx`, `pcb/PCBNode.tsx`, `pcb/ComponentLibraryPanel.tsx` — appear to inject static component SVG (not user content); `ui/chart.tsx` is the standard shadcn CSS-var pattern. Recommend a confirm-static review.

## Known debt (documented, not sweep-fixable — pervasive/established, would require a rewrite)
- **RESOLVED (2026-06-15):** Cleaned up all 83 leftover `if (!db)` null-guards (harmless dead branches since `getDb()` is never null) across the server codebase.
- ~60 default-export components vs Code-Standards §1.1 "named exports only" — established page/lazy pattern.
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
