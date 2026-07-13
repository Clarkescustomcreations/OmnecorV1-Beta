# External API Integrations

Omnecor integrates with 30+ external services across AI, payments, cloud compute, voice, and collaboration platforms. This document provides a reference guide for all external API connections, configuration requirements, security considerations, and reliability guarantees.

---

## Overview

All external API calls are protected by:
- ✅ **Rate limiting & circuit breaker** — Exponential backoff, per-host failure tracking
- ✅ **Sensitive data redaction** — PAN, tokens, API keys scrubbed from logs
- ✅ **Error wrapping** — Safe error messages, internal logging of details
- ✅ **Token refresh safety** — Pre-flight expiry checks, automatic refresh with retry
- ✅ **Transaction atomicity** — Cloud compute and payment operations are atomic
- ✅ **CORS validation** — Foreign origins blocked from state-changing endpoints

See [SECURITY_FEATURES.md](../user-guides/SECURITY_FEATURES.md#8-external-api-security-hardening) for details.

---

## 1. AI & Language Models

### OpenAI
- **Endpoint:** `https://api.openai.com/v1/chat/completions`
- **Config:** `OPENAI_API_KEY`
- **Status:** Optional (local Ollama fallback available)
- **Use Case:** Cloud LLM inference (GPT-4, GPT-3.5-turbo)
- **Rate Limiting:** Built-in circuit breaker (5 retries, 60s cooldown)
- **Files:** `server/core_services/services/AiProviderService.ts`

### Anthropic (Claude)
- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Config:** `ANTHROPIC_API_KEY`
- **Status:** Optional (local Ollama fallback available)
- **Use Case:** Cloud LLM inference (Claude Opus, Sonnet, Haiku)
- **Rate Limiting:** Built-in circuit breaker (5 retries, 60s cooldown)
- **Files:** `server/core_services/services/AiProviderService.ts`

### xAI (Grok)
- **Endpoint:** `https://api.x.ai/v1/chat/completions`
- **Config:** `XAI_API_KEY`
- **Status:** Optional (local Ollama fallback available)
- **Use Case:** Cloud LLM inference (Grok models)
- **Rate Limiting:** Built-in circuit breaker (5 retries, 60s cooldown)
- **Files:** `server/core_services/services/AiProviderService.ts`

### Google Gemini
- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{modelId}:streamGenerateContent`
- **Config:** `GEMINI_API_KEY`
- **Status:** Optional (local Ollama fallback available)
- **Use Case:** Cloud LLM inference (Gemini Pro, Ultra)
- **Rate Limiting:** Built-in circuit breaker (5 retries, 60s cooldown)
- **Files:** `server/core_services/services/AiProviderService.ts`

### Ollama (Local)
- **Endpoint:** `http://localhost:11434/api/chat` (configurable)
- **Config:** `OLLAMA_URL` (default: `http://localhost:11434`)
- **Status:** Default/Required for sovereign mode
- **Use Case:** Local LLM inference (Llama3, Mistral, etc.)
- **Reliability:** Fails gracefully if unavailable
- **Files:** `server/core_services/services/AiProviderService.ts`, `server/routers/ollamaRouter.ts`

### Forge (Internal)
- **Endpoint:** `https://forge.manus.im/v1/chat/completions`
- **Config:** `BUILT_IN_FORGE_API_KEY`, `BUILT_IN_FORGE_API_URL`
- **Status:** Optional
- **Use Case:** Internal Omnecor Forge service for specialized tasks
- **Files:** `server/_core/llm.ts`, `server/_core/imageGeneration.ts`

---

## 2. OAuth & Authentication

### Google OAuth
- **Endpoints:**
  - Authorization: `https://accounts.google.com/o/oauth2/v2/auth`
  - Token Exchange: `https://oauth2.googleapis.com/token`
  - User Profile: `https://www.googleapis.com/oauth2/v3/userinfo`
- **Config:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Status:** Optional (Zero-login mode available)
- **Token Refresh:** Automatic with pre-flight expiry check
- **Files:** `server/_core/oauth.ts`, `server/core_services/services/TokenRefreshService.ts`

### Microsoft OAuth
- **Endpoints:**
  - Authorization: `https://login.microsoftonline.com/common/v2.0/oauth2/authorize`
  - Token Exchange: `https://login.microsoftonline.com/common/v2.0/oauth2/token`
  - User Profile: `https://graph.microsoft.com/v1.0/me`
- **Config:** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
- **Status:** Optional (Zero-login mode available)
- **Token Refresh:** Automatic with pre-flight expiry check
- **Files:** `server/_core/oauth.ts`, `server/core_services/services/TokenRefreshService.ts`

---

## 3. Voice & Speech Services

### ElevenLabs (Cloud TTS)
- **Endpoints:**
  - List Voices: `https://api.elevenlabs.io/v1/voices`
  - Synthesize: `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`
- **Config:** `ELEVENLABS_API_KEY`
- **Status:** Optional (local TTS fallback available)
- **Rate Limiting:** Circuit breaker (5 retries, 60s cooldown)
- **Error Handling:** Safe error wrapping, no PII in responses
- **Files:** `server/core_services/services/ElevenLabsService.ts`

### Whisper (Local STT)
- **Endpoint:** `http://localhost:8001/transcribe` (configurable)
- **Config:** `WHISPER_SERVER_URL` (default: `http://localhost:8001`)
- **Status:** Optional (graceful degradation)
- **Port Configuration:** `WHISPER_SERVER_URL` env var
- **Files:** `server/core_services/services/VoiceService.ts`

### TTS Synthesis (Local)
- **Endpoint:** `http://localhost:8002/synthesize` (configurable)
- **Config:** `TTS_SERVER_URL` (default: `http://localhost:8002`)
- **Status:** Optional (graceful degradation)
- **Port Configuration:** `TTS_SERVER_URL` env var
- **Files:** `server/core_services/services/VoiceService.ts`

### RVC Voice Conversion (Local)
- **Endpoint:** `http://127.0.0.1:8003/convert_voice` (configurable)
- **Config:** `RVC_SERVER_URL` (default: `http://127.0.0.1:8003`)
- **Status:** Optional (graceful degradation)
- **Port Configuration:** `RVC_SERVER_URL` env var
- **Files:** `server/core_services/services/VoiceService.ts`

---

## 4. Image & Video Generation

### FAL.ai (Local Bridges)
- **Endpoints:**
  - Character Generation: `http://localhost:8004/flux-character`
  - Video Generation: `http://localhost:8004/minimax-video`
- **Config:** `FAL_LOCAL_PORT` (default: `8004`)
- **Status:** Optional (graceful degradation)
- **Port Configuration:** `FAL_LOCAL_PORT` env var
- **Files:** `server/core_services/services/FalApiService.ts`

### OpenArt.ai
- **Endpoint:** `https://openart.ai/api/v1/image_request`
- **Config:** `OPENART_API_KEY`
- **Status:** Optional
- **Rate Limiting:** Circuit breaker via `apiClient` wrapper
- **Error Handling:** Safe error wrapping, no sensitive data in responses
- **Files:** `server/core_services/services/OpenArtService.ts`

### ComfyUI (Local)
- **Endpoints:**
  - Prompt: `http://127.0.0.1:8188/prompt`
  - Queue: `http://127.0.0.1:8188/queue`
  - Stats: `http://127.0.0.1:8188/system_stats`
  - Interrupt: `http://127.0.0.1:8188/interrupt`
- **Config:** `COMFYUI_URL`, `COMFYUI_PORT` (defaults: `http://127.0.0.1:8188`)
- **Status:** Optional (graceful degradation)
- **Port Configuration:** `COMFYUI_PORT` env var
- **Files:** `server/core_services/services/ComfyService.ts`

---

## 5. Cloud Compute Rental

### Vast.ai
- **Endpoints:**
  - Start Instance: `https://console.vast.ai/api/v0/asks/0/` (PUT)
  - Stop Instance: `https://console.vast.ai/api/v0/instances/{externalId}/` (DELETE)
- **Config:** `VASTAI_API_KEY`
- **Status:** Optional
- **Rate Limiting:** Circuit breaker (5 retries, 60s cooldown)
- **Transaction Safety:** Atomic with idempotency keys
- **Billing:** Only recorded after provider confirms termination
- **Files:** `server/routers/cloudComputeRouter.ts`

### RunPod
- **Endpoints:**
  - Start Pod: `https://rest.runpod.io/v1/pods` (POST)
  - Stop Pod: `https://rest.runpod.io/v1/pods/{externalId}/stop` (POST)
- **Config:** `RUNPOD_API_KEY`
- **Status:** Optional
- **Rate Limiting:** Circuit breaker (5 retries, 60s cooldown)
- **Transaction Safety:** Atomic with idempotency keys
- **Billing:** Only recorded after provider confirms termination
- **Files:** `server/routers/cloudComputeRouter.ts`

### Lambda Labs
- **Endpoints:**
  - Start Instance: `https://cloud.lambdalabs.com/api/v1/instance-operations/launch` (POST)
  - Stop Instance: `https://cloud.lambdalabs.com/api/v1/instance-operations/terminate` (POST)
- **Config:** `LAMBDA_API_KEY`
- **Status:** Optional
- **Rate Limiting:** Circuit breaker (5 retries, 60s cooldown)
- **Transaction Safety:** Atomic with idempotency keys
- **Billing:** Only recorded after provider confirms termination
- **Files:** `server/routers/cloudComputeRouter.ts`

---

## 6. Payment & Virtual Cards

### Lithic
- **Endpoint:** `https://api.lithic.com/v1/cards` (POST)
- **Config:** `LITHIC_API_KEY`
- **Status:** Optional (Agentic Wallet feature)
- **Rate Limiting:** Circuit breaker (5 retries, 60s cooldown)
- **Error Handling:** **Critical** — PAN/CVV never exposed in errors or logs
  - Raw errors logged internally with `redactSensitive()`
  - Users see safe `CardOperationError`
  - Audit trail recorded for compliance
- **Encryption:** Card PAN encrypted immediately with AES-256-GCM; plaintext never stored
- **Files:** `server/core_services/services/VirtualCardService.ts`, `server/routers/virtualCardRouter.ts`

---

## 7. Hardware Manufacturing

### PCBWay
- **Endpoints:**
  - Get Quote: `https://api.pcbway.com/api/order/GetQuote` (POST)
  - Place Order: `https://api.pcbway.com/api/order/PlaceOrder` (POST)
  - Check Status: `https://api.pcbway.com/api/order/GetOrderStatus` (GET)
- **Config:** `PCBWAY_API_KEY`, `PCBWAY_PARTNER_ID`
- **Status:** Optional
- **Rate Limiting:** Circuit breaker via `apiClient` wrapper
- **Error Handling:** Safe error wrapping, no sensitive data in responses
- **Files:** `server/core_services/services/PCBWayService.ts`

---

## 8. Vector Search & Memory

### ChromaDB
- **Endpoint:** `http://localhost:8000/api/v1/heartbeat` (and other vector ops)
- **Config:** `CHROMADB_URL` (default: `http://localhost:8000`)
- **Status:** Optional (memory features degrade gracefully)
- **Health Check:** Monitored on startup and during operations
- **Files:** `server/core_services/services/VectorDBService.ts`, `server/routers/knowledgeBase.ts`

---

## 9. Workflow Automation

### n8n
- **Endpoint:** `http://localhost:5678/` (configurable)
- **Config:** `N8N_URL` (default: `http://localhost:5678`)
- **Status:** Optional (graceful degradation)
- **Files:** Workflow execution via n8n REST API

### Valet Router (Local)
- **Endpoint:** `http://127.0.0.1:8010/route` (configurable)
- **Config:** `VALET_ROUTER_URL` (default: `http://127.0.0.1:8010`)
- **Status:** Optional (keyword fallback mode available)
- **Port Configuration:** `VALET_ROUTER_URL` env var
- **Files:** `server/core_services/services/ValetRouterService.ts`

### Local LLM Runtime — `llama-server` (Local)
- **What:** Omnecor's own managed `llama-server` subprocess (llama.cpp, OpenAI-compatible) — supervised by `LocalLlmRuntimeService`. Replaced the standalone `llamacpp_bridge.py` (port 8013), which was retired once MoE-Chain moved onto this runtime.
- **Endpoints (managed):** `/health`, `/completion`, `/apply-template` on the runtime's base URL (default `http://127.0.0.1:8014`).
- **Config:** `LLAMA_SERVER_BIN`, `LOCAL_LLM_MODEL_PATH`, `LOCAL_LLM_GPU_LAYERS`
- **Status:** Optional (Ollama-independent; the app serves local inference itself when a `.gguf` + `llama-server` binary are present).
- **Files:** `server/core_services/services/LocalLlmRuntimeService.ts`

### MAS Bridge (Local)
- **Endpoints:**
  - Run: `http://127.0.0.1:8011/run`
  - Status: `http://127.0.0.1:8011/status/{jobId}`
  - Stop: `http://127.0.0.1:8011/stop/{jobId}`
- **Config:** `MAS_BRIDGE_PORT` (default: `8011`)
- **Status:** Optional (graceful degradation)
- **Port Configuration:** `MAS_BRIDGE_PORT` env var
- **Files:** `server/core_services/services/AgentService.ts`

---

## 10. Threat Intelligence

### MISP
- **Endpoint:** `https://your-misp-instance.internal/attributes/restSearch.json` (POST)
- **Config:** `MISP_URL`, `MISP_AUTH_KEY`
- **Status:** Optional (returns empty array if unconfigured)
- **Use Case:** Indicators of Compromise (IoC) threat feed
- **Files:** `server/core_services/services/ThreatIntelService.ts`

---

## 11. Collaboration & Integration

### Notion
- **Endpoint:** `https://api.notion.com/v1/oauth/token` (POST)
- **Config:** `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- **Status:** Optional
- **Token Refresh:** Automatic via `TokenRefreshService`
- **Files:** `server/core_services/services/TokenRefreshService.ts`

### Honcho (Plastic Labs)
- **Endpoints:** (Configured externally, uses Honcho SDK)
- **Config:** `HONCHO_API_KEY`, `HONCHO_APP_NAME`, `HONCHO_ENVIRONMENT`
- **Status:** Optional (degrades silently if unconfigured)
- **Use Case:** Cross-session user memory and conversation history
- **Files:** `server/core_services/services/HonchoService.ts`

---

## Configuration Reference

### Environment Variables

```bash
# ============ AI PROVIDERS ============
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GEMINI_API_KEY=...
XAI_API_KEY=...
OLLAMA_URL=http://localhost:11434

# ============ OAUTH / AUTH ============
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...

# ============ VOICE / SPEECH ============
ELEVENLABS_API_KEY=...
WHISPER_SERVER_URL=http://localhost:8001
TTS_SERVER_URL=http://localhost:8002
RVC_SERVER_URL=http://127.0.0.1:8003

# ============ IMAGE / VIDEO ============
OPENART_API_KEY=...
FAL_LOCAL_PORT=8004
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_PORT=8188

# ============ CLOUD COMPUTE ============
VASTAI_API_KEY=...
RUNPOD_API_KEY=...
LAMBDA_API_KEY=...

# ============ PAYMENT / FINANCE ============
LITHIC_API_KEY=...
PCBWAY_API_KEY=...
PCBWAY_PARTNER_ID=...

# ============ VECTOR / MEMORY ============
CHROMADB_URL=http://localhost:8000

# ============ WORKFLOW / AUTOMATION ============
N8N_URL=http://localhost:5678
VALET_ROUTER_URL=http://127.0.0.1:8010
MAS_BRIDGE_PORT=8011

# ============ THREAT INTELLIGENCE ============
MISP_URL=https://your-misp-instance.internal
MISP_AUTH_KEY=...

# ============ COLLABORATION ============
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
HONCHO_API_KEY=...
HONCHO_APP_NAME=omnecor
HONCHO_ENVIRONMENT=demo

# ============ INTERNAL ============
BUILT_IN_FORGE_API_URL=https://forge.manus.im
BUILT_IN_FORGE_API_KEY=...
```

---

## Troubleshooting

### Circuit Breaker Open
**Symptom:** API calls failing with "Circuit breaker OPEN"

**Cause:** 5+ consecutive API failures

**Recovery:**
1. Check service health: `curl http://localhost:3000/health`
2. Verify API credentials are correct
3. Wait 60 seconds for circuit to enter half-open state
4. Circuit will attempt recovery automatically

### Missing API Key
**Symptom:** "OPENAI_API_KEY not configured" error

**Solutions:**
1. Add the key to `.env`: `OPENAI_API_KEY=sk-...`
2. Restart the server: service sees updated config at startup
3. For optional APIs, use a local fallback (e.g., Ollama instead of OpenAI)

### Token Refresh Failures
**Symptom:** OAuth calls failing with "Token refresh failed"

**Cause:** 
- Token revocation (user revoked app access)
- Expired refresh token (older than 90 days typically)
- Network issues

**Recovery:**
- OAuth UI will prompt user to re-authenticate
- No manual intervention needed — automatic flow

### Local Service Unavailable
**Symptom:** "Whisper server unavailable" or "ComfyUI connection refused"

**Cause:** Local microservice not running on configured port

**Recovery:**
1. Verify service is running: `ps aux | grep whisper`
2. Check port configuration: `WHISPER_SERVER_URL=http://localhost:8001`
3. Verify no port conflicts: `lsof -i :8001`
4. Restart service and Omnecor

---

## Related Documentation

- [SECURITY_FEATURES.md](../user-guides/SECURITY_FEATURES.md) — Security hardening for all APIs
- [SERVICES_OVERVIEW.md](./SERVICES_OVERVIEW.md) — Internal service architecture
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — Audit log schema for API operations
- [AGENTIC_WALLET.md](../wallet/AGENTIC_WALLET.md) — Payment and spending controls
- [EXTERNAL_ENDPOINTS_AUDIT.md](../../EXTERNAL_ENDPOINTS_AUDIT.md) — Complete endpoint inventory
