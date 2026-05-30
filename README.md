# Omnecor

Operational Memory Never Escapes. Context Overview Remains. Omnecor is a powerful, elegant, and polished local-first AI workstation designed for power users who demand both function and beauty. It seamlessly integrates local and API-based AI models, manages complex projects, and orchestrates multi-step workflows—all in one refined interface.

Where imagination becomes infrastructure.

---

## Features

Omnecor is engineered as a modular, production-grade workstation, offering a comprehensive suite of features for AI-driven workflows:

- **Unified Backend**: A centralized Express.js/tRPC engine ensuring real-time UI/data state synchronization via WebSockets.
- **Neural Workspaces**: Spatial graph-based project management using React Flow for semantic file/knowledge visualization.
- **Multi-Modal Workforce**: Integrated autonomous agent orchestration for software, media, and hardware tasks.
- **Hardware Integration Layer**: Secure, process-managed bridges for Blender (3D), KiCad (PCB), and ESPTool (Firmware).
- **Voice Pipeline**: A high-performance inference bridge to FastAPI-based STT (Whisper) and TTS/RVC microservices.
- **OMMESH**: A distributed mesh intelligence layer enabling multiple Omnecor nodes to discover each other on a LAN, federate securely via mTLS, and route inference requests by available VRAM.
- **Strictly Local Data Sovereignty**: Your data stays on your machine. Always.
- **Interactive Neural Brain Maps**: Visualize, connect, and understand your projects like never before.
- **Run Any Local or Cloud AI Model**: Use the models you trust, on your own terms.
- **Zero Mandatory Monthly Bills**: No lock-in. No surprise fees. Just pure ownership.

---

## Screenshots

![Omnecor UI Overview](file_0000000036d471f7a2101a53fc9370a4.png)

---

## Architecture Overview

Omnecor operates as a unified application with a single Express server serving as the entry point. It integrates a tRPC API for efficient communication, a WebSocket server for real-time updates, and handles static file serving for the frontend. Key architectural components include:

- **tRPC API**: All API endpoints are accessible at `/api/trpc/`.
- **WebSocket Server**: Attached at `/ws` on the same HTTP server, facilitating real-time Neural Node-Tree and training progress updates.
- **OMMESH**: The distributed mesh intelligence layer for multi-node discovery and inference routing.
- **Phase 2 Services**: Singletons like `SecurityService`, `VectorDBService`, and `ProcessManagerService` are initialized at startup to ensure readiness.

---

## Installation

For detailed installation instructions, including system requirements and platform-specific guides, please refer to the [INSTALL.md](INSTALL.md) file.

---

## Quick Start

To get Omnecor up and running quickly, follow the steps outlined in the [QUICKSTART.md](QUICKSTART.md) guide.

---

## Configuration

Omnecor's configuration is managed through environment variables (e.g., `.env` file) and granular UI settings. For comprehensive details on available configuration options and their impact, consult the [Configuration Guide](docs/user-guides/USER_GUIDE.md#8-configuration-guide).

---

## Project Structure

The repository is organized into several key directories:

- `client/`: Contains the frontend application built with React and Vite.
- `server/`: Houses the backend services, tRPC routers, and AI integration bridges.
- `docs/`: Stores detailed documentation, including architecture, API, and user guides.
- `packaging/`: Contains scripts and configurations for application packaging (AppImage, Deb, Flatpak).
- `drizzle/`: Database schema and migration files.
- `shared/`: Shared types and utilities between client and server.

---

## Development

Information on contributing to Omnecor, including coding standards, pull request processes, and testing expectations, can be found in the [CONTRIBUTING.md](CONTRIBUTING.md) file.

---

## Roadmap

For upcoming features, planned enhancements, and the overall direction of the Omnecor project, please refer to the [ROADMAP.md](ROADMAP.md) file.

---

## Documentation

Explore the comprehensive documentation suite in the [docs/](docs/) directory for in-depth information on various aspects of Omnecor.

---

## License

Omnecor is released under the [MIT License](LICENSE).
