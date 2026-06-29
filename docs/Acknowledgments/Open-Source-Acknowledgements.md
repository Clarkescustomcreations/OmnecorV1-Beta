# Open Source Acknowledgements

The Omnecor HMCI (Human-Machine Collaboration Interface) leverages various open-source projects for reference, architectural inspiration, and core functionality. We are grateful to the following projects and their communities for their contributions to the field of AI and automation.

---

### Core Tech Stack
- **[React](https://react.dev/)**: The foundational UI framework for building our highly interactive interface.
- **[shadcn/ui](https://ui.shadcn.com/)**: Beautifully designed components built with Radix UI and Tailwind CSS.
- **[React Flow](https://reactflow.dev/)**: Powerful graph visualization for the Neural Brain Map.
- **[Tailwind CSS](https://tailwindcss.com/)**: Utility-first CSS framework for consistent and rapid styling.
- **[tRPC](https://trpc.io/)**: Provides the type-safe API layer connecting our frontend and backend.
- **[Drizzle ORM](https://orm.drizzle.team/)**: Type-safe TypeScript ORM for our persistent memory system.
- **[TanStack Query (React Query)](https://tanstack.com/query)**: Asynchronous state synchronization and caching layer integrated with tRPC.
- **[wouter](https://github.com/molecula/wouter)**: A minimalist, high-performance routing engine for our React web workstation client.
- **[Framer Motion](https://motion.dev/)**: Motion library for React used to create fluid UI transitions and component animations.
- **[Lucide](https://lucide.dev/)**: Clean, community-maintained iconography library powering our visual interface controls.
- **[Recharts](https://recharts.org/)**: Composable charting library built on React components and D3 for dashboard visualization.
- **[Vitest](https://vitest.dev/)**: The blazing fast unit test framework ensuring codebase stability.

---

### Core Infrastructure & Architecture
- **[n8n](https://n8n.io/)**: Used as a reference for the automation framework and webhook server architecture.
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)**: Provided the blueprint for the node-based media generation pipeline and async prompt queueing.
- **[crewAI](https://www.crewai.com/)**: Inspired the agentic orchestration and task-based multi-agent workflow system.
- **[ChromaDB](https://www.trychroma.com/)**: Reference for the vector database service and semantic memory integration.
- **[libSQL Client](https://github.com/tursodatabase/libsql)**: SQLite-compatible SQL database client backing the local-first and Sovereign mode database.
- **[xterm.js](https://xtermjs.org/)**: Fully-featured terminal front-end component powering the workstation's embedded terminal window.
- **[node-pty](https://github.com/microsoft/node-pty)**: Pseudo-terminal bindings in Node.js used to spawn and control native system shells.
- **[bonjour](https://github.com/samcday/node-bonjour)**: Zero-configuration networking (mDNS/DNS-SD) for Node.js, facilitating local peer discovery in OMMesh.

---

### Mobile & Desktop Client Runtimes
- **[Expo](https://expo.dev/)**: Framework for universal native Android and iOS apps using React Native, powering the Mobile HQ client.
- **[React Native](https://reactnative.dev/)**: Framework for building native mobile applications using React.
- **[Electron](https://www.electronjs.org/)**: Cross-platform desktop application container hosting the Setup Wizard and desktop workstation shells.

---

### AI & Machine Learning
- **[PyTorch](https://pytorch.org/)**: Core deep learning platform powering speech-to-text, text-to-speech, and fine-tuning pipelines.
- **[Hugging Face Transformers](https://github.com/huggingface/transformers)**: State-of-the-art machine learning models and training interfaces backing our local fine-tuning engine.
- **[Unsloth](https://unsloth.ai/)**: Reference for optimized LLM fine-tuning (LoRA) and training CLI implementation.
- **[Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)**: Architectural reference for the high-performance speech-to-text transcription service.
- **[Coqui TTS](https://github.com/coqui-ai/TTS)**: Blueprint for the text-to-speech synthesis microservice (XTTS-v2).
- **[RVC (Retrieval-based Voice Conversion)](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)**: Reference for the voice conversion and singing voice cloning system.

---

### Developer Tools & Data Retrieval
- **[Aider](https://aider.chat/)**: Inspired the terminal-based pair programming and git integration logic.
- **[Cline (formerly Claude Dev)](https://github.com/cline/cline)**: Reference for codebase-aware autonomous editing and coordinated file changes.
- **[Continue](https://www.continue.dev/)**: Blueprint for source-controlled AI checks and context-aware autocompletion providers.
- **[Firecrawl](https://www.firecrawl.dev/)**: Reference for the high-quality web crawling and scraping pipeline.
- **[Playwright](https://playwright.dev/) & [Puppeteer Extra Stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)**: Core engines powering Omnecor's "Bird Claw" (Agent Reach) for stealthy DOM rendering and headless browser scraping.
- **[Chatbot UI](https://github.com/mckaywrigley/chatbot-ui)**: Design inspiration for the clean, universal chat interface.

### Hardware & System Integration
- **[Esptool](https://github.com/espressif/esptool)**: Used as a reference for the ESP32 microcontroller flashing and serial port discovery logic.
- **[Blender](https://www.blender.org/)**: The headless Python executor serves as the basis for our 3D modeling and rendering bridge.
- **[Docker SDK](https://github.com/docker/docker-py)**: Reference for the sandboxed environment and container management.
- **[chokidar](https://github.com/paulmillr/chokidar)**: Blueprint for the robust, cross-platform file system watcher.

---

---

### AI Routing & Local Inference (v3.0.0 Roadmap)
- **[Unsloth / Qwen2.5-1.5B](https://huggingface.co/unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit)**: Provides the quantized base model for the 1.5B Valet Router fine-tuning pipeline — the local brain that routes prompts to the right provider without any cloud call.
- **[llama-cpp-python](https://github.com/abetlen/llama-cpp-python)**: Python bindings for llama.cpp enabling CPU-based GGUF inference for the Valet Router bridge and the Llama.cpp direct integration path.
- **[llama.rn](https://github.com/mybigday/llama.rn)**: React Native bindings for llama.cpp enabling native GGUF model execution on mobile client nodes.
- **[react-native-litert-lm](https://github.com/google-ai-edge/react-native-litert-lm)**: Google AI Edge LiteRT language model engine wrapper for local mobile Gemma model execution.

### Multi-Agent Systems & Protocols (v3.0.0 Roadmap)
- **[Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)**: Official TypeScript SDK for MCP used to connect Omnecor agents to self-hosted MCP tool servers in the Tool Directory integration.
- **[Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp)**: Tree-sitter powered codebase knowledge graph for AI coding agents via the Model Context Protocol.
- **[RecursiveMAS](https://github.com/RecursiveMAS/RecursiveMAS)**: Research reference and architectural inspiration for latent-space recursive multi-agent collaboration, informing the RecursiveMAS orchestration layer.
- **[AgenticOS](https://agentico.dev/)**: Reference for MCPServer declarative management and Tool Directory browsing model.

### Frontend & 3D Visualization (v3.0.0 Roadmap)
- **[React Three Fiber](https://github.com/pmndrs/react-three-fiber)**: React renderer for Three.js used to build the PCB 3D viewer component (`PCBViewer3D.tsx`) in the KiCad integration panel.
- **[React Three Drei](https://github.com/pmndrs/drei)**: Utility helpers for React Three Fiber providing camera controls, loaders, and 3D UI primitives for the PCB viewer.
- **[axe-core](https://github.com/dequelabs/axe-core)**: Accessibility testing engine powering the automated WCAG 2.1 AA test suite across all Omnecor pages.
- **[Penpot](https://penpot.app/)**: Open-source design and prototyping platform, serving as the foundation for the Penpot Agent integration.

### Security & Threat Intelligence (v3.0.0 Roadmap)
- **[Semgrep](https://github.com/semgrep/semgrep)**: Open-source static analysis engine used in the automated vulnerability scanning module (`threat_scanner.py`) for code-level security issue detection.
- **[MISP](https://github.com/MISP/MISP)**: Self-hosted threat intelligence platform used as the IoC data source for the `ThreatIntelService.ts` integration.
- **[YARA](https://github.com/VirusTotal/yara)**: Pattern matching signature engine used by the threat scanning modules to classify binary and text payloads.

### Voice & Media (v3.0.0 Roadmap)
- **[ElevenLabs JavaScript SDK](https://github.com/elevenlabs/elevenlabs-js)**: Official SDK for ElevenLabs voice synthesis, integrated as an optional cloud voice enhancement alongside the local XTTS-v2 default pipeline.
- **[Voicebox](https://voicebox.metademolab.com/)**: Reference for advanced voice synthesis and text-to-speech architectures.
- **[whisper.rn](https://github.com/mybigday/whisper.rn)**: React Native bindings for whisper.cpp enabling on-device automatic speech recognition for mobile nodes.

### Database & Infrastructure (v3.0.0 Roadmap)
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)**: Synchronous SQLite3 bindings for Node.js, used as the zero-dependency metadata store fallback in Sovereign/Zero-Login mode.
- **[onnxruntime-node](https://github.com/microsoft/onnxruntime)**: ONNX Runtime Node.js bindings for running local embedding models without a Python dependency (`ONNXEmbeddingService.ts`).
- **[Lithic API](https://www.lithic.com/)**: Virtual card issuance API used as the optional provider for the Agentic Wallet's ephemeral cloud compute credit card feature.
- **[Honcho SDK](https://github.com/plastic-labs/honcho)**: Client integration library for Plastic Labs' Honcho, supporting optional user profile facts and long-term agentic memory synchronization.

### PCB Manufacturing Integration (v3.0.0 Roadmap)
- **[PCBWay Partner API](https://www.pcbway.com/api-partner.html)**: RESTful API for PCB quoting and order management, enabling one-click manufacturing workflows from within the KiCad bridge.

---

*This project is built with deep respect for the open-source ethos. Each project listed above has played a vital role in informing the development of Omnecor HMCI.*
