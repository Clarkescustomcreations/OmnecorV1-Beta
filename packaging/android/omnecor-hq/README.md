# Omnecor HQ

Mobile companion app for OmnecorV1-Beta. Remotely control your AI from anywhere—LAN or globally via Tailscale.

**Omnecor HQ** is the mobile control center for OmnecorV1-Beta. Connect your Android phone to your PC over LAN or Tailscale VPN, then chat with your AI, monitor job status, approve Human-in-the-Loop requests, and run a private AI node on your phone's Snapdragon NPU.

---

## Features

### 8-Tab Interface

| Tab | Purpose |
|---|---|
| **Chat** | Message your PC's AI with text or voice input (Whisper STT). Auto-reads responses with device TTS or falls back to phone's local model. Select neural map and agent/persona. |
| **HITL** | Real-time queue of pending Human-in-the-Loop approval requests from PC. Review and approve/reject live via WebSocket. |
| **AI Node** | Monitor your phone's OMMESH node status. Connect/disconnect, view inference stats, test local inference, manage model loading. Phone operates as a bidirectional compute node for the network. |
| **Status** | Live job monitoring from PC. Real-time state badges, progress bars, and cancel jobs via `jobs.cancel` tRPC. |
| **Terminal** | Live shell PTY to PC with real command execution, Ctrl+C support, command history, and auto-scroll. |
| **Podcast** | Generate podcasts on PC via `podcast.generate` tRPC. View and download generated audio. |
| **3D Viewer** | 3D model viewing interface connected to PC 3D Designer. |
| **Settings** | 7 sections: Omnecor Server (IP/port config), OMMESH Network (secret, node name), Voice (STT/TTS), Phone AI Model (GGUF management), Execution Mode, Appearance (light/dark), About/Logout. |

---

## Connection Modes

### LAN (Same Network)
Direct Wi-Fi connection to PC on the same network. Fastest, no latency overhead.

### Tailscale (Global)
Virtual LAN overlay via Tailscale. Access your PC securely from anywhere in the world without port forwarding. Requires Tailscale VPN on both PC and phone.

---

## OMMESH Phone AI Node

> For connecting your phone as a third mesh node alongside your desktop
> machines, see [docs/setup/OMMESH_SETUP.md](../../../docs/setup/OMMESH_SETUP.md).

Your phone operates as a **bidirectional compute node** in the OMMESH network:

- **Local Inference**: Run GGUF models directly on Snapdragon NPU via llama.rn
- **Bidirectional**: Phone can send/receive tasks to/from PC and other nodes
- **Auto-Reconnect**: Maintains WebSocket connection with heartbeat monitoring
- **Stats Tracking**: Real-time inference performance metrics
- **Model Management**: Load/unload GGUF models from device storage

---

## Always-Listening Voice Mode

Run a persistent background mic loop that wakes on a spoken phrase and hands
the transcribed query off to a desktop persona — fully on-device, no
third-party wake-word service required.

> Full setup guide: [docs/user-guides/ALWAYS_LISTEN.md](../../../docs/user-guides/ALWAYS_LISTEN.md)

---

## Quick Start

### 1. Install Dependencies
```bash
cd packaging/android/omnecor-hq
pnpm install
```

### 2. Run Prebuild (Android NDK + CMake Required)
```bash
# Generate native modules (llama.rn requires NDK r26+ and CMake 3.22+)
pnpm exec expo prebuild --clean
```

### 3. Build APK
```bash
pnpm exec eas build --platform android --local
```

### 4. Configure Settings
- Open app → **Settings** tab
- Enter **Omnecor Server IP/Port** (PC's address)
- Enter **OMMESH Secret** (shared with PC)
- Set **Phone Node Name**
- Choose **Whisper STT URL** and **TTS Speed**

### 5. Connect
- Go to **Chat** tab
- Select neural map and agent/persona
- Start messaging your PC's AI

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥20.0 | JavaScript runtime |
| pnpm | ≥9.0 | Package manager |
| JDK | 17+ | Java compiler (Android build) |
| Android SDK | API 34 | Platform tools |
| Android NDK | r26+ | C++ compilation for llama.rn |
| CMake | ≥3.22 | Native build system for llama.rn |

> **NDK & CMake**: llama.rn requires Android NDK r26+ and CMake 3.22+ to compile its C++ inference engine. Install via Android Studio's SDK Manager or manually.

---

## Package Details

| Property | Value |
|---|---|
| **Name** | Omnecor HQ |
| **Package ID** | com.omnecor.mobilehq |
| **Framework** | React Native 0.81 + Expo SDK 54 |
| **TypeScript** | 5.9 |
| **Min Android API** | 24 (Android 7.0) |
| **Target SDK** | 34 |
| **Architectures** | arm64-v8a, armeabi-v7a |
| **Key Libraries** | llama.rn ^0.9.0, expo-speech ~13.0.0, expo-audio, expo-file-system |

---

## Build Instructions

See **[BUILD.md](./BUILD.md)** for detailed build steps, including:
- Complete NDK/CMake setup
- Debug vs. production APK builds
- Troubleshooting native compilation errors
- Signing release builds

---

## Architecture

### Core Library Files

| File | Purpose |
|---|---|
| `lib/_core/server-config.ts` | Runtime IP/port persistence |
| `lib/_core/local-inference.ts` | llama.rn wrapper with stats tracking |
| `lib/_core/mobile-mesh-node.ts` | OMMESH WebSocket phone node (auto-reconnect, heartbeat) |

### Key Technologies

- **React Native 0.81** — Cross-platform mobile framework
- **Expo SDK 54** — Native APIs (audio, file system, haptics, notifications)
- **NativeWind v4** — Tailwind CSS for React Native styling
- **tRPC** — Type-safe API client for PC communication
- **TanStack Query** — Data fetching and caching
- **Zustand** — Global state management
- **llama.rn** — On-device GGUF inference (Snapdragon NPU)

---

## Development

### Run in Dev Mode
```bash
pnpm dev:metro
```
Opens Expo dev server with hot reload.

### Type-Check
```bash
pnpm check
```

### Format Code
```bash
pnpm format
```

---

## Workspace

This package is registered as a pnpm workspace under `packaging/android/omnecor-hq/`. All dependencies inherit from the monorepo's root `pnpm-workspace.yaml`.

---

## Support

For issues, refer to:
- **BUILD.md** — Native compilation troubleshooting
- **CLAUDE.md** (parent repo) — Architecture and development guidelines
- **PC Backend** — See `server/routers.ts` for available tRPC endpoints
