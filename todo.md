# Omnecor TODO
**Last updated:** 2026-05-29

## Phase 1 — UI/UX Prototype ✅ COMPLETE
- [x] UI/UX Prototype
- [x] Documentation Modernisation

## Phase 2 — Backend Services ✅ COMPLETE
- [x] Unified Backend (Express/tRPC/WebSocket)
- [x] Hardware Bridges (Blender, KiCad, ESPTool)
- [x] Voice Pipeline (Whisper, XTTS-v2, RVC)
- [x] AI Provider Hub (Ollama, OpenAI, Anthropic, Gemini)
- [x] Memory System (Drizzle/MySQL + ChromaDB VectorDB)
- [x] Process Manager UI
- [x] Branding Consolidation (CORTEX → Omnecor HMCI)

## Phase 3 — Hardware Bridges ✅ COMPLETE
- [x] Blender, KiCad, ESPTool bridges fully integrated

## Phase 4 — Voice Processing ✅ COMPLETE
- [x] Whisper STT, XTTS-v2 TTS, RVC pipeline

## Phase 5 — Knowledge Base ✅ COMPLETE
- [x] ChromaDB vector store, semantic search, episodic memory

## Phase 6 — Neural Brain Map WebSocket ✅ COMPLETE
- [x] `useOmnecorSocket.ts` hook (reconnect, ring-buffer, ping)
- [x] `HITLAlertPanel.tsx` (loop detection banner)
- [x] Wire hook into `NeuralGraphView.tsx` (Refactored into Windowing System)
- [x] Wire hook into `NeuralTreeView.tsx`
- [x] `useOmnecorSocket.test.ts` unit tests

## Phase 7 — UX Polish & Aviation Oversight ✅ COMPLETE
- [x] **Neural Brain Map Windowing**: Refactored into a detachable windowing system.
- [x] **Multi-Window Sync**: Live state synchronization via `zustand` and `BroadcastChannel`.
- [x] **Floating Overlay Mode**: Draggable/resizable window with `framer-motion` and `oklch` brand styling.
- [x] **External Monitor Support**: Dedicated route (`/brain-map-external`).
- [x] **Visual Identity**: Enhanced with backdrop filters, `oklch` colors, and matte surfaces.
- [x] **Verification**: Confirmed 177 tests pass and TypeScript check is clean.

## Phase 8 — OMMESH Distributed Mesh ✅ COMPLETE
- [x] LAN beacon / mDNS discovery service
- [x] Secure node federation (mTLS)
- [x] Intelligent VRAM-weighted job routing
- [x] Peer notification broadcast after rotation
- [x] Mesh Compute UI panel

## Phase 9 — Packaging & Distribution ✅ COMPLETE
- [x] .deb package
- [x] AppImage
- [x] Flatpak
- [x] systemd service file
- [x] Post-install script
- [x] Packaging docs

## Phase 12 — Security Hardening ✅ COMPLETE
- [x] **Critical Deserialization Fix**: Secured `rvc_server.py` by setting `weights_only=True` in `torch.load`.
- [x] **Path Traversal Protection**: Implemented secure root directory validation and `is_safe_path` checks in `rvc_server.py` and `tts_server.py`.
- [x] **Sensitive Data Protection**: Removed `apiKey` and `baseUrl` from `localStorage` in `ModelHub.tsx`.
- [x] **Security Dependency Updates**: Updated `drizzle-orm` (0.45.2), `vitest` (4.1.7), and `drizzle-kit` (0.31.10).
- [x] **Unified Security Router Hardening**: Auth enforced on all security endpoints.
- [x] **Advanced Path Validation**: Strict boundary checks in `validatePath` (including `fs.realpath`).
- [x] **DoS Mitigation**: Global rate limiting via `express-rate-limit`.
- [x] **Python Bridge Sandbox**: Secured `blender_bridge.py` against injection and introspection.
- [x] **Verification**: Confirmed all 177 tests pass (Final Baseline Verification).
- [x] **Zero-Trust Audit**: Conducted Tri-Agent simultaneous review; all critical vulnerabilities (XSS, RCE, Traversal) resolved.

## Future ✅ COMPLETE
- [x] **Character Engine (Flux Pro)**: Bridged to Fal.ai Flux.
- [x] **Video Clone Engine**: Bridged to Fal.ai video pipeline.
- [x] **ComfyUI Bridge**: Dedicated service and router for workflow orchestration.
- [x] **crewAI / n8n connectors**: `AgentService.ts` implemented for autonomous crews.
- [x] **Unsloth LoRA fine-tuning UI**: Advanced `trainingRouter` parameters and `UnslothPanel` UI.

## Analysis Findings & Cleanup ✅ COMPLETE
- [x] **OMMESH Federated Routing**: Real load-balanced routing implemented in `AiProviderService.ts`.
- [x] **LLM Builder Integration**: Frontend wired to backend Python Unsloth bridges.
- [x] **3D Modeler Integration**: React frontend connected to Blender bridge.
- [x] **PCB Designer Integration**: React frontend connected to KiCad bridge.
- [x] **Redundant Component Removal**: Deleted `Home.tsx`, `ComponentShowcase.tsx`, `AIChatBox.tsx`, `DashboardLayout.tsx`.
- [x] **Agentic Memory**: Integrated `LiteAgent` and `CrewAI` logic into production services.
- [x] **YARA Security**: Implemented high-performance YARA-based scanning in `SecurityService.ts`.

---
**OMNECOR HMCI v2.3.0 — FEATURE COMPLETE**
