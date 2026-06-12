# Omnecor HQ — APK Feature Plan

Remote command center for OmnecorV1-Beta. Connects over Tailscale or LAN Wi-Fi.
Runs on Samsung Galaxy S25 Ultra (Snapdragon 8 Elite) and any Android 7.0+ device.

---

## Core Architecture

### Runtime Stack
- **React Native 0.81** + **Expo SDK 54** — native Android APK (not a WebView wrapper)
- **expo-router** v6 — file-based tab navigation
- **NativeWind v4** — Tailwind CSS utility classes in React Native
- **tRPC v11** + **TanStack Query v5** — end-to-end typed API client
- **New Architecture enabled** (`newArchEnabled: true`) — concurrent rendering, JSI

### Connection Modes
| Mode | Description |
|------|-------------|
| **LAN** | Direct Wi-Fi connection; IP like `192.168.1.x`; fastest |
| **Tailscale** | Virtual LAN over internet; IP like `100.x.x.x`; works anywhere |
| **Offline** | On-device inference only; no server required |

### App Identity
- Package: `com.omnecor.mobilehq`
- App name: **Omnecor HQ**
- Min Android: 7.0 (API 24)
- Target SDK: 34
- Architectures: `arm64-v8a`, `armeabi-v7a`

---

## Feature 1: Remote Chat (Chat Tab)

The primary interface for communicating with Omnecor's AI system on the PC.

### Sub-features
- **Multi-session chat** — multiple named chat sessions; switch between them via dropdown
- **Neural Map selector** — choose active neural map for context routing (UI ready; API stub)
- **Agent selector** — select which agent handles the message (UI ready; API stub)
- **Fallback chain** — if PC server unreachable, automatically falls back to on-device model; if no model loaded, shows error with instructions
- **Streaming token display** — ready for streaming via `onToken` callback

### Voice Input (STT)
- Tap 🎤 mic button → recording starts (expo-audio)
- Tap ⏹ stop → audio POSTed as `FormData` to `http://{PC}:8001/transcribe` (Whisper)
- Transcribed text fills the input field automatically
- ActivityIndicator shown while transcribing
- Requires microphone permission (requested on first use)

### Voice Output (TTS)
- 🔊 toggle in header → auto-reads every AI response aloud after it arrives
- Long-press any assistant message → reads that message aloud
- Uses Android built-in TTS engine (expo-speech) — zero latency, no server required
- Markdown automatically stripped before reading (no "asterisk bold" spoken)
- 2000-character limit per TTS call to prevent overflow
- ⏹ Stop TTS button shown while speech is playing
- Speed control in Settings: 0.75×, 1.0×, 1.25×, 1.5×

### Connection Status
- 🟢 indicator when server is configured and reachable
- 🤖 indicator when on-device model is loaded
- Both shown at bottom of chat screen

---

## Feature 2: Bidirectional OMMESH Phone AI Node (AI Node Tab)

The flagship feature. Turns the phone into a compute node in the OMMESH network.

### Two directions
| Direction | Use case |
|-----------|----------|
| **Phone → serves PC** | Old/weak PC offloads inference to S25 Ultra's Snapdragon 8 Elite NPU (45 TOPS) |
| **PC → serves Phone** | Phone routes heavy requests (vision, large context) to a powerful PC |

### On-Device Inference (llama.rn)
- Powered by **llama.rn** (React Native port of llama.cpp)
- Backend: **Vulkan** (GPU) or **NNAPI** (NPU) — `n_gpu_layers: 99` (full NPU offload)
- Context window: 4096 tokens
- Supported quantization: GGUF Q4_K_M
- Recommended models:
  - Qwen2.5-7B-Instruct-Q4_K_M — 4.7 GB, best quality
  - Llama-3.2-3B-Instruct-Q4_K_M — 2.0 GB, fastest
  - Mistral-7B-Instruct-Q4_K_M — 4.4 GB
  - Llama-3.1-8B-Instruct-Q4_K_M — 4.9 GB
- Model status: idle / loading / ready / running / error
- Token streaming via `onToken` callback

### OMMESH WebSocket Node Protocol
- Phone opens WebSocket to `ws://{PC_IP}:{PORT}/ws`
- On connect: sends `mobile_node_register { nodeId, nodeName, secret, capabilities }`
- PC responds: `mobile_node_ack { accepted, reason? }`
- Every 10s: phone sends `mobile_node_heartbeat { nodeId, stats { tokensPerSec } }`
- PC sends `mobile_inference_request { requestId, prompt, options }` when routing to phone
- Phone responds with streamed `mobile_inference_response { requestId, content, done }`
- Auto-reconnect: 8-second backoff after disconnect or error
- Node ID: `nanoid(12)`, generated once per app session

### AI Node Screen UI
- Color-coded status card (disconnected/connecting/connected/registered/error)
- Animated spinner while connecting
- "No server configured" warning if Settings not filled in
- Connect / Disconnect buttons
- Inference stats grid: total requests, total tokens, current tok/s
- On-device model status (loaded model filename, inference state)
- Phone capabilities table (chipset, NPU, backend, max model size)
- **Test inference panel** (when model loaded): enter a prompt, tap Run Test, see streaming output
- Architecture explanation text

---

## Feature 3: Settings (Settings Tab)

Full configuration for all app features. 7 sections.

### Omnecor Server
- Server IP/hostname input (LAN or Tailscale `100.x.x.x`)
- Port input (default: 3000)
- **Test connection** — GET `/health` with 5-second timeout; shows ✓/✗ result
- **Save** — persists IP/port to AsyncStorage
- Runtime IP — no rebuild needed to change server

### OMMESH Network
- Enable/disable OMMESH node registration
- Node name (e.g. "Galaxy S25 Ultra")
- OMMESH secret (must match PC `.env` `OMMESH_SECRET`)
- Save & Connect — saves config and immediately connects WebSocket

### Voice
- Speech-to-Text (Whisper) enable/disable
- Text-to-Speech (Device TTS) enable/disable
- Reading speed selector: 0.75×, 1.0×, 1.25×, 1.5× (shown when TTS enabled)

### Phone AI Model
- Model selector with 4 recommended GGUF models (size + recommended badge shown)
- Load Selected Model — checks file exists, calls `loadModel(path)`
- Unload — releases model context, frees memory
- Loaded model display: filename + path

### Execution Mode
- Sovereign — conservative, local-first
- Scrapper — balanced
- Big Spender — aggressive, prefers cloud

### Appearance
- Dark / Light mode toggle (auto by default)

### About / Auth
- App version display
- Logout — clears session token from SecureStore

---

## Feature 4: Human-in-the-Loop Approval (HITL Tab)

Mobile gateway for HITL decisions from OmnecorV1-Beta's `HITLApprovalService`.

### Current state (stub → real)
- Alert list with unread count badge
- Alert types: `approval` (requires decision), `alert`, `warning`
- Filter by type
- Select alert to see full context
- Approve / Reject buttons for approval-type alerts
- Mark as Read for informational alerts

### When wired to PC
- Subscribe to WebSocket `actionPending` broadcasts on `hitl` channel
- `agent.approveAction` / `agent.rejectAction` tRPC calls
- Real-time push: alert appears on phone as soon as agent pauses for approval

---

## Feature 5: System Status Monitor (Status Tab)

Overview of PC system health and running jobs.

### OMMESH Phone Node panel (real data)
- Mesh connection status badge
- Node ID
- PC IP address
- Inference stats: requests, tokens, tok/s
- On-device model status

### PC Tasks panel (stub → real)
- Running / Completed / Failed counters
- Filter bar: all / running / completed / failed
- Per-task: name, status badge, progress bar, ETA, start time
- Actions: Pause (running tasks), Cancel (running tasks), Resume (paused tasks)
- Refresh button

### When wired to PC
- Subscribe to WebSocket `trainingProgress` + `lifecycle` events
- Or call `jobs.list` tRPC on load and on Refresh

---

## Feature 6: Remote Terminal (Terminal Tab)

Shell access to the PC's PTY session over WebSocket.

### Current state (stub → real)
- Terminal output display (scrollable, monospace)
- Command input with Enter button
- Command history navigation (↑/↓)
- Clear screen button

### When wired to PC
- Send `pty:spawn` on first connection → PC spawns shell
- Send `pty:input { data: command + "\n" }` on Enter
- Receive `pty:output { data }` → append to display
- Send `pty:resize` on layout change
- PC already has all PTY handlers in `WebSocketServer.ts`

---

## Feature 7: Podcast Studio (Podcast Tab)

Interface for OmnecorV1-Beta's AI podcast generation pipeline.

### Current state (stub → real)
- Podcast title, description, script inputs
- Voice selector: Default, Male, Female, Narrator, Casual
- Duration and quality selectors
- Generate Podcast button
- Progress bar (fake animation)
- Download Podcast button (shown at 100%)

### When wired to PC
- Call `podcast.generate` tRPC with title, description, script, voice, duration, quality
- Stream progress via WebSocket events
- Serve audio file URL for download

---

## Feature 8: 3D Viewer (3D View Tab)

Interface for Omnecor's 3D/PCB/blender pipeline.

### Current state (stub → real)
- View mode selector: 3D / Schematic-PCB / Code
- Component list (static: Cylinder, Cube, Sphere)
- AI panel toggle with query input
- Analyze / Modify / Export buttons

### When wired to PC
- Load real model data from `blender` or `comfy` tRPC endpoints
- Render geometry (needs a 3D library: `expo-three`, `react-three-fiber`, or `react-native-svg` for schematics)
- AI query routed to `ai.chat` with model context
- Export calls `blender.export` tRPC

---

## Feature 9: Tailscale Integration

Remote access from anywhere — no port forwarding.

### How it works
- Tailscale creates a virtual LAN (`100.x.x.x` IPs) between all your devices
- OMMESH WebSocket works identically over Tailscale vs local LAN
- Whisper STT POST also works over Tailscale
- Effectively extends the LAN to your pocket

### Setup
1. Install Tailscale on PC: `curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`
2. Install Tailscale on phone from Play Store
3. Sign in both to same Tailscale account
4. In Omnecor HQ Settings → Server IP: enter `100.x.x.x` Tailscale IP
5. Open firewall ports if needed: 3000, 8001, 8002

---

## Feature 10: Auth & Session

### OAuth flow
- OmnecorV1-Beta OAuth portal handles identity
- Mobile app deep-link callback: `omnecor-hq://oauth/callback`
- OAuth token exchanged via `GET /api/oauth/mobile?code=...`
- JWT stored in SecureStore (encrypted, hardware-backed on Android)
- Session sent as `Authorization: Bearer {token}` header on all requests

### Session persistence
- `expo-secure-store` — encrypted storage for JWT
- Token survives app restarts
- Logout clears token + user info from SecureStore

---

## Feature 11: Build & Distribution

### Debug APK (sideload)
```
pnpm install → pnpm prebuild:android → pnpm apk:debug
Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Install
```
pnpm apk:install          # via USB + adb
# or copy APK to phone via USB / file manager
```

### Release APK
```
pnpm apk:release          # requires signing keystore
```

### Copy to main project
```
cp android/app/build/outputs/apk/debug/app-debug.apk \
   ../OmnecorV1-Beta/packaging/android/omnecor-hq-debug.apk
```

---

## Integration Map: APK ↔ OmnecorV1-Beta

| APK Feature | PC Endpoint | Status |
|-------------|-------------|--------|
| Chat | `POST /api/trpc/ai.chat` | 🟡 Partial — auth needed |
| Chat Neural Maps | `GET /api/trpc/neuralMaps.list` | 🔴 Not wired |
| Chat Agents | `GET /api/trpc/agent.list` | 🔴 Not wired |
| OMMESH register | WS `mobile_node_register` | 🔴 PC handler missing |
| OMMESH inference | WS `mobile_inference_request` | 🔴 PC handler missing |
| OMMESH stats | WS `mobile_node_heartbeat` | 🔴 PC handler missing |
| Voice STT | `POST http://{PC}:8001/transcribe` | 🟡 Partial — Whisper must be running |
| Voice TTS | Device native (expo-speech) | ✅ No server needed |
| HITL | WS `actionPending` + `agent.approveAction` | 🔴 Not wired |
| Status / Jobs | WS `lifecycle` + `jobs.list` | 🔴 Not wired |
| Terminal PTY | WS `pty:spawn` / `pty:input` / `pty:output` | 🔴 Not wired |
| Podcast | `podcast.generate` tRPC | 🔴 Not wired |
| 3D Viewer | `blender.*` tRPC | 🔴 Not wired |
| Auth | `/api/oauth/mobile` + `/api/auth/me` | 🟡 Partial — OAuth not triggered yet |
| Execution Mode | `settings.setExecutionMode` tRPC | 🔴 Not wired |

---

## Phone Hardware Utilization

| Feature | Hardware Used |
|---------|---------------|
| On-device LLM inference | Snapdragon 8 Elite + Hexagon NPU (45 TOPS) via Vulkan/NNAPI |
| Voice recording (STT) | Microphone + expo-audio |
| Text-to-speech | Android TTS engine (CPU, built-in) |
| OMMESH WebSocket | Wi-Fi / Tailscale (cellular or Wi-Fi) |
| Chat responses | Server (PC) or NPU fallback |
| Session storage | Hardware-backed Keystore (SecureStore) |
