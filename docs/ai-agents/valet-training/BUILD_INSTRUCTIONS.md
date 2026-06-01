# Build Instructions — Valet Router (end-to-end runbook)

From zero to an auto-serving, verified Omnecor-expert router. Steps 0–3 run on a
**GPU machine** (training); steps 4–6 produce the shippable artifact and wire it into
the app. The goal is **one command** (`pnpm valet:build`) once the Phase-A/B code
changes land; until then, the manual steps below are the source of truth.

> Prereqs: a CUDA GPU for training (Unsloth is GPU-only), Python 3.11, Node 22+,
> Ollama running locally with an oracle model pulled (`ollama pull llama3.2`).

---

## Step 0 — Install the ML toolchain

```bash
# from repo root
python3 -m venv .venv-valet && source .venv-valet/bin/activate
pip install -U pip
pip install "torch>=2.2.0"            # pick the CUDA build per https://pytorch.org
pip install "transformers>=4.40" "trl>=0.8" "datasets>=2.19" fastapi "uvicorn[standard]"
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
```

(Phase 0.4 packages this as `scripts/setup-valet-ml.sh`.)

## Step 1 — Generate the dataset

```bash
export OLLAMA_URL=http://localhost:11434 ORACLE_MODEL=llama3.2:latest EXAMPLES_PER_CATEGORY=400
python3 server/python_bridges/valet_dataset_builder.py \
  --seeds docs/ai-agents/valet-training/seed \
  --manifest docs/ai-agents/valet-training/routing_manifest.json \
  --knowledge docs/ai-agents/valet-training/OMNECOR_KNOWLEDGE_BASE.md \
  --system-prompt docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md \
  --out data/valet/train.jsonl --val-out data/valet/val.jsonl --emit-text
```

Verify a row has a `text` field in ChatML before training (see DATASET_GENERATION §4).

## Step 2 — Validate the dataset

```bash
# reuse trainingRouter.validateDataset, or:
python3 - <<'PY'
import json
n=0
for line in open("data/valet/train.jsonl"):
    r=json.loads(line); assert "text" in r and r["text"].startswith("<|im_start|>system"); n+=1
print("ok rows:", n)
PY
```

## Step 3 — Fine-tune (LoRA via Unsloth)

```bash
python3 server/phase2/python_scripts/localLLMfine-tuning.py \
  --model_name "Qwen/Qwen2.5-1.5B-Instruct" \
  --dataset_path data/valet/train.jsonl \
  --output_dir models/valet-router/adapter \
  --task_type router \
  --epochs 2 --r 8 --lora_alpha 16 --max_seq_length 2048 \
  --save_method gguf
```

- `--task_type router` caps LoRA rank (the script already does this).
- Progress streams as JSON lines (epoch/step/loss) — the Node `ProcessManager` parses
  these onto the `training:${jobId}` WebSocket channel.
- `--save_method gguf` exports a quantized GGUF for llama.cpp/Ollama serving. Use
  `ollama` to register directly with Ollama instead.

## Step 4 — Register the artifact

```bash
mkdir -p models/valet-router
# write the pointer the inference server reads (IO_CONTRACT / Phase 2.2)
cat > models/valet-router/current.json <<JSON
{ "format": "gguf",
  "path": "models/valet-router/adapter/valet-router.gguf",
  "base_model": "Qwen/Qwen2.5-1.5B-Instruct",
  "manifest_version": "1.0.0",
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
JSON
```

## Step 5 — Serve + auto-start

1. Apply the Phase-3 code change so `valet_router_inference.py:get_model()` loads from
   `current.json` (gguf→llama.cpp, ollama→Ollama, merged→transformers) instead of the
   HF stub, and builds the system turn via `apply_chat_template` (IO_CONTRACT §6).
2. Start the server (the app will auto-spawn it once Phase 3.2 lands):
   ```bash
   uvicorn server.python_bridges.valet_router_inference:app --host 127.0.0.1 --port 8010
   ```
3. Health check:
   ```bash
   curl -s 127.0.0.1:8010/health      # expect {"status":"ok","model_loaded":true,...}
   ```

## Step 6 — Verify routing + eval gate

```bash
# functional smoke
curl -s 127.0.0.1:8010/route -H 'content-type: application/json' -d '{
  "task":"Write a Python function to dedupe a list","available_providers":["ollama","anthropic"],
  "execution_mode":"scrapper","task_type":"router"}' | jq

# accuracy gate (Phase 4): must beat keyword baseline and pass thresholds
python3 server/python_bridges/valet_eval.py \
  --model models/valet-router/current.json \
  --eval data/valet/val.jsonl \
  --thresholds overall=0.85,min_category=0.70
```

If the eval gate fails, **do not register as `current`** — fix data/config and retrain.

---

## Distribution (mode A — ship to users)

- Quantized GGUF for a 1.5B model is ~0.9–1.3 GB. Publish it as a GitHub release asset.
- Add `scripts/fetch-valet-model.sh` to download + checksum into `models/valet-router/`.
- Desktop builds: `packaging/models/` is already an `extraResources` path in
  `electron-builder.yml` — point it at the fetched/registered artifact (PKG-todo links
  to this).

## Out-of-the-box behavior

- **Artifact present** → app auto-starts the router; `/route` is model-driven; the model
  reads the live manifest + RAG, so it's an up-to-date Omnecor expert.
- **Artifact absent** → app still runs; routing degrades to the keyword fallback and the
  hardcoded rules are still enforced in code. Users are never blocked.

See [`../../../VALET-todo.md`](../../../VALET-todo.md) for the phased work that turns
this runbook into the single `pnpm valet:build` command.
