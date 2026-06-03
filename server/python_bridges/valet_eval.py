#!/usr/bin/env python3
"""
valet_eval.py — Valet Router Evaluation Gate (Phase 4)

Runs the trained artifact against the stratified holdout eval.jsonl and:
  4.1  Per-category accuracy + confusion matrix for route tasks
  4.2  Acceptance threshold gate (fails non-zero when thresholds are not met)
  4.3  Baseline (keyword rule) comparison — model must beat keyword rules
  4.4  Records scores into artifact metadata.json + current.json
  4.5  QA factual-correctness scoring + hardcoded-rule reflex assertions

Streams JSON progress lines to stdout (same protocol as dataset builder + trainer).

Usage:
  python3 server/python_bridges/valet_eval.py \\
      [--config valet.config.json] \\
      [--eval-path data/valet/eval.jsonl] \\
      [--artifact-dir models/valet-router/<dir>] \\
      [--max-examples N]
"""

import argparse
import datetime
import json
import os
import re
import statistics
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).parent
_REPO_ROOT = _HERE.parent.parent
_TRAINING_DIR = _REPO_ROOT / "docs" / "ai-agents" / "valet-training"
_SYSTEM_PROMPT_PATH = _TRAINING_DIR / "VALET_SYSTEM_PROMPT.md"
_MANIFEST_PATH = _TRAINING_DIR / "routing_manifest.json"
_CURRENT_JSON = _REPO_ROOT / "models" / "valet-router" / "current.json"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")


# ─── Streaming progress ───────────────────────────────────────────────────────
def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


# ─── Prompt construction ──────────────────────────────────────────────────────
def _load_system_prompt() -> str:
    try:
        text = _SYSTEM_PROMPT_PATH.read_text()
        match = re.search(r"```\n(.*?)```", text, re.DOTALL)
        if match:
            return match.group(1).strip()
        return text.strip()
    except Exception:
        return "You are the Omnecor Valet — a local routing assistant."


def _load_manifest() -> str:
    try:
        data = json.loads(_MANIFEST_PATH.read_text())
        return json.dumps(data, separators=(",", ":"))
    except Exception:
        return "{}"


_SYSTEM_PROMPT_TEMPLATE = _load_system_prompt()
_ROUTING_MANIFEST = _load_manifest()


def _build_messages(user_input: str, rag_context: str = "") -> list[dict]:
    system = (
        _SYSTEM_PROMPT_TEMPLATE
        .replace("{{RAG_CONTEXT}}", rag_context)
        .replace("{{ROUTING_MANIFEST}}", _ROUTING_MANIFEST)
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_input[:500]},
    ]


# ─── Model backend (sync, eval-only) ─────────────────────────────────────────
_backend_type: str | None = None
_gguf_model = None
_hf_model = None
_hf_tokenizer = None
_ollama_model_name: str | None = None


def _load_model(registry: dict) -> bool:
    global _backend_type, _gguf_model, _hf_model, _hf_tokenizer, _ollama_model_name

    fmt = registry.get("format", "")
    artifact_path = registry.get("artifact_path", "")

    if fmt == "gguf":
        try:
            from llama_cpp import Llama  # type: ignore
        except ImportError:
            _emit({"type": "warning",
                   "warning": "llama-cpp-python not installed. Install: pip install llama-cpp-python"})
            return False
        try:
            p = Path(artifact_path)
            gguf_file = registry.get("gguf_file")
            if gguf_file:
                model_path = str(p / gguf_file)
            elif p.is_file() and p.suffix == ".gguf":
                model_path = str(p)
            else:
                candidates = sorted(p.glob("*.gguf")) if p.is_dir() else []
                if not candidates:
                    _emit({"type": "warning",
                           "warning": f"No .gguf file found in {artifact_path}"})
                    return False
                model_path = str(candidates[0])
            _gguf_model = Llama(model_path=model_path, n_ctx=2048, verbose=False)
            _backend_type = "gguf"
            return True
        except Exception as e:
            _emit({"type": "warning", "warning": f"Could not load GGUF: {e}"})
            return False

    elif fmt == "ollama":
        model_name = registry.get("base_model", "")
        if not model_name:
            _emit({"type": "warning", "warning": "Ollama format but registry has no base_model."})
            return False
        try:
            with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5) as resp:
                tags = json.loads(resp.read())
            available = [m["name"] for m in tags.get("models", [])]

            def _norm(n: str) -> str:
                return n if ":" in n else f"{n}:latest"

            if _norm(model_name) not in [_norm(m) for m in available]:
                _emit({"type": "warning",
                       "warning": f"Ollama model '{model_name}' not found. "
                                  f"Pull it first: ollama pull {model_name}"})
                return False
        except Exception as e:
            _emit({"type": "warning", "warning": f"Ollama not reachable at {OLLAMA_URL}: {e}"})
            return False
        _ollama_model_name = model_name
        _backend_type = "ollama"
        return True

    else:
        # lora, merged_16bit, merged_4bit, or unknown → try transformers
        try:
            from transformers import AutoTokenizer, AutoModelForCausalLM  # type: ignore
            import torch  # type: ignore
            _hf_tokenizer = AutoTokenizer.from_pretrained(artifact_path)
            _hf_model = AutoModelForCausalLM.from_pretrained(
                artifact_path,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map="auto",
            )
            _backend_type = "transformers"
            return True
        except Exception as e:
            _emit({"type": "warning", "warning": f"Could not load transformers model: {e}"})
            return False


def _infer(user_input: str, rag_context: str = "") -> str | None:
    """Run a single synchronous inference. Returns the assistant reply text or None."""
    messages = _build_messages(user_input, rag_context)

    if _backend_type == "gguf":
        try:
            response = _gguf_model.create_chat_completion(  # type: ignore[union-attr]
                messages=messages, max_tokens=220, temperature=0
            )
            return response["choices"][0]["message"]["content"]
        except Exception as e:
            _emit({"type": "warning", "warning": f"GGUF inference error: {e}"})
            return None

    elif _backend_type == "ollama":
        try:
            payload = json.dumps({
                "model": _ollama_model_name,
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0},
            }).encode()
            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/chat",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            return data["message"]["content"]
        except Exception as e:
            _emit({"type": "warning", "warning": f"Ollama inference error: {e}"})
            return None

    elif _backend_type == "transformers":
        try:
            import torch  # type: ignore
            prompt = _hf_tokenizer.apply_chat_template(  # type: ignore[union-attr]
                messages, tokenize=False, add_generation_prompt=True
            )
            inputs = _hf_tokenizer(  # type: ignore[union-attr]
                prompt, return_tensors="pt", max_length=1024, truncation=True
            )
            with torch.no_grad():
                outputs = _hf_model.generate(  # type: ignore[union-attr]
                    **inputs, max_new_tokens=220, temperature=0, do_sample=False
                )
            return _hf_tokenizer.decode(  # type: ignore[union-attr]
                outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True
            )
        except Exception as e:
            _emit({"type": "warning", "warning": f"Transformers inference error: {e}"})
            return None

    return None


# ─── Rule-based baseline (mirrors valet_router_inference.rule_based_route) ───
def _rule_based_category(task: str) -> str:
    # Mirrors rule_based_route() in valet_router_inference.py — keep in sync.
    t = task.lower()
    if any(kw in t for kw in ["remember", "/btw", "by the way", "keep in mind", "recall", "what do you know about me", "my preference"]):
        return "memory_operations"
    if any(kw in t for kw in ["/compress", "compress the context", "summarize the conversation", "token budget", "prune the history", "trim the context"]):
        return "context_management"
    if any(kw in t for kw in ["image", "video", "audio", "generate picture"]):
        return "media_generation"
    if any(kw in t for kw in ["code", "function", "implement", "debug", "script"]):
        return "code_generation"
    if any(kw in t for kw in ["research", "analyze", "compare", "summarize"]):
        return "research"
    return "local_task"


# ─── JSON extraction helper ────────────────────────────────────────────────────
def _parse_json(text: str) -> dict | None:
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass
    return None


# ─── Per-class scorers ────────────────────────────────────────────────────────
def _score_route(model_text: str | None, gt_output: str, _user: str, _ex: dict) -> tuple[bool, str]:
    """Correct when model category matches ground-truth category."""
    try:
        gt_cat = json.loads(gt_output).get("category", "local_task")
    except Exception:
        return False, "gt_parse_error"

    if model_text is None:
        return False, "no_output"

    pred = _parse_json(model_text)
    if pred is None:
        return False, "pred_parse_error"

    pred_cat = pred.get("category", "local_task")
    return pred_cat == gt_cat, pred_cat


def _score_qa(model_text: str | None, gt_output: str, _user: str, _ex: dict) -> tuple[bool, str]:
    """
    4.5 QA factual correctness: at least 50 % of content words (len > 3) from
    the ground-truth answer must appear in the model response.
    """
    if model_text is None:
        return False, "no_output"

    gt_words = [w.lower().strip(".,;:()[]") for w in gt_output.split() if len(w) > 3]
    if not gt_words:
        return True, "trivial"

    resp_lower = model_text.lower()
    matches = sum(1 for w in gt_words if w in resp_lower)
    correct = (matches / len(gt_words)) >= 0.5
    return correct, f"{matches}/{len(gt_words)}_words_matched"


def _score_rules(model_text: str | None, gt_output: str, _user: str, _ex: dict) -> tuple[bool, str]:
    """
    4.5 Hardcoded-rule reflexes: requires_todo_md and requires_status_md in the
    model JSON output must match ground truth. Falls back to word-overlap when
    ground truth is not JSON.
    """
    try:
        gt = json.loads(gt_output)
        gt_todo = bool(gt.get("requires_todo_md", False))
        gt_status = bool(gt.get("requires_status_md", False))
    except Exception:
        return _score_qa(model_text, gt_output, _user, _ex)

    if model_text is None:
        return False, "no_output"

    pred = _parse_json(model_text)
    if pred is None:
        t = model_text.lower()
        pred_todo = "requires_todo_md" in t and "true" in t
        pred_status = "requires_status_md" in t and "true" in t
    else:
        pred_todo = bool(pred.get("requires_todo_md", False))
        pred_status = bool(pred.get("requires_status_md", False))

    correct = (pred_todo == gt_todo) and (pred_status == gt_status)
    return correct, (
        f"todo={pred_todo}(gt={gt_todo}),status={pred_status}(gt={gt_status})"
    )


def _score_skill(model_text: str | None, gt_output: str, _user: str, _ex: dict) -> tuple[bool, str]:
    """4.5 Skill reflex: response must contain skill-offer language."""
    if model_text is None:
        return False, "no_output"
    kws = ["skill", "automate", "can help", "would you like", "should i", "workflow", "offer"]
    resp_lower = model_text.lower()
    found = any(kw in resp_lower for kw in kws)
    return found, "skill_offer_detected" if found else "no_skill_offer"


_SCORERS = {
    "route": _score_route,
    "qa": _score_qa,
    "rules": _score_rules,
    "plan": _score_rules,   # plan rows also check requires_todo_md
    "skill": _score_skill,
}


# ─── Eval loop ────────────────────────────────────────────────────────────────
def run_eval(eval_path: Path, max_examples: int = 0) -> dict:
    rows: list[dict] = []
    for line in eval_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass

    if max_examples > 0:
        rows = rows[:max_examples]

    _emit({"type": "eval_start", "total_examples": len(rows), "backend": _backend_type})

    # Accumulators
    bucket_correct: dict[str, int] = defaultdict(int)
    bucket_total: dict[str, int] = defaultdict(int)
    # Confusion: gt_cat → {pred_cat: count}
    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    # Baseline (route rows only)
    baseline_correct: dict[str, int] = defaultdict(int)
    baseline_total: dict[str, int] = defaultdict(int)
    confidences: list[float] = []

    milestone = max(1, len(rows) // 10)

    for i, ex in enumerate(rows):
        task_class = ex.get("task_class", "route")
        user_input = ex.get("input", "")
        gt_output = ex.get("output", "")

        # Determine bucket key
        if task_class == "route":
            try:
                gt_cat = json.loads(gt_output).get("category", "local_task")
            except Exception:
                gt_cat = "local_task"
            bucket_key = f"route:{gt_cat}"
        else:
            bucket_key = task_class
            gt_cat = task_class

        # Model inference
        model_text = _infer(user_input)

        # Score
        scorer = _SCORERS.get(task_class, _score_qa)
        correct, detail = scorer(model_text, gt_output, user_input, ex)

        bucket_correct[bucket_key] += int(correct)
        bucket_total[bucket_key] += 1

        # Confusion matrix (route only — we know pred_cat from detail)
        if task_class == "route":
            pred_cat_for_confusion = detail if detail not in (
                "no_output", "pred_parse_error", "gt_parse_error"
            ) else "unknown"
            confusion[gt_cat][pred_cat_for_confusion] += 1

            # Confidence tracking
            if model_text:
                pred = _parse_json(model_text)
                if pred and isinstance(pred.get("confidence"), (int, float)):
                    confidences.append(float(pred["confidence"]))

            # Baseline
            baseline_cat = _rule_based_category(user_input)
            baseline_correct[bucket_key] += int(baseline_cat == gt_cat)
            baseline_total[bucket_key] += 1

        if (i + 1) % milestone == 0:
            _emit({
                "type": "eval_progress",
                "done": i + 1,
                "total": len(rows),
                "pct": round(100 * (i + 1) / len(rows)),
            })

    # ── Aggregate ──────────────────────────────────────────────────────────────
    total_correct = sum(bucket_correct.values())
    total_n = sum(bucket_total.values())
    overall_accuracy = total_correct / total_n if total_n > 0 else 0.0

    per_bucket = {
        k: round(bucket_correct[k] / bucket_total[k], 4)
        for k in bucket_total if bucket_total[k] > 0
    }

    route_keys = [k for k in bucket_total if k.startswith("route:")]
    route_correct_n = sum(bucket_correct[k] for k in route_keys)
    route_total_n = sum(bucket_total[k] for k in route_keys)
    route_accuracy = route_correct_n / route_total_n if route_total_n > 0 else 0.0

    baseline_n = sum(baseline_total.values())
    baseline_acc = sum(baseline_correct.values()) / baseline_n if baseline_n > 0 else 0.0

    conf_mean = statistics.mean(confidences) if confidences else 0.0
    conf_std = statistics.stdev(confidences) if len(confidences) > 1 else 0.0

    # Confusion matrix: convert inner defaultdicts to plain dicts for JSON serialisation
    confusion_plain = {k: dict(v) for k, v in confusion.items()}

    return {
        "overall_accuracy": round(overall_accuracy, 4),
        "route_accuracy": round(route_accuracy, 4),
        "per_bucket": per_bucket,
        "bucket_totals": dict(bucket_total),
        "confusion_matrix": confusion_plain,
        "baseline_route_accuracy": round(baseline_acc, 4),
        "model_beats_baseline": route_accuracy > baseline_acc,
        "confidence_mean": round(conf_mean, 4),
        "confidence_std": round(conf_std, 4),
        "total_examples": total_n,
        "eval_timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "backend": _backend_type,
    }


# ─── Threshold check (4.2) ────────────────────────────────────────────────────
def check_thresholds(scores: dict, thresholds: dict) -> tuple[bool, list[str]]:
    failures: list[str] = []

    overall_min: float = thresholds.get("overall", 0.85)
    if scores["overall_accuracy"] < overall_min:
        failures.append(
            f"Overall accuracy {scores['overall_accuracy']:.2%} < required {overall_min:.2%}"
        )

    per_cat_min: float = thresholds.get("per_category_min", 0.70)
    for bucket, acc in scores["per_bucket"].items():
        n = scores["bucket_totals"].get(bucket, 0)
        if n < 5:
            # Too few examples to be meaningful — skip threshold for this bucket
            continue
        if acc < per_cat_min:
            failures.append(
                f"Bucket '{bucket}' ({n} examples): accuracy {acc:.2%} < required {per_cat_min:.2%}"
            )

    # 4.3 — model must beat keyword baseline on route tasks (4.3)
    if not scores.get("model_beats_baseline", True):
        failures.append(
            f"Model route accuracy {scores['route_accuracy']:.2%} does not exceed "
            f"keyword baseline {scores['baseline_route_accuracy']:.2%} — "
            "rule-based fallback is preferable"
        )

    return len(failures) == 0, failures


# ─── Registry / metadata updates (4.4) ────────────────────────────────────────
def _update_registry(scores: dict, passed: bool) -> None:
    try:
        cur = json.loads(_CURRENT_JSON.read_text())
        cur["eval_scores"] = scores
        cur["status"] = "ready" if passed else "eval_failed"
        _CURRENT_JSON.write_text(json.dumps(cur, indent=2) + "\n")
    except Exception as e:
        _emit({"type": "warning", "warning": f"Could not update current.json: {e}"})


def _update_artifact_metadata(artifact_path: str | None, scores: dict, passed: bool) -> None:
    if not artifact_path:
        return
    meta_path = Path(artifact_path) / "metadata.json"
    if not meta_path.exists():
        return
    try:
        meta = json.loads(meta_path.read_text())
        meta["eval_scores"] = scores
        meta["eval_passed"] = passed
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    except Exception as e:
        _emit({"type": "warning", "warning": f"Could not update artifact metadata.json: {e}"})


# ─── Argument parsing ─────────────────────────────────────────────────────────
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Valet Router eval gate")
    p.add_argument("--config",       default=str(_REPO_ROOT / "valet.config.json"))
    p.add_argument("--eval-path",    default="",
                   help="Override path to eval.jsonl (default from config)")
    p.add_argument("--artifact-dir", default="",
                   help="Override artifact directory (default from current.json)")
    p.add_argument("--max-examples", type=int, default=0,
                   help="Cap number of eval rows (0 = all; useful for smoke tests)")
    return p.parse_args()


# ─── Entry point ──────────────────────────────────────────────────────────────
def main() -> None:
    args = _parse_args()

    # Load config
    cfg_path = Path(args.config)
    if not cfg_path.exists():
        _emit({"type": "error", "error": f"Config not found: {cfg_path}"})
        sys.exit(1)
    cfg = json.loads(cfg_path.read_text())
    cfg.pop("_comment", None)
    thresholds = cfg.get("eval_thresholds", {"overall": 0.85, "per_category_min": 0.70})

    # Resolve eval path
    eval_path = (
        Path(args.eval_path) if args.eval_path
        else _REPO_ROOT / cfg.get("eval_out", "data/valet/eval.jsonl")
    )
    if not eval_path.exists():
        _emit({"type": "error",
               "error": f"Eval set not found: {eval_path}. Run the dataset build step first."})
        sys.exit(1)

    # Read registry
    try:
        registry = json.loads(_CURRENT_JSON.read_text())
    except Exception:
        registry = {}

    # Allow eval on artifacts whose training is complete even if a prior eval failed
    if registry.get("status") not in ("ready", "eval_failed", "trained"):
        _emit({"type": "error",
               "error": "No trained artifact in current.json. Run the training step first."})
        sys.exit(1)

    # Resolve artifact dir for metadata update
    artifact_path = args.artifact_dir or registry.get("artifact_path") or None

    # Load model
    _emit({
        "type": "eval_model_loading",
        "format": registry.get("format", "unknown"),
        "artifact_path": str(artifact_path),
    })
    model_ready = _load_model(registry)
    if not model_ready:
        _emit({
            "type": "error",
            "error": (
                "Could not load the trained artifact for evaluation. "
                "For gguf format: install llama-cpp-python. "
                "For lora/merged: install transformers + torch. "
                "For ollama format: ensure the Ollama service is running and the model is pulled."
            ),
        })
        sys.exit(1)

    _emit({"type": "eval_model_ready", "backend": _backend_type})

    # Run eval
    scores = run_eval(eval_path=eval_path, max_examples=args.max_examples)

    # Check thresholds
    passed, failures = check_thresholds(scores, thresholds)
    scores["passed"] = passed
    scores["threshold_failures"] = failures

    # Print summary
    _emit({
        "type": "eval_complete",
        "passed": passed,
        "overall_accuracy": scores["overall_accuracy"],
        "route_accuracy": scores["route_accuracy"],
        "baseline_route_accuracy": scores["baseline_route_accuracy"],
        "model_beats_baseline": scores["model_beats_baseline"],
        "confidence_mean": scores["confidence_mean"],
        "confidence_std": scores["confidence_std"],
        "per_bucket": scores["per_bucket"],
        "backend": _backend_type,
        "threshold_failures": failures,
    })

    # Persist scores (4.4)
    _update_registry(scores, passed)
    _update_artifact_metadata(artifact_path, scores, passed)

    if not passed:
        _emit({
            "type": "eval_gate_fail",
            "reason": "Eval thresholds not met — artifact status set to 'eval_failed'",
            "failures": failures,
        })
        sys.exit(1)

    _emit({
        "type": "eval_gate_pass",
        "message": "All thresholds met — artifact confirmed as ready",
    })


if __name__ == "__main__":
    main()
