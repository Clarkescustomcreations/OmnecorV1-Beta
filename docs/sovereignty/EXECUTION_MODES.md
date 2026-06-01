# Omnecor Execution Modes

Omnecor operates in three distinct Execution Modes that balance computational power with data privacy. The selected mode is persisted to `users.executionMode` in the database and enforced server-side by the `sovereignCheck` middleware in `server/_core/trpc.ts`.

## Mode Overview

| Mode | Badge | Default | Cloud Calls | Use Case |
|---|---|---|---|---|
| Sovereign | 🔴 Red Lock | No | Blocked | Classified / sensitive data work |
| Scrapper | ⚡ Green Zap | **Yes** | Fallback only | Daily development, standard tasks |
| Big Spender | 🔥 Amber Flame | No | Preferred | Production runs, complex reasoning |

---

## 1. Sovereign Mode

**Privacy-first. Zero cloud leakage.**

All tRPC procedures tagged with `cloudProcedure` metadata are blocked at the middleware layer before any procedure body executes. This means even if the frontend sends a request for a cloud model, the backend rejects it with `FORBIDDEN` — no data leaves the machine.

**Enforcement chain:**
```
Client Request → tRPC Router → sovereignCheck() → FORBIDDEN (if sovereign)
                                                → Procedure Body (if scrapper/big_spender)
```

**Auto-enforced when:**
- `ZERO_LOGIN_MODE=true` is set in `.env`
- The user manually selects Sovereign Mode via the header badge or Settings

**Features available in Sovereign Mode:**
- All local Ollama and Llama.cpp inference
- Neural Brain Map
- Hardware Bridges (Blender, KiCad, ESPTool)
- Voice Pipeline (local Whisper + XTTS-v2)
- OMMESH (LAN-only, no external calls)
- Audit Log (local reads)
- Agentic Wallet (spend tracking only; no Lithic card calls)

**Features blocked in Sovereign Mode:**
- OpenAI, Anthropic, Gemini, Fal.ai inference
- Lithic virtual card issuance
- ElevenLabs TTS
- Any `cloudProcedure`-tagged tRPC endpoint

---

## 2. Scrapper Mode (Default)

**Efficiency-first. Local-preferred, cloud as fallback.**

The system attempts to fulfill every request with a locally available model. Cloud providers are only invoked when:
1. No local model can handle the requested capability (e.g., Fal.ai video generation has no local equivalent).
2. The user explicitly selects a cloud model from the Model Hub.
3. A pipeline step specifies a cloud-only tool.

The Valet Router (when trained) handles automatic local/cloud routing decisions at inference time without any cloud call for the routing decision itself.

---

## 3. Big Spender Mode

**Quality-first. Cloud models preferred.**

High-performance cloud models (GPT-4o, Claude Sonnet/Opus, Gemini Ultra) are selected by default for all inference tasks. Local models are available as manual overrides.

**When to use:**
- Final production content generation
- Complex multi-step reasoning chains
- Tasks requiring the highest available intelligence tier
- Large-scale media generation via Fal.ai

**Budget awareness:** Big Spender Mode increases cloud spend significantly. Configure a project budget in the Agentic Wallet before running long agentic workflows in this mode.

---

## Switching Modes

### Via UI
Click the mode badge in the application header (🔴/⚡/🔥) to cycle through modes, or navigate to **Settings → Execution Mode** for a full description of each option.

### Via Command Palette
Press `Ctrl+K` and type "execution mode" to search for the mode-switching action.

### Via API
```typescript
await trpc.system.setExecutionMode.mutate({ mode: 'sovereign' | 'scrapper' | 'big_spender' });
```

The change takes effect immediately for all subsequent requests in the same session.

---

## `sovereignCheck` Middleware

Source: `server/_core/trpc.ts`

```typescript
export const cloudProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.user?.executionMode === 'sovereign') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Cloud procedures are disabled in Sovereign Mode.',
    });
  }
  return next();
});
```

Any procedure that calls a third-party cloud service must use `cloudProcedure` instead of the base `publicProcedure` or `protectedProcedure`. This is enforced by code review — see `CONTRIBUTING.md` for the PR checklist.

---

## Sovereignty Manifest

The following data is **guaranteed to never leave your machine** in any Execution Mode:

| Data Type | Local Storage | Notes |
|---|---|---|
| Chat history | MySQL/TiDB (local) | Never synced to cloud |
| Project files | Local filesystem | Only processed locally |
| Vector embeddings | ChromaDB (local) | Embeddings generated locally |
| Audit logs | MySQL/TiDB (local) | Admin-only access |
| API keys | `.env` file (local) | Never logged, redacted before audit entries |

In **Sovereign Mode**, additionally, no inference payload is sent to any external provider.
