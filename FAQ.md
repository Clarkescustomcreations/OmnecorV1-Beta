# Frequently Asked Questions (FAQ)

This document addresses common questions about Omnecor, its functionality, and usage. If you have a question not covered here, please refer to the comprehensive [User Guide](docs/user-guides/Omnecor User Guide.md) or open an issue on our GitHub repository.

## General Questions

### Q: What is Omnecor?

A: Omnecor is a powerful, local-first AI workstation designed for Creativity (Operational Memory Never Escapes Context Overview Remains). It integrates local and API-based AI models, manages complex projects, and orchestrates multi-step workflows in a single, refined interface.

### Q: What does "local-first" mean for Omnecor?

A: "Local-first" means that Omnecor prioritizes storing your data and running AI models directly on your machine. This ensures strict data sovereignty, meaning your data stays on your machine, always. Cloud synchronization is optional and entirely user-controlled.

### Q: What is OMMESH?

A: OMMESH is the distributed mesh intelligence layer within Omnecor. It allows multiple Omnecor nodes to discover each other on a local area network (LAN), federate securely via mTLS, and intelligently route inference requests based on available VRAM across your connected devices.

### Q: Is Omnecor free to use?

A: Omnecor aims for zero mandatory monthly bills, promoting a model of no lock-in and no surprise fees, just pure ownership. Please refer to the [LICENSE](LICENSE) file for specific licensing details.

## Technical Questions

### Q: What are the minimum system requirements for Omnecor?

A: Omnecor supports Windows 10/11 natively, Linux (Debian 12, Ubuntu 20.04+ recommended), and has a companion app for Android 9+. It requires a CPU with 4+ physical cores, 8GB of RAM (16GB+ recommended for local LLM inference), and 20GB of free space on an NVMe SSD. For more details, see the [Installation Guide](INSTALL.md).

### Q: How do I install Omnecor?

A: You can install Omnecor by cloning the GitHub repository, installing dependencies with `pnpm install`, configuring environment variables in a `.env` file, running database migrations with `pnpm db:migrate`, building the application with `pnpm build`, and starting it with `pnpm start` (or `pnpm dev` for local development). A quick start guide is available in [QUICKSTART.md](QUICKSTART.md).

### Q: Can I use my own local AI models with Omnecor?

A: Yes, Omnecor is designed to integrate with local AI models, such as those compatible with Ollama/Llama.cpp. It provides a Model Hub for managing these connections, allowing you to use the models you trust on your own terms.

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
