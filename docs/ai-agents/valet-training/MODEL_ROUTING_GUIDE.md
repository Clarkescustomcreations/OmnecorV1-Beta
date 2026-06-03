# Model Routing Guide (best model for the task)

How the Valet decides *who* should do a task. The machine-readable source of truth is
[routing_manifest.json](routing_manifest.json); this doc explains the policy and how
the knowledge is kept current.

---

## 1. Decision procedure

For every task the Valet:

1. **Classifies** the task into one of the manifest `categories`.
2. **Looks up** the category's `primary` / `secondary` / `local` targets in the manifest.
3. **Applies the execution mode**:
   - `sovereign` → ignore cloud targets; use `local`. If no local option exists, enter
     **Guided Walk-Through Scrapper mode** (never call cloud).
   - `scrapper` → use `local` when `local_capable`, else `primary`; keep `secondary` as
     fallback.
   - `big_spender` → use `primary` (highest quality); parallelize `secondary` if the
     routing mode allows.
4. **Filters by availability** — never selects a provider absent from
   `available_providers`.
5. **Emits** the routing decision (see [IO_CONTRACT.md](IO_CONTRACT.md) §3).

## 2. Category → default target (snapshot)

| Category | Primary | Local option | Cost | Local-capable |
|---|---|---|---|---|
| code_generation | anthropic / claude-opus-4-8 | ollama / qwen2.5-coder | medium | yes |
| code_review | anthropic / claude-opus-4-8 | ollama / qwen2.5-coder | medium | yes |
| research | gemini / gemini-3.1-pro | ollama / llama3.2 | low | no |
| synthesis | openai / gpt-5.5 | ollama / llama3.2 | medium | yes |
| media_generation | fal / flux | comfyui-local | medium | yes |
| knowledge_retrieval | ollama / valet-router | ollama / valet-router | free | yes |
| instruction_writing | ollama / llama3.2 | ollama / llama3.2 | free | yes |
| integration | ollama / llama3.2 | ollama / llama3.2 | free | yes |
| hardware | local_bridge (no AI) | local_bridge | free | yes |
| reporting | ollama / llama3.2 | ollama / llama3.2 | free | yes |
| context_management | ollama / llama3.2 | ollama / llama3.2 | free | yes |
| memory_operations | ollama / valet-router | ollama / valet-router | free | yes |
| local_task | ollama / llama3.2 | ollama / llama3.2 | free | yes |

(Always defer to the manifest; this table is illustrative and may lag it. Note the
local-worker categories use `llama3.2`/`valet-router` as the *worker* model while the
Valet orchestrates them in `valet_background` mode — the Valet never names itself as the
worker for a category that produces generated content.)

## 3. Keeping routing knowledge current ("pull and update")

The model is **not** the source of routing truth — the manifest is. This is deliberate
so the router never goes stale:

- **Update a model name** (e.g., a new Claude/GPT/Gemini release) → edit
  `routing_manifest.json`, bump `manifest_version`. The live router reads it at startup
  and injects it into the system prompt; **no retraining needed**.
- **Add/repurpose a category** → edit the manifest + add seed examples + regenerate the
  dataset (this *does* change behavior, so retrain).
- **Automated refresh (recommended)** — cloud model IDs change *fast* (e.g. as of
  2026-06 the defaults are `gpt-5.5`, `gemini-3.1-pro`/`gemini-3.5-flash`, `grok-4.3`,
  `claude-opus-4-8`/`claude-sonnet-4-6`; these will be stale within months). A scheduled
  job should pull each provider's current model list (from its models API) and propose
  manifest updates for human review, bumping `manifest_version`. Because the router reads
  the manifest at inference and never bakes model strings into weights, refreshed IDs take
  effect with **no retraining**. The hooks already exist: `valet_knowledge_refresh.py`
  bumps versions and calls `/admin/reload`, and `_get_manifest_json()` hot-reloads the
  manifest on mtime change. Wiring the provider-model pull into that job is VALET-todo
  Phase 6 (model-name auto-update).
- The router is fine-tuned to **read and obey the injected manifest**, not to memorize
  specific model strings — so manifest edits take effect immediately.

## 4. Why a small model can route well

Routing is **classification**, not generation — a 1.5B model fine-tuned on a few
thousand labeled examples per category reaches high accuracy. The hard knowledge
(which model is best, current names) is supplied at inference via the manifest, so the
weights only need to learn the *mapping from task → category → manifest lookup* and the
*Omnecor rules/persona*.

## 5. Acceptance bar

The trained router must beat the keyword `rule_based_route` baseline on a holdout set
and meet the thresholds in `valet.config.json` (overall ≥ 0.85, no category < 0.70).
See [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) §6 and VALET-todo Phase 4.
