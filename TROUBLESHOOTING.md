# Troubleshooting Guide for Omnecor

This guide provides solutions to common issues you might encounter while installing, configuring, or operating Omnecor. For more in-depth information, please refer to the [User Guide](docs/user-guides/Omnecor User Guide.md) and the [Installation Guide](INSTALL.md).

## 1. General Troubleshooting Steps

Before diving into specific issues, consider these general troubleshooting steps:

1.  **Check System Requirements**: Ensure your system meets the minimum and recommended requirements outlined in [INSTALL.md](INSTALL.md).
2.  **Review Logs**: Examine the backend runtime logs located in `server/_core/logs` for any error messages or warnings. Process-specific logs are streamed as JSON for backend parsing.
3.  **Restart Omnecor**: Sometimes, simply restarting the Omnecor application can resolve transient issues.
4.  **Update Dependencies**: Ensure all project dependencies are up-to-date by running `pnpm install`.
5.  **Consult Documentation**: Refer to the relevant sections of the [User Guide](docs/user-guides/Omnecor User Guide.md) or other documentation files for detailed explanations of features and configurations.

## 2. Common Installation Issues

### Issue: Port Already in Use

**Symptoms**: Omnecor fails to start, and the console output indicates that the default port (e.g., `3000`) is already in use.

**Causes**: Another application is using the port Omnecor is trying to bind to.

**Diagnostics**: The startup logs will explicitly state that the port is unavailable. You can also use `lsof -i :<PORT>` to identify the process.

**Fixes**: Omnecor is designed to automatically find an available port if the preferred one is busy. Check the console output for the actual URL where Omnecor is running. Alternatively, you can specify a different port in your `.env` file:

```env
PORT=3001
```

To manually kill a process occupying the port:

```bash
lsof -i :3000
kill -9 <PID>
```

**Prevention**: Ensure no other applications are running on the ports Omnecor typically uses (e.g., 3000, 3001, etc.) before starting Omnecor.

### Issue: Node.js/pnpm Missing or Incorrect Version

**Symptoms**: `pnpm install` fails, or the application throws errors related to missing modules during startup, or `node --version` / `pnpm --version` commands fail.

**Causes**: Node.js or pnpm are not installed, or an incompatible version is being used.

**Diagnostics**: Error messages during `pnpm install` or runtime errors indicating `Cannot find module`. Verify installed versions:

```bash
node --version
pnpm --version
```

**Fixes**:

1.  **Install Node.js and pnpm**: Follow the instructions in [INSTALL.md](INSTALL.md) to install the correct versions.
2.  **Clean Install**: Delete the `node_modules` directory and `pnpm-lock.yaml` file, then run `pnpm install` again:
    ```bash
    rm -rf node_modules pnpm-lock.yaml
    pnpm install
    ```

**Prevention**: Always ensure your development environment matches the prerequisites specified in [INSTALL.md](INSTALL.md).

### Issue: SQLite Database Failures (better-sqlite3)

**Symptoms**: The application fails to start or crashes with an error like `Cannot find module 'better_sqlite3.node'` or `The module ... was compiled against a different Node.js version`.

**Causes**: `better-sqlite3` is a native C++ module that must be compiled for your specific OS and Node.js version. If you recently updated Node.js or changed platforms, the binary binding might be missing or incompatible.

**Fixes**:

1.  **Rebuild Native Modules**: Run `pnpm install` again. Omnecor's `pnpm-workspace.yaml` is configured to automatically fetch or build the correct binary.
2.  **Manual Rebuild**: If the automatic install fails, you can force a rebuild:
    ```bash
    cd node_modules/better-sqlite3
    pnpm install
    ```
    *Note: This requires a C++ compiler (like `gcc`, `clang`, or MSVC on Windows) and Python installed on your system.*
3.  **Prebuilt Binaries**: Omnecor attempts to use prebuilt binaries to sidestep compilation issues (especially on systems with spaces or special characters in the project path). Ensure your internet connection is active during `pnpm install`.

**Prevention**: Use the pinned versions of Node.js and pnpm specified in [INSTALL.md](INSTALL.md). Avoid moving the project directory after installation, as some native modules use absolute paths in their bindings.

## 3. Runtime and Operational Issues

### Issue: AI Model Loading Failures

**Symptoms**: Omnecor cannot connect to local AI models (e.g., Ollama/Llama.cpp) or fails to load them, or models do not appear in the UI.

**Causes**: Incorrect endpoint configuration, the local AI model server is not running, or network issues.

**Diagnostics**: Check Omnecor logs for connection errors to the AI model endpoint. Verify the AI model server is running independently. You can check Ollama status with `curl http://localhost:11434/api/tags`.

**Fixes**:

1.  **Verify AI Server Status**: Ensure your local AI model server (e.g., Ollama) is running and accessible.
2.  **Check `.env` Configuration**: Confirm that `OLLAMA_ENDPOINT` (or similar) in your `.env` file points to the correct address and port of your local AI model server.
3.  **Firewall Settings**: Ensure your firewall is not blocking communication between Omnecor and your local AI model server.
4.  **Verify Configuration in UI**: Check `Settings > Model Hub` for Ollama host settings.

**Prevention**: Always start your local AI model server before launching Omnecor if you intend to use local models.

### Issue: GPU Issues / Performance Problems

**Symptoms**: Slow AI inference, UI lag, or errors indicating GPU memory exhaustion. Application runs slowly or GPU is not being used.

**Causes**: Insufficient GPU VRAM, outdated GPU drivers, or resource-intensive AI models.

**Diagnostics**: System monitoring tools (e.g., `nvidia-smi` for NVIDIA GPUs) can show GPU utilization and memory usage. Omnecor logs might show warnings related to performance.

**Fixes**:

1.  **Reduce Context Size**: Adjust context limits in `Settings > Advanced`.
2.  **Close Unused Workspaces**: Free up system memory.
3.  **Reduce Model Size**: Use smaller AI models or quantizations if VRAM is limited.
4.  **Update Drivers**: Ensure your GPU drivers are up-to-date.
5.  **Zram**: For memory-constrained Linux systems, ensure Zram is enabled to prevent Out-Of-Memory (OOM) terminations. Refer to [User Guide](docs/user-guides/Omnecor User Guide.md#16-performance-optimization) for details.
6.  **Configure Ollama for GPU**: Ensure Ollama is correctly detecting and utilizing your hardware.

**Prevention**: Monitor GPU usage during heavy AI tasks. Allocate sufficient resources for your intended AI workloads.

### Issue: WebSocket Connection Problems

**Symptoms**: Real-time updates (e.g., Neural Node-Tree, training progress) are not functioning, or the UI shows connection errors.

**Causes**: Firewall blocking WebSocket connections, incorrect WebSocket URL, or server-side WebSocket issues.

**Diagnostics**: Browser developer console (Network tab) will show WebSocket connection attempts and any errors. Omnecor server logs will indicate WebSocket server status.

**Fixes**:

1.  **Firewall**: Ensure your firewall allows WebSocket connections on the Omnecor port.
2.  **Server Status**: Verify the Omnecor server is running and the WebSocket server is initialized (check startup logs).

**Prevention**: Ensure consistent network configuration and monitor server health.

### Issue: Bridge Not Connecting (Blender/KiCad/ESPTool)

**Symptoms**: Integrations with external tools like Blender or KiCad fail to establish a connection or execute commands.

**Causes**: Incorrect Python environment setup, missing dependencies for the bridge scripts, or issues with the `ProcessManagerService`.

**Diagnostics**:

1.  **Check Python Environment**: Ensure the Python environment used by the bridge has the necessary dependencies installed.
2.  **View Bridge Logs**: Check the logs generated by the `ProcessManagerService` for specific errors related to the bridge.

**Fixes**:

1.  **Install Python Dependencies**: Ensure all required Python packages for the specific bridge are installed.
2.  **Verify Python Path**: Confirm that Omnecor is configured to use the correct Python interpreter and environment.

**Prevention**: Follow the specific setup instructions for each hardware integration in the [User Guide](docs/user-guides/Omnecor User Guide.md).

### Issue: Knowledge Base Not Indexed

**Symptoms**: Semantic search or knowledge retrieval features are not working as expected, or the knowledge base appears empty.

**Causes**: File permission issues, indexing process failure, or incorrect configuration of the `VectorDBService`.

**Diagnostics**:

1.  **Check File Permissions**: Ensure Omnecor has read access to the directories you are trying to index.
2.  **Review `VectorDBService` Logs**: Check logs for errors during the indexing process.

**Fixes**:

1.  **Manual Reindex**: Use the reindex action in the Knowledge Base settings within the Omnecor UI.
2.  **Verify Configuration**: Ensure the `VectorDBService` is correctly configured and initialized.

**Prevention**: Grant appropriate file system permissions and monitor the indexing process for large datasets.

### Issue: Background Notes (/btw) Not Persisting Across Sessions

**Symptoms**: Notes saved with `/btw <note>` in the chat appear locally but are lost when you restart Omnecor or open a new project.

**Causes**: The Honcho memory layer is not configured. The feature requires an API key to enable cross-session persistence.

**Diagnostics**: Check whether `HONCHO_API_KEY` is set in your `.env` file. Without it, notes are stored only in browser localStorage and won't survive restarts.

**Fixes**:

1. **Set HONCHO_API_KEY**: In your `.env` file, add your Honcho API key:
   ```env
   HONCHO_API_KEY=your_honcho_api_key
   HONCHO_APP_NAME=omnecor
   HONCHO_ENVIRONMENT=demo
   ```
2. **Restart Omnecor**: Ensure the new environment variables are loaded by restarting the application.

**Prevention**: Configure `HONCHO_API_KEY` during initial setup (see [INSTALL.md](INSTALL.md)) if you need persistent cross-session memory.

### Issue: No Other Omnecor Nodes Appearing in Peer Card

**Symptoms**: The sidebar footer Peer Card shows "No peers on local network" even though you have other Omnecor instances running.

**Causes**: Another instance not running, different subnet/VLAN, or mDNS discovery blocked by firewall.

**Diagnostics**:

1. **Verify Other Instance Running**: Confirm another Omnecor instance is actually running and accessible.
2. **Check Network Configuration**: Ensure all Omnecor nodes are on the same Wi-Fi network or LAN.
3. **Firewall Rules**: Check whether mDNS (port 5353, UDP) is blocked by your firewall or network security appliance.

**Fixes**:

1. **Enable mDNS**: Ensure mDNS is enabled and not blocked by network security tools.
2. **Same Subnet**: Verify all nodes are on the same subnet; discovery does not cross VLAN boundaries.
3. **Check Logs**: Review the OMMESH/discovery logs in `server/_core/logs` for discovery errors.

**Prevention**: Maintain a stable, mDNS-enabled local network; use `settings > OMMESH` to monitor mesh status in real-time.

### Issue: Chat Running Out of Context Tokens

**Symptoms**: The token budget bar under the chat input turns red (~90% full); the AI starts refusing to process new messages.

**Causes**: The conversation history has grown too large for the selected model's context window.

**Diagnostics**: Look at the token budget bar color:
- Amber (~70%) = approaching limit
- Red (~90%) = nearing maximum

**Fixes**:

1. **Use /compress**: Type `/compress` in the chat to summarize and shrink the conversation history. The Goal & Plan buffer is never pruned.
2. **Exclude Messages**: Click the context menu on individual messages to toggle them out of the context sent to the model (they remain visible locally).
3. **Switch to Larger Model**: Select a model with a larger context window in the model selector.
4. **Start Fresh**: Create a new chat session if the current one is too large to recover.

**Prevention**: Monitor token usage and compress regularly. Use `Settings > Advanced` to adjust initial context limits if needed.

## 4. Getting Help

If you encounter an issue not covered in this guide, please report it on the [GitHub Issues page](https://github.com/Clarkescustomcreations/OmnecorV1-Beta/issues). When reporting, please include:

-   A clear and concise description of the problem.
-   Steps to reproduce the behavior.
-   Expected behavior.
-   Screenshots or error messages, if applicable.
-   Your operating system and Omnecor version.
-   Relevant log snippets.

Alternatively, you can contact support at `th3artistunknown@gmail.com`.
