# 👁️ Omnecor

> **Context-Aware AI Infrastructure.**

**Omnecor** is the premier **Human-Machine Collaboration Interface (HMCI)**. Designed as the central nervous system for your digital and physical workflow, Omnecor unites software development, business automation, media generation, and hardware engineering under one unified, intelligent, and Beta-V1 workspace.

## ✨ Core Capabilities

### 🚦 The Unified AI Orchestrator

At the heart of Omnecor is a high-performance orchestration layer. It analyzes your prompts in real-time and routes them to the ideal model—optimizing for performance, cost, and task-specific capabilities across local models and cloud providers.

### 🔗 Service-Oriented Backend

Omnecor features a unified, production-capable Express/tRPC backend. This centralized architecture ensures real-time synchronization across your entire workspace, providing robust state management for complex AI-driven workflows.

### 🧠 Distributed Mesh Infrastructure

Omnecor visualizes your workflow by generating dynamic, interactive neural networks for your data. Build custom, isolated "neural workspaces" for every individual project. Watch in real-time as your AI agents map out files, connect research documents, and build semantic memory contexts.

### 🤖 The Multi-Modal Workforce

Leverage specialized autonomous agents that collaborate natively:

- **Software & Web:** Agents read your local codebase, write applications, and handle deployment.
- **Media Studio:** Node-based generation for images, video, and voice cloning.
- **Hardware Integration Layer:** Bridge the gap to the physical world with integrated Blender 3D modeling and KiCad PCB routing.

## ⚙️ Execution Environments

Omnecor adapts to your specific hardware needs:

1. **Hybrid Orchestration**: Leverage local compute for UI/orchestration, while offloading heavy tasks to authorized cloud providers.
2. **Sovereign Execution**: 100% local, offline execution. From custom LoRA training to local vector databases, your data stays within your high-end rig.
3. **Ephemeral Cloud Infrastructure**: Autonomously provision and terminate ephemeral cloud resources (e.g., RunPod) to handle intense compute tasks on-demand, with strict budget tracking.

---

## 🎯 Technical Overview

**Omnecor** is a comprehensive, Beta-V1 AI workstation for Linux that combines the power of multiple AI models, advanced project management, and specialized engineering tools into a single, unified interface.

### Key Technical Features

- **Unified Backend** - Centralized, service-oriented tRPC architecture
- **Spatial Knowledge Organization** - Neural Workspaces for project visualization
- **Multi-Model Support** - Extensive local (Ollama) and cloud (OpenAI, Anthropic, Gemini) integration
- **Context Transparency** - Real-time insight into AI-accessible data
- **Unified ProcessManagerService** - Real-time tracking and lifecycle management of autonomous processes
- **Specialized Engineering Bridges** - Native integration for Blender, KiCad, and ESPTool
- **Security Hardening** - CSRF protection, path traversal protection, and secure data handling

## 🚀 Quick Start

### Prerequisites

- Linux (Debian 12, Ubuntu 20.04+)
- Node.js 22+
- 8GB+ RAM recommended
- 10GB free disk space

### Installation

```bash
# Clone the repository
git clone [repository-url]

# Install dependencies
pnpm install

# Start the workstation
npm run dev
```

Open `http://localhost:3000` in your browser.

## 📚 Documentation

- **[Installation Guide](./INSTALLATION.md)** - Detailed setup and configuration.
- **[User Guide](./USER_GUIDE.md)** - Comprehensive feature documentation.
- **[Troubleshooting Guide](./TROUBLESHOOTING.md)** - Solutions to common issues.
- **[Architecture Documentation](./docs/PHASE2_ARCHITECTURE.md)** - Deep dive into Omnecor's infrastructure.

## 🏗️ Architecture

Omnecor leverages a service-oriented, unified backend to provide a stable, Beta-V1 environment.

### Core Stack

- **Frontend**: React 19, TypeScript, shadcn/ui.
- **Backend**: Express.js, tRPC, Drizzle ORM.
- **Orchestration**: Unified WebSocket endpoint, TrpcContext.
- **Visualization**: React Flow (Neural Workspaces).
- **Testing**: Vitest (comprehensive coverage).

## 🤝 Contributing

We welcome professional contributions. Please follow the repository conventions:

1. Fork the repository.
2. Create a feature branch.
3. Adhere to the established architecture and coding standards.
4. Add verification tests.
5. Submit a pull request.

## 📄 License

Omnecor is licensed under the MIT License. See [LICENSE](./LICENSE) file for details.

---

**Building the future of human-machine collaboration.**

Omnecor HMCI: Unified. Intelligent. Beta-V1. 🧠✨
Operational Memory Never Escapes Context Overview Remains