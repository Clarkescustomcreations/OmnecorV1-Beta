#!/usr/bin/env python3
"""
Omnecor Valet Router — Holdout Eval Kernel (Kaggle GPU)
========================================================
Computes the routing-accuracy eval the conversion kernel only hard-coded.

  1. Install pinned transformers/peft/accelerate (match training stack).
  2. Load Qwen2.5-1.5B + the trained LoRA adapter (from valet-v2-eval dataset).
  3. For every eval.jsonl row, use the EXACT training-format prompt baked into the
     `text` field (cut at the assistant marker) — no prompt reconstruction.
  4. Score route accuracy + per-category + keyword baseline (mirrors valet_eval.py).
  5. Write /kaggle/working/eval_results.json AND eval_run.log (self-logging, because
     Kaggle's script-kernel stdout log comes back empty).
"""
import glob
import json
import os
import subprocess
import sys
import traceback
from collections import defaultdict

_LOG = open("/kaggle/working/eval_run.log", "w", buffering=1)


def log(*a):
    line = " ".join(str(x) for x in a)
    print(line, flush=True)
    _LOG.write(line + "\n")


ASSISTANT_MARKER = "<|im_start|>assistant"
BASE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"


def rule_based_category(task: str) -> str:
    t = task.lower()
    if any(k in t for k in ["remember", "/btw", "by the way", "keep in mind", "recall", "what do you know about me", "my preference"]):
        return "memory_operations"
    if any(k in t for k in ["/compress", "compress the context", "summarize the conversation", "token budget", "prune the history", "trim the context"]):
        return "context_management"
    if any(k in t for k in ["image", "video", "audio", "generate picture"]):
        return "media_generation"
    if any(k in t for k in ["code", "function", "implement", "debug", "script"]):
        return "code_generation"
    if any(k in t for k in ["research", "analyze", "compare", "summarize"]):
        return "research"
    return "local_task"


def parse_json(text: str):
    s, e = text.find("{"), text.rfind("}") + 1
    if s >= 0 and e > s:
        try:
            return json.loads(text[s:e])
        except json.JSONDecodeError:
            return None
    return None


def find_under_input(filename: str) -> str:
    """Recursively locate a file by name anywhere under /kaggle/input (depth-agnostic)."""
    for root, _dirs, files in os.walk("/kaggle/input"):
        if filename in files:
            return os.path.join(root, filename)
    raise FileNotFoundError(f"{filename} not found under /kaggle/input")


def find_adapter_dir() -> str:
    return os.path.dirname(find_under_input("adapter_config.json"))


def find_eval_jsonl() -> str:
    return find_under_input("eval.jsonl")


def _main():
    # Pin torch to a P100-compatible build (sm_60). Kaggle's default torch
    # 2.10+cu128 dropped sm_60 kernels → "no kernel image for device" on the P100.
    # Matches the proven valet-v2-eval-run conversion kernel.
    subprocess.run([sys.executable, "-m", "pip", "install", "-q",
        "torch==2.4.1", "torchvision==0.19.1",
        "--index-url", "https://download.pytorch.org/whl/cu121"], check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-q",
        "transformers==4.46.3", "peft==0.13.2", "accelerate==1.1.1",
        "sentencepiece", "protobuf"], check=True)

    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel

    log(f"[eval] torch {torch.__version__} | GPU: {torch.cuda.get_device_name(0)}")

    log("[eval] /kaggle/input tree:")
    for root, _dirs, files in os.walk("/kaggle/input"):
        log("   ", root, "->", files[:12])

    adapter_dir = find_adapter_dir()
    eval_path = find_eval_jsonl()
    log(f"[eval] adapter: {adapter_dir}")
    log(f"[eval] eval set: {eval_path}")

    tok = AutoTokenizer.from_pretrained(adapter_dir, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.truncation_side = "left"   # attribute, NOT a __call__ kwarg (4.46.3 rejects the kwarg)

    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, torch_dtype=torch.float16, device_map={"": 0}, trust_remote_code=True,
    )
    model = PeftModel.from_pretrained(base, adapter_dir)
    model.eval()
    log("[eval] model + adapter loaded")

    rows = [json.loads(l) for l in open(eval_path, encoding="utf-8") if l.strip()]
    log(f"[eval] {len(rows)} eval rows")

    bucket_correct = defaultdict(int)
    bucket_total = defaultdict(int)
    confusion = defaultdict(lambda: defaultdict(int))
    baseline_correct = 0
    route_total = 0
    confidences = []

    for i, ex in enumerate(rows):
        if ex.get("task_class", "route") != "route":
            continue
        text = ex.get("text", "")
        idx = text.find(ASSISTANT_MARKER)
        if idx < 0:
            continue
        prompt = text[: idx + len(ASSISTANT_MARKER) + 1]

        inputs = tok(prompt, return_tensors="pt", max_length=3072, truncation=True)
        inputs = {k: v.to(model.device) for k, v in inputs.items()}
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=350, do_sample=False,
                                 pad_token_id=tok.eos_token_id)
        gen = tok.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)

        try:
            gt_cat = json.loads(ex.get("output", "{}")).get("category", "local_task")
        except Exception:
            gt_cat = "local_task"
        bucket = f"route:{gt_cat}"
        pred = parse_json(gen)
        pred_cat = pred.get("category", "unknown") if pred else "parse_error"
        bucket_correct[bucket] += int(pred_cat == gt_cat)
        bucket_total[bucket] += 1
        confusion[gt_cat][pred_cat] += 1
        route_total += 1
        baseline_correct += int(rule_based_category(ex.get("input", "")) == gt_cat)
        if pred and isinstance(pred.get("confidence"), (int, float)):
            confidences.append(float(pred["confidence"]))

        if (i + 1) % 40 == 0:
            log(f"[eval] {i+1}/{len(rows)} processed")

    route_correct = sum(bucket_correct.values())
    route_n = sum(bucket_total.values())
    route_acc = route_correct / route_n if route_n else 0.0
    baseline_acc = baseline_correct / route_total if route_total else 0.0

    results = {
        "route_accuracy": round(route_acc, 4),
        "baseline_route_accuracy": round(baseline_acc, 4),
        "model_beats_baseline": route_acc > baseline_acc,
        "confidence_mean": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
        "route_examples": route_n,
        "per_bucket": {k: round(bucket_correct[k] / bucket_total[k], 4) for k in sorted(bucket_total)},
        "bucket_totals": dict(bucket_total),
        "confusion_matrix": {k: dict(v) for k, v in confusion.items()},
        "gpu": torch.cuda.get_device_name(0),
    }
    with open("/kaggle/working/eval_results.json", "w") as f:
        json.dump(results, f, indent=2)

    log("\n[eval] ===== RESULTS =====")
    log(json.dumps(results, indent=2))
    log(f"[eval] route_accuracy={route_acc:.4f} baseline={baseline_acc:.4f} "
        f"beats_baseline={route_acc > baseline_acc}")
    log("[eval] DONE")


try:
    _main()
except Exception:
    tb = traceback.format_exc()
    log("[eval] FATAL ERROR:\n" + tb)
    with open("/kaggle/working/error.txt", "w") as f:
        f.write(tb)
    raise
finally:
    _LOG.close()
