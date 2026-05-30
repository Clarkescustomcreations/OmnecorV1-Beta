# Frequently Asked Questions (FAQ)

This document addresses common questions about Omnecor, its functionality, and usage. If you have a question not covered here, please refer to the comprehensive [User Guide](docs/user-guides/USER_GUIDE.md) or open an issue on our GitHub repository.

## General Questions

### Q: What is Omnecor?

A: Omnecor is a powerful, elegant, and polished local-first AI workstation designed for power users. It integrates local and API-based AI models, manages complex projects, and orchestrates multi-step workflows in a single, refined interface.

### Q: What does "local-first" mean for Omnecor?

A: "Local-first" means that Omnecor prioritizes storing your data and running AI models directly on your machine. This ensures strict data sovereignty, meaning your data stays on your machine, always. Cloud synchronization is optional and entirely user-controlled.

### Q: What is OMMESH?

A: OMMESH is the distributed mesh intelligence layer within Omnecor. It allows multiple Omnecor nodes to discover each other on a local area network (LAN), federate securely via mTLS, and intelligently route inference requests based on available VRAM across your connected devices.

### Q: Is Omnecor free to use?

A: Omnecor aims for zero mandatory monthly bills, promoting a model of no lock-in and no surprise fees, just pure ownership. Please refer to the [LICENSE](LICENSE) file for specific licensing details.

## Technical Questions

### Q: What are the minimum system requirements for Omnecor?

A: Omnecor requires a Linux-based operating system (Debian 12, Ubuntu 20.04+ recommended), a CPU with 4+ physical cores, 8GB of RAM (16GB+ recommended for local LLM inference), and 20GB of free space on an NVMe SSD. For more details, see the [Installation Guide](INSTALL.md).

### Q: How do I install Omnecor?

A: You can install Omnecor by cloning the GitHub repository, installing dependencies with `pnpm install`, configuring environment variables in a `.env` file, pushing the database schema with `pnpm run db:push`, building the application with `npm run build`, and starting it with `npm run start`. A quick start guide is available in [QUICKSTART.md](QUICKSTART.md).

### Q: Can I use my own local AI models with Omnecor?

A: Yes, Omnecor is designed to integrate with local AI models, such as those compatible with Ollama/Llama.cpp. It provides a Model Hub for managing these connections, allowing you to use the models you trust on your own terms.

### Q: How does Omnecor handle data security?

A: Omnecor implements several security measures, including local-first data storage, rate limiting, CSRF and path traversal protection, AES-256-GCM encryption for sensitive local data, and secure mTLS communication for OMMESH. Refer to [SECURITY.md](SECURITY.md) for more details.

### Q: Where can I find logs for troubleshooting?

A: Backend runtime logs are managed by `server/_core/logs`. Process-specific logs (e.g., for Blender, ESPTool integrations) are streamed as JSON for backend parsing. For more troubleshooting tips, consult the [Troubleshooting Guide](TROUBLESHOOTING.md).
