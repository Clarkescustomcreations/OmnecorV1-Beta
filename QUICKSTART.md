# Quick Start Guide for Omnecor

This guide provides a streamlined set of instructions to get Omnecor up and running quickly. For detailed installation steps and troubleshooting, please refer to the [INSTALL.md](INSTALL.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md) files.

## Prerequisites

Ensure you have the following installed:

- **Git**
- **Node.js (v22 or higher)**
- **pnpm** (install with `npm install -g pnpm`)

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
    # OLLAMA_ENDPOINT=http://localhost:11434
    ```

4.  **Initialize Database Schema**

    Synchronize the database schema:

    ```bash
    pnpm run db:push
    ```

5.  **Start the Application**

    Launch Omnecor. This will build the application and start the server:

    ```bash
    npm run dev
    ```

    *(Note: `npm run dev` starts the application in development mode, which includes live reloading. For production, use `npm run build` followed by `npm run start` as described in [INSTALL.md](INSTALL.md).)*

## Accessing the User Interface

Once the application starts, you will see output in your terminal indicating the URL. Typically, Omnecor will be accessible at:

```
http://localhost:3000/
```

If port `3000` is in use, Omnecor will automatically select an available port and display the correct URL in the console. Open this URL in your web browser to access the Omnecor UI.

## First Task

Upon first launch, Omnecor will perform an inventory of locally available AI models and initialize its knowledge base. You can then:

-   **Explore the Dashboard**: Familiarize yourself with the main interface.
-   **Import a Project Folder**: Begin by importing a folder to leverage Omnecor's semantic indexing capabilities.
-   **Interact with the Chat Interface**: Start a conversation with the integrated AI.

For more detailed usage instructions, refer to the [User Guide](docs/user-guides/USER_GUIDE.md).
