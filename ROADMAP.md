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
| Android APK smoke-tested (debug build sideloaded) | 🔴 Deferred — last item |
| PodcastStudio output buttons wired | 🔴 DEAD — pending |
| Calendar "Publish Now" wired | 🔴 DEAD — pending |
| 13 unaudited TSX files covered by input-tracker | 🔴 Pending |
| pnpm check — 0 errors | ✅ Passing |
| All stale audit comments removed | ✅ Done (2026-06-10) |

### Phase 2 (v2.x): Advanced Orchestration & Integration

Already implemented as part of V1-Beta build-out (Phases 2–35). Remaining v2.x deferred items:

-   **Model Management Service**: Dedicated CRUD, versioning, and lifecycle manager for models (beyond current Ollama + provider coverage).
-   **Model Marketplace Sync**: Curated model library with automated sync and ratings.
-   **Integration Permission Management**: Per-integration OAuth scope control and granular revocation UI.
-   **crewAI / n8n Full Connectors**: V1 bridges functional; deeper workflow orchestration planned.
-   **OMMESH Topology UI**: Visual `react-force-graph` rendering of live mesh peer network.

### Phase 3 (v3.x): Community & Ecosystem

-   **Plugin Marketplace**: Platform for community-contributed plugins and extensions.
-   **Open API & SDK**: Developer tools for building on top of Omnecor.
-   **Educational Resources**: Tutorials, guides, and example projects.
-   **macOS Native Support**: Current packaging covers Linux + Windows + Android. macOS Electron target planned for v3.x.

## Contributing to the Roadmap

We welcome ideas and feedback from the community. If you have suggestions for features or improvements, please engage with us through our GitHub issues or community channels. Your input is invaluable in shaping the future of Omnecor.
