# Omnecor Documentation Index

This is the full map of the `docs/` tree. For top-level project docs
(installation, FAQ, security policy, etc.) see the repository root.

---

## 🚀 Getting Started

| Doc | Purpose |
|---|---|
| [../INSTALL.md](../INSTALL.md) | Full installation guide — all platforms |
| [../QUICKSTART.md](../QUICKSTART.md) | 5–10 minute fast-path setup |
| [setup/SETUP_WIZARD.md](setup/SETUP_WIZARD.md) | In-app first-run wizard walkthrough |
| [setup/OAUTH_SETUP.md](setup/OAUTH_SETUP.md) | Configuring OAuth for social platforms / identity providers |
| [setup/OMMESH_SETUP.md](setup/OMMESH_SETUP.md) | Connecting a second (or third) machine into your OMMESH mesh |

---

## 📖 User Guides

| Doc | Covers |
|---|---|
| [user-guides/Omnecor User Guide.md](<user-guides/Omnecor User Guide.md>) | Full feature walkthrough — start here for a complete tour |
| [user-guides/AGENT_NETWORKING.md](user-guides/AGENT_NETWORKING.md) | Social media automation — discovery, curation, scheduling, publishing |
| [user-guides/PODCAST_STUDIO.md](user-guides/PODCAST_STUDIO.md) | Script generation, multi-speaker TTS, episode history |
| [user-guides/3D_DESIGNER.md](user-guides/3D_DESIGNER.md) | 3D Viewer + PCB Schematic Editor — scope, AI context bridge, Blender/KiCad handoff |
| [user-guides/FICTION_MODE.md](user-guides/FICTION_MODE.md) | Creative writing mode — locks, personas, story-bible state |
| [user-guides/ALWAYS_LISTEN.md](user-guides/ALWAYS_LISTEN.md) | Android wake-word voice mode setup |
| [user-guides/SLASH_COMMANDS.md](user-guides/SLASH_COMMANDS.md) | All chat slash commands, including the `/architect /remember /review /recover /imprint` workflow skills |
| [user-guides/PERSONA_AGENT_GUIDE.md](user-guides/PERSONA_AGENT_GUIDE.md) | Configuring always-on persona agents |
| [user-guides/CLOUD_COMPUTE.md](user-guides/CLOUD_COMPUTE.md) | Renting GPU compute (Vast.ai / RunPod / Lambda Labs) |
| [user-guides/LIGHT_MODE.md](user-guides/LIGHT_MODE.md) | Light theme reference |
| [user-guides/SECURITY_FEATURES.md](user-guides/SECURITY_FEATURES.md) | Encryption, auditing, threat scanning, execution modes |

---

## 🧠 AI & Routing

| Doc | Covers |
|---|---|
| [ai-agents/VALET_ROUTER.md](ai-agents/VALET_ROUTER.md) | The 1.5B routing classifier — architecture, serving, fallback behavior |
| [ai-agents/WORKFLOW_SEQUENCING.md](ai-agents/WORKFLOW_SEQUENCING.md) | Multi-step pipeline orchestration |
| [ai-agents/Omnecor AI Agent Responsibilities.md](<ai-agents/Omnecor AI Agent Responsibilities.md>) | Agent roles and decision-making authority |
| [ai-agents/Omnecor Multi-Agent Collaboration Workflows.md](<ai-agents/Omnecor Multi-Agent Collaboration Workflows.md>) | How agents collaborate and share context |
| [sovereignty/EXECUTION_MODES.md](sovereignty/EXECUTION_MODES.md) | Sovereign / Scrapper / Big Spender — what each mode blocks and allows |

**Valet Router training internals** (developer-facing, not needed for normal
use): see [ai-agents/valet-training/](ai-agents/valet-training/) — dataset
generation, build instructions, serving runbook, I/O contract.

---

## 🏗️ Architecture & Backend

| Doc | Covers |
|---|---|
| [backend/SERVER_ARCHITECTURE.md](backend/SERVER_ARCHITECTURE.md) | Express/tRPC server design |
| [architecture/DATA_FLOW.md](architecture/DATA_FLOW.md) | How data moves between frontend, backend, AI models, external services |
| [architecture/ROUTER_INVENTORY.md](architecture/ROUTER_INVENTORY.md) | Reference for every tRPC router |
| [architecture/Omnecor System Design.md](<architecture/Omnecor System Design.md>) | High-level system design |
| [backend/SERVICES_OVERVIEW.md](backend/SERVICES_OVERVIEW.md) | Backend singleton services |
| [backend/DATABASE_SCHEMA.md](backend/DATABASE_SCHEMA.md) | Drizzle schema reference |
| [backend/AI_BRIDGES.md](backend/AI_BRIDGES.md) | Python inference bridge architecture |
| [backend/EXTERNAL_APIS.md](backend/EXTERNAL_APIS.md) | All 30+ external service integrations |
| [api/TRPC_API.md](api/TRPC_API.md) | tRPC API reference |
| [api/WEBSOCKET_API.md](api/WEBSOCKET_API.md) | WebSocket events and auth |

---

## 🎨 Frontend

| Doc | Covers |
|---|---|
| [frontend/UI_OVERVIEW.md](frontend/UI_OVERVIEW.md) | Page-by-page UI tour |
| [frontend/COMPONENT_HIERARCHY.md](frontend/COMPONENT_HIERARCHY.md) | Component structure |
| [frontend/STATE_MANAGEMENT.md](frontend/STATE_MANAGEMENT.md) | Zustand, TanStack Query, context patterns |
| [frontend/NEURAL_BRAIN_MAP_UI.md](frontend/NEURAL_BRAIN_MAP_UI.md) | Brain Map canvas internals |

---

## 💰 Wallet

| Doc | Covers |
|---|---|
| [wallet/AGENTIC_WALLET.md](wallet/AGENTIC_WALLET.md) | Per-project budgets, spend tracking, virtual cards |

---

## 🛠️ Development

| Doc | Covers |
|---|---|
| [workflows/DEVELOPMENT_WORKFLOWS.md](workflows/DEVELOPMENT_WORKFLOWS.md) | Local dev setup, branching, migrations |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines, including the AGENTS.md context system |
| [../AGENTS.md](../AGENTS.md) | Agent/developer behavioral rules, schema gotchas, skill triggers |

---

## 📦 Packaging & Platform Builds

| Doc | Covers |
|---|---|
| [../packaging/windows/BUILD-WINDOWS.md](../packaging/windows/BUILD-WINDOWS.md) | Windows installer build |
| [../packaging/android/BUILD-ANDROID.md](../packaging/android/BUILD-ANDROID.md) | Android APK build (quick reference) |
| [../packaging/android/omnecor-hq/README.md](../packaging/android/omnecor-hq/README.md) | Full Android companion app reference |
| [../packaging/electron-app/README.md](../packaging/electron-app/README.md) | Electron desktop shell |

---

## 📜 Project-Level

| Doc | Covers |
|---|---|
| [../README.md](../README.md) | Project overview, full feature list |
| [../ROADMAP.md](../ROADMAP.md) | Current focus, v1.0 blockers, future milestones |
| [../CHANGELOG.md](../CHANGELOG.md) | Version history |
| [../FAQ.md](../FAQ.md) | Frequently asked questions |
| [../TROUBLESHOOTING.md](../TROUBLESHOOTING.md) | Common issues and fixes |
| [../SECURITY.md](../SECURITY.md) | Security policy |
| [Acknowledgments/Open-Source-Acknowledgements.md](Acknowledgments/Open-Source-Acknowledgements.md) | OSS attributions |

---

*If you add a new doc, add it to this index in the same PR — an undiscoverable
doc might as well not exist.*
