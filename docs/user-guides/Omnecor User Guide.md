# Omnecor User Guide

Welcome to the comprehensive User Guide for Omnecor, the Human-Machine Collaboration Interface (HMCI). This guide is designed to help users of all skill levels—from beginners to advanced power users—understand, install, configure, and effectively utilize Omnecor to enhance their AI-driven workflows. Omnecor is your prefrontal cortex for your AI workforce, a context-holding, memory-preserving, operation-coordinating core that lets you build, design, generate, and engineer without switching tools, losing context, or working in silos.

Operational Memory Never Escapes. Context Overview Remains.

## Table of Contents

1.  [Introduction](#1-introduction)
2.  [Feature Overview](#2-feature-overview)
3.  [System Requirements](#3-system-requirements)
4.  [Installation Guide](#4-installation-guide)
    -   4.1. [Linux Packages (.deb / AppImage / Flatpak)](#41-linux-packages)
    -   4.2. [Windows Installer](#42-windows-installer)
    -   4.3. [Android APK (Thin Client)](#43-android-apk-thin-client)
    -   4.4. [Zero-Login & Air-Gapped Operation](#44-zero-login--air-gapped-operation)
5.  [First Launch & Setup Wizard](#5-first-launch--setup-wizard)
6.  [User Interface Guide](#6-user-interface-guide)
    -   6.7. [Appearance & Light Mode](#67-appearance--light-mode)
7.  [Core Workflows](#7-core-workflows)
8.  [Configuration Guide](#8-configuration-guide)
9.  [AI Systems Documentation](#9-ai-systems-documentation)
10. [Agentic Wallet & Budgeting](#10-agentic-wallet--budgeting)
10b. [Notifications & Agent Messenger](#10b-notifications--agent-messenger)
11. [Cloud Compute Rental](#11-cloud-compute-rental)
    -   11b. [Kaggle GPU Training](#11b-kaggle-gpu-training)
    -   11a. [Agent Networking & Social Media Automation](#11a-agent-networking--social-media-automation)
12. [Persona & Agent Creation](#12-persona--agent-creation)
13. [Networking & Multi-System Operation](#13-networking--multi-system-operation)
14. [Security & Permissions](#14-security--permissions)
15. [Backup, Recovery, and Migration](#15-backup-recovery-and-migration)
16. [Troubleshooting Guide](#16-troubleshooting-guide)
17. [Logs & Diagnostics](#17-logs--diagnostics)
18. [Advanced Usage](#18-advanced-usage)
19. [Performance Optimization](#19-performance-optimization)
20. [FAQ](#20-faq)
21. [Glossary](#21-glossary)
22. [Appendix](#22-appendix)

---

## 1. Introduction

Omnecor is a powerful, local-first AI workstation designed for Creativity (Operational Memory Never Escapes Context Overview Remains). It seamlessly integrates local and API-based AI models, manages complex projects, and orchestrates multi-step workflows—all in one refined interface. It serves as the unifying layer across every creative and technical discipline, built for individuals who code, design hardware, generate media, and run AI agents, often within the same session.

### 1.1. Project Overview

Omnecor collapses a costly multi-tool subscription stack into a single, locally deployed workspace. It provides strictly local data sovereignty, ensuring your data remains on your machine. With interactive neural brain maps, you can visualize, connect, and understand your projects like never before. It allows you to run any local or cloud AI model on your own terms, free from mandatory monthly bills, offering pure ownership.

### 1.2. Purpose and Goals

The primary purpose of Omnecor is to empower users with a comprehensive, context-aware AI infrastructure that enhances productivity and creativity. Our goals include:

-   Providing a unified platform for diverse AI-driven tasks.
-   Ensuring data sovereignty and user control over AI models.
-   Facilitating seamless human-machine collaboration.
-   Offering a flexible and extensible system for advanced users.

### 1.3. Major Capabilities

Omnecor offers a wide array of capabilities, including:

-   **Unified Backend**: A centralized Express.js/tRPC engine for real-time UI/data state synchronization.
-   **Neural Workspaces**: Spatial graph-based project management for semantic visualization.
-   **Multi-Modal Workforce**: Integrated autonomous agent orchestration for software, media, and hardware tasks.
-   **Hardware Integration Layer**: Secure bridges for Blender (3D), KiCad (PCB), and ESPTool (Firmware).
-   **Voice Pipeline**: High-performance STT (Whisper) and TTS/RVC microservices.
-   **OMMESH**: Distributed mesh intelligence layer for multi-node collaboration.

### 1.4. Supported Platforms

Omnecor is primarily developed for Linux-based operating systems, with official support for Debian 12 and Ubuntu 20.04+ (LTS recommended). While it may run on other platforms (e.g., Windows via WSL2, macOS), full compatibility is not guaranteed.

### 1.5. Intended Users

Omnecor is built for a diverse audience of power users who refuse to stay in one lane:

-   **Developers & Hackers**: Those who build new things and need flexible tooling.
-   **Hardware Engineers**: PCB designers, firmware writers, bridging physical and digital.
-   **AI Researchers & Power Users**: Individuals running local models, building custom agents, and experimenting with AI.
-   **Creative Professionals**: Artists, filmmakers, 3D artists, and musicians using AI as a medium.

### 1.6. Real-World Use Cases

-   **AI-Assisted Software Development**: Agents writing and debugging code, managing project structures.
-   **Generative Media Production**: Creating images, videos, and audio with integrated AI tools.
-   **Hardware Design and Automation**: Designing PCBs, flashing firmware, and automating physical processes.
-   **Knowledge Management**: Building semantic knowledge bases and performing advanced research with AI.

### 1.7. System Philosophy

Omnecor embodies a philosophy of **sovereignty, flexibility, and collaboration**. It puts the user in control of their data and tools, offering a highly customizable environment that adapts to complex, interdisciplinary workflows. The system is designed to be an intelligent co-pilot, technically precise, and always in service of the user.

### 1.8. Architecture Overview

Omnecor operates as a unified application with a single Express server, integrating a tRPC API, a WebSocket server for real-time updates, and static file serving. Key architectural components include a services layer for business logic, the OMMESH network for distributed intelligence, and Python bridges for hardware integration. For a deep dive, refer to `docs/architecture/SYSTEM_DESIGN.md`.

---

## 2. Feature Overview

Omnecor is engineered as a modular, production-grade workstation. This section provides a detailed breakdown of its major systems, UI modules, AI capabilities, automation systems, and integrations.

### 2.1. Unified Backend

-   **Purpose**: A centralized Express.js/tRPC engine ensuring real-time UI/data state synchronization via WebSockets.
-   **Workflow**: All frontend requests and real-time updates are routed through this unified backend, which orchestrates various internal services and external integrations.
-   **User Interaction**: Seamless and responsive application behavior due to synchronized state.
-   **Dependencies**: Node.js, Express.js, tRPC, WebSocket-compatible clients.
-   **Limitations**: Requires a stable backend process for full functionality.
-   **Related Settings**: Port configuration in `.env`.

### 2.2. Neural Workspaces (Neural Brain Map)

-   **Purpose**: Spatial graph-based project management using React Flow for semantic file/knowledge visualization.
-   **Workflow**: Users create and manipulate nodes (representing files, ideas, tasks) and edges (representing relationships) on an interactive canvas. AI agents can also interact with the map.
-   **User Interaction**: Drag-and-drop, zoom, pan, context menus, node property editing.
-   **Dependencies**: React Flow, `brainMapStore` (Zustand), `NeuralMapContext`.
-   **Limitations**: Optimal performance on larger screens; complex maps may require more resources.
-   **Related Settings**: Display preferences, auto-layout options (future).

### 2.3. Multi-Modal Workforce (AI Agents)

-   **Purpose**: Integrated autonomous agent orchestration for software, media, and hardware tasks.
-   **Workflow**: Specialized AI agents collaborate to execute complex tasks, leveraging shared context and communication protocols. Workflows can involve multiple steps and human-in-the-loop approvals.
-   **User Interaction**: Initiating agent tasks, reviewing agent outputs, providing approvals.
-   **Dependencies**: `AgentService`, `WorkflowSequencing`, `MemoryArchitectService`, `VectorDBService`.
-   **Limitations**: Agent capabilities are defined by their programming and available tools.
-   **Related Settings**: Agent permissions, workflow configurations.
-   **1.5B Valet Router**: A locally-running fine-tuned model that serves as the intelligent dispatch layer. It classifies every task into one of 10 categories and routes it to the optimal provider or chain. The routing decision itself never leaves your machine.
-   **Routing Modes**: Ten user-configurable modes control how the Valet dispatches tasks — from direct API pass-through, to multi-API distribution, to sequential MoE chains through custom LLM-Builder models, to full OMMESH + multi-API hybrid routing. See [VALET_ROUTER.md](../ai-agents/VALET_ROUTER.md) for the full reference.
-   **Multi-API Support**: Run agents against multiple AI subscriptions or APIs simultaneously (Claude, Gemini, OpenAI/ChatGPT, Grok, local models, etc.). The Valet selects the best-suited provider per task type within the same workflow.
-   **Guided Walk-Through Scrapper Mode**: When automated routing fails or no API keys are available, the Valet guides the user manually — generating detailed prompt instruction sets, recommending the best free web UI, and integrating the result when the user returns it.

### 2.4. Hardware Integration Layer (Python Bridges)

-   **Purpose**: Secure, process-managed bridges for Blender (3D), KiCad (PCB), and ESPTool (Firmware).
-   **Workflow**: Backend services invoke Python scripts (`blender_bridge.py`, `kicad_bridge.py`, `esptool_bridge.py`) via the `ProcessManagerService` to interact with external hardware and software. Status updates are streamed back to the UI.
-   **User Interaction**: Triggering hardware operations from the UI, monitoring progress.
-   **Dependencies**: Python environment, specific external tools (Blender, KiCad, ESPTool).
-   **Limitations**: Requires correct installation and configuration of external tools.
-   **Related Settings**: Python environment paths, tool configurations.

### 2.5. Voice Pipeline

-   **Purpose**: A high-performance inference bridge to FastAPI-based STT (Whisper) and TTS/RVC microservices.
-   **Workflow**: User voice input is transcribed to text (STT), and AI-generated text can be converted to speech (TTS) or cloned voices (RVC).
-   **User Interaction**: Voice input buttons, TTS panel controls.
-   **Dependencies**: FastAPI microservices, Whisper model, RVC models.
-   **Limitations**: Performance depends on local hardware and model size.
-   **Related Settings**: Voice model selection, audio input/output devices.

### 2.6. OMMESH (Distributed Mesh Intelligence Layer)

-   **Purpose**: Enables multiple Omnecor nodes to discover each other on a LAN, federate securely via mTLS, and route inference requests by available VRAM.
-   **Workflow**: Omnecor instances form a secure mesh, sharing resources and distributing AI inference tasks. Nodes discover each other using Bonjour.
-   **User Interaction**: Monitoring mesh status, configuring node visibility.
-   **Dependencies**: `MeshNode`, `DiscoveryService`, `SecurityManager`, `RoutingEngine`.
-   **Limitations**: Requires a local network connection.
-   **Related Settings**: Network ports, security certificates.

### 2.7. Context Management and Memory Layer

-   **Purpose**: Ensures AI agents maintain coherence and access relevant information across tasks and sessions.
-   **Workflow**: Project documents are chunked, embedded, and stored in ChromaDB via `VectorDBService`. The `MemoryArchitectService` retrieves semantically relevant chunks as context for AI models (RAG).
-   **User Interaction**: Importing project folders, semantic search.
-   **Dependencies**: `VectorDBService`, ChromaDB, `MemoryArchitectService`.
-   **Limitations**: Performance scales with the size of the knowledge base.
-   **Related Settings**: Chunking parameters, vector database configuration.

### 2.8. Dashboards and Monitoring

-   **Purpose**: Provide an overview of active projects, system status, and recent activities.
-   **Workflow**: Displays real-time metrics and summaries of ongoing tasks, resource utilization, and agent activities.
-   **User Interaction**: Viewing system health, checking task progress.
-   **Dependencies**: Backend health endpoints, WebSocket updates.

### 2.9. Settings Systems

-   **Purpose**: Granular control over application behavior, configurations, and integrations.
-   **Workflow**: Users can adjust various parameters through dedicated UI panels.
-   **User Interaction**: Navigating settings categories, modifying values.
-   **Dependencies**: `appPreferences.ts`, `.env` file.

### 2.10. Agentic Wallet

-   **Purpose**: Real-time cost management for cloud AI providers (OpenAI, Anthropic, Fal.ai, etc.) to prevent runaway spend during agentic workflows.
-   **Workflow**: Every outbound cloud API call is intercepted by `WalletService`, which logs token counts and estimated cost to the `spend_log` table and emits a `budget:spend` WebSocket event to the UI.
-   **Project Budgets**: Set a hard limit in cents for each project. When `mode = 'hard'`, requests are blocked once the limit is reached and remaining tasks are automatically routed to local Ollama/Llama.cpp models.
-   **Alert Thresholds**: Receive a real-time notification when spend reaches a configured percentage of your budget (default: 80%).
-   **Virtual Credit Cards**: Integrated with the Lithic API, Omnecor can issue a unique virtual card per project or agent, providing complete financial isolation at the card network level. Requires `LITHIC_API_KEY` in `.env`.
-   **Manual Tracking Mode**: Without `LITHIC_API_KEY`, the wallet operates in tracking-only mode — no cards are issued but spend is still logged and alerts are still fired.
-   **Related Settings**: `LITHIC_API_KEY`, wallet UI under Settings → Agentic Wallet.

---

## 3. System Requirements

To ensure optimal performance and compatibility, please ensure your system meets the following requirements:

| Component | Minimum Requirement | Recommended for Local LLM Inference |
|---|---|---|
| **Operating System** | Debian 12, Ubuntu 20.04+ (LTS recommended) | Debian 12, Ubuntu 22.04+ |
| **CPU** | 4+ physical cores | 8+ physical cores |
| **RAM** | 8GB | 16GB+ |
| **Disk Space** | 20GB free space on NVMe SSD | 50GB+ free space on NVMe SSD |
| **Network** | Stable connection for API provider calls | Stable connection |
| **Node.js** | 22+ | 22+ |
| **pnpm** | Latest stable version | Latest stable version |
| **GPU** | Optional (for local LLMs/media generation) | NVIDIA GPU with 8GB+ VRAM (e.g., RTX 3060 or higher) |

### 3.1. Linux Specifics

-   **Debian/Ubuntu**: Ensure your system is up-to-date with `sudo apt update && sudo apt upgrade -y`.
-   **Permissions**: Ensure your user has necessary permissions for installing packages and accessing project directories.

### 3.2. Windows and macOS Specifics

While Omnecor is primarily developed for Linux, it may be possible to run it on Windows (via WSL2) or macOS. However, specific instructions and full compatibility are not guaranteed. Users attempting to install on these platforms should be familiar with Node.js development and troubleshooting in their respective environments.

---

## 4. Installation Guide

For detailed, step-by-step instructions on how to install Omnecor, including prerequisites and platform-specific considerations, please refer to the dedicated [INSTALL.md](../INSTALL.md) document.

### 4.1. Linux Packages

Omnecor ships three native Linux package formats for production deployments:

| Package | Command | Notes |
|---|---|---|
| **Debian (.deb)** | `sudo dpkg -i omnecor-hmci_2.3.0_amd64.deb` | Installs to `/opt/omnecor/`, creates a systemd unit and desktop entry. |
| **AppImage** | `chmod +x Omnecor-2.3.0.AppImage && ./Omnecor-2.3.0.AppImage` | Portable — no install or root required. |
| **Flatpak** | `flatpak install --user omnecor.flatpak` | Sandboxed. Note: hardware bridges (ESPTool, serial ports) require extra Flatpak permissions. |

Build any package yourself from source using the scripts in `packaging/`:

```bash
./packaging/build-deb.sh          # → dist/omnecor-hmci_2.3.0_amd64.deb
./packaging/build-appimage.sh     # → dist/Omnecor-2.3.0.AppImage
./packaging/build-flatpak.sh      # → dist/omnecor.flatpak
./packaging/build-all.sh          # → all Linux targets
```

Full reference: [INSTALL.md — Linux Packages](../INSTALL.md#4-platform-specific-packages)

### 4.2. Windows Installer

Omnecor ships a Windows installer built with NSIS via Electron.

- **NSIS installer** (`Omnecor-Setup-2.3.0.exe`) — Installs per-user with no UAC required. Creates a desktop shortcut, Start Menu entry, and silently installs Ollama if absent.
- **Portable EXE** (`Omnecor-2.3.0-portable.exe`) — Run anywhere with no installation.

Build requirements: Windows 10/11 x64, Node.js v24.15.0, Visual Studio C++ Build Tools.

Cross-compile from Linux: `./packaging/build-all.sh --target win`

Full reference: [INSTALL.md — Windows](../INSTALL.md#45-windows--nsis-installer--portable-exe) · [packaging/windows/BUILD-WINDOWS.md](../packaging/windows/BUILD-WINDOWS.md)

### 4.3. Android APK (Thin Client)

The Omnecor Android app is a **thin client** that connects to a running desktop instance over your local Wi-Fi network. It delivers the full workstation UI on a mobile screen.

**Sideload a pre-built APK:**

```bash
adb install app-debug.apk
```

**Build yourself (requires Android NDK r26+ and CMake 3.22+):**

```bash
cd packaging/android/omnecor-hq
pnpm install
pnpm prebuild:android   # generates the Gradle/native project
pnpm apk:debug          # produces app-debug.apk
```

**Connect to the desktop:** Launch the app → Settings → Omnecor Server → enter your desktop's LAN IP or Tailscale IP. Tap **Test** to verify, then **Save**.

Full reference: [INSTALL.md — Android APK](../INSTALL.md#46-android--thin-client-apk) · [packaging/android/BUILD-ANDROID.md](../packaging/android/BUILD-ANDROID.md) · [BUILD.md (detailed)](../packaging/android/omnecor-hq/BUILD.md)

### 4.4. Beginner Installation Path

Follow the [QUICKSTART.md](../QUICKSTART.md) for the fastest way to get Omnecor running with default settings.

### 4.5. Advanced Installation Path

For users requiring specific configurations or deeper control over the installation process, refer to the full [INSTALL.md](../INSTALL.md) guide, paying close attention to environment variable setup and database initialization.

### 4.6. Developer Installation Path

Developers should follow the [CONTRIBUTING.md](../CONTRIBUTING.md) guide, which covers setting up the development environment, running tests, and contributing code.

### 4.7. Zero-Login & Air-Gapped Operation

For enterprise or high-security environments that prohibit external network calls during boot:

1.  **Enable**: Set `ZERO_LOGIN_MODE=true` in your `.env` file.
2.  **Behavior**:
    -   Skips all OAuth provider checks (Google, Microsoft).
    -   Generates a synthetic "Local Admin" session on startup with `role = 'owner'`.
    -   Automatically enforces **Sovereign Mode** (`executionMode = 'sovereign'`) — no cloud procedures can execute.
    -   No external SDK calls are made during the boot sequence.
3.  **Limitations**: Multi-user support and cloud-dependent features (Agentic Wallet card issuance, Fal.ai, cloud LLMs) are unavailable.
4.  **Use Case**: Air-gapped workstations, classified environments, offline demos.

---

## 5. First Launch & Setup Wizard

Upon the very first launch of Omnecor, the system performs several initialization steps to prepare your workstation.

### 5.0. Setup Wizard

The **Setup Wizard** runs automatically on first launch and guides you through the essential configuration steps:

1. **Mode Selection** — Choose Sovereign / Scrapper / Big Spender execution mode.
2. **API Providers** — Enter cloud AI API keys (OpenAI, Anthropic, Gemini, etc.).
3. **Local Model Setup** — Detect Ollama and pull models.
4. **Database** — Confirm SQLite or configure MySQL/MariaDB.
5. **Voice Pipeline** — Configure Whisper STT and XTTS-v2 TTS endpoints.
6. **Hardware Bridges** — Auto-detect Blender, KiCad, ESPTool paths.
7. **Appearance** — Choose light or dark theme.
8. **Local Network** — Set LAN IP for Android thin client connectivity.

Re-open the wizard at any time: **Settings → System → Re-run Setup Wizard**.

Full reference: [docs/setup/SETUP_WIZARD.md](../setup/SETUP_WIZARD.md)

---

Upon the very first launch of Omnecor, the system performs several initialization steps to prepare your workstation.

### 5.1. What Happens on First Launch

1.  **Dashboard Initialization**: The system performs an inventory of locally available AI models (e.g., Ollama/Llama.cpp) and checks their status.
2.  **Knowledge Base Setup**: Upon the first project folder import, Omnecor initiates semantic indexing via the `VectorDBService`, building your local knowledge base.
3.  **System Readiness Check**: The `ProcessManagerService` validates the availability of necessary bridges (e.g., Python environment checks for Blender, KiCad, ESPTool).
4.  **Configuration Generation**: Default configuration files and directories (e.g., `~/.omnecor`) are created.

### 5.2. Expected Behavior

-   You will see console logs indicating the initialization of various services (e.g., `SecurityService initialized`, `VectorDBService initialized`).
-   The UI may display onboarding screens or prompts to guide you through initial setup steps, such as importing your first project folder or configuring AI providers.
-   If a local AI model server (like Ollama) is not running, you might see warnings, but Omnecor will still launch, allowing you to configure it later.

### 5.3. Warnings and Performance Expectations

-   Initial startup might take slightly longer as services are initialized and resources are allocated.
-   If you have a large number of local AI models or a vast project directory for indexing, the initial knowledge base setup might consume significant CPU/RAM resources.
-   Warnings related to unconfigured integrations or missing external tools are normal if you haven't set them up yet.

---

## 6. User Interface Guide

Omnecor's UI is designed for intuitive navigation and efficient workflow management. This section guides you through the main elements of the user interface.

### 6.1. Navigation Layout

-   **Navigation Sidebar (Left)**: Provides global access to core modules like Dashboard, Chat, Model Hub, Neural Brain Map, Pipelines, Integrations, Agentic Wallet, **Notifications**, and Settings. Click icons to switch views. The Notifications item (between Agentic Wallet and Settings) shows a live unread badge.
-   **Header (Top)**: Contains the application logo, search (Command Palette), notifications, and user profile access.
-   **Main Content Area**: The central dynamic area that displays the content of the currently selected module.

### 6.2. Menus and Sidebars

-   **Context Menus**: Right-clicking on various UI elements (e.g., nodes in the Neural Brain Map, files in the Document Library) reveals context-sensitive menus with relevant actions.
-   **Settings Pages**: Accessible via the Navigation Sidebar, these pages allow granular control over application configurations.

### 6.3. Dashboards and Panels

-   **Dashboard**: Provides an overview of active projects, system status, and recent activities.
-   **Floating Panels**: Omnecor supports detachable, resizable floating windows for tools like code editors, media viewers, or specific AI agent controls, allowing for flexible workspace customization.

### 6.4. Notifications

-   **Sonner Notifications**: Non-intrusive pop-up notifications provide feedback on background processes, task completions, and alerts.
-   **Notifications Hub (`/notifications`)**: A dedicated page (sidebar item between Agentic Wallet and Settings) with two views:
    -   **Alerts** — a persistent, live feed of everything you'd wait on: new chat replies, task/job completion, Human-in-the-Loop (HITL) approvals, and agentic-wallet budget alerts. Each item is colour-coded by kind; tap to mark read and jump to the source. Use **Mark all read** / **Clear** to manage the feed. The sidebar badge tracks unread count in real time.
    -   **Agent Messenger** — see §10b. The same hub is available on the Android companion app as the **Alerts** tab.

### 6.5. Terminal Interfaces

-   Integrated terminal interfaces may be available for direct command-line interaction with backend processes or external tools.

### 6.6. Status Indicators

-   Various UI elements (e.g., in the Header or specific panels) display real-time status indicators for AI model connections, OMMESH network status, and ongoing tasks.

### 6.7. Appearance & Light Mode

Omnecor supports **Light** and **Dark** themes. Your preference is stored locally and applied without a page reload.

- Navigate to **Settings → Appearance** and click the **Light** or **Dark** tile.
- The `ThemeProvider` toggles the `.dark` CSS class on `<html>`, which TailwindCSS's `darkMode: "class"` strategy picks up across the entire component tree.
- Preference is persisted in `localStorage` key `"theme"`.
- Both themes are WCAG 2.1 AA compliant.

Full reference: [docs/user-guides/LIGHT_MODE.md](LIGHT_MODE.md)

---

## 7. Core Workflows

This section details common workflows within Omnecor, providing step-by-step instructions and expected outcomes.

### 7.1. Knowledge Augmentation: Importing and Indexing a Project Folder

1.  **Navigate to Neural Brain Map**: Click on the 
Neural Brain Map icon in the Navigation Sidebar.
2.  **Import Folder**: Click the "Import Folder" button or drag and drop a folder from your file system onto the canvas.
3.  **Indexing Process**: Omnecor will begin recursively processing the files in the imported folder. The `VectorDBService` will chunk the text content, generate embeddings, and store them in ChromaDB. You may see a progress indicator.
4.  **Semantic Visualization**: Once indexed, the files and their relationships will appear as nodes and edges on the Neural Brain Map, allowing for semantic search and contextual understanding.

### 7.2. Conversational AI: Interacting with the Chat Interface

1.  **Access Chat**: Click the "Chat" icon in the Navigation Sidebar.
2.  **Select Model**: Choose an AI model from the Model Hub dropdown (local or cloud-based).
3.  **Start Conversation**: Type your query or prompt into the input field and press Enter.
4.  **Contextual Responses**: The AI will generate responses, leveraging the knowledge base (if configured) for contextual awareness.
5.  **Human-In-The-Loop**: For critical actions suggested by the AI, you may be prompted for approval via the `HITLApprovalService`.

#### Chat Features:

**Background Notes (`/btw` command)**

Save persistent background notes that are automatically injected into the chat system prompt:

1. Type `/btw <your note>` in the chat input (e.g., `/btw I prefer concise responses`).
2. The note is saved and will appear as a chip in the chat interface.
3. When `HONCHO_API_KEY` is configured, these notes persist across sessions and projects. Without it, notes are local to the current browser session.

**Context Management and Token Budget**

Monitor and manage your conversation's token usage:

1. Look at the **Token Budget Bar** under the chat input:
   - Green: Plenty of context available
   - Amber (~70%): Approaching limit
   - Red (~90%): Context nearly full
2. Use the `/compress` command to summarize and shrink conversation history. The Goal & Plan buffer is never pruned.
3. Hover over individual messages and click the context menu to **toggle per-message exclusion** — remove messages from what the model sees without deleting them locally.

**Slash Command Reference**

Type `/` in the chat input to open the autocomplete popup. All available commands:

| Command | Description |
|---|---|
| `/clear` | Clear conversation history |
| `/new` | Start a fresh conversation |
| `/system` | Toggle the system prompt editor |
| `/export` | Download the conversation as a Markdown file |
| `/compress` | Collapse older messages into a single summary block to save tokens. The permanent Goal & Plan buffer is never compressed. |
| `/btw <note>` | Add a persistent background context note. Appears as a dismissible chip; injected silently into every AI call. Persists cross-session via Honcho when `HONCHO_API_KEY` is set. |
| `/skill` | Open the skill-save dialog. Names and stores the current workflow to `localStorage:omnecor:skills` for future reuse via the Command Palette. |
| `/plan` | Launch the Valet-guided project planning session. Creates `todo.md`, `status.md`, and the `project-docs/` suite. |
| `/help` | Show a quick-reference of all commands and keyboard shortcuts. |

**Keyboard shortcuts:**
- `Enter` — Send message
- `Shift+Enter` — Insert new line
- `@filename` — Mention and attach a context file
- `Ctrl+K` — Open Command Palette

### 7.3. Hardware Automation: Flashing Firmware with ESPTool

1.  **Prepare Firmware**: Ensure you have the `.bin` or `.elf` firmware file ready.
2.  **Connect Device**: Connect your ESP32/ESP8266 device to your computer via USB.
3.  **Access ESPTool Integration**: Navigate to the Integrations section or a specific project within the Neural Brain Map that has ESPTool functionality enabled.
4.  **Initiate Flash**: Select the firmware file and the correct serial port, then click "Flash Device".
5.  **Monitor Progress**: The UI will display real-time progress updates streamed from the `esptool_bridge.py` via the `ProcessManagerService`.

### 7.4. Media Generation: Creating Images with Fal.ai

1.  **Access Media Generation**: Navigate to the Media section or a project with Fal.ai integration.
2.  **Enter Prompt**: Provide a detailed text prompt describing the image you want to generate.
3.  **Configure Parameters**: Adjust parameters like style, resolution, and number of images.
4.  **Generate Image**: Click "Generate". The `fal_bridge.py` will send the request to Fal.ai.
5.  **View Results**: The generated images will appear in the UI, and can be saved or further edited.

### 7.5. Project Planning with `/plan` Mode

The `/plan` command activates the Valet Router's guided planning session. This is the recommended starting point for any significant new project.

1.  **Activate**: Type `/plan` in the chat input or select "Plan Mode" from the Command Palette (`Ctrl+K`).
2.  **Guided Questioning**: The 1.5B Valet asks structured questions about your project goal, audience, constraints, and preferences, referencing any loaded Neural Brain Map context.
3.  **Bootstrap Files Created**: The Valet creates `todo.md` (task list) and `status.md` (project goal and status) in the project root. These are mandatory and are updated after every completed task.
4.  **Project Docs Suite**: The Valet guides creation of a `project-docs/` folder containing:
    -   `PRD.md` — Product/Project Requirements Document
    -   `Feature-Plan.md` — Feature breakdown and implementation order
    -   `Voice-Tone.md` — Communication style and brand voice
    -   `Design-Preferences.md` — Visual and aesthetic constraints
    -   `Rules/standards.md` — Coding standards and architectural rules
5.  **Ongoing Maintenance**: After each significant task, the Valet offers to update the relevant project docs and flag progress in `todo.md` and `status.md`.
6.  **Skill Packaging**: When a repeatable task is completed, the Valet offers to save it as a reusable skill — a named workflow that can be invoked in any future project.

> **Hardcoded Rule**: The Valet will not route substantive tasks until `todo.md` and `status.md` exist. This rule is always active regardless of routing mode or execution mode.

---

## 8. Configuration Guide

Omnecor offers extensive configuration options to tailor the application to your specific needs. Configurations are managed through a combination of environment variables (`.env` file) and in-application settings.

### 8.1. Environment Variables (`.env`)

The `.env` file, located in the root of your Omnecor installation, contains critical configuration parameters. **Do not commit this file to version control.**

| Variable Name | Description | Example Value | Notes |
|---|---|---|---|
| `PORT` | The port on which the Omnecor server will run. | `3000` | Change if port is in use. |
| `DATABASE_URL` | Connection string for your MySQL/TiDB database. | `mysql://user:password@host:port/database` | Required for data persistence. |
| `OPENAI_API_KEY` | API key for OpenAI services. | `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Optional, for OpenAI model access. |
| `ANTHROPIC_API_KEY` | API key for Anthropic services. | `sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Optional, for Anthropic model access. |
| `GEMINI_API_KEY` | API key for Google Gemini services. | `AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Optional, for Gemini model access. |
| `FAL_AI_KEY` | API key for Fal.ai services. | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Optional, for Fal.ai media generation. |
| `OLLAMA_HOST` | Host address for local Ollama instance. | `http://localhost:11434` | Optional, for local Ollama models. |
| `LLAMA_CPP_HOST` | Host address for local Llama.cpp instance. | `http://localhost:8080` | Optional, for local Llama.cpp models. |
| `VOICE_API_HOST` | Host address for the local Voice API microservice. | `http://localhost:5000` | Required for voice pipeline. |
| `COMFY_UI_HOST` | Host address for the local ComfyUI instance. | `http://localhost:8188` | Optional, for ComfyUI integration. |
| `BLENDER_PATH` | Absolute path to your Blender executable. | `/usr/bin/blender` | Required for Blender bridge. |
| `KICAD_PATH` | Absolute path to your KiCad executable. | `/usr/bin/kicad` | Required for KiCad bridge. |
| `ESPTOOL_PATH` | Absolute path to your esptool.py script. | `/usr/local/bin/esptool.py` | Required for ESPTool bridge. |
| `OMMESH_ENABLED` | Enable/disable OMMESH distributed intelligence. | `true` or `false` | Default `false`. |
| `OMMESH_PORT` | Port for OMMESH communication. | `7777` | Default `7777`. |
| `OMMESH_MDNS_NAME` | mDNS name for Omnecor node discovery. | `omnecor-node` | Default `omnecor-node`. |
| `OMMESH_SECURITY_KEY` | Shared secret for mTLS in OMMESH. | `a_strong_secret_key` | Required if `OMMESH_ENABLED=true`. |
| `LITHIC_API_KEY` | API key for Lithic virtual card issuance. | `lithic_prod_xxxxx` | Optional. Without it, Wallet runs in tracking-only mode. |
| `ZERO_LOGIN_MODE` | Skips OAuth; creates a synthetic Local Admin session. | `true` or `false` | Default `false`. Forces Sovereign Mode when `true`. |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID. | `xxxxxxx.apps.googleusercontent.com` | Optional, enables Google login. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret. | `GOCSPX-xxxxxxxx` | Required if `GOOGLE_CLIENT_ID` is set. |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra (Azure AD) Application Client ID. | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Optional, enables Microsoft login. |
| `MICROSOFT_CLIENT_SECRET` | Microsoft Entra Client Secret. | `xxxxxxxxxxxxxxxxxxxxxxxx` | Required if `MICROSOFT_CLIENT_ID` is set. |
| `OLLAMA_PROXY_TOKEN` | Shared bearer token for the Ollama reverse proxy (Dockerfile.ollama-proxy). | `a_strong_random_secret` | Required if using the Ollama proxy container. |
| `HONCHO_API_KEY` | API key for Honcho cross-session memory service. | `honcho_pk_xxxxx` | Optional. Enables persistent background notes across sessions and projects. Without it, notes are local to browser. |
| `HONCHO_APP_NAME` | Application name in Honcho service. | `omnecor` | Default `omnecor`. Only required if `HONCHO_API_KEY` is set. |
| `HONCHO_ENVIRONMENT` | Honcho environment (demo, local, or production). | `demo` | Default `demo`. Only required if `HONCHO_API_KEY` is set. |
| `VALET_AUTO_START` | Auto-start Valet Router when a trained artifact is present. | `true` or `false` | Default `true`. Set to `false` to disable auto-start while keeping artifact. |

### 8.2. In-Application Settings

Accessible via the "Settings" icon in the Navigation Sidebar, these settings allow users to configure various aspects of Omnecor without directly editing the `.env` file.

-   **General**: Application theme, language, startup behavior.
-   **AI Providers**: Manage API keys for cloud AI services, configure local model hosts.
-   **Neural Brain Map**: Display preferences, node default settings.
-   **Integrations**: Enable/disable specific hardware bridges, configure paths to external tools.
-   **OMMESH**: Configure OMMESH settings, view connected nodes.
-   **Security**: Manage user roles, data encryption settings.

### 8.3. Configuration Best Practices

-   **Secure `.env`**: Ensure your `.env` file is protected and not exposed.
-   **Restart on Change**: Most `.env` changes require a server restart to take effect.
-   **Backup Configurations**: Regularly back up your `.env` file and any custom configurations.

---

## 9. AI Systems Documentation

Omnecor is built around a powerful and flexible AI infrastructure. For detailed documentation on the AI Model Hub, context management, agent responsibilities, and workflow sequencing, please refer to the `docs/ai-agents/` and `docs/architecture/` directories:

-   [AI Model Hub and Pipelines](docs/architecture/AI_PIPELINES.md)
-   [AI Agent Responsibilities](docs/ai-agents/AGENT_RESPONSIBILITIES.md)
-   [AI Agent Workflow Sequencing](docs/ai-agents/WORKFLOW_SEQUENCING.md)
-   [Valet Router Reference](docs/ai-agents/VALET_ROUTER.md)

---

## 10. Agentic Wallet & Budgeting

See [Section 2.10](#210-agentic-wallet) for a full feature overview. This section provides quick-reference information for configuring budgets and virtual cards.

-   Navigate to **Settings → Agentic Wallet** to create and manage project budgets.
-   Set `LITHIC_API_KEY` in `.env` to enable virtual card issuance per project or agent.
-   Without `LITHIC_API_KEY`, the wallet runs in tracking-only mode — spend is still logged and threshold alerts are still fired.
-   Budget overruns in `hard` mode automatically reroute remaining tasks to local Ollama/Llama.cpp models.

---

## 10b. Notifications & Agent Messenger

The **Notifications** hub (`/notifications`, sidebar item between Agentic Wallet and Settings) unifies every alert Omnecor raises and adds a direct messenger for your agents. It is available identically in the desktop GUI and as the **Alerts** tab on the Android companion app.

### Alerts feed

A live, persistent feed of everything you'd wait on. Alert kinds:

| Kind | Raised when |
|---|---|
| 💬 Chat | A blocking `ai.chat` completion returns (background/agent replies; the live chat UI streams separately). |
| ✅ Task | A background job/process finishes or fails. |
| ⚠️ HITL | An agent action is paused awaiting your approval. |
| 💳 Wallet | A project crosses its budget **alert threshold** or **limit** (deduped per project). |
| 🤖 Agent | An agent/persona replies to you in the Agent Messenger. |
| 🔔 System | Generic system events. |

Alerts arrive in real time over the `notifications` WebSocket channel, and the sidebar/tab badge shows the unread count. Tap an alert to mark it read and jump to its source; use **Mark all read** or **Clear** to manage the list. Alerts are in-memory (they reset when the server restarts), so this is a "what needs my attention now" feed rather than a permanent audit log — for the durable log see **Settings → Audit** (retained 2 weeks by default — see §14.2).

### Agent Messenger

A WhatsApp/Discord-style messenger for your agents/personas, **separate from regular project chats**. Each persona you create (see §12) becomes a thread. Use it to talk to always-on agents — ask a **planner** to outline work, an **assistant** to start or check on Omnecor tasks, or a self-clone to retrieve neural-map data — back and forth, conversationally.

-   Replies are generated through each persona's configured model backend (`Settings → Personas → Model`). If that backend is offline, your message is saved and the agent replies with a graceful "offline" notice.
-   Every agent reply also raises a 🤖 **Agent** notification, so you're alerted even when you're not on the thread.
-   Threads are in-memory for now (history resets on server restart).

> Tip: deep-link straight to a thread with `/notifications?persona=<personaId>`.

---

## 11. Cloud Compute Rental

Omnecor integrates with GPU cloud rental providers so you can run heavy inference workloads remotely without leaving the application.

**Access:** Settings → Cloud Compute

**Supported providers:**

| Provider | API Key Variable | Description |
|---|---|---|
| **Vast.ai** | `VASTAI_API_KEY` | Consumer and enterprise GPU marketplace |
| **RunPod** | `RUNPOD_API_KEY` | Serverless and on-demand pods |
| **Lambda Labs** | `LAMBDA_API_KEY` | Datacenter A100 / H100 instances |

**Quick start:**
1. Add an API key to `.env` and restart.
2. Go to **Settings → Cloud Compute → Start Session**.
3. Select a provider, GPU tier, and billing unit.
4. Click **Start Session** — cost is tracked in your Agentic Wallet.
5. Stop the session when done; final cost is written to the wallet spend log.

Sessions can be assigned as the model backend for always-on Persona agents (see section 12).

Full reference: [docs/user-guides/CLOUD_COMPUTE.md](CLOUD_COMPUTE.md)

---

## 11b. Kaggle GPU Training

Omnecor integrates Kaggle's free T4 GPU tier for Valet Router LoRA training and custom model fine-tuning — no credit card required.

**Access:** Settings → Valet Router → Train on Kaggle  
Also available in: Setup Wizard, LLM Builder, and the Valet Router panel.

### Quick Start

1. Create a free account at [kaggle.com](https://kaggle.com) and enable phone verification.
2. Go to **Settings → Account → API** → click **Create New Token** → download `kaggle.json`.
3. In Omnecor: **Settings → Valet Router → Kaggle** → paste your username and API token.
4. Click **Launch Training Job** — Omnecor creates and starts a Kaggle kernel with your dataset and LoRA config.
5. Monitor kernel status in the Kaggle panel (60-second polling).
6. When training completes, click **Import Adapter** — the LoRA weights are downloaded automatically.
7. Click **Activate** to load the new adapter into your Valet Router.

### Notes

- Kaggle free tier provides ~30 GPU hours/week on NVIDIA T4.
- Training datasets are generated from your local audit log and spend log via the Valet Dataset Builder.
- The adapter import overwrites the previous Valet Router adapter; the old weights are archived locally.

---

## 11a. Agent Networking & Social Media Automation

Omnecor's Agent Networking system automates your social media presence across 6 platforms using AI-driven content curation, persona management, and scheduled publishing.

**Access:** Agent Networking icon in the sidebar.

### Quick Start

1. Set OAuth credentials for your platforms in `.env` (see [OAUTH_SETUP.md](../OAUTH_SETUP.md)).
2. Go to **Agent Networking → Platforms** → click a platform button → complete OAuth.
3. Go to **Agent Networking → Personas** → create a persona with your brand voice and tone.
4. Go to **Agent Networking → Discovery** → configure content sources (RSS feeds or keywords).
5. AI-drafted content appears in **Agent Networking → Approvals** for your review.
6. Approved content is scheduled in the **Calendar** tab.

### Supported Platforms

Twitter/X · LinkedIn · Instagram · TikTok · Facebook · YouTube

### Security

OAuth tokens are stored encrypted. CSRF state tokens (10-minute TTL) protect the authorization flow. Tokens auto-refresh every 15 minutes.

Full reference: [docs/user-guides/AGENT_NETWORKING.md](AGENT_NETWORKING.md)

---

## 12. Persona & Agent Creation

The **Character Persona Studio** lets you build a digital clone, a social media identity, or a fully autonomous AI agent.

**Access:** Settings → Personas

**Three persona types:**

| Type | Description |
|---|---|
| **Self Clone** | Your digital replica — voice, face, and communication style. |
| **Social Media Persona** | A crafted brand identity for content creation and automated posting. |
| **Omnecor Agent** | A fully autonomous agent with a custom system prompt, tool permissions, always-on mode, and multi-channel messaging. |

**Each persona includes:**
- **Identity** — Name, bio, personality traits, Neural Brain Map binding
- **Appearance** — Avatar upload or AI-generated portrait (Fal.ai / OpenArt / ComfyUI)
- **Voice** — XTTS-v2 clone, RVC model, or ElevenLabs cloud voices
- **Video Avatar** — Talking-head video generation (OpenArt / Fal.ai / D-ID)
- **Agent Config** (agent type only) — System prompt, tool permissions, always-on toggle, model backend (Ollama / Omesh / Cloud Compute / External API), messaging channels (in-app chat, webhook, n8n, desktop notifications, email)

Personas are stored locally in `localStorage` — no data leaves your machine.

Full reference: [docs/user-guides/PERSONA_AGENT_GUIDE.md](PERSONA_AGENT_GUIDE.md)

---

## 13. Networking & Multi-System Operation

Omnecor supports multi-system operation through its OMMESH distributed intelligence layer. For detailed information on how to set up and manage a mesh network of Omnecor instances, refer to:

-   [OMMESH Architecture](docs/architecture/SYSTEM_DESIGN.md) (Section on OMMESH)
-   [Multi-Agent Collaboration Workflows](docs/workflows/MULTI_AGENT_COLLABORATION.md)

---

## 14. Security & Permissions

Security is a paramount concern in Omnecor. For a comprehensive reference, see [SECURITY.md](../SECURITY.md) and the `SecurityService` documentation.

### 14.1. Execution Modes

Omnecor operates in three distinct **Execution Modes** that balance power with privacy. Toggle from the header badge or via Settings → Execution Mode.

| Mode | Badge | Behavior |
|---|---|---|
| **Sovereign** | 🔴 Red Lock | All cloud-dependent tRPC procedures are blocked server-side by the `sovereignCheck` middleware. 100% local operation enforced. Use for classified or sensitive data. |
| **Scrapper** | ⚡ Green Zap | **(Default)** Local models (Ollama, Llama.cpp) are preferred. Cloud models are used only when no local model can fulfill the request, or when a cloud-exclusive tool (e.g., Fal.ai video generation) is explicitly requested. |
| **Big Spender** | 🔥 Amber Flame | High-performance cloud models (GPT-4o, Claude Sonnet) are preferred by default. Optimizes for output quality over cost. Ideal for final production runs or complex reasoning tasks. |

Your selected mode is persisted to `users.executionMode` in the database and survives session restarts. The `sovereignCheck` middleware enforces Sovereign Mode at the tRPC layer — it cannot be bypassed by the frontend.

### 14.2. Append-Only Audit Log

Omnecor maintains an append-only audit log of all privileged system events.

-   **Integrity**: The `audit_log` table is insert-only — entries can never be edited or rewritten. The only deletion path is the time-based retention purge below.
-   **Retention**: Default **2 weeks** — a background sweep (every 6 hours) deletes entries outside the window so the log never consumes unbounded storage. Admins can switch to **4 weeks** or **Permanent** under Settings → Security → Audit Log Retention; Permanent shows a storage warning with the current entry count and approximate size. Retention changes are themselves audit-logged.
-   **Redaction**: Sensitive data (API keys, PII, tokens) is automatically scrubbed by the `redactSensitiveData()` utility before any entry is written.
-   **Viewing**: Admin and Owner roles can access the log via Settings → Audit Log or via `audit.getAuditLog` tRPC procedure.
-   **Export**: Use `audit.exportAuditLog` (Admin only) to download a CSV of the full log for compliance reporting.
-   **Captured Events**: User logins/logouts, HITL approvals/rejections, agent spawns/terminations, critical tool calls (Blender, KiCad, ESPTool), budget changes, virtual card issuance.

### 14.3. Extended OAuth Providers

Omnecor supports two OAuth identity providers for user authentication. Configure the required environment variables to enable each:

| Provider | Required Variables |
|---|---|
| **Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| **Microsoft** | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |

Use `ZERO_LOGIN_MODE=true` to skip all OAuth providers for air-gapped deployments.

---

## 15. Backup, Recovery, and Migration

Regular backups are crucial for protecting your data. Omnecor stores critical data in its database and local file system.

### 15.1. Backup Procedures

-   **Database Backup**: Regularly export your MySQL/TiDB database using standard database tools (e.g., `mysqldump`).
-   **File System Backup**: Back up your project folders, the `.omnecor` configuration directory, and any custom AI models.

### 15.2. Recovery Procedures

-   In case of data loss, restore your database from the latest backup and replace affected files from your file system backup.

### 15.3. Migration

-   **Database Migrations**: Use Drizzle Kit for schema migrations (`pnpm drizzle-kit generate`, `pnpm run db:push`).
-   **System Migration**: To move your Omnecor installation to a new machine, copy the entire installation directory, including the `.env` file, and restore your database.

---

## 16. Troubleshooting Guide

For common issues and their solutions, please refer to the dedicated [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) document.

---

## 17. Logs & Diagnostics

Omnecor generates detailed logs to assist with debugging and monitoring.

-   **Backend Logs**: Located in `server/_core/logs/`, these logs provide insights into server operations, errors, and service activities.
-   **Frontend Console**: Browser developer console provides frontend-specific errors and warnings.
-   **Process Manager Logs**: Output from Python bridges and external tools is captured by the `ProcessManagerService` and can be viewed in the UI or backend logs.

---

## 18. Advanced Usage

### 18.1. Custom AI Model Integration

-   **Local Models**: Integrate new local AI models by configuring their API endpoints in the `.env` file or through the Model Hub settings.
-   **Custom Providers**: For advanced users, it is possible to extend the `AiProviderService` to support new AI service providers.

### 18.2. Extending Python Bridges

-   **New Bridges**: Create new Python scripts in `server/python_bridges/` to integrate with additional external tools or hardware.
-   **Custom Commands**: Extend existing bridges with new commands or functionalities.

### 18.3. Developing Custom Agents

-   **Agent API**: Utilize the `AgentService` to define and register new autonomous AI agents with specific responsibilities and capabilities.
-   **Workflow Integration**: Integrate custom agents into existing or new workflows using the `WorkflowSequencing` mechanisms.

---

## 19. Performance Optimization

To ensure Omnecor runs optimally, consider the following:

-   **Hardware**: Use recommended hardware, especially for local LLM inference (GPU with sufficient VRAM).
-   **Local AI Models**: Optimize local AI model configurations (e.g., quantize models, use appropriate batch sizes).
-   **Knowledge Base**: Regularly prune irrelevant data from your knowledge base to improve search performance.
-   **OMMESH**: Leverage the OMMESH network to distribute compute-intensive tasks across multiple nodes.
-   **Resource Monitoring**: Use system monitoring tools to identify and address performance bottlenecks.

---

## 20. FAQ

For answers to frequently asked questions, please refer to the dedicated [FAQ.md](../FAQ.md) document.

---

## 21. Glossary

-   **`/plan` Mode**: A Valet Router guided session that creates and maintains the project documentation suite (`todo.md`, `status.md`, `project-docs/`).
-   **Agentic Wallet**: Omnecor's built-in cost management system for cloud AI providers, featuring project budgets, spend logging, and optional Lithic virtual card integration.
-   **AI Agent**: An autonomous software entity designed to perform specific tasks, often leveraging AI models.
-   **Big Spender Mode**: An Execution Mode that prefers high-performance cloud AI models for maximum output quality.
-   **ChromaDB**: An open-source vector database used by Omnecor for semantic indexing and retrieval.
-   **Drizzle ORM**: A TypeScript ORM used for interacting with the database.
-   **Execution Mode**: A per-user setting (`sovereign`, `scrapper`, `big_spender`) controlling which AI providers are permitted. Enforced at the tRPC middleware layer.
-   **Guided Walk-Through Scrapper Mode**: A fallback Valet mode for when automated routing fails; the Valet manually guides the user to generate inference via free web UIs and integrates the result.
-   **HMCI (Human-Machine Collaboration Interface)**: A system designed to facilitate seamless interaction and collaboration between humans and AI.
-   **HITL (Human-In-The-Loop)**: A process where human intervention or approval is required at critical stages of an automated workflow.
-   **Lithic**: A virtual card issuance API used by the Agentic Wallet for project-level financial isolation.
-   **LLM-Builder**: Omnecor's fine-tuning interface for creating custom specialized models, used in MoE Chain routing.
-   **Llama.cpp**: A C/C++ port of Facebook's LLaMA model, enabling local inference on various hardware.
-   **MoE Chain (Mixture of Experts Chain)**: A Valet routing mode that sends tasks sequentially through multiple specialized fine-tuned models, one task at a time, to conserve compute.
-   **mTLS (Mutual Transport Layer Security)**: A security protocol that ensures both client and server authenticate each other.
-   **Multi-API Mode**: A Valet routing mode that distributes tasks across multiple user-configured AI provider APIs or subscriptions.
-   **Neural Brain Map**: Omnecor's spatial, graph-based interface for project and knowledge management.
-   **Ollama**: A tool for running large language models locally.
-   **OMMESH**: Omnecor's distributed mesh intelligence layer for multi-node collaboration.
-   **RAG (Retrieval-Augmented Generation)**: An AI technique that combines information retrieval with text generation to produce more informed and accurate responses.
-   **React Flow**: A library for building node-based editors and interactive diagrams in React.
-   **Scrapper Mode**: The default Execution Mode. Prefers local models; uses cloud as fallback.
-   **RVC (Real-time Voice Cloning)**: A technology for generating speech in a cloned voice.
-   **shadcn/ui**: A collection of reusable UI components built with Radix UI and Tailwind CSS.
-   **Sovereign Mode**: An Execution Mode that blocks all cloud API calls at the server middleware layer. Ensures 100% local data residency.
-   **STT (Speech-to-Text)**: The process of converting spoken language into written text.
-   **`todo.md` / `status.md`**: Mandatory project files created by the Valet Router at the start of every project. Cannot be bypassed.
-   **tRPC**: A framework for building end-to-end type-safe APIs in TypeScript.
-   **TTS (Text-to-Speech)**: The process of converting written text into spoken language.
-   **Vector Embedding**: A numerical representation of text or other data that captures its semantic meaning.
-   **Valet Router**: The locally-running 1.5B parameter model that classifies and dispatches all tasks to optimal providers without making a cloud call for the routing decision.
-   **Vector Database**: A database optimized for storing and querying vector embeddings.
-   **Vite**: A fast build tool for modern web projects.
-   **WSL2 (Windows Subsystem for Linux 2)**: A compatibility layer for running Linux binary executables natively on Windows.
-   **ZERO_LOGIN_MODE**: An environment variable that enables air-gapped operation by bypassing OAuth and creating a synthetic Local Admin session.
-   **Zustand**: A small, fast, and scalable state-management solution for React.

---

## 22. Appendix

### 22.1. Third-Party Libraries and Licenses

Refer to the `package.json` file for a comprehensive list of third-party libraries and their respective licenses.

### 22.2. Contributing

For information on how to contribute to the Omnecor project, please see the [CONTRIBUTING.md](../CONTRIBUTING.md) file.

### 22.3. Contact and Support

For support, bug reports, or feature requests, please visit the [GitHub repository](https://github.com/Clarkescustomcreations/OmnecorV1-Beta) or contact the development team.

---

**End of Document**
