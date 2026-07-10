# Frequently Asked Questions (FAQ)

This document addresses common questions about Omnecor, its functionality, and usage. If you have a question not covered here, please refer to the comprehensive [User Guide](docs/user-guides/Omnecor User Guide.md) or open an issue on our GitHub repository.

## General Questions

### Q: What is Omnecor?

A: Omnecor is a powerful, local-first AI workstation designed for Creativity (Operational Memory Never Escapes Context Overview Remains). It integrates local and API-based AI models, manages complex projects, and orchestrates multi-step workflows in a single, refined interface.

### Q: What does "local-first" mean for Omnecor?

A: "Local-first" means that Omnecor prioritizes storing your data and running AI models directly on your machine. This ensures strict data sovereignty, meaning your data stays on your machine, always. Cloud synchronization is optional and entirely user-controlled.

### Q: What is OMMESH?

A: OMMESH is the distributed mesh intelligence layer within Omnecor. It allows multiple Omnecor nodes to discover each other on a local area network (LAN), federate securely via mTLS, and intelligently route inference requests based on available VRAM across your connected devices. Each node advertises its available models (Omnecor-hosted, not raw Ollama endpoints) via a beacon-minimal mDNS record; the full model list is fetched on demand over the mTLS channel. From the model picker you can select a model hosted on a remote peer and drive the agentic chat loop with it. You can also delegate a full sub-agent task to a trusted peer — the peer runs a complete tool loop on its own filesystem inside a sandbox, and the results stream back live to your device.

### Q: Is Omnecor free to use?

A: Omnecor aims for zero mandatory monthly bills, promoting a model of no lock-in and no surprise fees, just pure ownership. Please refer to the [LICENSE](LICENSE) file for specific licensing details.

## Technical Questions

### Q: What are the minimum system requirements for Omnecor?

A: Omnecor supports Windows 10/11 natively, Linux (Debian 12, Ubuntu 20.04+ recommended), and has a companion app for Android 9+. It requires a CPU with 4+ physical cores, 8GB of RAM (16GB+ recommended for local LLM inference), and 20GB of free space on an NVMe SSD. For more details, see the [Installation Guide](INSTALL.md).

### Q: How do I install Omnecor?

A: You can install Omnecor by cloning the GitHub repository, installing dependencies with `pnpm install`, configuring environment variables in a `.env` file, then running `pnpm dev` (development) or `pnpm build && pnpm start` (production). The local SQLite database is created and migrated automatically on first launch — no manual migration step is required. To regenerate migrations after a schema change run `pnpm build:push`. A quick start guide is available in [QUICKSTART.md](QUICKSTART.md).

### Q: Can I use my own local AI models with Omnecor?

A: Yes. Omnecor manages its own `llama-server` (llama.cpp) subprocess and can serve inference without Ollama installed — just place a `.gguf` file in `~/.omnecor/models/` and optionally set `LLAMA_SERVER_BIN` in your `.env`. Ollama is an optional accelerator: when present, it is detected automatically and both sources appear in the Unified Model Catalog. Cloud providers (OpenAI, Anthropic, Gemini) are also supported. The Model Hub shows all sources in one place and lets you select which cloud models are visible via curation toggles.

### Q: How does Omnecor handle data security?

A: Omnecor implements several security measures, including local-first data storage, rate limiting, CSRF and path traversal protection, AES-256-GCM encryption for sensitive local data, and secure mTLS communication for OMMESH. Refer to [SECURITY.md](SECURITY.md) for more details.

### Q: Where can I find logs for troubleshooting?

A: Backend runtime logs are managed by `server/_core/logs`. Process-specific logs (e.g., for Blender, ESPTool integrations) are streamed as JSON for backend parsing. For more troubleshooting tips, consult the [Troubleshooting Guide](TROUBLESHOOTING.md).

### Q: How do I save background notes that persist across sessions?

A: Use the `/btw <note>` command in the chat interface to save a persistent background note. These notes are stored in the Honcho memory layer and are automatically injected into the chat system prompt. To enable this feature, set the `HONCHO_API_KEY` environment variable in your `.env` file. If `HONCHO_API_KEY` is not set, the feature is disabled but nothing breaks.

### Q: Why isn't the assistant remembering my /btw notes?

A: The Honcho memory layer must be configured to persist notes. Check that `HONCHO_API_KEY` is set in your `.env` file. If not configured, notes are stored locally in your browser but won't persist across sessions. See the [INSTALL.md](INSTALL.md) guide for configuration details.

### Q: How do I check if there are other Omnecor nodes on my network?

A: Look at the sidebar footer for the "Peer Card" indicator. It shows other Omnecor nodes discovered on your local network, including hostname, latency (ms), and available model count. The card updates every 10 seconds. If no peers are found, ensure another Omnecor instance is running on the same network and that mDNS/Bonjour is not blocked by your firewall.

### Q: My chat is running out of context tokens — what can I do?

A: Use the `/compress` command to summarize your conversation history and reclaim tokens. The Goal & Plan buffer is never pruned during compression. You can also toggle individual messages out of the context sent to the model (without deleting them) by clicking the context menu on each message.

### Q: What is the Valet Router and when is it running?

A: The Valet Router is a locally-running ~1.5B model that routes each task to the best provider/model and enforces project rules. It auto-starts when a trained artifact is present (`models/valet-router/current.json` with status=ready). If no artifact is present, the app falls back to keyword-based routing rules. You can disable auto-start by setting `VALET_AUTO_START=false` in your `.env` file.

### Q: Does Omnecor require Ollama?

A: No. Omnecor manages its own inference runtime (`LocalLlmRuntimeService`) that spawns and supervises a `llama-server` (llama.cpp) subprocess. Drop any `.gguf` file into `~/.omnecor/models/` and Omnecor loads it automatically at boot. Ollama is an optional accelerator — if you also run Ollama, both sources appear in the Unified Model Catalog and are deduplicated. You can run Omnecor fully offline and fully local with zero Ollama dependency. See [INSTALL.md](INSTALL.md#local-llm-runtime-optional-ollama-optional) for setup details.

### Q: What is the Agentic Chat Stream?

A: The main Omnecor chat (web and Android APK) runs a Claude-Code-style typed stream. Instead of plain assistant bubbles, AI responses appear as a structured flow on a guide line: a collapsible "Thinking" section (real reasoning or a loading animation), and inline status chips for every tool the model runs — `edit_file`, `run_command`, `start_job`, and MCP skills. Each chip shows a green/red dot and expands to show full output, a hunk-only diff (for file edits), or stdout/stderr (for commands). Every tool action is HITL-gated — you approve or deny it inline before the AI proceeds. A FIFO message queue lets you type follow-up prompts while the model is still streaming; they drain automatically when each turn completes.

### Q: What is Mesh Sub-Agent Delegation?

A: When you have a trusted OMMESH peer connected, the AI's tool loop gains a `delegate_task` tool. Invoking it (with your approval) spawns a full `ChatAgentRunner` loop on the peer's machine inside a sandboxed workspace. The peer's typed event stream (tool calls, edits, command output) relays back over mTLS as live NDJSON and appears in your chat as a new managed conversation. You can observe it, approve individual tool actions on the remote machine, and type follow-up instructions between turns — all from your local device. When the delegated run completes, the parent chat is re-prompted with a condensed summary. The delegated conversation persists in your local database even after the peer session ends.
