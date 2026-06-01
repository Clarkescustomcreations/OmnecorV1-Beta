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

| Category | Primary (cloud) | Local option | Cost | Local-capable |
|---|---|---|---|---|
| code_generation | anthropic / claude-opus-4-8 | ollama / qwen2.5-coder | medium | yes |
| code_review | anthropic / claude-opus-4-8 | ollama / qwen2.5-coder | medium | yes |
| research | gemini / gemini-1.5-pro | ollama / llama3.2 | low | no |
| synthesis | openai / gpt-4o | ollama / llama3.2 | medium | yes |
| media_generation | fal / flux | comfyui-local | medium | yes |
| knowledge_retrieval | ollama / valet-router | ollama / valet-router | free | yes |
| instruction_writing | ollama / valet-router | ollama / llama3.2 | free | yes |
| integration | ollama / valet-router | ollama / valet-router | free | yes |
| hardware | local_bridge (no AI) | local_bridge | free | yes |
| reporting | ollama / valet-router | ollama / llama3.2 | free | yes |
| local_task | ollama / llama3.2 | ollama / llama3.2 | free | yes |

(Always defer to the manifest; this table is illustrative and may lag it.)

## 3. Keeping routing knowledge current ("pull and update")

The model is **not** the source of routing truth — the manifest is. This is deliberate
so the router never goes stale:

- **Update a model name** (e.g., a new Claude/GPT/Gemini release) → edit
  `routing_manifest.json`, bump `manifest_version`. The live router reads it at startup
  and injects it into the system prompt; **no retraining needed**.
- **Add/repurpose a category** → edit the manifest + add seed examples + regenerate the
  dataset (this *does* change behavior, so retrain).
- **Automated refresh (optional)** — a scheduled job can pull the latest available
  model IDs per provider (from each provider's models API) and propose manifest updates
  for human review. Tracked as VALET-todo Phase 6.
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
