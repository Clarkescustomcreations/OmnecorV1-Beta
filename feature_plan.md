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
- [ ] Wire `useOmnecorSocket` into `NeuralGraphView.tsx` — map fileEvents to React Flow state. // TODO: wire after Gemini CLI Chunk 04 completes
- [ ] Wire `useOmnecorSocket` into `NeuralTreeView.tsx` — mirror graph updates in tree view. // TODO: wire after Gemini CLI Chunk 04 completes
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

## Phase 8 — OMMESH: Distributed Mesh Intelligence

### Goal
Transform Omnecor from a standalone workstation into a distributed LAN-native AI cloud.

### Success Criteria
- **Zero-Config Discovery:** Nodes find each other on a LAN within 5 seconds via mDNS/UDP broadcast.
- **Secure Federation:** mTLS or signed token exchange. Only trusted nodes share compute.
- **Intelligent Offloading:** Inference requests route to the node with the most available
  VRAM and lowest latency. The orchestrator tracks this in real-time.
- **Transparent Scaling:** A "Mesh Compute" resource pool is visible in the UI, showing
  all online nodes, their VRAM availability, and current job loads.

### Architecture Notes
- Each Omnecor instance runs a LAN beacon service on a fixed UDP port.
- The primary node maintains a mesh registry (node ID, IP, port, VRAM, status).
- Job routing uses a simple weighted score: `(available_vram * 0.7) + (1/latency_ms * 0.3)`.
- Mesh state is broadcast via WebSocket to the frontend for live display.

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

## Future — Media & Creative Engines

- **Character Engine:** Consistent character generation across sessions (Flux Pro).
- **Video Clone Engine:** Advanced video generation with voice-cloned narration.
- **ComfyUI Integration:** Node-based image generation pipeline bridge.
- **crewAI / n8n Integration:** External orchestration connectors.
- **Unsloth Integration:** Local LoRA fine-tuning pipeline UI.
