# Omnecor Roadmap & Feature Plan
**Architecture Version:** 2.2.0 — Unified HMCI  
**Last Updated:** 2026-05-28

## Vision
Omnecor HMCI is a production-grade, unified workstation for intelligent,
multi-agent AI workflows and hardware engineering. Local-first. Sovereign.
Aviation-grade reliability.

## Architectural Foundation
Service-oriented Unified Backend (Express/tRPC + WebSocket). All features
build on this stable core.

---

## Phase 6 — Neural Brain Map WebSocket Integration (IN PROGRESS)

### Goal
Enable real-time, bi-directional synchronisation between the local file system
and the Neural Brain Map UI via the Omnecor WebSocket server.

### Success Criteria
- Real-time graph/tree sync within 250ms of a filesystem event.
- Auto-reconnect with exponential backoff (max 30s). Zero manual refreshes.
- Node 'pulse' animations trigger on file change events.
- Hardware job progress (Blender, ESP flash) streams into UI without polling.

### Task List
- [x] Create `client/src/hooks/useOmnecorSocket.ts` — reconnect, ring-buffer (200), ping, subscriptions.
- [ ] Wire `useOmnecorSocket` into `NeuralGraphView.tsx` — map fileEvents to React Flow state.
- [ ] Wire `useOmnecorSocket` into `NeuralTreeView.tsx` — mirror graph updates in tree view.
- [x] Create `HITLAlertPanel.tsx` — loopDetected events trigger manual intervention banner.
- [ ] Add `wsLink` to tRPC config in `client/src/main.tsx` if subscription support is required.

### Risks
- **Stale connections:** Always close WebSocket and clear timers on component unmount.
- **Race conditions during rapid file changes:** Backend debouncing + frontend ring-buffer handle this.
- **Hardcoded URLs:** Use `VITE_WS_URL` env var or derive from `window.location`. Never hardcode.

### Tests Required
- `useOmnecorSocket.test.ts` — reconnect logic, ring-buffer eviction, subscription payloads.
- E2E: Create file in watched dir → new node appears without page reload.
- E2E: Trigger ESP flash → progress bar advances from streaming JSON events.

---

## Phase 7 — UX Polish & Aviation Oversight (NEXT)

### Goal
Elevate Omnecor to Aviation-grade reliability with a distinct creative environment.

### Features
- **Ctrl+K Command Palette:** Global keyboard shortcut for all major actions.
- **Fiction Mode:** A distinct UI mode for creative/generative workflows, visually
  differentiated from engineering mode.
- **Aviation-Grade HITL Checklists:** Challenge-and-response confirmation dialogs
  for high-impact AI tasks (mass file writes, firmware flashing, model training runs).
  User must explicitly confirm each step before proceeding.
- **Time-Boxed Decision Lanes:** Auto-pause long-running agent tasks and surface
  a review prompt after a configurable time threshold.

---

## Phase 8 — OMMESH: Distributed Mesh Intelligence (IN PROGRESS)

### Goal
Transform Omnecor from a standalone workstation into a distributed LAN-native AI cloud.

### Success Criteria
- [x] **Zero-Config Discovery**: Nodes find each other on a LAN via mDNS (`bonjour`).
- [x] **Secure Federation**: mTLS with automated certificate rotation and signed messages.
- [x] **Intelligent Offloading**: VRAM-weighted job routing via `RoutingEngine`.
- [ ] **Transparent Scaling**: A "Mesh Compute" resource pool is visible in the UI.

### Architecture Implementation
- **mDNS Discovery**: Uses `bonjour` to advertise node identity and capabilities on the LAN.
- **Security Manager**: Handles ed25519/RSA identity, mTLS TLS options for server/client, and certificate lifecycle (generation/rotation).
- **Routing Engine**: Decides whether to execute inference locally or route to a peer based on VRAM score.
- **MeshNode Orchestrator**: Singleton service coordinating discovery, security, and routing.
- **tRPC Integration**: `ommeshRouter` provides mesh control and discovery APIs to the frontend.

### Task List
- [x] Implement core types and interfaces.
- [x] Create `SecurityManager` with mTLS and cert rotation.
- [x] Create `DiscoveryService` using `bonjour`.
- [x] Create `RoutingEngine` (VRAM-weighted).
- [x] Integrate `ommeshRouter` into unified `appRouter`.
- [x] Implement peer notification broadcast after cert rotation.
- [ ] Create Mesh Compute UI panel using existing Neural Graph components.

---

## Phase 9 — Packaging & Distribution

### Deliverables
- `.deb` package (Debian 12 / Ubuntu 20.04+) with systemd service.
- AppImage (portable, no install required).
- Flatpak (sandboxed, for broader distro support).

### Checklist
- [ ] Debian package structure (`packaging/deb/`)
- [ ] AppImage bundling (`packaging/appimage/`)
- [ ] Flatpak manifest
- [ ] systemd service file
- [ ] Post-install script (dependency checks, first-run setup)
- [ ] Packaging documentation update

---

## Phase 12 — Security Hardening (COMPLETE)

### Goal
Harden the Omnecor HMCI infrastructure against critical vulnerabilities, ensuring
safe handling of untrusted data and protection of sensitive credentials.

### Success Criteria
- [x] **Eliminate Deserialization Risks**: Secure all `torch.load` calls in Python microservices.
- [x] **Path Traversal Mitigation**: Validate all file access paths against strict root boundaries.
- [x] **Credential Hygiene**: Prevent sensitive API keys from persisting in browser `localStorage`.
- [x] **Dependency Integrity**: Update core database and testing libraries to patched versions.
- [x] **Zero Regressions**: Maintain 100% test pass rate (177/177).

### Completed Tasks
- **Critical Deserialization Fix**: Secured `rvc_server.py` by setting `weights_only=True` in `torch.load` to prevent arbitrary code execution via malicious model files.
- **Path Traversal Protection**: Implemented secure root directory validation and `is_safe_path` checks in `rvc_server.py` and `tts_server.py`.
- **Sensitive Data Protection**: Removed `apiKey` and `baseUrl` from `localStorage` in `ModelHub.tsx`, moving toward more secure state management.
- **Security Dependency Updates**: Updated `drizzle-orm` (0.45.2), `vitest` (4.1.7), and `drizzle-kit` (0.31.10) to resolve known vulnerabilities.
- **Verification**: Confirmed all 177 tests pass.

---

## Future — Media & Creative Engines

- **Character Engine:** Consistent character generation across sessions (Flux Pro).
- **Video Clone Engine:** Advanced video generation with voice-cloned narration.
- **ComfyUI Integration:** Node-based image generation pipeline bridge.
- **crewAI / n8n Integration:** External orchestration connectors.
- **Unsloth Integration:** Local LoRA fine-tuning pipeline UI.

---

## Inferred Planned Feature: Real OMMESH Routing
Currently, OMMESH discovery and security are functional, but the `AiProviderService` does not yet leverage the mesh for distributed inference.
- **Goal**: Enable transparent offloading of LLM requests to peer nodes based on VRAM availability.
- **Requirement**: Update `AiProviderService.ts` to query `MeshNodeOrchestrator` for optimal execution targets.

## Inferred Planned Feature: Specialized Module Hardening
Bridge the gap between the aesthetic mock UIs for specialized tools and their functional backend bridges.
- **LLM Builder**: Wire to Unsloth/Fine-tuning service.
- **3D Modeler**: Wire to Blender headless rendering.
- **PCB Designer**: Wire to KiCad DRC/ERC service.

## Inferred Planned Feature: Agentic Memory Integration
Move beyond static vector storage to active agent-driven memory management.
- **Goal**: Integrate `LiteAgent` and `CrewAI` references to allow agents to autonomously manage working and episodic memory layers.