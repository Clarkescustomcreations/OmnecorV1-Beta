# Omnecor Master Feature Plan & Capability Map

This document serves as the authoritative record of all features, functional capabilities, and architectural goals of the Omnecor AI Studio. It synthesizes data from all project todo lists, audit reports, and design documents.

## 1. Core AI & Chat Engine
*   **Multi-Provider Hub:** Integration with Ollama, OpenAI, Anthropic, Google Gemini, Groq, Fal.ai, and Llama.cpp.
*   **Valet Router (1.5B):** Fine-tuned Qwen-based router for intelligent task-to-model mapping.
*   **Hierarchical Context Management:** Rolling terminal buffers, permanent Goal & Plan buffers, and auto-summarization.
*   **Action Hash Loop Detector:** HITL-gated protection against AI infinite loops.
*   **Streamdown Rendering:** Real-time Markdown and interactive component rendering in chat.
*   **Context Transparency:** Visual indicators of active files, token usage, and latency/cost.
*   **Memory Systems:** Session-based vs. Persistent episodic memory (Drizzle/MySQL + ChromaDB).
*   **Prompt Sanitization:** Adversarial injection defense and NFC normalization.

## 2. OMMESH Distributed Intelligence
*   **mDNS Discovery:** Automatic LAN node detection and federation.
*   **mTLS Security:** Encrypted node-to-node communication.
*   **VRAM-Weighted Routing:** Intelligent load balancing across mesh nodes based on hardware availability.
*   **Topology Map:** Visual representation of the mesh network (Planned: `react-force-graph`).
*   **Mesh Compute UI:** Dedicated panel for monitoring and authorizing peer nodes.

## 3. Creative & Manufacturing Suite (3D Designer)
*   **3D Viewer:** React Three Fiber-based canvas for GLTF/OBJ/Primitive rendering.
*   **Schematic/PCB Editor:** React Flow-based diagramming with a dark-circuit board aesthetic.
*   **Web Preview:** Sandboxed iframe for live AI-generated UI testing.
*   **Visual Editor (WYSIWYG):** Style inspector, element dragging, and inline text editing for web previews.
*   **Workspace Code Editor:** Tab-based virtual file system with scroll-synced line numbers and Markdown preview.
*   **Visual Diff Checker:** Line-by-line highlights with Accept/Reject/Suggest actions.
*   **Neural Brain Map:**
    *   **File-to-Graph Rendering:** `fileTreeToNetwork.ts` converts real project file trees to React Flow networks with color-coded node types.
    *   **Multi-Source Maps:** Local directories, GitHub repos (`github://owner/repo`), and cloud integrations (`integration://provider`) as source nodes.
    *   **Master Network View:** `buildMasterNetwork()` aggregates all maps into a single workspace-level graph (polar layout, colour-coded per map).
    *   **Visual Controller:** Persistent settings (Zustand + localStorage) — Layout Engine (Force/Hierarchical/Mind-Map/Circular), Node Size slider, Animation Speed slider, GPU Acceleration toggle, Auto-Clustering toggle.
    *   **Drag-to-Context:** React Flow nodes have a `⋮⋮` grip handle; dragging adds file/folder to AI chat context. Click "Add to Context" also available.
    *   **Label Editing:** Inline rename via pencil icon; persisted to `NeuralBrainMap.labelOverrides` in DB.
    *   **DB Persistence:** `neuralMaps` table + `neuralMapsRouter` (list/create/update/delete/migrate); localStorage warm cache for sovereign/offline mode.
    *   **User & Project Peer Cards:** Identity cards injected into AI system prompt; user card persists via localStorage, project card per-map.
    *   **Fiction Mode:** Creative graph exploration mode with distinct UI (FictionModePanel, FictionModeContext).

*   **Manufacturing Pipelines:**
    *   **Blender Bridge:** Headless render, glTF export, and script execution.
    *   **KiCad Bridge:** DRC/ERC checks, STEP/Gerber export, and BOM generation.
    *   **PCBWay Integration:** Quoting and automated ordering (HITL gated).

## 4. Agent Networking & Social Automation
*   **Omnichannel Publishing:** X/Twitter, LinkedIn, Instagram, TikTok, Facebook, YouTube integration.
*   **AI Curator Hub:** Automated discovery feed, AI summarization, and draft curation.
*   **Content Scheduler:** Calendar-view for managing future posts across platforms.
*   **Engagement Analytics:** Reach, impressions, and sentiment tracking.
*   **Persona Studio:** Bio, tone, and posting schedule management for autonomous agents.

## 5. Security & Sovereignty
*   **Zero-Login Mode:** Air-gapped/offline operation with synthetic local admin.
*   **Execution Modes:** Sovereign (local only), Scrapper (local-preferred), Big Spender (cloud-allowed).
*   **Immutable Audit Log:** Append-only event tracking with PII scrubbing.
*   **File Security:** AES-256-GCM encryption and YARA-based vulnerability scanning.
*   **RBAC Matrix:** Viewer, User, Admin, and Owner roles with granular permissioning.
*   **HITL Gates:** Human-approval requirements for dangerous actions (file deletion, card issuance, etc.).

## 6. Infrastructure & Systems
*   **Agentic Wallet:** Budget enforcement, model pricing estimation, and Virtual Credit Card (Lithic) issuance.
*   **Voice Pipeline:** Faster-Whisper (STT), XTTS-v2 (TTS), and RVC (Voice Conversion).
*   **Specialized Module Launchers:** ESPTool (firmware flashing), LLM Builder (Unsloth fine-tuning), and Cloud Compute Rental (Vast.ai, RunPod).
*   **Cross-Platform Packaging:** Linux (deb, AppImage, Flatpak), Windows (NSIS, Portable), Android (Capacitor client).
*   **System Health Dashboard:** GPU detection, VRAM monitoring, and auto-update mechanism.

## 7. Status of "Dark Logic" (Implemented Backend, Pending UI)
> **2nd-Pass Audit 2026-06-07:** All 6 items have backend implementations. UI exposure varies.

*   **Mesh Federation Approval:** `ommesh.router.approvePeer` — ✅ Backend implemented (`server/ommesh/core/SecurityManager.ts`). ⚠️ UI blocked by `trpc.ommesh.*` namespace mismatch (router mounted as `mesh`).
*   **Hardware Control:** `espRouter.flash` — ✅ Full ESPTool bridge + firmware flash UI in `SpecializedModuleLauncher`.
*   **Social Ingestion:** RSS/API article discovery — ✅ `discoveryRouter.ts` + `curatorRouter.ts`; Discovery tab in AgentNetworking UI implemented.
*   **Financial Insights:** `walletRouter.getSpendLog` — ✅ Implemented and mounted. `BudgetPanel.tsx` renders spend history.
*   **Memory Archiving:** `aiRouter.summarizeAndPruneSession` — ✅ Procedure exists in `aiRouter.ts`. No scheduled trigger or UI button yet.
*   **Batch Dataset Processing:** `trainingRouter.validateDataset` — ✅ Procedure exists in `trainingRouter.ts`. Exposed via `UnslothPanel.tsx`.

## 8. Active Bugs & Stubs — Verified by Swarm Audit 2026-06-07
> Previous items corrected; new bugs discovered. Items marked ✅ are resolved.

*   ✅ ~~**Chat Model Selector disconnected**~~ — `ModelSelector.tsx` queries discovered models via tRPC with 30/60s refetch. **FIXED.**
*   ✅ ~~**Provider Key Mapping (uppercase/lowercase)**~~ — `AiProviderService.getProviderKey()` normalizes correctly. **FIXED.**
*   ✅ ~~**3D External Route missing**~~ — `/3d-designer-external` present in `App.tsx:83`. **FIXED.**
*   ✅ ~~**Settings Persistence (Security/Hardware/Voice stubs)**~~ — All three panels call `trpc.system.saveSettings`. **FIXED.**
*   ✅ ~~**`DiscoveryService.getPeers()` returns `[]`**~~ — **FIXED 2026-06-07.** Peer tracking Map + bonjour `'up'`/`'down'` events added. Topology map and VRAM routing now receive live peer data.
*   ✅ ~~**OMMESH router namespace mismatch**~~ — **FIXED 2026-06-07.** `routers.ts` mount key: `mesh` → `ommesh`.
*   ✅ ~~**Content Scheduler "New Post" / "Edit" unwired**~~ — **FIXED 2026-06-07.** `createDirectPost` mutation added to `schedulingRouter`; inline form + inline reschedule wired in `AgentNetworking.tsx`.
*   ✅ ~~**SQLite Compatibility (7 routers importing from `../db` directly)**~~ — **FIXED 2026-06-07.** All 7 routers updated to `../db.factory.js`. All null-guards already present.
*   ✅ ~~**Loop Detection no backend persistence**~~ — **FIXED 2026-06-07.** `ai.reportLoopViolation` tRPC mutation added; `HITLAlertPanel.tsx` fires it via vanilla tRPC on every loop event.
*   ✅ ~~**Missing onClick handlers (KiCad BOM, STL/GLB, Settings panels)**~~ — **FIXED 2026-06-07.** All 6 buttons wired: KiCad Download BOM (backend `downloadBOM` query + blob download), STL/GLB exports (blender.export mutations), Settings General Export/Import Config + Knowledge Add/Remove Folder + Advanced Diagnostic Bundle.
*   ✅ ~~**File Attachment Upload**~~ — **FIXED 2026-06-07.** `attachmentsRouter.ts` created (upload → `uploads/attachments/<uuid>.<ext>`, returns URL); static serving via `_core/static.ts`; `ChatInput.tsx` wired with async send flow.
*   ✅ ~~**Neural Map localStorage-only**~~ — **FIXED 2026-06-07.** `neuralMaps` table + `neuralMapsRouter` (list/create/update/delete/migrate) added; `NeuralMapContext.tsx` fully rewritten with tRPC-backed persistence; localStorage kept as warm cache for sovereign/offline mode.
*   ✅ ~~**Persona Studio no backend**~~ — **FIXED 2026-06-08.** `personas` table in `drizzle/schema.ts`; `personaRouter.ts` (list/upsert/delete/migrate); `PersonaCreationPanel.tsx` fully wired with tRPC + one-time localStorage→DB migration.
*   ✅ ~~**Rolling chat buffers**~~ — **FIXED 2026-06-08.** `Chat.tsx` auto-compresses after 50 messages (keeps last 6, inserts system summary entry, fires toast).
*   ✅ ~~**Real-time preview sync (Blender/KiCad)**~~ — **FIXED 2026-06-08.** `ManufacturingPanel.tsx` wired with `useOmnecorSocket({ jobId })` + `jobLifecycle` events.
*   ✅ ~~**Visual Controller non-functional**~~ — **FIXED 2026-06-08.** `visualControlStore.ts` (persist); 4 layout algorithms (Force, Hierarchical, Mind-Map, Circular); Node Size slider; Anim Speed slider; GPU Acceleration toggle; Auto-Clustering toggle. All settings saved to localStorage.
*   ⚠️ **Missing backend services** — `ModelManagementService`, `ModelMarketplaceService`, `IntegrationManagementService`, crewAI/n8n connectors.
*   ⚠️ **Valet Router advisory-only** — Decision is logged but does not override `providerId`; rule-based fallback active until model artifact is present.

---
**Last Updated:** Sunday, June 8, 2026 (3rd-Pass: Security + TSC + Chat Features + Visual Controller)
**Vision:** Omnecor v3.0.0 (The Autonomous AI Workstation)
