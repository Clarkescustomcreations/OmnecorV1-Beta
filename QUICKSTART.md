# Quick Start Guide for Omnecor

This guide provides a streamlined set of instructions to get Omnecor up and running quickly. For detailed installation steps and troubleshooting, please refer to the [INSTALL.md](INSTALL.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) files.

## Prerequisites

Ensure you have the following installed:

- **Git**
- **Node.js (v22 or higher)**
- **pnpm** (install with `npm install -g pnpm@10.34.1`)

## Quick Start Steps (5-10 Minutes)

Follow these steps to launch Omnecor and access its user interface:

1.  **Clone the Repository**

    Open your terminal and clone the Omnecor repository:

    ```bash
    git clone https://github.com/Clarkescustomcreations/OmnecorV1-Beta.git
    cd OmnecorV1-Beta
    ```

2.  **Install Dependencies**

    Install all required project dependencies:

    ```bash
    pnpm install
    ```

3.  **Configure Environment (Optional, if `.env` exists)**

    If a `.env` file is present or required, ensure it's configured. For a basic quick start, the default settings are often sufficient. If you need to specify a port or Ollama endpoint, create a `.env` file:

    ```env
    PORT=3000
    # OLLAMA_URL=http://localhost:11434
    ```

4.  **Initialize Database Schema (automatic)**

    The local SQLite database (`~/.omnecor/data/omnecor.db`) is created and migrated automatically on first launch — no manual step required. If you change `drizzle/schema.ts` and need to regenerate migrations:

    ```bash
    pnpm build:push
    ```

5.  **Start the Application**

    Launch Omnecor. This will build the application and start the server:

    ```bash
    pnpm dev
    ```

    *(Note: `pnpm dev` starts the application in development mode, which includes live reloading. For production, use `pnpm build` followed by `pnpm start` as described in [INSTALL.md](INSTALL.md).)*

## Accessing the User Interface

Once the application starts, you will see output in your terminal indicating the URL. Typically, Omnecor will be accessible at:

```
http://localhost:3000/
```

If port `3000` is in use, Omnecor will automatically select an available port and display the correct URL in the console. Open this URL in your web browser to access the Omnecor UI.

## First Launch — Setup Wizard

On first launch Omnecor opens the **Setup Wizard**, which:

- Auto-detects installed tools: Ollama, Python 3.10+, llama.cpp, Blender, KiCad CLI, ESPTool, and running bridge servers (Whisper STT on :8001, TTS on :8002, ComfyUI on :8188)
- Offers a one-click **Install Ollama** button (Windows/Linux) if Ollama is not found
- Auto-detects your GPU model and VRAM to pre-fill model size recommendations
- Guides you through execution mode selection (Sovereign / Scrapper / Big Spender)

After completing the wizard you can:

-   **Explore the Dashboard**: Familiarize yourself with the main interface.
-   **Import a Project Folder**: Begin by importing a folder to leverage Omnecor's semantic indexing capabilities.
-   **Interact with the Chat Interface**: Start a conversation with the integrated AI.
-   **Check Local Network Peers**: Look at the sidebar footer to see if any other Omnecor nodes are on your network (requires OMMESH discovery enabled).

## Optional Configuration

For cross-session memory persistence, set the `HONCHO_API_KEY` environment variable in your `.env` file to enable the Honcho memory layer. This allows you to save background notes with `/btw <note>` that persist across sessions.

For more detailed usage instructions, refer to the [User Guide](docs/user-guides/Omnecor User Guide.md).
