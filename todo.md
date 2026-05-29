# Omnecor TODO
**Last updated:** 2026-05-28

## Phase 1 — UI/UX Prototype ✅
- [x] UI/UX Prototype
- [x] Documentation Modernisation

## Phase 2 — Backend Services ✅
- [x] Unified Backend (Express/tRPC/WebSocket)
- [x] Hardware Bridges (Blender, KiCad, ESPTool)
- [x] Voice Pipeline (Whisper, XTTS-v2, RVC)
- [x] AI Provider Hub (Ollama, OpenAI, Anthropic, Gemini)
- [x] Memory System (Drizzle/MySQL + ChromaDB VectorDB)
- [x] Process Manager UI
- [x] Branding Consolidation (CORTEX → Omnecor HMCI)

## Phase 3 — Hardware Bridges ✅
- [x] Blender, KiCad, ESPTool bridges fully integrated

## Phase 4 — Voice Processing ✅
- [x] Whisper STT, XTTS-v2 TTS, RVC pipeline

## Phase 5 — Knowledge Base ✅
- [x] ChromaDB vector store, semantic search, episodic memory

## Phase 6 — Neural Brain Map WebSocket (IN PROGRESS) 🔄
- [x] `useOmnecorSocket.ts` hook (reconnect, ring-buffer, ping)
- [x] `HITLAlertPanel.tsx` (loop detection banner)
- [ ] Wire hook into `NeuralGraphView.tsx`
- [ ] Wire hook into `NeuralTreeView.tsx`
- [ ] `useOmnecorSocket.test.ts` unit tests

## Phase 7 — UX Polish & Aviation Oversight ⏳
- [ ] Ctrl+K Command Palette
- [ ] Fiction Mode UI
- [ ] HITL challenge-and-response checklists
- [ ] Time-boxed decision lanes

## Phase 8 — OMMESH Distributed Mesh (IN PROGRESS) 🔄
- [x] LAN beacon / mDNS discovery service
- [x] Secure node federation (mTLS)
- [x] Intelligent VRAM-weighted job routing
- [x] Peer notification broadcast after rotation
- [ ] Mesh Compute UI panel

## Phase 9 — Packaging & Distribution ⏳
- [ ] .deb package
- [ ] AppImage
- [ ] Flatpak
- [ ] systemd service file
- [ ] Post-install script
- [ ] Packaging docs

## Phase 12 — Security Hardening ✅
- [x] **Critical Deserialization Fix**: Secured `rvc_server.py` by setting `weights_only=True` in `torch.load`.
- [x] **Path Traversal Protection**: Implemented secure root directory validation and `is_safe_path` checks in `rvc_server.py` and `tts_server.py`.
- [x] **Sensitive Data Protection**: Removed `apiKey` and `baseUrl` from `localStorage` in `ModelHub.tsx`.
- [x] **Security Dependency Updates**: Updated `drizzle-orm` (0.45.2), `vitest` (4.1.7), and `drizzle-kit` (0.31.10).
- [x] **Verification**: Confirmed all 177 tests pass.

## Future
- [ ] Character Engine (Flux Pro)
- [ ] Video Clone Engine
- [ ] ComfyUI bridge
- [ ] crewAI / n8n connectors
- [ ] Unsloth LoRA fine-tuning UI

## Analysis Findings & Cleanup
- [ ] Implement real OMMESH federated routing in `AiProviderService.ts`.
- [ ] Connect LLM Builder frontend to backend Python bridges.
- [ ] Connect 3D Modeler frontend to Blender bridge.
- [ ] Connect PCB Designer frontend to KiCad bridge.
- [ ] Remove unreachable components: `Home.tsx`, `ComponentShowcase.tsx`.
- [ ] Remove redundant components: `AIChatBox.tsx`, `DashboardLayout.tsx`.
- [ ] Integrate LiteAgent/CrewAI references into production services.
- [ ] Implement YARA-based scanning in `SecurityService.ts`.