# Omnecor Project Roadmap

This document outlines the future development plans and strategic direction for the Omnecor project. The roadmap is subject to change based on community feedback, technological advancements, and project priorities.

## Vision

Omnecor aims to be the definitive local-first AI workstation, empowering users with unparalleled control over their data, AI models, and creative workflows. We envision a future where complex multi-modal projects are seamlessly orchestrated, and human-machine collaboration reaches new heights.

The core platform feature set is fully code-complete, packaged, and verified. Pre-built binaries are available for Windows (native installer), Linux (AppImage/deb/Flatpak), and the Omnecor HQ Android companion app (React Native / Expo).

## Future Milestones

### V1-Beta Completion Record

| Feature | Status |
|---|---|
| Valet V2 model artifact integrated + eval passed | ✅ Completed (Option A: Direct GGUF loading / Option B: Ollama support) |
| Android APK smoke-tested (debug build sideloaded) | ✅ Completed (Standalone release APK compiled successfully) |
| PodcastStudio output buttons wired | ✅ Done (2026-06-10) — Play/Download/Export |
| Calendar "Publish Now" wired | ✅ Done (2026-06-10) — `trpc.scheduling.publishNow` |
| All AgentNetworking curation dead buttons wired | ✅ Done (2026-06-10) — Auto-Pilot/Schedule/Regenerate/Reject |
| SpecializedModuleLauncher dead buttons + LoRA slider | ✅ Done (2026-06-10) — inline editors, real range input |
| CurationStudio + ImageStudioPanel + Settings Backup | ✅ Done (2026-06-10) — all three wired |
| ModelManagementService + router | ✅ Done (2026-06-10) — JSON registry, 9 endpoints |
| ModelMarketplaceService + router | ✅ Done (2026-06-10) — dual-source search, featured models |
| IntegrationManagementService + router | ✅ Done (2026-06-10) — health checks, OAuth lifecycle |
| Unified Notifications + Agent Messenger (GUI + APK) | ✅ Done (2026-06-12) — `notifications`/`agentMessenger` routers, `notifications` WS channel, desktop page + Android Alerts tab |
| 13 unaudited TSX files covered by input-tracker | ✅ Done (2026-06-10) — 0 DEAD found across all 12 |
| pnpm check — 0 errors | ✅ Passing |
| All stale audit comments removed | ✅ Done (2026-06-10) |
| Agentic Chat Stream — web + APK (Claude-Code-style typed stream, HITL, FIFO queue, code execution) | ✅ Done (2026-07-04–07) — 1315 tests passing |
| Model-Fabric: Ollama decoupled, LocalLlmRuntimeService, dual tool-protocol, unified model catalog, beacon-minimal mesh advertising | ✅ Done (2026-07-07–08) — 1455 tests at Phase 7 gate |
| Mesh Sub-Agent Delegation: delegate_task tool, SubAgentHostService, DelegationService, mTLS NDJSON relay, web + APK managed chats | ✅ Done (2026-07-08) — 1447 tests at that workstream's Phase 9 gate |
| Model-Fabric Phase 8: local GGUF auto-discovery (app dir + Ollama blob store, Ollama-stopped) + hot-swap runtime (`ensureModelLoaded`, per-model VRAM fit) + `loadLocalModel` + picker loading indicator | ✅ Done (2026-07-10) — 1469 tests (authoritative HEAD total), live-verified on DadsPC RTX 4060 Ti |

> **Test count note:** Gate counts are sequential per-phase snapshots. Model-Fabric's 1455 includes its own Phase 7 additions; Mesh-Delegation's **1447** was the verified `pnpm test` count at that workstream's Phase 9 close (2026-07-08). Later work has since moved HEAD past 1447 — Model-Fabric **Phase 8** (local GGUF auto-discovery + hot-swap, 2026-07-10) added +22 tests to **1469 passing / 4 skipped**. See `Context/Tracker-Docs/Verification-Pass.md` for the authoritative live HEAD baseline.

### Phase 2 (v2.x): Advanced Orchestration & Integration

Already implemented as part of V1-Beta build-out (Phases 2–35). Session 12 closed the remaining v2.x deferred items:

-   ✅ **Model Management Service** — JSON-based registry with full CRUD, set-active, sync-from-Ollama, version tracking.
-   ✅ **Model Marketplace Sync** — Dual-source search (Ollama library + HuggingFace), 8 curated featured models, pull-to-install.
-   ✅ **Integration Lifecycle Management** — Health monitoring, OAuth token refresh, disconnect, 60s cache.
-   ✅ **crewAI / n8n Connectors** — V1 bridges functional (RecursiveMASPanel + agentSettingsRouter n8n URL).
-   ✅ **OMMESH Topology UI** — Visual `react-force-graph` rendering of live mesh peer network. 

### Phase 3 (v3.x): Community & Ecosystem

-   **Plugin Marketplace**: Platform for community-contributed plugins and extensions.
-   **Open API & SDK**: Developer tools for building on top of Omnecor.
-   **Educational Resources**: Tutorials, guides, and example projects.
-   **macOS Native Support**: Current packaging covers Linux + Windows + Android. macOS Electron target planned for v3.x.

## Contributing to the Roadmap

We welcome ideas and feedback from the community. If you have suggestions for features or improvements, please engage with us through our GitHub issues or community channels. Your input is invaluable in shaping the future of Omnecor.
