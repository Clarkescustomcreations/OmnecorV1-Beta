# Troubleshooting Guide for Omnecor

This guide provides solutions to common issues you might encounter while installing, configuring, or operating Omnecor. For more in-depth information, please refer to the [User Guide](docs/user-guides/USER_GUIDE.md) and the [Installation Guide](INSTALL.md).

## 1. General Troubleshooting Steps

Before diving into specific issues, consider these general troubleshooting steps:

1.  **Check System Requirements**: Ensure your system meets the minimum and recommended requirements outlined in [INSTALL.md](INSTALL.md).
2.  **Review Logs**: Examine the backend runtime logs located in `server/_core/logs` for any error messages or warnings. Process-specific logs are streamed as JSON for backend parsing.
3.  **Restart Omnecor**: Sometimes, simply restarting the Omnecor application can resolve transient issues.
4.  **Update Dependencies**: Ensure all project dependencies are up-to-date by running `pnpm install`.
5.  **Consult Documentation**: Refer to the relevant sections of the [User Guide](docs/user-guides/USER_GUIDE.md) or other documentation files for detailed explanations of features and configurations.

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

### Issue: Build Failures

**Symptoms**: `npm run build` command fails with compilation errors.

**Causes**: TypeScript errors, misconfigured `vite.config.ts`, or issues with static assets.

**Diagnostics**: The build output will show specific error messages from TypeScript or Vite.

**Fixes**:

1.  **Check TypeScript Errors**: Run `pnpm run check` to identify and fix any TypeScript compilation errors.
2.  **Review Configuration**: Ensure `vite.config.ts` and `tsconfig.json` are correctly configured.

**Prevention**: Regularly run `pnpm run check` during development to catch type errors early.

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
5.  **Zram**: For memory-constrained Linux systems, ensure Zram is enabled to prevent Out-Of-Memory (OOM) terminations. Refer to [User Guide](docs/user-guides/USER_GUIDE.md#16-performance-optimization) for details.
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

**Prevention**: Follow the specific setup instructions for each hardware integration in the [User Guide](docs/user-guides/USER_GUIDE.md).

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

## 4. Getting Help

If you encounter an issue not covered in this guide, please report it on the [GitHub Issues page](https://github.com/Clarkescustomcreations/OmnecorV1-Beta/issues). When reporting, please include:

-   A clear and concise description of the problem.
-   Steps to reproduce the behavior.
-   Expected behavior.
-   Screenshots or error messages, if applicable.
-   Your operating system and Omnecor version.
-   Relevant log snippets.

Alternatively, you can contact support at `th3artistunknown@gmail.com`.
