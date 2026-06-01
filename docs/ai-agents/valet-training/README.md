# Valet Router — Training Package

This directory contains everything needed to fine-tune the **Omnecor 1.5B Valet
Router** into an *out-of-the-box* expert dispatcher: an Omnecor domain expert that
(a) **routes** each task to the best model/provider, (b) **knows Omnecor** — its
features, workflows, execution modes, and bridges, and (c) **enforces the hardcoded
project-discipline rules** (todo.md / status.md, `/plan` project-docs suite, reusable
skills).

> Recommended base model: **`Qwen2.5-1.5B-Instruct`** (matches the documented
> "1.5B Valet" and uses the ChatML template these docs assume).

---

## ⚠️ Why this package exists — three blocking mismatches in the current code

Before any training can "just work," three incompatibilities in the existing
pipeline must be resolved. This package defines the **single canonical contract**
([IO_CONTRACT.md](IO_CONTRACT.md)) that all three components must converge on.

| # | Component | Today | Problem |
|---|-----------|-------|---------|
| M1 | `server/python_bridges/valet_dataset_builder.py` | emits `{provider, model, local_capable, cost_tier, reasoning}` | Not the schema the server reads |
| M2 | `server/python_bridges/valet_router_inference.py` `/route` | parses `{mode, primary_provider, secondary_providers, reasoning, confidence, requires_todo_md, requires_status_md}` | A model trained on M1's data can never produce these → always falls back |
| M3 | `server/phase2/python_scripts/localLLMfine-tuning.py` | trains on `dataset_text_field="text"` | The builder never writes a `text` field → SFT trains on nothing |

**Fixes** (tracked in [`../../../VALET-todo.md`](../../../VALET-todo.md)):
- The dataset generator writes the **canonical response schema** *and* a preformatted
  **`text`** field (ChatML) so the trainer works unmodified (resolves M1 + M3).
- The inference `/route` prompt is aligned to the **same** system prompt + schema used
  in training (resolves M2 + train/inference skew).

---

## Contents

| File | Purpose |
|------|---------|
| [VALET_SYSTEM_PROMPT.md](VALET_SYSTEM_PROMPT.md) | The master system prompt — persona, rules, and output contract. Used **identically** in dataset generation, training, and inference. |
| [IO_CONTRACT.md](IO_CONTRACT.md) | Canonical request/response JSON schemas, the two output modes (`route` vs `assist`), and the exact ChatML `text` formatting for SFT. |
| [OMNECOR_KNOWLEDGE_BASE.md](OMNECOR_KNOWLEDGE_BASE.md) | Curated, authoritative facts about Omnecor — the corpus for expert Q&A seeds **and** the runtime RAG source. |
| [MODEL_ROUTING_GUIDE.md](MODEL_ROUTING_GUIDE.md) | Task-category → best-model/provider mapping, cost tiers, and how the routing knowledge is kept current. |
| [routing_manifest.json](routing_manifest.json) | Machine-readable source of truth for "best model per task." The generator and the live router both read this — update it, don't hardcode. |
| [HARDCODED_RULES.md](HARDCODED_RULES.md) | The authoritative text of the non-negotiable rules (todo/status, `/plan` docs suite, skills). |
| [DATASET_GENERATION.md](DATASET_GENERATION.md) | How the full dataset is assembled from seeds + Ollama augmentation + a **pull from live docs/manifest** so it stays current. |
| [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) | The operational runbook: deps → dataset → train → export → deploy → verify. |
| `seed/*.jsonl` | Hand-authored, high-quality exemplars for each behavior class. The generator multiplies these. |

---

## The model's five jobs (what we are training)

1. **Routing** — classify a task and emit a routing decision (mode + provider(s)).
   Knowledge of "best model for the job" comes from [routing_manifest.json](routing_manifest.json).
2. **Omnecor expertise** — answer questions about features, workflows, and config
   accurately, grounded in [OMNECOR_KNOWLEDGE_BASE.md](OMNECOR_KNOWLEDGE_BASE.md) (+ RAG).
3. **Hardcoded rule enforcement** — ensure every task/project starts with `todo.md` +
   `status.md` and keeps them updated.
4. **`/plan` mode guidance** — interview the user (using context / Neural Brain Map) to
   build and maintain the `project-docs/` suite.
5. **Skill generation** — after notable tasks, offer to package the workflow as a
   reusable skill.

## Fine-tune vs. retrieval — keeping it current

A 1.5B model **cannot memorize all of Omnecor and stay current**. So:

- **Fine-tune** teaches *behavior, format, persona, the rules, and the routing
  taxonomy* — things that are stable.
- **Retrieval (RAG)** supplies *current facts*: the live router reads
  [routing_manifest.json](routing_manifest.json) and queries the Neural Brain Map /
  `OMNECOR_KNOWLEDGE_BASE.md` at inference time. This is the "pull and update that
  information" requirement — facts live in data, not frozen weights.

This split is what makes the router both **expert** and **maintainable**.
