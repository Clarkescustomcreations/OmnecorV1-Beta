# Installation Guide for Omnecor

This guide provides comprehensive instructions for installing and setting up Omnecor on various operating systems. Omnecor is designed to be a local-first AI workstation, and these instructions will help you get it running efficiently on your machine.

## 1. System Requirements

To ensure optimal performance and compatibility, please ensure your system meets the following requirements:

| Component | Minimum Requirement | Recommended for Local LLM Inference |
|---|---|---|
| **Operating System** | Debian 12, Ubuntu 20.04+ (LTS recommended) | Debian 12, Ubuntu 22.04+ |
| **CPU** | 4+ physical cores | 8+ physical cores |
| **RAM** | 8GB | 16GB+ |
| **Disk Space** | 20GB free space on NVMe SSD | 50GB+ free space on NVMe SSD |
| **Network** | Stable connection for API provider calls | Stable connection |
| **Node.js** | 22+ | 24.15.0 (pinned for beta) |
| **pnpm** | 10.x | 10.4.1 (pinned for beta) |

## 2. Prerequisites

Before proceeding with the installation, ensure you have the following installed on your system:

- **Git**: For cloning the repository.
- **Node.js (v24.15.0 pinned; v22 minimum)**: Omnecor is built with Node.js. You can download it from the [official Node.js website](https://nodejs.org/en/download/).
- **pnpm (v10.4.1 pinned; v10.x minimum)**: A fast, disk space efficient package manager. Install it using:

  ```bash
  npm install -g pnpm@10.4.1
  ```

## 3. Installation Steps

Follow these steps to install Omnecor:

### Step 1: Clone the Repository

Open your terminal or command prompt and clone the Omnecor repository:

```bash
git clone https://github.com/Clarkescustomcreations/OmnecorV1-Beta.git
cd OmnecorV1-Beta
```

### Step 2: Install Dependencies

Navigate into the cloned directory and install the project dependencies using pnpm:

```bash
pnpm install
```

This command will install all necessary packages for both the client and server components of Omnecor.

### Step 3: Configure Environment Variables

Omnecor uses environment variables for configuration. Create a `.env` file in the root of the project directory. A `.env.example` file might be provided in the repository as a template. At a minimum, you might need to configure the following:

```env
PORT=3000
# Add any other required API keys or local host endpoints (e.g., Ollama/Llama.cpp) here
# OLLAMA_ENDPOINT=http://localhost:11434
```

Refer to the `server/_core/env.ts` file or the `Configuration Guide` in the user documentation for a complete list of environment variables.

### Step 4: Database Setup

Omnecor supports two database backends, selected by the `OMNECOR_DB` environment variable (default `auto`):

- **SQLite (default, zero-infra)** — If you do **not** set `DATABASE_URL`, Omnecor uses a local SQLite database file (`./data/omnecor.db`). The schema is created automatically on first launch — **no setup command is required**. This is the recommended path for beta testing and Sovereign / offline operation. To force it explicitly, set `OMNECOR_DB=sqlite`.

- **MySQL/MariaDB (optional, multi-user / production)** — Requires a running MySQL/MariaDB instance (install via `apt install mariadb-server` on Linux or similar). Create a database and user, then set `DATABASE_URL` in your `.env` (matches `.env.example` format). Finally, push the schema:

  ```bash
  pnpm run db:push
  ```

  Alternatively, use the provided `docker-compose.yml` to start a MySQL instance:
  ```bash
  docker compose up -d db
  ```

### Step 5: Build the Application

Build the Omnecor application for production:

```bash
pnpm run build
```

This command compiles the client-side assets and the server-side TypeScript code into JavaScript.

### Step 6: Start the Application

Finally, start the Omnecor application:

```bash
pnpm run start
```

Omnecor will attempt to start on `http://localhost:3000`. If this port is in use, it will automatically find and use the next available port. You will see the exact URL in your terminal output.

## 4. Platform-Specific Instructions

### Linux (Debian/Ubuntu)

The general installation steps above are primarily for Linux-based systems. Ensure your system is up-to-date:

```bash
sudo apt update && sudo apt upgrade -y
```

If you encounter any permission issues, ensure your user has the necessary rights to install packages and access directories.

### Windows and macOS

While Omnecor is primarily developed for Linux, it may be possible to run it on Windows (via WSL2) or macOS. However, specific instructions and full compatibility are not guaranteed. Users attempting to install on these platforms should be familiar with Node.js development and troubleshooting in their respective environments.

## 5. Troubleshooting Common Installation Issues

Refer to the [TROUBLESHOOTING.md](TROUBLESHOOTING.md) file for solutions to common installation problems, such as port conflicts, dependency issues, or build failures.
