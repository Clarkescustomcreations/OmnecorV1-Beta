# Service Dependency Matrix

*An operational tracker for all background and external services — tracking their installation, availability, fallback behavior, and failure handling. Port assignments, detection methods, and verified status all sourced from code. Last audited: 2026-06-20.*

| Service | Installed | Running | Detected | Fallback Exists | Failure Handling | Verified |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Ollama | [x] | [x] | [x] | [x] | [x] | [x] |
| OpenSCAD (Blueprint CAD, optional) | [ ] | [ ] | [x] | [x] | [x] | [x] |
| FEA python deps (gmsh/numpy/scipy, optional) | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| Whisper (STT) | [x] | [ ] | [x] | [x] | [x] | [x] |
| TTS / Kokoro | [x] | [ ] | [x] | [x] | [x] | [x] |
| RVC | [x] | [ ] | [x] | [x] | [x] | [x] |
| ChromaDB | [x] | [ ] | [x] | [x] | [x] | [ ] |
| ComfyUI | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| Blender | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| KiCad | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| ESPTool | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| MCP Servers | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| OMMESH | [x] | [x] | [x] | [x] | [x] | [x] |
| Valet Router | [x] | [x] | [x] | [x] | [x] | [x] |
| llama.cpp | [x] | [ ] | [x] | [x] | [x] | [x] |
| ElevenLabs | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| Fal.ai | [ ] | [ ] | [x] | [ ] | [x] | [ ] |
| RunPod | [ ] | [ ] | [ ] | [ ] | [x] | [ ] |
| Vast.ai | [ ] | [ ] | [ ] | [ ] | [x] | [ ] |
| Lambda Labs | [ ] | [ ] | [ ] | [ ] | [x] | [ ] |
| Kaggle GPU | [ ] | [ ] | [ ] | [x] | [x] | [x] |
| Lithic (VirtualCard) | [ ] | [ ] | [ ] | [x] | [x] | [ ] |
| Honcho AI | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| n8n | [ ] | [ ] | [x] | [x] | [x] | [ ] |
| Tailscale | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

---

## Service Notes

### Ollama
- **Port**: Configurable — `OLLAMA_URL` env var (default `http://localhost:11434`)
- **Detection**: `trpc.system.checkDependencies` probes `GET ${OLLAMA_URL}/api/tags` in parallel with all other checks; `trpc.system.installOllama` (adminProcedure) — platform-aware installer (Windows: `OllamaSetup.exe /S`; Linux: `install.sh`; macOS: opens download page); SetupWizard Launch Checklist shows detected/not-found badge with Re-check button
- **Fallback**: Valet Router falls back to dynamic LLM intent classification (via AiProviderService) when local model is unreachable; `PipelineEngineService` falls back to static phase output strings; `AiProviderService` falls back to next configured provider
- **Failure Handling**: All Ollama calls wrapped in try/catch; unresponsive Ollama logged as `ollama_unavailable` in AuditLog; `ValetServerService` sets 45 s timeout on first model load (cold boot)
- **Known State (2026-06-16)**: Linux Ollama returning 500s on all models (local issue — not mesh/code bug); Windows node (`192.168.1.78:11434`) verified working
- **Special**: `ollama_proxy.py` — `OLLAMA_BIND_ADDRESS`/`OLLAMA_PROXY_TOKEN` proxy; `ollama create omnecor-valet-router:v2-q8 -f Modelfile` required for Valet Ollama backend on each node; `docker-compose.ollama.yml` available

### Whisper (STT / Speech-to-Text)
- **Port**: 8001 (external Faster-Whisper FastAPI daemon)
- **Service File**: External binary — **not shipped with Omnecor**. Must be started separately: `uvicorn <your_whisper_server>:app --port 8001`. The `server/python_bridges/` directory does not contain a Whisper bridge — Omnecor treats port 8001 as a pre-existing HTTP endpoint.
- **Detection**: `trpc.system.checkDependencies` HTTP probe to `:8001/health`; SetupWizard Checklist shows badge with Re-check button
- **Fallback**: Voice input silently disabled in Chat UI when Whisper unreachable; mobile APK shows STT unavailable status
- **Failure Handling**: `VoiceService.ts` catches proxy errors and returns user-visible error; `voiceRouter.transcribe` catches subprocess/proxy errors; degrades gracefully with `console.warn`
- **Mobile Usage**: `POST :8001/transcribe` directly from APK (not via tRPC — FormData audio blob); Tailscale IP used for remote access

### TTS / Kokoro (Text-to-Speech)
- **Port**: 8002 (FastAPI Kokoro daemon)
- **Detection**: `trpc.system.checkDependencies` HTTP probe to `:8002/health`
- **Fallback**: `podcast_engine.py` inserts 1.5 s silence per segment when TTS server unreachable; mobile APK falls back to Android `expo-speech` device TTS (no server required)
- **Failure Handling**: `LocalPodcastService.ts` catches `callPodcastEngine()` subprocess errors; falls back to stub response; `streamDialogue()` calls TTS server directly via `fetch` (not VoiceService to avoid path resolution conflict)
- **XTTS-v2**: Used when `referenceWav` provided in podcast turn config; Kokoro used otherwise
- **ElevenLabs Alternative**: `ElevenLabsService.ts` — cloud TTS via `cloudProcedure`; requires `ELEVENLABS_API_KEY`

### RVC (Real-time Voice Cloning)
- **Port**: Embedded in `rvc_server.py` (FastAPI — started by `VoiceService.ts` via Python subprocess)
- **Service File**: `server/python_bridges/rvc_server.py`
- **Detection**: `trpc.system.checkDependencies` implicit (listed in voice section)
- **Fallback (F22 fix)**: `_stub_synthesise` replaced mock 220 Hz sine tone → identity pass-through of original 16 kHz audio; zero-filled silence only if audio entirely unavailable
- **Failure Handling**: Real HuBERT + SynthesizerTrnMs768NSFsid path called first; stub used only when RVC libs not installed; `voiceRouter.convertVoice` path validated by `validatePath`
- **Path Safety**: `validatePath` enforced on `voiceRouter.convertVoice` (audioFilePath + modelPath) and `voiceRouter.listRvcModels` (modelsDir) — separator-aware `isWithin()` boundary checks

### ChromaDB (Vector Store)
- **Port**: Default 8000 (embedded or remote)
- **Service File**: Managed by `VectorDBService.ts` + `MemoryArchitectService.ts` + `ONNXEmbeddingService.ts`
- **Detection**: Probed in `trpc.system.checkDependencies` (HTTP probe)
- **Embedding Fix (F11)**: `@anthropic-ai/tokenizer` BPE encoder — replaced whitespace pseudo-tokenizer that produced identical token IDs for same-length strings (broken vector search). Now produces unique, content-sensitive embeddings.
- **Failure Handling**: `VectorDBService` degrades gracefully when ChromaDB unreachable — semantic search disabled, episodic memory unavailable; `console.warn` logged; no crash
- **Per-Agent Isolation**: `recursive_mas_bridge.py` creates a separate ChromaDB collection per agent to prevent context leakage in multi-agent runs
- **Collection naming (2026-06-23)**: all writers + the reader derive names from the shared `VectorDBService.sanitizeCollectionName` (single source of truth). A neural map's collection `omnecor_{mapId}` holds **both** local-file content (via `FileSystemWatcherService`) and remote-source content (via `integrations.indexMapSources` → `MemoryArchitectService.reindexRemoteSource`). Fixed a latent seam where the watcher wrote a raw, unsanitized name that diverged from the reader's sanitized one for hyphenated map UUIDs.

### ComfyUI
- **Port**: Configurable — `COMFYUI_URL` env var (default `http://localhost:8188`)
- **Detection**: `trpc.system.checkDependencies` HTTP probe; SetupWizard Checklist shows badge
- **Fallback**: `comfyRouter` returns error when ComfyUI unreachable; `imageGenRouter` falls back to alternative provider if configured
- **Failure Handling**: `ComfyService.ts` wraps all HTTP calls in try/catch; `ComfyPanel.tsx` validates workflow JSON before queueing

### Blender
- **Port**: N/A — headless subprocess (not a daemon)
- **Binary**: `BLENDER_PATH` env var (or system PATH)
- **Detection**: `trpc.system.checkDependencies` → `findExecutable("blender")` / `BLENDER_PATH`; SetupWizard Checklist
- **Fallback**: `blenderRouter` returns error when binary not found; 3DDesigner degrades to Three.js primitive scene only
- **Failure Handling**: `BlenderService.ts` wraps `execFileSync` / `spawn` calls; all args in arrays (no shell string RCE); graceful error returned to client
- **Mobile**: `blender.listModels` + `/media/model/:file` range-capable route serves GLB/GLTF to mobile viewer; `blender.export` with `toLibrary` writes to shared model library

### KiCad
- **Port**: N/A — headless subprocess
- **Binary**: `KICAD_CLI_PATH` env var (was `KICAD_BIN` — fixed in Session 14)
- **Detection**: `trpc.system.checkDependencies` → `findExecutable`; SetupWizard Checklist
- **Fallback**: `kicadRouter` returns error when binary not found; PCB editor still functional for schematic design without KiCad CLI
- **Failure Handling**: `KiCadService.ts` wraps subprocess calls; DRC/ERC failures return structured error JSON to client
- **PCBWay**: `PCBWayService.ts` → HITL-gated quoting + ordering (requires `PCBWAY_API_KEY`)

### ESPTool (IoT Firmware Flash)
- **Port**: Serial port (COM on Windows, `/dev/ttyUSB*` / `/dev/cu.*` on Linux/macOS)
- **Binary**: `esptool` (Python package or standalone binary)
- **Detection**: `trpc.system.checkDependencies` → `findExecutable("esptool")` / `findExecutable("esptool.py")`; Windows: PowerShell `Get-PnpDevice` COM auto-detect (Session 14 fix); macOS: `/dev/cu.*` glob
- **Fallback**: Flash button disabled when no port detected; error message shown
- **Failure Handling**: `ESPToolService.ts` uses `execFileSync` with arg arrays (no shell string RCE — F2 security fix); Windows `taskkill` also converted to `execFileSync`

### MCP (Model Context Protocol) Servers
- **Port**: Variable (stdio transport or HTTP Streamable transport)
- **Detection**: User-configured in Integrations → Add MCP Server (command path, IDs, transport)
- **Fallback**: Tool directory shows available tools; HITL gate on `dangerous:true` tools
- **Failure Handling**: `MCPClientService.ts` (`@modelcontextprotocol/sdk`) wraps connections; `mcpRouter.connectServer` is adminProcedure (any user passing command+args is blocked — F1/F3 security tightening)
- **Status**: Listed in Integrations Manager; `trpc.mcp.listTools`, `trpc.mcp.callTool`

### OMMESH (LAN Mesh Intelligence)
- **Port**: `MESH_PORT` 3001 (mTLS HTTPS inference listener, `MeshServer.ts`); `PORT` 3000 (main app + mDNS advertisement)
- **Service Files**: `server/ommesh/core/MeshNode.ts`, `server/ommesh/core/MeshServer.ts`, `server/core_services/services/MeshDiscoveryService.ts`
- **Detection**: `bonjour` mDNS — static `import bonjour from "bonjour"` (CJS `export =` pattern; dynamic `import()` breaks module resolution); `OMMESH_SECRET` env var required for secure peer auth
- **Fallback (F22)**: mDNS unavailable → `console.warn` + graceful no-op; `routeInference()` falls back to local on remote failure/missing peer; `MeshServer` no-ops gracefully when certs unprovisioned or port taken
- **Failure Handling**: `SecurityManager.isReady()` gates the inference listener; `MeshNode.executeLocal()` rejects cloud providers in sovereign mode; fingerprint pinning rejects MITM; secret compared with SHA-256 + `crypto.timingSafeEqual`; mobile nodes fail-closed when `OMMESH_SECRET` unset (except loopback/zero-login)
- **Live Verified (2026-06-16)**: Linux (`192.168.1.252`, `omnecor-lin-vis`) ↔ Windows (`192.168.1.78`, `omnecor-win-clark`) bidirectional mDNS + mTLS inference; shared CA + per-node certs provisioned; gotcha: Windows LAN must be **Private** + inbound firewall TCP 3000/3001; Linux clock NTP drift (61 min fast) invalidated cert timestamps
- **Mobile Node**: `?token=` WS auth (cookies not supported in RN WebSockets); `mobile_node_register` → `mobile_node_ack` handshake; 10 s heartbeat; 8 s reconnect backoff; `nanoid(12)` session nodeId

### Valet Router (ML Inference Routing)
- **Port**: 8010 (FastAPI — `valet_router_inference.py`)
- **Service Files**: `server/python_bridges/valet_router_inference.py`, `server/core_services/services/ValetServerService.ts`, `server/core_services/services/ValetArtifactRegistry.ts`, `server/core_services/services/ValetRouterService.ts`
- **Detection**: `trpc.valet.status` → `GET :8010/health`; `ValetServerService` auto-starts on server boot; registry seeded from repo `current.json` by `ValetArtifactRegistry.seedFromRepoIfMissing()` (checks `process.cwd()`, Electron `process.resourcesPath`, bundle-relative paths)
- **Fallback**: Dynamic LLM intent classification via AiProviderService when model not loaded
- **Failure Handling**: 45 s cold-load timeout (raised from 10 s to prevent premature fallback on first boot); `ValetRouterService` catches HTTP errors; pre-routing in `AiProviderService.streamChat()` uses result or skips routing on error
- **Model**: `omnecor-valet-router:v2-q8` (Qwen2.5-1.5B-Instruct Q8_0, ~1.6 GB); `gguf_sha256: b0398f857ffb1dc6d9ae562304201c24e64ec4422cfb6b1b1391d66e21138eee`; route accuracy 0.7385 (Kaggle P100 eval — beats keyword baseline ~2.7×; below 0.85 config gate — sign-off pending GPU box)
- **Packaging Gap (BLOCKER)**: `electron-builder.yml` `extraResources` must include `server/python_bridges/valet_router_inference.py` + `docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md` + `routing_manifest.json`; Python + deps required in packaged app

### Local LLM Runtime — `llama-server` (Local Model Inference)
- **Port**: Managed `llama-server` subprocess (llama.cpp, OpenAI-compatible), default `http://127.0.0.1:8014`; supervised by `LocalLlmRuntimeService.ts`. (Superseded the standalone `llamacpp_bridge.py` on port 8013, retired 2026-07-11 once MoE-Chain moved onto this runtime.)
- **Service File**: `server/core_services/services/LocalLlmRuntimeService.ts`
- **Detection**: `LocalLlmRuntimeService.isAvailable()` — a `llama-server` binary (`LLAMA_SERVER_BIN`/PATH) + at least one indexed `.gguf` (`ModelIndexService`). `isReady()` flags whether a model is warm.
- **Hot-swap**: `ensureModelLoaded(idOrPath)` stops the current server and spawns the requested model (the swap frees the prior model's RAM/VRAM); per-model `--n-gpu-layers` VRAM-fit; boot resumes the last model (`localLlmLastModel`).
- **Failure Handling**: All lifecycle work (boot load, hot-swap, crash respawn) is serialized through one queue so nothing orphans a server; `chatLocalLlm`/`completeLocal` surface a clear error when no binary/model is available.

### ElevenLabs (Cloud TTS)
- **Port**: N/A — external HTTPS API
- **Detection**: `trpc.system.checkDependencies` checks `ELEVENLABS_API_KEY` env presence; Settings → API → ElevenLabs key field
- **Fallback**: When unavailable, defaults to local Kokoro/XTTS TTS pipeline
- **Failure Handling**: `ElevenLabsService.ts` wraps all API calls; errors bubble to `voiceRouter` which returns user-visible error; all ElevenLabs procedures are `cloudProcedure` (blocked in Sovereign mode)

### Fal.ai (Image / Video Generation)
- **Port**: N/A — external HTTPS API
- **Detection**: `FAL_API_KEY` env var; Settings → API → fal.ai key field
- **Fallback**: None — fal.ai is the primary image gen cloud backend
- **Failure Handling**: `FalApiService.ts` + `falRouter.ts` (cloudProcedure); errors returned structured; `fal_bridge.py` available as subprocess alternative

### RunPod / Vast.ai / Lambda Labs (Cloud Compute Rental)
- **Port**: N/A — external HTTPS APIs
- **Detection**: API keys in Settings → Cloud Compute; not auto-detected
- **Fallback**: Session fails with structured error; `cloudComputeRouter` catches provider errors
- **Failure Handling**: `cloudComputeRouter` (cloudProcedure — blocked in Sovereign mode); sessions tracked in `cloud_compute_sessions` table with status enum; all provider calls individually try/catch'd

### Kaggle GPU (Training)
- **Port**: N/A — Kaggle API (external)
- **Detection**: `kaggle.json` credentials file (`trainingRouter.kaggleStatus`); `KaggleKeyCard` in Settings
- **Fallback**: Local Unsloth training via `trainingRouter.startTraining`
- **Failure Handling**: `valet_merge.py` — CPU LoRA→fp16 merge (streaming progress); `trainingRouter.kaggleJobStatus` polls status; `pullKaggleArtifact` downloads and activates GGUF
- **Verified**: Kaggle P100 eval run completed (2026-06-11) — produced `valet-router-q8_0.gguf` with 0.7385 accuracy

### Lithic (Agentic Wallet / Virtual Cards)
- **Port**: N/A — external HTTPS API
- **Detection**: `LITHIC_API_KEY` env var; Virtual Cards tab hidden when key absent
- **Fallback**: Budget enforcement works without Lithic (spend log + limits enforced server-side regardless)
- **Failure Handling**: `VirtualCardService.ts` wraps Lithic SDK calls; AES-256-GCM PAN encryption at rest; `virtualCardRouter` (cloudProcedure)

### Honcho AI (Long-Term Memory)
- **Port**: N/A — external HTTPS API
- **Detection**: `HONCHO_API_KEY` env var; `honchoRouter` degrades without key
- **Fallback**: Session memory only (libSQL `chat_messages`); Honcho layer disabled gracefully
- **Failure Handling**: `HonchoService.ts` + `honchoRouter` — all procedures degrade without API key; explicitly `publicProcedure` by design (zero-login compatible)

### n8n (Workflow Automation)
- **Port**: Configurable — `N8N_URL` env var (default `http://localhost:5678`)
- **Detection**: Settings → API → n8n URL field; `agentRouter.triggerN8n` (protectedProcedure)
- **Fallback**: Agent orchestration falls back to direct `crewai_bridge.py` / `liteagent_bridge.py`
- **Failure Handling**: `agentRouter.triggerN8n` catches HTTP errors; returns error payload to client

### Tailscale (Remote Access VPN)
- **Port**: N/A — Tailscale manages virtual LAN (`100.x.x.x` range)
- **Detection**: User-configured in APK Settings → Omnecor Server (IP/port field accepts Tailscale IP)
- **Fallback**: LAN Wi-Fi (`192.168.x.x`) or on-device inference
- **Failure Handling**: Connection test via `GET /health` 5 s timeout in APK Settings → Test button; no automatic fallback
- **Setup**: Tailscale installed on PC + phone (same account); open ports 3000/8001/8002 if firewall blocks; Linux UFW: `allow 3000/tcp`, `allow 8001/tcp`, `allow 8002/tcp`
