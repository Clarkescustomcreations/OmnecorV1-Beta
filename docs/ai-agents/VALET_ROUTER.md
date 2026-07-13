# Omnecor Valet Router

The Valet Router is the intelligent dispatch layer for all tasks in Omnecor. It runs entirely on the user's machine — no cloud call is ever made for the routing decision itself. Every incoming user request passes through the Valet first; it classifies the task, selects the optimal model or chain, and dispatches accordingly.

**How it works:** The router is powered by a **Qwen2.5-1.5B-Instruct** model fine-tuned as a routing classifier using the `pnpm valet:build` pipeline (dataset generation → LoRA training → GGUF export → eval gate). The trained model is distributed as a pre-built GGUF artifact via GitHub Releases. The inference bridge (`server/python_bridges/valet_router_inference.py`) serves it on port 8010 via one of three backends, selected by the `format` field in `models/valet-router/current.json`: `gguf` (llama-cpp-python), `ollama` (local Ollama REST API), or `merged_16bit`/`lora` (HuggingFace transformers). The app auto-starts the inference server on launch when an artifact is registered (`status: ready`).

> **Serving on older CPUs / current deployment (2026-06-11):** On machines without AVX2 (e.g. Sandy Bridge), prebuilt `llama-cpp-python` wheels crash, and transformers serving is slow. The current deployment therefore serves the Q8_0 GGUF through **Ollama** (model `omnecor-valet-router:v2-q8`, `format: "ollama"`), which warm-routes in ~2–3 s. See **[`valet-training/SERVING.md`](valet-training/SERVING.md)** for the full serving runbook, registry configuration, verification steps, and known gotchas.

**Fallback behavior:** When no trained artifact is present (first install before running `scripts/fetch-valet-model.sh`, or when `VALET_AUTO_START=false`), the router falls back to keyword-rule-based routing. This is fully documented and observable — the server logs mark every fallback call. The Settings → Valet Router panel shows distinct status badges for Online/Loaded, Online/Loading, and Offline states.

**Obtaining the model:**
```bash
# Download the pre-built artifact for the current release (recommended)
bash scripts/fetch-valet-model.sh

# Or build from scratch on a GPU box (≥8 GB VRAM)
pnpm valet:build
```

> **Note:** All model names used in this document (Grok, Gemini, Claude, GPT-4o, etc.) are illustrative examples. Omnecor is provider-agnostic — you bring your own API keys or subscriptions.

---

## 1. Hardcoded Rules (Always Active)

These rules are enforced by the Valet Router regardless of routing mode or user configuration. They cannot be disabled.

### 1.1. Project Bootstrap Files

**Every task or project must begin by creating two files:**

| File | Purpose |
|---|---|
| `todo.md` | Task list with item descriptions and completion status |
| `status.md` | Project goal, current phase, and overall progress summary |

The Valet will not proceed with any substantive task until these files exist in the project root. If they are missing, the Valet creates them (prompting the user for initial content) before routing the first task.

These files are **updated after every completed task** to maintain a living record of project state.

### 1.2. `/plan` Mode — Project Documentation Suite

When the user activates `/plan` mode, the Valet Router enters a guided planning session. It asks structured questions, makes suggestions based on loaded Neural Brain Map context, and helps the user build a `project-docs/` folder containing:

| Document | Purpose |
|---|---|
| `PRD.md` | Product/Project Requirements Document — the canonical definition of what is being built and why |
| `Feature-Plan.md` | Detailed breakdown of features, acceptance criteria, and implementation order |
| `Voice-Tone.md` | Communication style, tone, brand voice, and persona guidelines |
| `Design-Preferences.md` | Visual language, UI patterns, color philosophy, and aesthetic constraints |
| `Rules/standards.md` | Coding standards, architectural rules, naming conventions, and quality gates |

**Maintenance:** These documents are considered the highest-priority context sources. The Valet actively offers to update them after significant tasks complete — e.g., "Task complete. Should I update `Feature-Plan.md` to mark this section done?"

**Reusable Skills:** After completing notable or repeatable tasks, the Valet offers to package the approach as a reusable skill — a named, parameterized workflow that can be invoked in any future project with a single command.

---

## 2. Routing Mode Overview

The Valet Router supports ten distinct routing modes. The active mode is stored per-user in the database (`users.valetMode`) and can be changed at any time from the header menu or Settings → Valet Router.

| Mode | ID | Description |
|---|---|---|
| API Direct | `api_direct` | Bypass the Valet entirely. Requests go directly to the user's chosen provider. Valet performs no routing. |
| Valet Background Only | `valet_background` | Valet handles only background/housekeeping tasks (todo updates, status tracking, skill generation). Main chat and project tasks go direct to provider. |
| Local OMMESH | `local_omesh` | Route all inference to the user's configured OMMESH local network models. Requires an active OMMESH mesh with at least one peer node. |
| Main API Only | `main_api` | Route all tasks through the user's single primary API or subscription (e.g., one Claude Pro account, one OpenAI API key). |
| Multi-API | `multi_api` | Distribute tasks across multiple user-provided APIs or subscriptions. The Valet selects the best-suited provider per task type. |
| Main API + OMMESH | `main_api_omesh` | Primary API handles main inference; OMMESH nodes handle parallel background or secondary tasks. |
| Multi-API + OMMESH | `multi_api_omesh` | Full combination: multiple providers + OMMESH nodes. Maximum capability and redundancy. |
| MoE Chain (No OMMESH) | `moe_chain` | Sequential chain through the user's custom fine-tuned LLM-Builder models. Tasks are sent one-by-one down the chain to the most relevant model, conserving compute by running only one model at a time. |
| MoE Chain + OMMESH | `moe_chain_omesh` | Chain runs on the main PC *and* OMMESH nodes simultaneously. **OMMESH tasks must be dispatched first** so the Valet retains the compute headroom needed for local chain routing before starting the main PC chain. |
| Multi-Task | `multi_task` | *(Settings menu only — rarely used)* Runs multiple models simultaneously on the main PC. Requires extreme hardware specs. Future-proofing for high-spec power users only. |

---

## 3. Routing Mode Details

### 3.1. API Direct (`api_direct`)

The Valet is completely bypassed for chat and project tasks. The user's selected provider receives requests unmodified. The hardcoded rules (todo.md / status.md) are still enforced — these are session-level rules, not routing-level.

**Use when:** You want zero latency overhead and are handling your own prompt engineering.

---

### 3.2. Valet Background Only (`valet_background`)

The Valet runs invisibly in the background, maintaining project files, updating `todo.md` and `status.md`, suggesting skill packaging, and running housekeeping tasks. All main chat and project inference goes directly to the provider.

**Use when:** You want the project-management discipline of the Valet without it touching your main inference flow.

---

### 3.3. Local OMMESH (`local_omesh`)

All inference is routed to OMMESH peer nodes. The Valet selects the peer with the most available VRAM for the task. Requires a configured OMMESH mesh with at least one peer running an inference-capable model.

**Use when:** You want fully local, distributed inference across your own hardware network without any cloud dependency.

---

### 3.4. Main API Only (`main_api`)

Single-provider routing. The Valet analyzes each task and crafts the optimal prompt for your one configured provider. Useful for users with a single high-capability subscription (e.g., Claude Pro or a high-tier OpenAI key).

**Use when:** You have one premium API account and want the Valet to maximize its use across diverse task types.

---

### 3.5. Multi-API (`multi_api`)

The Valet routes each task to the most suitable provider from a pool of user-configured APIs and subscriptions. Task classification (research, coding, synthesis, media, etc.) determines which provider is selected for each step.

**Example pool:** Claude (code + reasoning), Gemini (research + synthesis), Grok (current events + analysis), OpenAI (writing + structured output).

**Use when:** You have multiple API subscriptions or accounts and want the Valet to extract maximum specialization from each.

---

### 3.6. Main API + OMMESH (`main_api_omesh`)

Your primary cloud API handles the main inference thread. OMMESH peer nodes handle parallel secondary tasks (e.g., background indexing, context retrieval, sub-agent research).

**Use when:** You want cloud quality for primary tasks with local compute handling the support work.

---

### 3.7. Multi-API + OMMESH (`multi_api_omesh`)

The fullest routing mode. Multiple cloud providers handle specialized tasks in parallel; OMMESH nodes handle additional parallel workloads. The Valet orchestrates all threads simultaneously.

**Use when:** You have a fully equipped setup — multiple API subscriptions + a local OMMESH network — and want maximum throughput on complex multi-domain projects.

---

### 3.8. MoE Chain — No OMMESH (`moe_chain`)

Designed for users who have multiple specialist GGUF models on their local machine. The Valet creates a sequential processing chain: each model handles the specific sub-task it was specialized for, then passes its output as context to the next model in the chain.

**Key constraint:** Only one model runs at a time to conserve RAM. Between each step, Omnecor's managed `llama-server` runtime hot-swaps to the next model (`LocalLlmRuntimeService.ensureModelLoaded` — stop current → spawn next), so the swap itself frees the prior model's RAM. This allows chains of large models to run on 8–16 GB machines.

**Logical step order** (hardcoded in `valetRouter.ts`):
`knowledge_retrieval` → `research` → `code_generation` → `code_review` → `integration` → `synthesis` → `reporting`

**Step skipping:** Steps whose `taskCategories[]` is non-empty are skipped when the Valet's task classification does not match any listed category. Steps with an empty `taskCategories` always run.

**Sovereign mode:** Allowed — all inference stays on-device via the managed `llama-server` runtime (`LocalLlmRuntimeService`).

**Setup:** Run `/MOE-Chain L` in chat to initialize, then configure steps at **Settings → Valet Router → MoE Chain**.

**Use when:** You have 2+ locally-stored GGUF specialist models and want sequential expert-pipeline routing without parallel GPU/RAM load.

> See [`docs/ai-agents/MOE_CHAIN.md`](MOE_CHAIN.md) for the full implementation reference.

---

### 3.9. MoE Chain + OMMESH (`moe_chain_omesh`)

Chains through cloud API providers (Anthropic, OpenAI, or any configured provider) sequentially. Despite the `_omesh` suffix in the mode ID, this chain type in the Settings UI represents cloud-provider chaining rather than a literal OMMESH peer chain. Each step calls the cloud provider assigned to that step; the previous step's output becomes context for the next.

**Critical sequencing rule:** OMMESH tasks **must be dispatched and started first**. This ensures the Valet retains the local compute budget needed for the routing calculation before the local chain begins. Starting the local chain first would starve the routing layer of resources.

**Execution order:**
1. Valet dispatches all OMMESH node tasks (network inference begins)
2. Valet starts the cloud MoE chain (Step 1 → cloud provider A → output)
3. Chain continues (output → provider B → output → provider C…)
4. OMMESH results return asynchronously and merge with chain output

**Sovereign mode:** **Blocked.** Cloud inference is forbidden in `sovereign` execution mode. Attempting to activate this chain type while sovereign returns a FORBIDDEN error.

**Setup:** Run `/MOE-Chain C` in chat to initialize, then configure steps at **Settings → Valet Router → MoE Chain**.

**Use when:** You want sequential specialist AI pipeline routing via cloud providers on a task that benefits from distinct provider strengths at each stage.

> See [`docs/ai-agents/MOE_CHAIN.md`](MOE_CHAIN.md) for the full implementation reference.

---

### 3.10. Multi-Task (`multi_task`)

Runs multiple models simultaneously on the main PC. Hidden in the Settings menu because it demands extreme hardware — multiple high-VRAM GPUs or very large system RAM. Not recommended for standard configurations.

**Enable:** Settings → Valet Router → Advanced → Multi-Task Toggle.

---

## 4. Guided Walk-Through Scrapper Mode

When automated routing or web scraping fails — or when the user is operating in a resource-constrained environment with no active API keys — the 1.5B Valet (and/or an OMMESH model if available) activates **Guided Walk-Through Scrapper Mode**.

**What it does:**
1. Acknowledges that automated routing is unavailable for this task
2. Analyzes the task requirements using local inference only
3. Creates a detailed, copy-paste-ready prompt instruction set tailored for the task
4. Recommends the best free-tier web UI for the specific task type (e.g., "For this synthesis task, use Gemini Advanced free tier at gemini.google.com")
5. Guides the user step-by-step through submitting the prompt to the external UI
6. Waits for the user to paste the result back into Omnecor
7. Integrates the result into the active project, updates `todo.md` / `status.md`, and continues the workflow

**This mode ensures zero workflow dead-ends:** even with no API keys, no active subscriptions, and no OMMESH network, the Valet keeps the project moving by leveraging free web interfaces as the inference layer.

---

## 5. Example Multi-API Agent Workflow

The following illustrates how the 1.5B Valet orchestrates a complex research-to-implementation task in `multi_api` mode. All model names are examples only.

```
User Input: "Research and implement a new authentication flow"
        │
        ▼
1.5B Valet — Task Analysis & Decomposition
        │
        ├─► Research Phase
        │     ├─ Grok Agent     (current auth standards, CVEs, industry patterns)
        │     └─ Gemini Agent   (academic research, RFC references)
        │               │
        ▼               ▼
        Research outputs merged
        │
        ├─► Synthesis Phase
        │     ├─ OpenAI Agent   (write synthesis document)
        │     └─ Gemini Agent   (cross-reference + fact check)
        │               │
        ▼               ▼
        Synthesis document produced
        │
        ├─► Context Comparison
        │     └─ Neural Brain Map Query
        │           ├─ 1.5B Valet and/or OMMESH Model  (local semantic search)
        │           └─ API Model (optional — deeper contextual analysis)
        │
        ├─► Instruction Generation
        │     └─ 1.5B Valet or OMMESH Model  (write detailed implementation instructions)
        │         (or API Model for complex architectures)
        │
        ├─► Code Generation
        │     ├─ Claude Agent   (primary code author — system design + core logic)
        │     ├─ Grok Agent     (security review + edge cases)
        │     └─ Gemini Agent   (test generation + documentation)
        │               │
        ▼               ▼
        Code + tests + docs produced
        │
        ├─► Project Integration
        │     └─ 1.5B Valet and/or OMMESH Model  (merge into project, update files)
        │         (or API Model for conflict resolution)
        │
        └─► Report to User
              └─ 1.5B Valet or chosen API Model
```

---

## 6. Valet Router — Routing Taxonomy

The Valet classifies incoming tasks into 13 categories (sourced from `docs/ai-agents/valet-training/routing_manifest.json`) that determine routing decisions. Actual routing targets depend on the active execution mode (Sovereign / Scrapper / Big Spender).

| Category | Description |
|---|---|
| `code_generation` | Write new code from a specification |
| `code_review` | Review, debug, audit existing code |
| `research` | Fact-finding, web search, current events |
| `synthesis` | Summarize, compare, merge information; write documents |
| `media_generation` | Images, video, audio creation |
| `knowledge_retrieval` | Query the Neural Brain Map / vector DB |
| `instruction_writing` | Create step-by-step guides or prompt sets |
| `integration` | Merge AI output into the project; resolve conflicts |
| `hardware` | Blender, KiCad, ESPTool, ComfyUI operations |
| `reporting` | Summarize results back to the user |
| `context_management` | Compress/summarize context, manage the token budget (/compress) |
| `memory_operations` | Store/retrieve durable memory — Honcho facts, /btw notes, Brain Map recall |
| `local_task` | Simple local utility tasks (list files, status, quick calc) |

> The taxonomy is the canonical source — update `routing_manifest.json` to add or rename categories; the dataset builder, trainer, and inference server all load from it.

---

## 7. Configuration

All Valet Router settings are accessible under **Settings → Valet Router**.

| Setting | Description |
|---|---|
| Active Routing Mode | Select from the 10 modes above |
| Primary API Provider | Your main cloud provider (used in `main_api` and `main_api_omesh` modes) |
| API Pool | Configured providers for `multi_api` and `multi_api_omesh` modes |
| LLM-Builder Models | Custom fine-tuned models available for MoE chain routing |
| OMMESH Integration | Enable/disable OMMESH peer usage in routing decisions |
| Multi-Task Toggle | *(Advanced)* Enable simultaneous multi-model execution on main PC |

---

## 8. Related Documentation

- [MOE_CHAIN.md](MOE_CHAIN.md) — Full MoE Chain implementation reference (architecture, RAM conservation, DB schema, setup steps)
- [EXECUTION_MODES.md](../sovereignty/EXECUTION_MODES.md) — How routing modes interact with Sovereign/Scrapper/Big Spender execution modes
- [OMMESH Architecture](../architecture/Omnecor%20System%20Design.md) — OMMESH node discovery and VRAM-weighted routing
- [Multi-Agent Workflows](Omnecor%20Multi-Agent%20Collaboration%20Workflows.md) — Full workflow examples
- [Agentic Wallet](../wallet/AGENTIC_WALLET.md) — Cost tracking across multi-API routing
