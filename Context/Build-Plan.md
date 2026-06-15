# Omnecor — System Build Plan & Roadmap

This document outlines the step-by-step roadmap for resolving the security vulnerabilities, mock services, missing bridges, unwired UI switches, and mobile stubs identified across the workspace.

The build is partitioned into **5 phases containing 27 features**, creating a linear execution path to achieve a fully functional application.

**Status legend:** ✅ done · ⬜ pending. Phases 1–4 complete (22/27); Phase 5 pending.

---

## 🛠️ Phase 1: Security Hardening & Access Control — ✅ COMPLETE (5/5)

Resolves high-severity vulnerabilities (RCE, directory traversal, DoS, and CSRF) on the server. Verified: `pnpm check` clean, `pnpm test` 323/323 passing.

*   ✅ **Feature 1: tRPC Procedures Lockdown**
    *   *Task:* Upgrade public procedures in `projectRouter`, `jobRouter`, `agentRouter`, `ommeshRouter`, and `voiceRouter` to `protectedProcedure` or `adminProcedure` to block unauthenticated endpoints access.
    *   *Done:* All `publicProcedure` removed from the five routers; reads/actions → `protectedProcedure`, credential/command/log-deletion ops (`runSandboxCommand`, `prune`, `rotateCert`, `approvePeer`) → `adminProcedure`.
*   ✅ **Feature 2: Safe Subprocess Spawning**
    *   *Task:* Replace all instances of `execAsync` and `child_process.exec` (e.g., in `project.openPath` and bridges) with `child_process.spawn` utilizing safe string argument arrays to eliminate shell injection RCE.
    *   *Done:* `openPath`→`spawn`; ZRAM `&&` shell→two `execFileAsync` sudo calls; OMMESH openssl `execSync`→`execFileSync` arg arrays (SecurityManager + generate-certs); `taskkill`/PowerShell→`execFileSync`. No shell-string exec left in `server/`.
*   ✅ **Feature 3: File Path Sanitization**
    *   *Task:* Enforce the `validatePath` security wrapper on all user-supplied paths across file-system listing, voice transcribing, and model importing procedures.
    *   *Done:* `validatePath` enforced on `voiceRouter.convertVoice`/`listRvcModels` and `modelManagementRouter.register`; `validatePath` itself hardened with separator-aware `isWithin()` boundary checks.
*   ✅ **Feature 4: OAuth Callback CSRF Protection**
    *   *Task:* Implement temporary state cookie verification inside the Express OAuth callback handler (`GET /api/oauth/callback/:platform`) to prevent CSRF account-linking exploits.
    *   *Done:* Double-submit `social_oauth_state` httpOnly cookie (sameSite=lax), set at initiation (`setSocialOAuthStateCookie`) and verified+cleared in the callback before trusting DB state.
*   ✅ **Feature 5: llama.cpp Bridge Directory Containment**
    *   *Task:* Patch `is_safe_model_path` in [llamacpp_bridge.py](file:///home/linux/Documents/OmnecorV1-Beta/server/python_bridges/llamacpp_bridge.py) by appending path separators to check bounds, preventing directory traversal prefix bypasses.
    *   *Done:* Added separator-aware `_is_within()`; sibling-prefix dirs (`~/models-evil`) no longer bypass the allow-list.

---

## 🗄️ Phase 2: Database Layer & Integrity — ✅ COMPLETE (5/5)

Enhances database queries, structural definitions, and transaction consistency.

*   ✅ **Feature 6: Drizzle Relations Schema Definition**
    *   *Task:* Add full relational definitions in [schema.ts](file:///home/linux/Documents/OmnecorV1-Beta/drizzle/schema.ts) using the `relations(...)` builder to support Drizzle relational queries.
    *   *Done:* 20 `relations(...)` definitions added covering all 25 tables with FK links. `relations` imported from `drizzle-orm`.
*   ✅ **Feature 7: Out-of-Band DB Migrations**
    *   *Task:* Extract migration tasks from the server startup event loop. Setup separate setup/deployment commands to avoid blocking server boot sequences.
    *   *Done:* `server/scripts/migrate.ts` standalone runner created; `pnpm db:migrate` script added. Server auto-migration changed to non-fatal (warns + continues rather than throwing).
*   ✅ **Feature 8: Safe Cascading Transactions**
    *   *Task:* Wrap multi-table deletions (such as deleting design projects and corresponding saves in `db-pcb.ts`) inside standard `db.transaction()` wrapper boundaries.
    *   *Done:* `deleteProject`, `deleteDesign`, and `saveDesign` all wrapped in `db.transaction()` for atomic multi-table consistency.
*   ✅ **Feature 9: SQLite Query Audit**
    *   *Task:* Verify all database query helper functions utilize SQLite-supported configurations. Refactor legacy MySQL `(result as any)[0]?.insertId` lookups inside [db-pcb.ts](file:///home/linux/Documents/OmnecorV1-Beta/server/db-pcb.ts#L44) (lines 44, 169, 270, 356, 408) to use SQLite `.returning({ id: <Table>.id })` arrays.
    *   *Done:* All 5 `insertId` patterns replaced with `.returning()`. No `as any` cast remains in `db-pcb.ts`.
*   ✅ **Feature 10: Sovereign Mode Audit Tracking**
    *   *Task:* Verify that `cloudProcedure` blocks are logged in the audit trail when throwing forbidden errors, tracking system compliance.
    *   *Done:* `sovereignCheck` middleware in `trpc.ts` now fire-and-forget logs a `sovereign_block` audit event before throwing FORBIDDEN.

---

## 🧠 Phase 3: Core AI Services & Pipeline Repairs — ✅ COMPLETE (5/5)

Resolves embedding errors, model loading latency, and missing executor script bridges.

*   **Feature 11: Embedding Tokenizer Implementation**
    *   *Task:* Replace the whitespace pseudo-tokenizer in `ONNXEmbeddingService.ts` with a valid BPE tokenizer using `@anthropic-ai/tokenizer` or `@xenova/transformers` to repair ChromaDB query vector math.
*   **Feature 12: Warm Model Memory Caching**
    *   *Task:* Refactor `llamacpp_bridge.py` to cache instantiated model weights in GPU/CPU memory, adding load/unload handlers to eliminate latency on every request.
*   **Feature 13: Agent Python Bridges Creation**
    *   *Task:* Code and deploy the missing `crewai_bridge.py` and `liteagent_bridge.py` bridge scripts in the python bridges folder.
*   **Feature 14: Dynamic Pipeline Phase Engine**
    *   *Task:* Hook the static phase states (`DEFINE`, `PLAN`, `EXECUTE`, `REVIEW`, `SHIP`) in `PipelineEngineService.ts` to `AiProviderService` for dynamic prompt and script validation.
*   **Feature 15: Local Podcast Service Integration**
    *   *Task:* Replace `LocalPodcastService` database mocks and timeout loops with active python daemon calls. Modify `podcast_engine.py` to synthesize real XTTS-v2 turns instead of faking wave floats.

---

## 💻 Phase 4: Desktop Shell & Theme Modernization

Aligns styling tokens and runtime environments across Web and Desktop (Electron).

*   **Feature 16: React 19 Version Alignment**
    *   *Task:* Upgrade the Electron project package manifest to React `^19.2.1` to unify package builds and remove duplicate modules.
*   **Feature 17: tRPC Client Alignment**
    *   *Task:* Align mobile client tRPC dependencies to match the server-side version (`^11.8.0`) to avoid RPC runtime typing mismatch.
*   **Feature 18: Tailwind Token Drift Resolution**
    *   *Task:* Provide static color fallbacks for Tailwind v3/NativeWind in mobile config files to match OKLCH spaces.
*   **Feature 19: Multi-Window External Brain Map**
    *   *Task:* Connect `/brain-map-external` pop-out window with the main tab context, ensuring bidirectional state sync.
*   **Feature 20: Real-Time Telemetry Upgrades**
    *   *Task:* Unify Express websocket hooks to push CPU/GPU/VRAM load parameters dynamically to the Dashboard metrics graphs.
*   **Feature 21: mDNS Discovery Integration**
    *   *Task:* Replace the constructor stub in `MeshDiscoveryService.ts` with a functional mDNS advertisement/listener daemon.
*   **Feature 22: RVC Server Fallback Repair**
    *   *Task:* Setup actual voice feature extraction paths and model checkloads in `rvc_server.py`, replacing mock array fallbacks.

---

## 📱 Phase 5: Mobile App Realization & Verification

Resolves mobile storage vulnerabilities and wires up non-functional stubs.

*   **Feature 23: Secure KeyStore Encryption**
    *   *Task:* Replace unencrypted AsyncStorage with `expo-secure-store` in the mobile app to save the `omnecor_ommesh_secret` and chat histories inside the hardware KeyStore.
*   **Feature 24: Mobile 3D Canvas Interactivity**
    *   *Task:* Implement real touch-rotation, mesh selections, and format export logic inside the mobile 3D Viewer WebView container.
*   **Feature 25: Mobile Podcast Controls and Settings**
    *   *Task:* Program the audio player controls UI triggers and `onPress` callbacks inside the mobile Podcast screen. Wire settings dark mode toggle to update color schemes.
*   **Feature 26: Unwired Frontend Elements**
    *   *Task:* Bind state setters and handler actions for Curation Feed dismiss, Podcast history, Google Drive/Dropbox integrations, AgentNetworking checkboxes, and SettingsPanel's 14 locked switches.
*   **Feature 27: End-to-End Build Smoke Tests**
    *   *Task:* Execute full automated build sequences for web, Electron, and Android APK platforms to verify functional parity.

---

# Appendix A: Source Audit — Detailed Findings (2026-06-14)

> The detailed multi-agent swarm static-analysis findings that drove the 27-feature plan above (merged from `jun14-review.md`). Each maps to a Phase/Feature.

## 🚨 Critical Security Vulnerabilities

1.  **RCE via `project.openPath`** — `projectRouter.ts:L348-L370`, `publicProcedure` (unauthenticated). User-supplied path resolved and run via `execAsync(\`xdg-open "${targetDir}"\`)`; shell metacharacters (`"; rm -rf / ;"`) allow arbitrary command execution. **Fix:** `protectedProcedure`/`adminProcedure` + `validatePath` + `spawn` arg array. → Phase 1 Features 1–2.
2.  **Unauthenticated Sandbox Command Exec & DoS** — `jobRouter.ts:L82-L135`, `publicProcedure`. `runSandboxCommand`/`cancel`/`prune` public → arbitrary Docker containers, job-record deletion, DB prune. **Fix:** `protected`/`admin` + CPU/RAM bounds. → Phase 1 Feature 1.
3.  **RCE via `mcp.connectServer`** — `mcpRouter.ts:L11-L37`, `protectedProcedure` but no role check. Any user passes `command`+`args` over stdio transport → launch arbitrary executables. **Fix:** `adminProcedure` or `requirePermission('mcp_server','manage')`.
4.  **Unauthenticated Agent/Workflow Orchestration** — `agentRouter.ts:L20-L47`, `publicProcedure`. `runCrew`/`runLiteAgent`/`triggerN8n` public → CPU-heavy loops + external n8n triggers + token depletion. **Fix:** `protectedProcedure`. → Phase 1 Feature 1.
5.  **Unauthenticated OMMESH Peer/Cert Admin** — `ommesh.router.ts:L26-L44`, `publicProcedure`. `rotateCert`/`approvePeer` public → DoS cert cycles, rogue fingerprint approval (MITM). **Fix:** `adminProcedure`. → Phase 1 Feature 1.
6.  **Directory Traversal & Arbitrary File Read** — `projectRouter.ts:L276` & `voiceRouter.ts:L98-L228`, `publicProcedure`. `getFileTreeFlat` lists any folder; `listRvcModels` recurses user dir to depth 4; `transcribe`/`convertVoice` read absolute paths (e.g. `.env`) via `fs.readFile`. **Fix:** `protectedProcedure` + `validatePath`. → Phase 1 Features 1, 3.
7.  **CSRF in Express OAuth Callback** — `oauth.ts:L473-L556`. `GET /api/oauth/callback/:platform` consumes query `state` with no cookie/session verification → forced account linking. **Fix:** temporary state cookie check. → Phase 1 Feature 4.
8.  **Path Traversal Prefix Bypass in llama.cpp Bridge** — `llamacpp_bridge.py:L23-L27`. `is_safe_model_path()` uses `real.startswith(...)`; `/opt/omnecor/models_attacker/` passes a `/opt/omnecor/models` allow-list. **Fix:** append `os.path.sep` / containment check. → Phase 1 Feature 5.

## ⚠️ Severe Functional Issues

1.  **Corrupted Vector Embeddings** — `ONNXEmbeddingService.ts:L30-L31`. `text.split(/\s+/).map((_, i) => i + 1).slice(0, 512)` — every same-length string yields identical IDs → broken vector search. **Fix:** real tokenizer (`@anthropic-ai/tokenizer` / `@xenova/transformers`). → Phase 3 Feature 11.
2.  **Model Loading Latency Every Request** — `llamacpp_bridge.py:L47-L57`. `Llama` weights re-loaded per `/generate` call → 10s+ latency for multi-GB GGUF. **Fix:** keep instance warm + load/unload handler. → Phase 3 Feature 12.
3.  **Missing CrewAI & LiteAgent Bridges** — `AgentService.ts:L143` & `L183` spawn `crewai_bridge.py` / `liteagent_bridge.py` which do not exist → spawn crashes. **Fix:** write the bridges or stub recovery. → Phase 3 Feature 13.
4.  **Static Pipeline Plan Outputs** — `PipelineEngineService.ts:L11-L24`. `DEFINE/PLAN/EXECUTE/REVIEW/SHIP` use static string placeholders in `phaseOutput()`; no LLM behind execution. **Fix:** hook to `AiProviderService`. → Phase 3 Feature 14.

## 📦 Monorepo & Styling Inconsistencies

1.  **React Version Mismatch** — Root `^19.2.1`, Electron `^18.2.0`, Android `19.1.0` → duplicate node_modules + RN `Cannot read property 'useContext' of null`. **Fix:** align to React 19. → Phase 4 Feature 16.
2.  **Tailwind v3 vs v4 Token Drift** — Web/Electron Tailwind v4 OKLCH (`Globals.css`); Mobile Tailwind v3/NativeWind v4 (no OKLCH) → duplicate colors in `theme.config.js`. **Fix:** upgrade mobile to Tailwind v4 + NativeWind v5 (`react-native-css`), or static hex fallbacks. → Phase 4 Feature 18.
3.  **Plaintext Node Secrets in AsyncStorage** — `server-config.ts:L23`. `omnecor_ommesh_secret` written plaintext to AsyncStorage. **Fix:** Expo `SecureStore` (Android KeyStore). → Phase 5 Feature 23.
4.  **Non-Functional Mobile UI Stubs** — 3D Viewer static cube/sphere WebView (Modify/Export warn-only); Podcast "Audio ready" has no `onPress`; Settings Dark Mode toggle doesn't call `useThemeContext()`. → Phase 5 Features 24–26.

---

# Appendix B: Mobile APK (Omnecor HQ) — Build & Distribution Guide

> Merged from `packaging/android/omnecor-hq/BUILD.md`. Remote command center for OmnecorV1-Beta over Tailscale or LAN Wi-Fi. Features: Chat, HITL, Status, Terminal, Podcast, 3D Viewer, Voice STT/TTS, and bidirectional OMMESH AI node.

## Prerequisites
| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 9.12+ | `npm i -g pnpm` |
| Expo CLI | latest | `pnpm add -g expo-cli` |
| JDK | 17 | Android Studio SDK → SDK Tools |
| Android SDK | 34 | Android Studio |
| Android NDK | r26+ | SDK Manager → NDK (Side by side) |
| CMake | 3.22+ | SDK Manager → CMake |

> **NDK is required** because `llama.rn` compiles C++ (llama.cpp) native code.

## Build steps
```bash
# 1. Install
cd packaging/android/omnecor-hq
pnpm install

# 2. Generate native project (run once / when app.config.ts or native packages change)
pnpm prebuild:android        # = expo prebuild --platform android --clean

# 3a. RELEASE APK — use for sideloading / standalone testing (BUNDLES JS; debug-signed,
#     installs with plain adb, no keystore needed)
pnpm apk:release             # → android/app/build/outputs/apk/release/app-release.apk

# 3b. Debug APK — development only; does NOT bundle JS (needs Metro `pnpm dev:metro`
#     reachable from the phone). Sideloaded alone it shows "could not connect to dev server".
pnpm apk:debug
```
> ⚠️ Sideloading for a real-world test → build the RELEASE apk. A debug APK without Metro "starts dead" (missing JS bundle, not a bug).

## Release Signing

Release keystore generated (`android/app/omnecor-release.keystore`, 4096-bit RSA, alias `omnecor-release`, valid 10,000 days). Already configured in `android/app/build.gradle` under `signingConfigs.release`. Keystore is gitignored (`*.keystore` in `.gitignore`).

**Passwords** (change before shipping to production):
```
storePassword / keyPassword = omnecor2026   ← default
```
Override for CI without hardcoding:
```bash
export OMNECOR_KEYSTORE_PASSWORD=<secret>
export OMNECOR_KEY_PASSWORD=<secret>
pnpm apk:release
```
To regenerate the keystore from scratch:
```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore android/app/omnecor-release.keystore \
  -alias omnecor-release -keyalg RSA -keysize 4096 \
  -validity 10000 \
  -dname "CN=Omnecor, OU=Mobile, O=Omnecor, L=Unknown, S=Unknown, C=US"
```

## nanoid / Hermes crypto fix (metro.config.js)

**Root cause:** nanoid's `package.json` sets `"react-native": "index.js"`. Metro reads this field (higher priority than `browser`) and loads the Node.js entry, which calls `crypto.randomFillSync` — a Node.js API not present in Hermes. `react-native-get-random-values` patches `global.crypto.getRandomValues` (Web Crypto), a completely different API.

**Fix (already applied):** `metro.config.js` intercepts `moduleName === "nanoid"` and returns `index.browser.js` (Web Crypto path) directly. Sub-paths like `nanoid/non-secure` fall through to normal resolution.

**If you see `crypto.randomFillSync is not a function` on device**, the Metro resolver fix is in place but the APK was built before it was applied. Rebuild:
```bash
cd packaging/android/omnecor-hq
pnpm prebuild:android && pnpm apk:release
```

## Sideload to device
```bash
adb uninstall com.omnecor.mobilehq                                      # match signature
adb install android/app/build/outputs/apk/release/app-release.apk
# or: adb push .../app-release.apk /sdcard/Download/  (open via Files app)
```

## Tailscale (remote access from anywhere — no port forwarding)
```bash
# PC: curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up && tailscale ip  (note 100.x.x.x)
# Phone: install Tailscale from Play Store, sign in to same account.
# APK Settings → Omnecor Server → enter PC's 100.x.x.x, port 3000 → Test → Save.
# Firewall if Test fails (Linux UFW): allow 3000/tcp (server), 8001/tcp (Whisper), 8002/tcp (TTS).
```

## Voice
*   **Whisper STT:** runs on PC port 8001 — `uvicorn server.python_bridges.whisper_server:app --port 8001`. APK: tap 🎤 in Chat.
*   **Device TTS:** Android built-in engine (no server). Toggle 🔊 to auto-read; long-press a message to read; speed in Settings → Voice.

## OMMESH Phone AI Node
1.  **Load a model:** download a GGUF (e.g. Qwen2.5-7B-Q4_K_M ~4.7 GB) to `Documents/models/…`; Settings → Phone AI Model → Load Selected Model.
2.  **Register:** Settings → OMMESH Network → enable, enter `OMMESH_SECRET` (must match PC `.env`), name the node → Save & Connect → AI Node tab shows status/stats.
3.  **PC handlers** in `WebSocketServer.ts` already handle `mobile_node_register` / `mobile_node_heartbeat` / `mobile_inference_request`+`response` / `mobile_node_ack`. `aiRouter.ts` exposes the phone as provider `"ommesh"` ("Phone — {nodeName}"). No code changes; set `OMMESH_SECRET=…` (optional, recommended).
*   **Bidirectional:** Old PC → S25 Ultra (phone handles 4B–7B at 20–55 tok/s via NPU); S25 Ultra → powerful PC (large models / vision). Works over Tailscale.

## Stage the APK output
```bash
cp android/app/build/outputs/apk/debug/app-debug.apk ../omnecor-hq-debug.apk   # from packaging/android/omnecor-hq/
```

## Package details
| Field | Value |
|-------|-------|
| App name | Omnecor HQ |
| Package | `com.omnecor.mobilehq` |
| Min Android | 7.0 (API 24) |
| Target SDK | 34 |
| Architectures | arm64-v8a, armeabi-v7a |
| Framework | React Native 0.81 + Expo SDK 54 |
| On-device LLM | llama.rn (GGUF) + MediaPipe/LiteRT (`.task`, Google AI Edge Gallery) |

## Authentication (sovereign / self-host)
Omnecor is **local-first** — no cloud accounts/OAuth/config files needed.
*   **Local account (recommended):** first launch → **Create a local account** (username, optional password); works offline and **auto-registers on your PC** the first time it connects (no second login). "Skip — explore offline" browses with no account.
*   **Google / Microsoft sign-in (optional):** no code/`.env` edits — on the **desktop** go to **Settings → Social Login**, register your *own* OAuth app, paste Client ID + Secret, copy the shown redirect URIs into the provider console. Stored encrypted in `~/.omnecor/settings.json`. Then the APK's "Continue with Google/Microsoft" buttons work via the PC.

## On-device AI models (no manual steps)
*   **GGUF (llama.rn):** Settings → Phone AI Model → Download a recommended model, or 📂 Import a `.gguf` already on the device.
*   **LiteRT `.task` (Google AI Edge Gallery):** Edge Gallery → Share → Omnecor HQ the `.task` file (or Settings → Import a .task model), then Load. (Android sandboxing means sharing the file in is the one step it can't automate.)

---

# Appendix C: Mobile APK Feature Specification

> Merged from `packaging/android/omnecor-hq/APK-feature-plan.md`. Runs on Samsung Galaxy S25 Ultra (Snapdragon 8 Elite) and any Android 7.0+ device.

## Core Architecture
*   **Runtime:** React Native 0.81 + Expo SDK 54 (native APK, not a WebView wrapper); expo-router v6 (file-based tabs); NativeWind v4; tRPC v11 + TanStack Query v5; New Architecture enabled (`newArchEnabled: true`).
*   **Connection Modes:** **LAN** (direct Wi-Fi `192.168.1.x`, fastest); **Tailscale** (`100.x.x.x`, works anywhere); **Offline** (on-device inference only).
*   **App Identity:** package `com.omnecor.mobilehq`; name "Omnecor HQ"; Min API 24; Target SDK 34; arm64-v8a + armeabi-v7a.

## Feature 1 — Remote Chat
Multi-session chat (named sessions via dropdown); Neural Map selector; Agent selector; fallback chain (PC unreachable → on-device model → error w/ instructions); streaming via `onToken`. **Voice In (STT):** 🎤 → expo-audio record → POST FormData to `:8001/transcribe` (Whisper) → fills input. **Voice Out (TTS):** 🔊 auto-reads each AI reply; long-press a message to read; Android expo-speech (no server); markdown stripped; 2000-char limit; speed 0.75/1.0/1.25/1.5×. **Status:** 🟢 server reachable, 🤖 on-device model loaded.

## Feature 2 — Bidirectional OMMESH Phone AI Node (flagship)
*   **Two directions:** Phone → serves weak PC (Snapdragon 8 Elite NPU, 45 TOPS); PC → serves phone (vision / large context).
*   **On-device (llama.rn):** Vulkan (GPU) / NNAPI (NPU), `n_gpu_layers: 99`, 4096 ctx, GGUF Q4_K_M. Recommended: Qwen2.5-7B-Q4_K_M (4.7 GB, best), Llama-3.2-3B (2.0 GB, fastest), Mistral-7B (4.4 GB), Llama-3.1-8B (4.9 GB).
*   **WS Node Protocol:** phone opens `ws://{PC}:{PORT}/ws`; sends `mobile_node_register {nodeId,nodeName,secret,capabilities}`; PC `mobile_node_ack {accepted,reason?}`; 10s `mobile_node_heartbeat {stats{tokensPerSec}}`; PC `mobile_inference_request {requestId,prompt,options}`; phone streams `mobile_inference_response {requestId,content,done}`; 8s reconnect backoff; nodeId `nanoid(12)` per session.
*   **Screen UI:** color-coded status card, spinner, "no server" warning, connect/disconnect, stats grid, model status, capabilities table, test-inference panel, architecture text.

## Feature 3 — Settings (7 sections)
Omnecor Server (IP/host + port 3000 + Test `/health` 5s + Save, runtime IP no rebuild); OMMESH Network (enable, node name, secret, Save & Connect); Voice (STT/TTS toggles + speed); Phone AI Model (4-model selector, Load/Unload, file-exists check); Execution Mode (Sovereign/Scrapper/Big Spender); Appearance (Dark/Light); About/Auth (version, Logout clears SecureStore).

## Feature 4 — HITL Approval
Alert list + unread badge; types `approval`/`alert`/`warning`; filter; Approve/Reject; Mark Read. Wired: subscribe WS `actionPending` on `hitl` channel; `agent.approveAction`/`rejectAction`.

## Feature 5 — System Status Monitor
OMMESH Phone Node panel (mesh status, node ID, PC IP, inference stats, model status); PC Tasks panel (running/completed/failed counters + filter, per-task name/status/progress/ETA, Cancel/Refresh). Wired via WS `trainingProgress`+`lifecycle` or `jobs.list`.

## Feature 6 — Remote Terminal
Scrollable mono output, command input + Enter, history ↑/↓, clear. Wired: `pty:spawn` / `pty:input {data}` / `pty:output {data}` / `pty:resize` (PC already has PTY handlers).

## Feature 7 — Podcast Studio
Title/description/script inputs, voice selector (Default/Male/Female/Narrator/Casual), duration/quality, Generate, progress bar, Download. Wired: `podcast.generate` tRPC + WS progress + audio URL.

## Feature 8 — 3D Viewer
View-mode selector 3D/Schematic-PCB/Code; component list; AI panel + Analyze/Modify/Export. Wired: `blender`/`comfy` tRPC, `ai.chat`, `blender.export`.

## Feature 9 — Tailscale Integration
Virtual LAN (`100.x.x.x`) — OMMESH WS + Whisper POST work identically vs LAN. Setup: install Tailscale on PC + phone (same account); enter Tailscale IP in Settings; open ports 3000/8001/8002 if needed.

## Feature 10 — Auth & Session
OAuth via OmnecorV1-Beta portal; deep-link `omnecor-hq://oauth/callback`; token via `GET /api/oauth/mobile?code=…`; JWT in `expo-secure-store` (hardware-backed); `Authorization: Bearer {token}` on all requests; survives restarts; logout clears token.

## Feature 11 — Build & Distribution
See Appendix B. `pnpm install → pnpm prebuild:android → pnpm apk:debug` (or `apk:release`); `pnpm apk:install` (USB+adb); copy `app-debug.apk` → `OmnecorV1-Beta/packaging/android/omnecor-hq-debug.apk`.

## Integration Map: APK ↔ OmnecorV1-Beta (original spec status, now mostly wired — see UI-Registry)
Chat `ai.chat`; Chat Neural Maps `neuralMaps.list`; Chat Agents `agent.list`/`personas.list`; OMMESH register/inference/stats WS; Voice STT `:8001/transcribe`; Voice TTS device; HITL `actionPending`+`agent.approveAction`; Status `lifecycle`+`jobs.list`; Terminal `pty:*`; Podcast `podcast.generate`; 3D `blender.*`; Auth `/api/oauth/mobile`+`/api/auth/me`; Execution Mode `settings.setExecutionMode`.

## Phone Hardware Utilization
On-device LLM → Snapdragon 8 Elite + Hexagon NPU (45 TOPS) via Vulkan/NNAPI; STT → mic + expo-audio; TTS → Android engine (CPU); OMMESH → Wi-Fi/Tailscale; chat → server or NPU fallback; session storage → hardware Keystore (SecureStore).

---

# Appendix D: Mobile APK Build Task Status

> Merged from `packaging/android/omnecor-hq/APK-todo.md`.

## ✅ Done
*   **Cleanup & spec alignment (2026-06-13):** removed `apk-staging` symlink + workspace-member lockfile + nested build cruft; fixed stale `apk-staging` paths in BUILD.md; merged HITL into Alerts (9→8 tabs); theme parity (`theme.config.js` teal `#0a7ea4` → blue `#1d4ed8`/`#3b82f6`); 3D viewer preview-only; `tsc --noEmit` clean.
*   **Project setup:** copied template → `omnecor-hq/`; renamed package; bundle ID + app name; APK build scripts; `RECORD_AUDIO`+`INTERNET` perms; `.env.example`; registered pnpm workspace.
*   **Assets:** icon/splash/foreground/favicon copied.
*   **Deps:** `expo-speech ~13.0.0`, `llama.rn ^0.9.0`, `nanoid ^3.3.7`, `expo-file-system ~18.0.12`.
*   **Icon mapping:** full SF Symbol → Material Icons in `icon-symbol.tsx`, matched to desktop GUI.
*   **Core lib files:** `server-config.ts`, `local-inference.ts`, `mobile-mesh-node.ts`.
*   **Hooks:** `use-voice.ts`, `use-ommesh-node.ts`, `use-jobs.ts`, `use-hitl.ts`, `use-terminal.ts`.
*   **Screens:** rewrote `_layout.tsx` (8 tabs), `index.tsx` (Chat), `settings.tsx` (7 sections), `status.tsx` (OMMESH + real jobs), created `ai-node.tsx`; HITL merged into `notifications.tsx`.
*   **PC-side:** all 6 `mobile_node_*` WS handlers + `routeInferenceToMobile()`/`getMobileNodes()`/`hasMobileWorker()`; `aiRouter` provider `"ommesh"`; `hitlRouter` (`getPending`/`resolve`) + `hitl:pending`; `jobs.list`/`jobs.cancel`; `auth.setExecutionMode`.
*   **NDK build:** NDK r26+ + CMake 3.22+ verified; `prebuild:android` + `apk:debug` compiled native libs → `app-debug.apk` (100 MB).
*   **Per-screen wiring:** Chat Neural Map/Agent selectors (`neuralMaps.list`/`personas.list`); Status jobs (Cancel/Refresh; Pause/Resume removed — no PC endpoint); Terminal full PTY (resize on rotation, ^C, history, 40k buffer cap); Podcast `podcast.generate` (audioPath); 3D preview-only (AI panel removed); Execution Mode read+sync.

## 🔴 / 🟡 / 🔵 Remaining
*   **Critical:** download GGUF to phone `Documents/models/` + verify Load (runtime, not code).
*   **Important:** import PC `AppRouter` type for full tRPC type safety; session persistence across launches (now done via `chat-store.ts`); podcast streaming progress + voice list from PC config; 3D wire to `blender`/`comfy` for real models.
*   **Enhancement:** OAuth login screen + token-expiry handling; RoutingEngine auto-prefer phone; node capability advertisement; voice activity detection / PC TTS option / Whisper status; chat streaming display + session rename/delete/export; physical S25 Ultra test (Vulkan/NNAPI); Tailscale subnet-routing docs + IP auto-detect.
*   **Docs:** model download links (HF URLs); document PC WS handler additions.
*   **`OMMESH_SECRET`** not yet set in PC `.env` — mobile nodes accepted with a warning until set.

## Deferred (DEFERRED note)
Dedup/remove dead `server/`, `drizzle/`, duplicate `shared/` scaffolding (older template fork; only the `AppRouter` type is imported); graft mobile `llm.ts` `fetchWithBackoff` retry helper into main `server/_core/llm.ts`.
