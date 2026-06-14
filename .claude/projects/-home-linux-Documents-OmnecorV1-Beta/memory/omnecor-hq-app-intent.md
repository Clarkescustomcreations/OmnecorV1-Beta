---
name: omnecor-hq-app-intent
description: What the Omnecor HQ mobile app is and its intended 8-tab structure per the user's spec
metadata:
  type: project
---

**Omnecor HQ** (`packaging/android/omnecor-hq/`, Expo SDK 54 / RN 0.81) is a remote control + alert/notification companion app for the main Omnecor PC app. It connects to the PC over LAN or Tailscale via tRPC/WebSocket. It's a simplified copy of the main GUI and MUST share the same color theme, aesthetics, and tab/page icons as the main GUI. It runs on the phone; it cannot run the PC backend — it only needs the `AppRouter` type for client type-safety.

**Intended 8 tabs (user spec, 2026-06-13):**
1. Chat — simplified main chat; must be able to access/continue chats from the main GUI.
2. 3D Viewer — INTERACTIVE (user reversed the earlier "preview-only" call on 2026-06-13). Rebuilt with three.js-in-WebView 3D mode (orbit/pinch/tap-select), real PCB/schematic mode (`pcbEditor.getProjects`/`getLatestDesign` rendered via react-native-svg), and Code mode (`project.list`/`getFileTree`/`readFile`/`writeFile`). Restored action bar — all wired to REAL endpoints: Ask AI (`ai.chat` or `pcbEditor.reviewDesign`), Analyze, Modify/Save (`project.writeFile`/`pcbEditor.saveDesign`), Export (`pcbEditor.exportDesign`).
3. Alerts + Agent Messenger (ONE tab) — alerts for anything you'd wait on (LLM Builder, pipelines, chat responses, finished tasks, HITL alerts + post-approvals) PLUS a messenger to chat with selectable agents/personas (start/stop/check tasks, ask questions, make plans). HITL must live INSIDE this tab, not be its own tab.
4. OMMESH — view connections + make connections; this is where the phone NPU AI node setup lives (PC can offload AI inference to phone NPU for older PCs, or phone routes heavy work to a powerful PC — bidirectional).
5. Terminal — terminus clone for running terminal commands.
6. Podcast — smaller version of the podcast creation studio.
7. Status — what projects/tasks/pipelines are running and how long is left.
8. Settings/Setup — app settings + Tailscale connection setup.

Goal: check in and run Omnecor safely from anywhere — approve HITL/post reviews, chat in the main project's chat, or message an agent/persona to ask a question or make a plan. Much of this is already in the main project docs.

Main GUI primary color = Tailwind blue-700 (#1d4ed8). Mobile default was teal #0a7ea4 (Expo starter) — being corrected. Related: [[omnecor-hq-deferred-scaffolding]].
