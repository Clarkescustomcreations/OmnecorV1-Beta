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

The 1.5B Valet Router handles automatic local/cloud routing decisions at inference time without any cloud call for the routing decision itself.

### 2.1. Valet Routing Modes in Scrapper Mode

Within Scrapper Mode, the Valet Router offers granular control over *how* tasks are dispatched. These are configured independently from the Execution Mode under **Settings → Valet Router**:

| Mode | Description |
|---|---|
| `api_direct` | Bypass Valet for main tasks; direct provider calls only |
| `valet_background` | Valet manages housekeeping only; main inference goes direct |
| `local_omesh` | Route all inference to OMMESH peer nodes (requires active mesh) |
| `main_api` | Single primary API or subscription handles all tasks |
| `multi_api` | Distribute tasks across multiple user-configured APIs/subscriptions |
| `main_api_omesh` | Primary API for main work + OMMESH for parallel background tasks |
| `multi_api_omesh` | Multiple APIs + OMMESH nodes — maximum capability |
| `moe_chain` | Sequential chain through custom LLM-Builder fine-tuned models |
| `moe_chain_omesh` | MoE chain on main PC + OMMESH (OMMESH dispatched first) |
| `multi_task` | *(Advanced/High-spec only)* Simultaneous multi-model execution |

See [VALET_ROUTER.md](VALET_ROUTER.md) for complete details on each mode.

### 2.2. Guided Walk-Through Scrapper Mode

When automated routing or web scraping fails — or the user has no active API keys — Scrapper Mode falls back to **Guided Walk-Through** operation:

1. The 1.5B Valet (and/or an OMMESH model if available) acknowledges the routing failure
2. It analyzes the task using local inference only
3. It creates a detailed, copy-paste-ready prompt instruction set
4. It recommends the best free-tier web UI for the task type
5. It walks the user through submitting the prompt to that external UI
6. The user pastes the result back into Omnecor
7. The Valet integrates the result into the active project and continues the workflow

This ensures **zero workflow dead-ends** — even with no API keys, no subscriptions, and no OMMESH network, the Valet keeps projects moving by leveraging free web interfaces as the inference layer.

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

## 4. Interaction Between Execution Mode and Valet Routing Mode

Execution Mode and Valet Routing Mode are two separate settings that work together:

| Execution Mode | Effect on Valet Routing |
|---|---|
| **Sovereign** | All `cloudProcedure` calls are blocked. Valet routing modes that require cloud providers (`main_api`, `multi_api`, `main_api_omesh`, `multi_api_omesh`) will fail at the middleware layer. Only `local_omesh`, `moe_chain`, `moe_chain_omesh` (local portion), and `valet_background` (no cloud) are functional. |
| **Scrapper** | All routing modes are available. Cloud is used as needed per the selected Valet mode. |
| **Big Spender** | All routing modes are available. Cloud providers are preferred by default; local models are available as manual overrides. |

**Practical rule:** Setting Execution Mode to Sovereign automatically constrains which Valet routing modes are usable. The UI will indicate which routing modes are incompatible with the current Execution Mode.

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
