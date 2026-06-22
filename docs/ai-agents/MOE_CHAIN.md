# MoE Chain (Mixture-of-Experts Chain)

MoE Chain is a sequential multi-model routing feature in Omnecor. Instead of sending a single message to a single model, MoE Chain passes the user's input through an ordered pipeline of specialist models, where each step's output becomes context for the next step. The result is a cumulative, expert-reviewed response built in stages.

## Why MoE Chain Exists

Consumer-grade workstations — particularly systems with 8–16 GB RAM — cannot hold multiple large language models in memory simultaneously. Standard multi-model approaches either require enough VRAM for all models at once, or rely on expensive cloud inference for each model. MoE Chain addresses both constraints:

- **For local hardware:** One GGUF model loads, does its work, unloads, and the next loads. No step occupies more RAM than the largest model in the chain.
- **For cloud providers:** When running in cloud mode, the chain calls providers sequentially without spinning up additional local compute, allowing specialization without parallelism overhead.

---

## Chain Types

Two chain types are supported. Each is stored as a separate row in the `moe_chain_configs` table keyed by `(userId, chainType)`.

### Local Chain — `moe_chain`

- **Models:** GGUF files served by `llamacpp_bridge.py` on port 8013.
- **RAM conservation:** Between each step, `LlamaCppService.unload()` is called on the current model before `preWarm()` loads the next. Only one model occupies memory at any time.
- **Hardware target:** 8–16 GB RAM machines with locally-stored GGUF specialist models.
- **Sovereign mode:** Allowed. Local inference only; no external calls.

### Cloud Chain — `moe_chain_omesh`

- **Models:** Cloud API providers (Anthropic, OpenAI, or any provider configured in the user's AI provider list). Despite the `_omesh` suffix in the routing-mode ID, this chain type in the Settings UI represents cloud-provider chaining, not a literal OMMESH peer chain.
- **Execution:** Sequential calls to cloud providers, one step at a time.
- **Sovereign mode:** **Blocked.** `AiProviderService.streamChat()` routes `moe_chain_omesh` through `cloudProcedure` semantics; users in `sovereign` execution mode will receive a FORBIDDEN error when attempting to run this chain type.

---

## Architecture

```
User message
     │
     ▼
Chat.tsx — detects "moe-chain" routing mode
     │
     ▼
aiRouter.ts — chatInputSchema includes routingMode + userId
     │
     ▼
AiProviderService.streamChat() — moe_chain / moe_chain_omesh branch
     │
     ▼
MoeChainService.runChain()
     │
     ├─► Step 1 (knowledge_retrieval)
     │     └─ LlamaCppService or AiProviderService per step
     │         • Local: llamacpp_bridge.py (port 8013) — load → infer → unload
     │         • Cloud: cloud API provider call
     │
     ├─► Step 2 (research) — receives Step 1 output as context
     │
     ├─► Step 3 (code_generation) — receives Steps 1–2 output
     │
     │   … (remaining steps in order)
     │
     └─► Final step output returned to client
```

### Key Services

| Service | File | Role |
|---|---|---|
| `MoeChainService` | `server/phase2/services/MoeChainService.ts` | Sequential executor — loops over steps, manages context accumulation |
| `LlamaCppService` | `server/phase2/services/LlamaCppService.ts` | llama.cpp bridge; `unload()` frees model RAM; `preWarm()` loads the next model |
| `AiProviderService` | `server/phase2/services/AiProviderService.ts` | Cloud branch in `streamChat()` handles `moe_chain_omesh` steps |

### Database

Table: `moe_chain_configs` in `drizzle/schema.ts` (Drizzle sqlite-core).  
Columns: one row per `(userId, chainType)` storing the full `MoeChainStep[]` array as JSON and an `enabled` flag.

The `MoeChainStep` interface (also in `drizzle/schema.ts`) defines:
- `modelId` — the GGUF file path (local) or provider model ID (cloud)
- `taskCategories` — which Valet categories this step applies to (empty = always runs)
- `systemPrompt` — optional per-step system prompt override

---

## Logical Task Order

Steps are executed in this hardcoded order (enforced in `valetRouter.ts`):

| Order | Task Category |
|---|---|
| 1 | `knowledge_retrieval` |
| 2 | `research` |
| 3 | `code_generation` |
| 4 | `code_review` |
| 5 | `integration` |
| 6 | `synthesis` |
| 7 | `reporting` |

This order mirrors the natural flow of a complex engineering task: first retrieve background knowledge, then research the problem space, generate code, review it, integrate it, synthesize a final answer, and report to the user.

---

## Step Skipping

Each step has an optional `taskCategories` array. The Valet Router classifies the incoming user message into one of 13 categories (see `docs/ai-agents/VALET_ROUTER.md` §6). When a step's `taskCategories` is **non-empty**, the step only executes if the Valet's classification matches one of those categories. If the classification does not match, the step is skipped and the chain advances to the next step.

When `taskCategories` is **empty**, the step always runs regardless of classification.

This allows a chain to be configured such that, for example, the `code_generation` step only fires when the Valet classifies the task as `code_generation` or `code_review`, while a `synthesis` step always runs to summarize the final result.

---

## Setup

### Step 1 — Initialize via Slash Command

In the Omnecor chat, type one of:

| Command | Effect |
|---|---|
| `/MOE-Chain` | Initialize both local and cloud chains |
| `/MOE-Chain L` | Initialize local chain only |
| `/MOE-Chain C` | Initialize cloud chain only |

On the first run, `Chat.tsx` dispatches the `moe-chain` command to `Chat.tsx`'s `handleCommand()`, which calls the `valet.initMoeChain` tRPC procedure. This procedure:
1. Scans `~/.omnecor/models/` for GGUF files via `valet.scanLocalModels`.
2. Seeds the `moe_chain_configs` table with a default local chain populated from discovered GGUFs.
3. Creates two project files in the current project root:
   - `MOE-Chain-L.md` — local chain configuration reference
   - `MOE-Chain-C.md` — cloud chain configuration reference

These project files are auto-generated by `initMoeChain`. They document the chain's current step configuration and can be committed to the project for team reference. They are regenerated if you run the command again.

### Step 2 — Configure via Settings

Navigate to **Settings → Valet Router → MoE Chain** to open the `MoeChainPanel`.

From this panel you can:
- Enable or disable each chain type independently.
- Add, remove, and reorder steps using the step editor rows.
- Set the model for each step (GGUF path for local; model ID for cloud).
- Assign `taskCategories` to each step to configure skipping.
- Save changes via `valet.saveMoeChain`.

### Step 3 — Activate the Routing Mode

Change the active routing mode to **MoE Chain (No OMMESH)** (`moe_chain`) or **MoE Chain + OMMESH** (`moe_chain_omesh`) via **Settings → Valet Router → Active Routing Mode**, or from the header routing mode menu. Once active, all chat messages are routed through the chain.

---

## RAM Conservation Details (Local Chain)

`MoeChainService` calls `LlamaCppService.unload(previousModelId)` before each step transition. This posts to `llamacpp_bridge.py`'s `/unload` endpoint, which removes the model from the bridge's warm cache and frees the memory held by the `Llama` instance. The next model is then loaded fresh via `LlamaCppService.preWarm(nextModelId)`, which calls the `/load` endpoint.

The net effect: at any moment during local chain execution, only one GGUF model occupies RAM. A chain of seven 4-bit quantized 7B models (each ~4 GB) can run on a machine with 8 GB RAM without out-of-memory failures.

This approach trades latency (each model load takes several seconds) for RAM headroom. It is the correct trade-off for the target hardware profile.

---

## Sovereign Mode Interaction

| Chain type | Sovereign mode |
|---|---|
| `moe_chain` (local) | Allowed — all inference stays on-device via llamacpp_bridge.py |
| `moe_chain_omesh` (cloud) | Blocked — calls cloud providers; `assertProviderAllowedInMode()` in `AiProviderService` throws FORBIDDEN |

---

## Key File Locations

| File | Purpose |
|---|---|
| `drizzle/schema.ts` | `moeChainConfigs` table + `MoeChainStep` interface |
| `server/phase2/services/MoeChainService.ts` | Sequential chain executor |
| `server/phase2/services/LlamaCppService.ts` | `unload()` + `preWarm()` for RAM management |
| `server/phase2/services/AiProviderService.ts` | `streamChat()` MoE branch (cloud chain) |
| `server/routers/valetRouter.ts` | `getMoeChain`, `saveMoeChain`, `initMoeChain`, `scanLocalModels` tRPC procedures |
| `server/routers/aiRouter.ts` | `chatInputSchema` — `routingMode` + `userId` fields |
| `client/src/components/settings/MoeChainPanel.tsx` | Two-card settings UI |
| `client/src/components/settings/ValetRouterPanel.tsx` | Hosts MoeChainPanel |
| `client/src/components/chat/ChatInput.tsx` | `/MOE-Chain [L|C]` slash command parsing |
| `client/src/pages/Chat.tsx` | `moe-chain` case in `handleCommand()` |

---

## Related Documentation

- [VALET_ROUTER.md](VALET_ROUTER.md) — Routing mode overview; §3.8 and §3.9 describe `moe_chain` and `moe_chain_omesh`
- [EXECUTION_MODES.md](../sovereignty/EXECUTION_MODES.md) — Sovereign/Scrapper/Big Spender interaction with routing
- [valet-training/MODEL_ROUTING_GUIDE.md](valet-training/MODEL_ROUTING_GUIDE.md) — Valet task classification taxonomy
