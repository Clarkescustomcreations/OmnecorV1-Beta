# Valet Router — Canonical I/O Contract

This contract resolved mismatches **M1/M2/M3** (see [README](README.md)); they are now
fixed in code. Every component — dataset generator, trainer, inference server — MUST use
these exact shapes and the exact [system prompt](VALET_SYSTEM_PROMPT.md).
`scripts/check_valet_drift.py` asserts the schema stays consistent across the contract,
the pydantic model, and the TS interface (currently 11/11 fields).

---

## 1. Two output modes

The Valet operates in one of two modes, discriminated by the request:

| Mode | Trigger | Output |
|------|---------|--------|
| `route` | `task_type == "router"` or an explicit route request | **one JSON object** (Routing Decision) |
| `assist` | everything else (Q&A, `/plan`, skills) | **natural-language text** |

---

## 2. Routing request (input)

```json
{
  "task": "string — the user prompt to route",
  "context": "string | null — optional extra context",
  "available_providers": ["ollama", "anthropic", "openai", "gemini", "xai", "fal", "ommesh"],
  "execution_mode": "sovereign | scrapper | big_spender",
  "preferred_mode": "api_direct | main_api | multi_api | local_omesh | ...",
  "task_type": "router"
}
```

## 3. Routing decision (output) — THE canonical schema

This is the schema the live server parses (`RouteDecision(**data)` in
`valet_router_inference.py`). The dataset generator MUST emit exactly these keys.

```json
{
  "category": "code_generation | code_review | research | synthesis | media_generation | knowledge_retrieval | instruction_writing | integration | hardware | reporting | context_management | memory_operations | local_task",
  "mode": "api_direct | valet_background | local_omesh | main_api | multi_api | main_api_omesh | multi_api_omesh | moe_chain | moe_chain_omesh | multi_task",
  "primary_provider": "string — must be in available_providers",
  "primary_model": "string — must come from the routing manifest",
  "secondary_providers": ["string"],
  "cost_tier": "free | low | medium | high",
  "local_capable": true,
  "reasoning": "string — one short honest sentence",
  "confidence": 0.0,
  "requires_todo_md": true,
  "requires_status_md": true
}
```

> **Note:** the server's `RouteDecision` pydantic model and the TS `RouteDecision`
> interface already match this schema (Phase A complete). The 13-value `category` enum —
> the 11 original categories plus `context_management` and `memory_operations` (added in
> manifest v1.1.0) — is mirrored in `valet_router_inference.py` (`TaskCategory` Literal)
> and `ValetRouterService.ts` (`TaskCategory` union). If you add a category, update both
> code sites and this list together.

## 4. Assist request/response

Request: free-form `task` (+ optional `context`, `mode: "plan"` flag). Response:
plain text. For `/plan` the assistant asks one focused question at a time and proposes
concrete `project-docs/` content; for skills it proposes a named, parameterized skill
and asks for confirmation.

---

## 5. Training `text` formatting (fixes M3)

`localLLMfine-tuning.py` uses `dataset_text_field="text"`. The generator therefore
writes a **`text`** field per row, preformatted in **Qwen2.5 ChatML**. Each JSONL row:

```json
{
  "task_class": "route | qa | rules | plan | skill",
  "instruction": "…",
  "input": "…",
  "output": "…",
  "text": "<|im_start|>system\n{SYSTEM_PROMPT with manifest+context filled}<|im_end|>\n<|im_start|>user\n{input}<|im_end|>\n<|im_start|>assistant\n{output}<|im_end|>"
}
```

- `instruction/input/output` are kept for human review and regeneration.
- **Only `text` is consumed by the SFT trainer** — so training works with the existing
  script unchanged.
- The `system` turn embeds the filled system prompt (manifest snapshot + any RAG
  excerpt). This is what removes train/inference skew: inference builds the system turn
  the same way.

### Loss masking (recommended)
For tighter routing accuracy, mask the prompt tokens and train only on the assistant
completion (TRL `DataCollatorForCompletionOnlyLM` with the `<|im_start|>assistant`
response template). Document-level SFT on the full `text` also works for a first pass.

---

## 6. Inference alignment (fixes M2)

`valet_router_inference.py` must, for a `route` request:

1. Build the **same** ChatML system turn (filled system prompt + manifest + RAG).
2. Apply the tokenizer chat template (`tokenizer.apply_chat_template`).
3. Generate with `temperature=0`, `do_sample=False`, `max_new_tokens≈220`.
4. Extract the first balanced `{…}` and validate against the Routing Decision schema;
   on validation failure, fall back to `rule_based_route` (keep the existing fallback).

This guarantees the tokens the model saw in training are the tokens it sees in prod.
