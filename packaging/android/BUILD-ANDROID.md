# Omnecor — Android Build Guide

The Omnecor Android app is **Omnecor HQ** — a React Native (Expo) companion app for the desktop workstation. It connects over Tailscale or LAN Wi-Fi and runs on-device GGUF inference via llama.rn.

For the full step-by-step build, sideload and connection instructions, see
[INSTALL.md § 4.6](../../INSTALL.md#46-android--omnecor-hq-companion-app). The
project source and scripts live in
[packaging/android/omnecor-hq/](omnecor-hq/) — see its
[README.md](omnecor-hq/README.md) for the app's feature set.

## Quick Reference

| Step | Command | Location |
|------|---------|---------|
| Install deps | `pnpm install` | `packaging/android/omnecor-hq/` |
| Generate Gradle project | `pnpm prebuild:android` | `packaging/android/omnecor-hq/` |
| Build debug APK | `pnpm apk:debug` | `packaging/android/omnecor-hq/` |
| Install to device | `pnpm apk:install` | `packaging/android/omnecor-hq/` |

## Requirements

- Android NDK r26+ (required for llama.rn C++ compilation)
- CMake 3.22+
- JDK 17
- Android SDK 34

Both NDK and CMake can be installed via Android Studio → SDK Manager → SDK Tools.

## Package Details

| Field | Value |
|-------|-------|
| App name | Omnecor HQ |
| Package | `com.omnecor.mobilehq` |
| Framework | React Native 0.81 + Expo SDK 54 |
| Min Android | 7.0 (API 24) |
| Target SDK | 34 |
| Tabs | Chat, HITL, **Alerts** (Notifications + Agent Messenger), AI Node, Status, Terminal, Podcast, 3D View, Settings |

> The **Alerts** tab (`app/(tabs)/notifications.tsx`, added 2026-06-12) mirrors the desktop Notifications hub: a unified alert feed (`notifications.*`) plus the Agent Messenger (`agentMessenger.*`), both served by the PC over tRPC + the `notifications` WebSocket channel.
