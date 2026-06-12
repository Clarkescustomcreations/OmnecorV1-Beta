# Omnecor HQ APK — Full TODO

---

## ✅ DONE

### Project Setup
- [x] Copy `omnecor-mobile-main` → `apk-staging/` as staging folder
- [x] Update `package.json` name: `app-template` → `omnecor-hq`
- [x] Update `app.config.ts` bundle ID: `com.omnecor.mobilehq`
- [x] Update `app.config.ts` app name: `"Omnecor HQ"`
- [x] Add APK build scripts: `prebuild:android`, `apk:debug`, `apk:release`, `apk:install`
- [x] Add Android permissions: `RECORD_AUDIO`, `INTERNET`
- [x] Create `.env.example` with Tailscale quick-start documentation
- [x] Rename `apk-staging/` → `omnecor-hq/` and register as pnpm workspace package (`packaging/android/omnecor-hq`)

### Assets
- [x] Copy `app_icon_1024.png` → `assets/images/icon.png` (was missing, blocked prebuild)
- [x] Copy `app_icon_1024.png` → `assets/images/splash-icon.png`
- [x] Copy `app_icon_192.png` → `assets/images/android-icon-foreground.png`
- [x] Copy `favicon_32.png` → `assets/images/favicon.png`

### Dependencies Added
- [x] `expo-speech ~13.0.0` — device TTS
- [x] `llama.rn ^0.9.0` — on-device GGUF inference (NPU)
- [x] `nanoid ^3.3.7` — node ID generation

### Icon Mapping
- [x] Expand `components/ui/icon-symbol.tsx` with full SF Symbol → Material Icons mapping
- [x] Match icons to OmnecorV1-Beta desktop GUI (MessageCircle→chat, Brain→psychology, Zap→bolt, etc.)
- [x] Add all utility icons: xmark, checkmark, wifi, lock, volume, mic-off, etc.

### Core Library Files (New)
- [x] Create `lib/_core/server-config.ts` — runtime IP persistence via AsyncStorage; `loadServerConfig`, `saveServerConfig`, `getServerBaseUrl`, `getWhisperUrl`, `getTTSUrl`, `getWsUrl`, `getOmmeshSecret`, `getNodeName`, `isServerConfigured`
- [x] Create `lib/_core/local-inference.ts` — llama.rn wrapper; `loadModel`, `runInference`, `releaseModel`, `getStatus`, `isModelLoaded`, `getLoadedModelPath`, `subscribeStatus`, `getStats`, `recordStats`, `RECOMMENDED_MODELS`
- [x] Create `lib/_core/mobile-mesh-node.ts` — OMMESH WebSocket phone node; `connect`, `disconnect`, `getNodeStatus`, `getNodeId`, `subscribeStatus`, `subscribeStats`; auto-reconnect (8s), heartbeat (10s), inference request handler

### Hooks (New)
- [x] Create `hooks/use-voice.ts` — expo-audio recording → Whisper STT (POST FormData to PC:8001); expo-speech TTS; markdown stripping; 2000-char limit; exports `startRecording`, `stopAndTranscribe`, `speak`, `stopSpeaking`
- [x] Create `hooks/use-ommesh-node.ts` — reactive hook wrapping mobile-mesh-node; returns `{ status, nodeId, stats, isConnected, isRegistered, connect, disconnect }`

### Screens (Rewritten or Created)
- [x] Rewrite `app/(tabs)/_layout.tsx` — 8 tabs with desktop-matching icons (Chat, HITL, AI Node, Status, Terminal, Podcast, 3D View, Settings)
- [x] Rewrite `app/(tabs)/index.tsx` (Chat) — voice input (mic button), TTS toggle, auto-read, long-press to read, ai.chat fetch with local inference fallback, connection status indicator
- [x] Rewrite `app/(tabs)/settings.tsx` — 7 sections: Omnecor Server, OMMESH Network, Voice, Phone AI Model, Execution Mode, Appearance, About/Logout
- [x] Update `app/(tabs)/status.tsx` — add OMMESH node status panel at top; real mesh stats, model status; existing mock task list retained
- [x] Create `app/(tabs)/ai-node.tsx` — new screen: node status card, connect/disconnect, inference stats, model status, phone capabilities table, test inference panel, architecture explanation

### Documentation
- [x] Create `BUILD.md` — complete build guide: prerequisites, install, prebuild, APK build, sideload, Tailscale setup (PC + phone + firewall), Whisper STT, OMMESH node setup, stage copy command, package details table
- [x] Create `APK-input-tracker.md` — exhaustive catalog of every input/output/function/API call labeled connected or stub
- [x] Create `APK-feature-plan.md` — full feature and function listing for all 8 tabs

---

## 🔴 TODO — Critical (Blocks Core Features)

### PC-Side WebSocket Handlers — ✅ DONE
- [x] Add `mobile_node_register` handler to `OmnecorV1-Beta/server/phase2/websocket/WebSocketServer.ts`
  - Validates `OMMESH_SECRET` (allows + warns if unset, for local dev)
  - Stores `ws` + capabilities in `mobileNodes` Map; tags socket with `mobileNodeId`
  - Responds with `mobile_node_ack { accepted: true }`
- [x] Add `mobile_inference_request` dispatch — via public `routeInferenceToMobile(prompt, opts)` method
- [x] Add `mobile_inference_response` handler — matches by `requestId`, streams via `pendingInferences` Map, calls `onToken`, resolves on `done`
- [x] Add `mobile_node_heartbeat` handler — updates node `lastSeen` + stats; keeps `modelLoaded` flag current
- [x] Add `mobile_node_ack` send on registration — accepted/rejected response
- [x] Clean up node + fail in-flight inferences on socket close (`removeMobileNode`)
- [x] Public API for RoutingEngine: `getMobileNodes()`, `hasMobileWorker()`, `routeInferenceToMobile()`
- [x] Type-checks clean (`tsc --noEmit` → 0 errors)
- [x] **Wired `aiRouter` to the phone — loop closed.** Reserved provider id `"ommesh"`:
  - `ai.getProviders` surfaces a "Phone — {nodeName}" provider only while a phone is registered with a model loaded
  - `ai.chat` (blocking) routes to the phone via `routeInferenceToMobile()` when `providerId === "ommesh"`
  - `ai.chatStream` streams the phone's tokens through the existing subscription (`{content, delta, done}`)
  - Clear `PRECONDITION_FAILED` error if no worker is available
- [ ] **Remaining:** set `OMMESH_SECRET` in `OmnecorV1-Beta/.env` to enforce auth (currently accepts unauthenticated with a warning)
- [ ] **Optional:** auto-prefer the phone (route without explicit `"ommesh"` selection) — deliberately left explicit so the PC doesn't silently offload to a small phone model

### llama.rn NDK Build
- [ ] Verify Android NDK r26+ is installed: `Android Studio → SDK Manager → SDK Tools → NDK (Side by side)`
- [ ] Verify CMake 3.22+ installed: `Android Studio → SDK Manager → SDK Tools → CMake`
- [ ] Run `pnpm install` (includes llama.rn)
- [ ] Run `pnpm prebuild:android` — generates `android/` Gradle project with llama.cpp C++ compilation
- [ ] Verify llama.rn compiles: check `android/app/build/` for `.so` native libraries
- [ ] Run `pnpm apk:debug` — produces `android/app/build/outputs/apk/debug/app-debug.apk`

### Model Download
- [ ] Download GGUF model to phone: `Qwen2.5-7B-Instruct-Q4_K_M.gguf` (~4.7 GB, recommended)
  - Or: `Llama-3.2-3B-Instruct-Q4_K_M.gguf` (~2.0 GB, faster)
  - Source: Hugging Face
- [ ] Copy file to phone at: `Documents/models/{filename}.gguf`
- [ ] Verify path in Settings → Phone AI Model → Load

---

## 🟡 TODO — Important (Real API Wiring)

### Chat Screen
- [x] Wire Neural Map selector to `neuralMaps.list` tRPC endpoint on PC
- [x] Wire Agent selector to `agent.list` tRPC endpoint on PC (wired to `personas.list`)
- [x] Send `selectedNeuralMap` and `selectedAgent` in the `ai.chat` request body
- [ ] Import PC `AppRouter` type (or generate type stubs) so tRPC client has full type safety
- [ ] Add session persistence — save/load `sessions` array from AsyncStorage across app launches

### Status Screen — ✅ DONE
- [x] Created `hooks/use-jobs.ts` — snapshot via `jobs.list`, live updates on `training:all` channel (lifecycle = state, trainingProgress = progress), `jobPercent()` helper
- [x] Rewrote `app/(tabs)/status.tsx` — real PC jobs replace mock tasks; live state badges, progress bars, counts, state filter; kept the live OMMESH node panel on top
- [x] Wired Cancel → `jobs.cancel`; wired Refresh → `jobs.list`
- [x] NOTE: Pause/Resume removed — the PC's ProcessManagerService only exposes `cancel` (no pause/resume endpoints exist)

### HITL Screen — ✅ DONE
- [x] **PC:** created `server/routers/hitlRouter.ts` (`hitl.getPending` query, `hitl.resolve` mutation) — exposes `HITLApprovalService`; registered in `routers.ts`; type-checks clean
- [x] Created `lib/_core/ws-channels.ts` — shared single-socket channel pub/sub (subscribe/unsubscribe, auto-reconnect)
- [x] Created `lib/_core/trpc-fetch.ts` — direct tRPC-over-HTTP helper (superjson `{json}` wrap), matches Chat's pattern
- [x] Created `hooks/use-hitl.ts` — initial snapshot via `hitl.getPending`, live `actionPending` on `hitl:pending` channel, optimistic `resolve`
- [x] Rewrote `app/(tabs)/hitl.tsx` — live pending queue (real `CriticalAction` shape: toolName/args/riskLevel), Approve/Reject → `hitl.resolve`, manual refresh

### Terminal Screen — ✅ DONE
- [x] Created `hooks/use-terminal.ts` — dedicated WS to PC `/ws`, drives `pty:spawn`/`pty:input`/`pty:output`/`pty:exit`/`pty:kill`
- [x] Rewrote `app/(tabs)/terminal.tsx` — live shell, status bar, auto-connect on mount, ANSI-stripped output stream, auto-scroll
- [x] Real command execution (`sendCommand` appends newline → runs in real PC shell)
- [x] Ctrl+C interrupt button (`\x03`), Clear, Connect/Disconnect
- [x] Command history ↑/↓ (local)
- [x] Output buffer capped at 40k chars; CR/LF normalized
- [ ] **Optional later:** PTY resize on device rotation; full xterm rendering (currently plain mono text)

### Podcast Screen
- [x] Wire Generate button to `podcast.generate` tRPC on PC
- [ ] Show real generation progress from WebSocket events (currently set to 100% on completion, not streamed)
- [x] Wire Download button to fetch generated audio file from PC (shows audioPath)
- [ ] Populate voice list from PC voice configuration

### 3D Viewer Screen
- [ ] Wire to PC `blender` or `comfy` tRPC endpoints for actual 3D models
- [ ] Load and render real model data (replace static component list)
- [ ] Wire AI panel query input to `ai.chat` or a dedicated `blender.askAbout` endpoint
- [ ] Wire Analyze/Modify/Export buttons to respective tRPC calls

### Settings — Execution Mode
- [x] Send chosen execution mode (`sovereign`/`scrapper`/`big_spender`) to PC via `settings.setExecutionMode` tRPC
- [x] Read current mode from PC on Settings screen load

---

## 🔵 TODO — Enhancement (Nice to Have)

### Auth
- [ ] Wire OAuth login flow — currently `startOAuthLogin()` exists but is never triggered from a login screen
- [ ] Add login screen / onboarding flow for first launch when no session token exists
- [ ] Handle token expiry — detect 401 and re-authenticate

### OMMESH
- [ ] Integrate mobile node with PC `RoutingEngine` — when a PC inference request arrives, RoutingEngine should prefer phone if phone is registered and model is ready
- [ ] Show live active inference job on AI Node screen when PC is routing to phone
- [ ] Add node capability advertisement (context length, max tokens/s, model name) in `mobile_node_register`
- [ ] Persist node registration across app restart (reconnect automatically if OMMESH enabled)

### Voice
- [ ] Add option to use PC TTS server (`getTTSUrl()` at port 8002) as alternative to device TTS
- [ ] Show Whisper server status (online/offline) in Settings
- [ ] Add voice activity detection so mic auto-stops on silence

### Chat
- [ ] Add file attachment upload (📎 button has no handler)
- [ ] Add image capture and send (📷 button has no handler)
- [ ] Add streaming response display for `ai.chat` (currently shows final response)
- [ ] Implement proper session management — rename sessions, delete sessions, export chat

### Build & Distribution
- [ ] Set up release signing keystore for `pnpm apk:release`
- [ ] Copy built APK to `OmnecorV1-Beta/packaging/android/omnecor-hq-debug.apk`
- [x] Add `expo-file-system` dependency (needed for `FileSystem.getInfoAsync` in Settings model load check)
- [ ] Test on physical S25 Ultra — verify Vulkan/NNAPI llama.rn backend activates

### Tailscale
- [ ] Document Tailscale subnet routing for cases where PC has multiple network interfaces
- [ ] Add auto-detection of Tailscale IP from `/api/network/interfaces` if PC exposes it

---

## 📋 TODO — Documentation

- [ ] Update `BUILD.md` with actual build output once first successful `apk:debug` completes
- [ ] Document PC-side WebSocket handler additions in `BUILD.md`
- [ ] Document model download links (Hugging Face URLs for each recommended model)
