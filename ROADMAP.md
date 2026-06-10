# Omnecor Project Roadmap

This document outlines the future development plans and strategic direction for the Omnecor project. The roadmap is subject to change based on community feedback, technological advancements, and project priorities.

## Vision

Omnecor aims to be the definitive local-first AI workstation, empowering users with unparalleled control over their data, AI models, and creative workflows. We envision a future where complex multi-modal projects are seamlessly orchestrated, and human-machine collaboration reaches new heights.

## Current Focus (V1-Beta — Final Finalization Phase, as of 2026-06-10)

The core platform feature set is complete. Current efforts are on verification, integration, and the final remaining deliverables:

-   **Valet Router V2** — Training complete; V2 model artifact nearly ready. Once loaded, the router moves from rule-based fallback to fully model-driven task-to-provider routing. This is the top active priority.
-   **Android APK** — Capacitor project initialized; web assets synced. The APK build (`./gradlew assembleDebug`, keystore, sideload smoke test) is the intentionally last deliverable — will be completed after Valet V2 signs off.
-   **UI Dead-End Cleanup** — 9 confirmed DEAD interactive elements remain (`PodcastStudio.tsx` output buttons, `AgentNetworking.tsx` Calendar "Publish Now", minor stubs). These will be wired or formally marked as v3.1.0 deferred.
-   **Unaudited Components** — 13 TSX files not yet covered by the input-tracker swarm audit (`CriticalActionChecklist.tsx`, `ManusDialog.tsx`, PCB schematic components, etc.).
-   **Code Quality Gate** — TypeScript check passes at 0 errors. All stale audit comments removed (624 lines across 30 files). Ongoing: no regressions allowed past `pnpm check`.

## Future Milestones

### V1-Beta Remaining Checklist (before stable release)

| Item | Status |
|---|---|
| Valet V2 model artifact integrated + eval passed | 🟡 In progress (nearly done) |
| Android APK smoke-tested (debug build sideloaded) | 🔴 Deferred — last item intentionally |
| PodcastStudio output buttons wired | ✅ Done (2026-06-10) — Play/Download/Export |
| Calendar "Publish Now" wired | ✅ Done (2026-06-10) — `trpc.scheduling.publishNow` |
| All AgentNetworking curation dead buttons wired | ✅ Done (2026-06-10) — Auto-Pilot/Schedule/Regenerate/Reject |
| SpecializedModuleLauncher dead buttons + LoRA slider | ✅ Done (2026-06-10) — inline editors, real range input |
| CurationStudio + ImageStudioPanel + Settings Backup | ✅ Done (2026-06-10) — all three wired |
| ModelManagementService + router | ✅ Done (2026-06-10) — JSON registry, 9 endpoints |
| ModelMarketplaceService + router | ✅ Done (2026-06-10) — dual-source search, featured models |
| IntegrationManagementService + router | ✅ Done (2026-06-10) — health checks, OAuth lifecycle |
| 13 unaudited TSX files covered by input-tracker | ✅ Done (2026-06-10) — 0 DEAD found across all 12 |
| pnpm check — 0 errors | ✅ Passing |
| All stale audit comments removed | ✅ Done (2026-06-10) |

### Phase 2 (v2.x): Advanced Orchestration & Integration

Already implemented as part of V1-Beta build-out (Phases 2–35). Session 12 closed the remaining v2.x deferred items:

-   ✅ **Model Management Service** — JSON-based registry with full CRUD, set-active, sync-from-Ollama, version tracking.
-   ✅ **Model Marketplace Sync** — Dual-source search (Ollama library + HuggingFace), 8 curated featured models, pull-to-install.
-   ✅ **Integration Lifecycle Management** — Health monitoring, OAuth token refresh, disconnect, 60s cache.
-   ✅ **crewAI / n8n Connectors** — V1 bridges functional (RecursiveMASPanel + agentSettingsRouter n8n URL).
-   ⚠️ **OMMESH Topology UI** — Visual `react-force-graph` rendering of live mesh peer network. Deferred to v3.x.

### Phase 3 (v3.x): Community & Ecosystem

-   **Plugin Marketplace**: Platform for community-contributed plugins and extensions.
-   **Open API & SDK**: Developer tools for building on top of Omnecor.
-   **Educational Resources**: Tutorials, guides, and example projects.
-   **macOS Native Support**: Current packaging covers Linux + Windows + Android. macOS Electron target planned for v3.x.

## Contributing to the Roadmap

We welcome ideas and feedback from the community. If you have suggestions for features or improvements, please engage with us through our GitHub issues or community channels. Your input is invaluable in shaping the future of Omnecor.
