# Omnecor HQ — APK Build Guide

Remote command center for OmnecorV1-Beta. Connects over Tailscale (from anywhere)
or LAN Wi-Fi. Features: Chat, HITL, Status, Terminal, Podcast, 3D Viewer, Voice STT/TTS,
and bidirectional OMMESH AI node — use the phone's Snapdragon 8 Elite NPU to serve AI
inference to a weaker PC, or use the PC's models from the phone.

---

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
> Install via: Android Studio → SDK Manager → SDK Tools → NDK (Side by side).

---

## 1. Install dependencies

```bash
cd apk-staging
pnpm install
```

---

## 2. Generate the Android native project

```bash
pnpm prebuild:android
# equivalent: expo prebuild --platform android --clean
```

This creates `android/` with the Gradle project. Run it once, or whenever
`app.config.ts` or native packages change.

---

## 3. Build the APK

```bash
# Debug APK (for sideloading / testing)
pnpm apk:debug
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# Release APK (requires signing key — see below)
pnpm apk:release
```

---

## 4. Sideload to your S25 Ultra

```bash
# With USB cable + USB Debugging enabled:
pnpm apk:install

# Or manually copy the APK and open via Files app
adb push android/app/build/outputs/apk/debug/app-debug.apk /sdcard/Download/
```

---

## 5. Configure Tailscale (remote access from anywhere)

Tailscale creates a virtual LAN between your devices. No port forwarding needed.

### On the PC (running OmnecorV1-Beta):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip          # note the 100.x.x.x address
```

### On the S25 Ultra:
1. Install **Tailscale** from Play Store
2. Sign in with the same Tailscale account
3. Both devices now share a virtual LAN

### In Omnecor HQ (the APK):
1. Open **Settings** tab
2. Under **Omnecor Server**, enter the PC's Tailscale IP (e.g. `100.64.0.1`)
3. Port: `3000`
4. Tap **Test** → should show "Server reachable"
5. Tap **Save**

### Firewall (if Test fails):
On the PC, allow these ports in UFW or Windows Firewall:
```bash
# Linux UFW:
sudo ufw allow 3000/tcp   # Omnecor main server
sudo ufw allow 8001/tcp   # Whisper STT
sudo ufw allow 8002/tcp   # TTS server
```

---

## 6. Voice: Whisper STT + TTS

### Speech-to-Text (Whisper):
- Whisper runs on your PC as part of OmnecorV1-Beta (Python server on port 8001)
- Start it from OmnecorV1-Beta: `uvicorn server.python_bridges.whisper_server:app --port 8001`
- In the APK: tap the 🎤 button in Chat, speak, release → transcribed text appears

### Text-to-Speech (device native):
- Uses Android's built-in TTS engine — no server required, zero latency
- Toggle the 🔊 button in Chat to auto-read AI responses
- Long-press any assistant message to read it aloud
- Speed control in Settings → Voice

---

## 7. OMMESH Phone AI Node

Uses your S25 Ultra's Snapdragon 8 Elite NPU as a compute node in the OMMESH network.

### Step 1 — Load a model on the phone:
1. Download a GGUF model from Hugging Face (recommended: Qwen2.5-7B-Q4_K_M ~4.7 GB)
2. Copy the `.gguf` file to your phone at: `Documents/models/qwen2.5-7b-instruct-q4_k_m.gguf`
   - Connect via USB and drag-drop, or use a file transfer app
3. In the APK: Settings → Phone AI Model → select model → **Load Selected Model**

### Step 2 — Register as OMMESH node:
1. Settings → OMMESH Network → enable "Register as OMMESH Node"
2. Enter the OMMESH_SECRET (must match `OMMESH_SECRET=` in OmnecorV1-Beta/.env)
3. Give the node a name (e.g. "Galaxy S25 Ultra")
4. Tap **Save & Connect**
5. Go to the **AI Node** tab to see connection status and inference stats

### Step 3 — Verify PC-side WebSocket handlers (already implemented):

The PC's WebSocket server (`server/phase2/websocket/WebSocketServer.ts`) already handles all mobile OMMESH messages:
- `mobile_node_register` — validates OMMESH_SECRET, stores node in `mobileNodes` Map, responds with `mobile_node_ack`
- `mobile_node_heartbeat` — updates node last-seen and model status
- `mobile_inference_request` / `mobile_inference_response` — bidirectional inference streaming
- `mobile_node_ack` — sent to phone on successful registration

The AI router (`server/routers/aiRouter.ts`) exposes the phone as provider `"ommesh"` — it appears in the provider list as "Phone — {nodeName}" whenever a phone is registered with a model loaded.

**No code changes needed.** Simply set `OMMESH_SECRET=your-secret` in OmnecorV1-Beta/.env (optional but recommended for auth).

### Bidirectional power sharing:
- **Old PC → S25 Ultra**: Phone handles 4B–7B inference at 20–55 tok/s via NPU
- **S25 Ultra → Powerful PC**: Phone routes requests to PC for large models / vision
- Connection works over Tailscale from anywhere in the world

---

## 8. Stage the APK output

Once built, the APK is at:
```
apk-staging/android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to the main project:
```bash
cp android/app/build/outputs/apk/debug/app-debug.apk \
   ../OmnecorV1-Beta/packaging/android/omnecor-hq-debug.apk
```

---

## Package details

| Field | Value |
|-------|-------|
| App name | Omnecor HQ |
| Package | `com.omnecor.mobilehq` |
| Min Android | 7.0 (API 24) |
| Target SDK | 34 |
| Architectures | arm64-v8a, armeabi-v7a |
| Framework | React Native 0.81 + Expo SDK 54 |
| On-device LLM | llama.rn (llama.cpp NDK, Vulkan/NNAPI backend) |
