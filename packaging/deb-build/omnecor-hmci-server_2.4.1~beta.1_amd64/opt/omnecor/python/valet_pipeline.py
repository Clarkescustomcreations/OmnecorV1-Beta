#!/usr/bin/env python3
"""
valet_pipeline.py — Valet Router Build Pipeline
Orchestrates: dataset build → validate → LoRA train → gguf export → register artifact.
One entrypoint for both `pnpm valet:build` (CI/headless) and the tRPC
`trainingRouter.buildValetRouter` procedure (spawned via ProcessManager).

Streams JSON progress lines to stdout so ProcessManager can relay them to
the WebSocket channel `training:<jobId>`.

Usage:
  python3 server/python_bridges/valet_pipeline.py [--config valet.config.json] [--force]
"""
import argparse
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# ─── resolve repo root relative to this file ─────────────────────────────────

_REPO_ROOT = Path(__file__).parent.parent.parent
_TRAINING_DIR = _REPO_ROOT / "docs" / "ai-agents" / "valet-training"
_DEFAULT_CONFIG = _REPO_ROOT / "valet.config.json"

# ─── paths to sibling scripts ────────────────────────────────────────────────

_DATASET_BUILDER = Path(__file__).parent / "valet_dataset_builder.py"
_LORA_TRAINER = Path(__file__).parent.parent / "phase2" / "python_scripts" / "localLLMfine-tuning.py"
_EVAL_SCRIPT = Path(__file__).parent / "valet_eval.py"
_DETECT_GPU = _REPO_ROOT / "packaging" / "scripts" / "detect_gpu.py"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
PYTHON_BIN = os.environ.get("PYTHON_BIN", sys.executable)


# ─── helpers ──────────────────────────────────────────────────────────────────

def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def _sha256_json(data: dict) -> str:
    """Stable hash of a dict (sorted keys)."""
    return hashlib.sha256(
        json.dumps(data, sort_keys=True).encode()
    ).hexdigest()[:16]


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _run_step(step: str, cmd: list[str], extra_env: dict | None = None) -> int:
    """
    Run a subprocess and relay its JSON stdout lines with a `step` field added.
    Returns the process exit code.
    """
    _emit({"type": "step_start", "step": step})
    env = {**os.environ, "PYTHONUNBUFFERED": "1", **(extra_env or {})}

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=env, text=True, bufsize=1,
        )
    except FileNotFoundError as e:
        _emit({"type": "step_error", "step": step, "error": str(e)})
        return 1

    for raw in proc.stdout:  # type: ignore[union-attr]
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
            _emit({"step": step, **data})
        except json.JSONDecodeError:
            pass  # non-JSON subprocess output — skip silently

    proc.wait()
    stderr_tail = (proc.stderr.read() or "")[-500:]  # type: ignore[union-attr]

    if proc.returncode != 0:
        _emit({"type": "step_error", "step": step,
               "exit_code": proc.returncode, "stderr": stderr_tail})
    else:
        _emit({"type": "step_complete", "step": step})

    return proc.returncode


# ─── preconditions check (1.5) ───────────────────────────────────────────────

def check_preconditions(cfg: dict, require_gpu: bool) -> None:
    """Fail fast with actionable messages if preconditions aren't met."""
    import urllib.request

    # 1. Disk space
    gb_required = cfg.get("disk_space_gb_required", 20)
    stat = shutil.disk_usage(_REPO_ROOT)
    gb_free = stat.free / (1024 ** 3)
    if gb_free < gb_required:
        _emit({"type": "error", "error":
               f"Not enough disk space: {gb_free:.1f} GB free, {gb_required} GB required."})
        sys.exit(1)

    # 2. Ollama reachable + oracle model available
    oracle = cfg.get("oracle_model", "llama3.2:latest")
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5) as resp:
            tags_data = json.loads(resp.read())
        models = [m["name"] for m in tags_data.get("models", [])]
        # Ollama tag may omit ":latest" — normalise for comparison
        def _norm(name: str) -> str:
            return name if ":" in name else f"{name}:latest"
        if _norm(oracle) not in [_norm(m) for m in models]:
            _emit({"type": "warning",
                   "warning": f"Oracle model '{oracle}' not found in Ollama tags. "
                               "The dataset build step will use the fallback text. "
                               f"Pull it first with: ollama pull {oracle}"})
    except Exception as e:
        _emit({"type": "warning",
               "warning": f"Ollama not reachable at {OLLAMA_URL}: {e}. "
                           "Dataset generation will use static fallbacks."})

    # 3. GPU (only hard-fail for on-device mode B; in mode A just warn)
    if require_gpu:
        has_nvidia = shutil.which("nvidia-smi") is not None
        has_amd = shutil.which("rocm-smi") is not None
        if not has_nvidia and not has_amd:
            _emit({"type": "error", "error":
                   "No GPU detected (nvidia-smi / rocm-smi not found). "
                   "On-device training requires a supported GPU. "
                   "Set FORCE_CPU=1 only for testing with CPU (very slow)."})
            sys.exit(1)


# ─── idempotency helpers (1.3) ───────────────────────────────────────────────

def _dataset_is_fresh(cfg: dict, config_hash: str) -> tuple[bool, str]:
    """Return (skip, dataset_hash). Skip if metadata.json shows config is unchanged."""
    meta_path = _REPO_ROOT / cfg.get("dataset_out", "data/valet/train.jsonl")
    meta_path = meta_path.parent / "metadata.json"
    train_path = _REPO_ROOT / cfg.get("dataset_out", "data/valet/train.jsonl")

    if not meta_path.exists() or not train_path.exists():
        return False, ""

    try:
        meta = json.loads(meta_path.read_text())
        manifest = json.loads(
            (_TRAINING_DIR / "routing_manifest.json").read_text()
        )
        if (meta.get("manifest_version") == manifest.get("manifest_version") and
                meta.get("random_seed") == cfg.get("seed")):
            dataset_hash = _sha256_file(train_path)
            return True, dataset_hash
    except Exception:
        pass
    return False, ""


def _artifact_is_fresh(cfg: dict, dataset_hash: str, config_hash: str) -> bool:
    """Return True if training is already done for this (base_model, dataset_hash, config_hash).
    Accepts ready/eval_failed so a failed eval doesn't trigger a full retrain."""
    current_path = _REPO_ROOT / cfg.get("registry_root", "models/valet-router") / "current.json"
    if not current_path.exists():
        return False
    try:
        cur = json.loads(current_path.read_text())
        return (
            cur.get("base_model") == cfg.get("base_model") and
            cur.get("dataset_hash") == dataset_hash and
            cur.get("config_hash") == config_hash and
            cur.get("status") in ("ready", "eval_failed", "trained")
        )
    except Exception:
        return False


def _eval_is_current(cfg: dict, dataset_hash: str, config_hash: str) -> bool:
    """Return True if current.json already has passing eval scores for this build."""
    current_path = _REPO_ROOT / cfg.get("registry_root", "models/valet-router") / "current.json"
    if not current_path.exists():
        return False
    try:
        cur = json.loads(current_path.read_text())
        scores = cur.get("eval_scores", {})
        return (
            cur.get("status") == "ready" and
            scores.get("passed") is True and
            cur.get("dataset_hash") == dataset_hash and
            cur.get("config_hash") == config_hash
        )
    except Exception:
        return False


# ─── dataset validation ───────────────────────────────────────────────────────

def validate_dataset(train_path: Path) -> int:
    """Basic schema check: count rows and verify 'text' field is present if emit_text was set."""
    _emit({"type": "step_start", "step": "validate"})
    if not train_path.exists():
        _emit({"type": "step_error", "step": "validate",
               "error": f"Dataset not found: {train_path}"})
        return 1

    count = 0
    missing_text = 0
    for line in train_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
            count += 1
            if "text" not in row:
                missing_text += 1
        except json.JSONDecodeError:
            pass

    _emit({"type": "step_complete", "step": "validate",
           "rows": count, "missing_text_field": missing_text})
    if count == 0:
        _emit({"type": "step_error", "step": "validate", "error": "Dataset is empty."})
        return 1
    return 0


# ─── argument parsing ─────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Valet Router build pipeline")
    p.add_argument("--config", default=str(_DEFAULT_CONFIG),
                   help="Path to valet.config.json")
    p.add_argument("--force", action="store_true", default=False,
                   help="Force rebuild even if artifact/dataset is already fresh")
    p.add_argument("--require-gpu", action="store_true", default=False,
                   help="Hard-fail if no GPU is detected (for on-device mode B)")
    return p.parse_args()


# ─── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()
    force: bool = args.force

    # ── load config ───────────────────────────────────────────────────────────
    config_path = Path(args.config)
    if not config_path.exists():
        _emit({"type": "error",
               "error": f"Config not found: {config_path}. Run from the repo root or pass --config."})
        sys.exit(1)

    cfg: dict = json.loads(config_path.read_text())
    # Strip the comment key that JSON doesn't support natively
    cfg.pop("_comment", None)

    config_hash = _sha256_json(cfg)

    _emit({
        "type": "pipeline_start",
        "base_model": cfg.get("base_model"),
        "config_hash": config_hash,
        "force": force,
    })

    # ── preconditions (1.5) ───────────────────────────────────────────────────
    check_preconditions(cfg, require_gpu=args.require_gpu)

    # ── step 1: dataset build (idempotent) ────────────────────────────────────
    train_path = _REPO_ROOT / cfg.get("dataset_out", "data/valet/train.jsonl")
    skip_dataset, dataset_hash = _dataset_is_fresh(cfg, config_hash)

    if skip_dataset and not force:
        _emit({"type": "step_skip", "step": "dataset",
               "reason": "dataset is fresh (manifest_version + seed unchanged)",
               "dataset_hash": dataset_hash})
    else:
        rc = _run_step("dataset", [
            PYTHON_BIN, str(_DATASET_BUILDER),
            "--total",        str(cfg.get("total_examples", 2000)),
            "--oracle-model", cfg.get("oracle_model", "llama3.2:latest"),
            "--seed",         str(cfg.get("seed", 42)),
            "--out",          str(train_path),
            "--val-out",      str(_REPO_ROOT / cfg.get("val_out", "data/valet/val.jsonl")),
            "--eval-out",     str(_REPO_ROOT / cfg.get("eval_out", "data/valet/eval.jsonl")),
            *(["--emit-text"] if cfg.get("emit_text", True) else []),
        ])
        if rc != 0:
            sys.exit(rc)
        dataset_hash = _sha256_file(train_path) if train_path.exists() else ""

    # ── step 2: validate ──────────────────────────────────────────────────────
    rc = validate_dataset(train_path)
    if rc != 0:
        sys.exit(rc)

    # ── step 3: LoRA train (idempotent) ───────────────────────────────────────
    if _artifact_is_fresh(cfg, dataset_hash, config_hash) and not force:
        _emit({"type": "step_skip", "step": "train",
               "reason": "artifact already registered for this base_model + dataset_hash + config_hash"})
    else:
        base_model = cfg.get("base_model", "Qwen/Qwen2.5-1.5B-Instruct")
        date_tag = datetime.datetime.utcnow().strftime("%Y%m%d")
        model_slug = base_model.split("/")[-1].lower()
        artifact_dir = (
            _REPO_ROOT /
            cfg.get("registry_root", "models/valet-router") /
            f"{model_slug}-{dataset_hash[:8]}-{date_tag}"
        )
        artifact_dir.mkdir(parents=True, exist_ok=True)

        rc = _run_step("train", [
            PYTHON_BIN, str(_LORA_TRAINER),
            "--model_name",    base_model,
            "--dataset_path",  str(train_path),
            "--output_dir",    str(artifact_dir),
            "--epochs",        str(cfg.get("epochs", 3)),
            "--r",             str(cfg.get("r", 16)),
            "--lora_alpha",    str(cfg.get("lora_alpha", 32)),
            "--max_seq_length",str(cfg.get("max_seq_length", 2048)),
            "--save_method",   cfg.get("save_method", "gguf"),
            "--task_type",     "router",
            "--registry_root", str(_REPO_ROOT / cfg.get("registry_root", "models/valet-router")),
            "--dataset_hash",  dataset_hash,
        ])
        if rc != 0:
            sys.exit(rc)

        # Stamp config_hash into current.json so future runs can detect freshness
        current_path = _REPO_ROOT / cfg.get("registry_root", "models/valet-router") / "current.json"
        if current_path.exists():
            try:
                cur = json.loads(current_path.read_text())
                cur["config_hash"] = config_hash
                current_path.write_text(json.dumps(cur, indent=2) + "\n")
            except Exception:
                pass

    # ── step 4: eval gate (4.1–4.5) ──────────────────────────────────────────
    if _eval_is_current(cfg, dataset_hash, config_hash) and not force:
        _emit({"type": "step_skip", "step": "eval",
               "reason": "eval scores already current (passing) for this build"})
    else:
        eval_path = _REPO_ROOT / cfg.get("eval_out", "data/valet/eval.jsonl")
        rc = _run_step("eval", [
            PYTHON_BIN, str(_EVAL_SCRIPT),
            "--config", str(config_path),
            "--eval-path", str(eval_path),
        ])
        if rc != 0:
            sys.exit(rc)

    _emit({
        "type": "pipeline_complete",
        "base_model": cfg.get("base_model"),
        "dataset_hash": dataset_hash,
        "config_hash": config_hash,
        "registry": str(_REPO_ROOT / cfg.get("registry_root", "models/valet-router") / "current.json"),
    })


if __name__ == "__main__":
    main()
