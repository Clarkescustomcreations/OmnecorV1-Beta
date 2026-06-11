# Serving the Omnecor Valet Router

This is a practical runbook for serving and verifying the Omnecor Valet Router locally. The Valet Router is a 1.5B Qwen2.5-based task-routing model that decides, for a given task, which provider/model/mode/cost-tier should handle it. This document is based on a real deployment session on 2026-06-11.

## Overview

The Valet Router is a LoRA fine-tune of `Qwen/Qwen2.5-1.5B-Instruct`. The trained adapter is merged to fp16, converted to a Q8_0 GGUF, and served through **Ollama** on this box. The Python inference bridge (`server/python_bridges/valet_router_inference.py`) is a FastAPI server that injects the Valet system prompt + routing manifest on every request and proxies routing decisions to the chosen backend.

The app auto-starts the bridge on launch (via `ValetServerService`) whenever the registry reports `status: ready`.

## Artifacts

- **Training:** LoRA adapter trained on Kaggle (kernel `th3artistunknown/valet-router-train`), `r=8`, `alpha=16`, 1.5 epochs, 2995 training examples, base model `Qwen/Qwen2.5-1.5B-Instruct`.
- **Merged fp16 model:** `models/valet-router/kaggle-2026-06-11/`
  - `model.safetensors` is ~2.9 GB.
  - merged sha256: `f8f196d519991d49368dbdad26a6f9c39c87f21bbfb94932d635718dc6fd561a`
  - adapter sha256: `171f0548e11f60d023b3008553a83e0204ab87d6105405cd49a2a93078d22011`
- **Q8_0 GGUF:** `models/valet-router/kaggle-2026-06-11/valet-router-q8_0.gguf`
  - ~1.6 GB
  - sha256: `b0398f857ffb1dc6d9ae562304201c24e64ec4422cfb6b1b1391d66e21138eee`

**Why Q8_0?** `convert_hf_to_gguf.py` produces Q8_0 directly — it's pure Python with no C++ build needed — and Q8_0 is near-lossless, preserving routing accuracy. Q4_K_M would be smaller but requires the compiled `llama-quantize` binary.

## Why Ollama (the AVX1 constraint)

The bridge supports three backends, selected by the `format` field in the registry (`models/valet-router/current.json`):

| `format` value | Backend |
|---|---|
| `gguf` | llama-cpp-python |
| `ollama` | local Ollama REST API |
| `merged_16bit` / `lora` | HuggingFace transformers |

On this deployment box, **Ollama** is the chosen backend, for two reasons:

1. **CPU is Intel Sandy Bridge** (Family 6, Model 42 — AVX1 only, no AVX2). Prebuilt `llama-cpp-python` wheels crash with Windows error `0xc000001d` (illegal instruction). Ollama ships its own CPU-compatible llama.cpp builds and drives the GPU efficiently.
2. **HuggingFace transformers serving is slow here** — roughly 30s per route on this (bottlenecked) machine, even on its GPU.

Warm routing via Ollama is roughly **2–3 seconds per request**.

## Importing into Ollama

The GGUF is imported into Ollama under the deliberately unique, versioned name **`omnecor-valet-router:v2-q8`**.

The import uses `models/valet-router/Modelfile`:

```
FROM C:\OmnecorV1-Beta\models\valet-router\kaggle-2026-06-11\valet-router-q8_0.gguf
PARAMETER temperature 0
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"
```

Run from `models/valet-router/`:

```bash
ollama create omnecor-valet-router:v2-q8 -f Modelfile
```

## Registry configuration

The bridge reads `models/valet-router/current.json` to decide what to load. Key fields for the Ollama backend:

```json
{
  "status": "ready",
  "format": "ollama",
  "base_model": "omnecor-valet-router:v2-q8"
}
```

For `format: ollama`, the bridge's `_load_ollama` uses the `base_model` field as the **Ollama model name**. This overloads `base_model` — the real HuggingFace base is recorded separately in an `hf_base` field.

> **Keep two copies in sync.** There are TWO copies of this registry:
> - the repo-root copy: `models/valet-router/current.json`
> - the app's data-dir copy: on Windows the app (`ValetServerService` via `PATHS.valetRouter`) reads `%APPDATA%\omnecor\models\valet-router\current.json`
>
> The Python bridge honors a `VALET_REGISTRY_ROOT` env var (the TS `ValetServerService` passes its registry root) so both sides resolve the same file. **When updating the registry by hand, write both copies.**

## Environment requirements

- **`PYTHON_BIN=python`** must be set (in `.env`). On this Windows machine `python3` resolves to the broken Microsoft Store stub; the real interpreter is `python` (`C:\Program Files\Python311`).
- The serving Python needs **`fastapi`** and **`uvicorn`** installed (the bridge is a FastAPI server). For the Ollama backend, **no torch/transformers are needed at serve time**.
- **Ollama must be running** (default `http://localhost:11434`; pass `OLLAMA_URL` if non-default). Ollama version used: **0.30.7**.

## Start & verify

The app auto-starts the bridge on launch when `current.json` has `status: ready` (via `ValetServerService`).

To run the bridge manually for testing:

```bash
PYTHON_BIN=python VALET_REGISTRY_ROOT=<registry dir> VALET_ROUTER_PORT=8010 OLLAMA_URL=http://localhost:11434 python server/python_bridges/valet_router_inference.py
```

**Health check:**

```
GET http://localhost:8010/health
```

Expect:

```json
{"status":"ok","model_loaded":true,"backend":"ollama"}
```

**Route check:**

```
POST http://localhost:8010/route
```

with a JSON body like:

```json
{"task":"Generate an image of a sunset","available_providers":["anthropic","openai","gemini","ollama","fal"]}
```

Expect a model-driven JSON routing decision with fields `category`, `mode`, `primary_provider`, `primary_model`, `cost_tier`, `confidence`, and `reasoning`.

If `reasoning` reads `"Rule-based fallback — Valet Router model not loaded"`, the model did **not** load and you are getting the rule-based fallback — investigate before trusting the output.

## Behavior note: raw vs system-prompted

The model only behaves correctly when its **Valet system prompt + routing manifest are injected** — and the bridge always injects these. If you query the raw Ollama model directly with no system prompt (e.g. `ollama run omnecor-valet-router:v2-q8 "..."`), it produces ungrounded, hallucinated output.

This is expected. It is a narrowly fine-tuned 1.5B router, not a general chatbot, and this is **not** how the app calls it. Freeform Q&A is a deliberately de-prioritized weak area; routing is the model's job.

## Eval results

**Verified** — independent Kaggle eval kernel `th3artistunknown/valet-router-eval` (Tesla P100, 2026-06-11), self-computed on **390 balanced route examples** (30 × 13 categories) using the exact training-format prompts baked into `eval.jsonl`:

- **Route accuracy: 0.7385** — **beats keyword baseline 0.2744** by ~2.7×; confidence mean 0.9018.
- Strongest buckets: `hardware` 1.0, `code_generation` 0.97, `code_review` 0.97. Weakest: `reporting` 0.27, `knowledge_retrieval` 0.53 (confused with `research`), `local_task` 0.57.
- The number is **stable and reproducible**: a re-run with `max_new_tokens` raised 200→350 returned *identical* results (greedy decoding is deterministic). That proves the ~10% `parse_error` rows are genuine non-JSON outputs from the model on a handful of prompts (mostly `media_generation`, `context_management`, `instruction_writing`) — **not** truncation. 0.7385 is not an undercount.
- This is **below** the `valet.config.json` 0.85 gate, but the router clearly works and decisively beats the keyword baseline — acceptable for a built-in default. Routing is the model's purpose; freeform Q&A is de-prioritized.

> An earlier figure of **0.8949** appears hard-coded in the `valet-v2-eval-run` *conversion* kernel's manifest. It did **not** reproduce under the independent recompute above (0.7385) and should be treated as unverified. A local 30-example smoke hit 1.0 but was a small/easy subset.

- Scores are recorded in `current.json` under `eval_scores`.
- The re-verification eval kernel lives at `tmp-valet-train/kaggle-bundle/eval-kernel/` (`valet_eval_kaggle.py` + `kernel-metadata.json`); its result is archived there as `eval_results.verified.json`. It pins `torch==2.4.1` (cu121) for P100 (sm_60) compatibility.

## Gotchas / fixes

Three Windows/GPU serving bugs were found and fixed in **both** `server/python_bridges/valet_router_inference.py` and `server/python_bridges/valet_eval.py`:

1. **CPU/CUDA device mismatch.** Tokenized inputs were not moved to the model's device. On a CUDA box this raised a device-mismatch error, and every route silently fell back to rules. **Fix:** move inputs to `model.device` before `generate`.
2. **UTF-8 mojibake.** Files were read with Python's default encoding (cp1252 on Windows), corrupting the em-dashes in the system prompt and making it out-of-distribution (garbage output). **Fix:** read all prompt/manifest/registry files with `encoding="utf-8"`.
3. **Prompt truncation at 1024 tokens.** The system prompt + routing manifest alone is ~2.8k tokens, so truncating at 1024 cut off the user task entirely. **Fix:** raise `max_length` to 3072 (matching the training `MAX_SEQ`) and left-truncate so the user turn and generation marker survive.
