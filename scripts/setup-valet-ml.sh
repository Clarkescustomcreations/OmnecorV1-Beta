#!/usr/bin/env bash
# setup-valet-ml.sh — Bootstrap the Unsloth ML training stack for the Valet Router.
#
# Creates a Python venv at ~/.omnecor/ml-venv and installs the training stack
# (torch, transformers, trl, datasets, unsloth). Idempotent — safe to re-run.
#
# Usage:
#   pnpm valet:setup-ml              # auto-detect GPU
#   FORCE_CPU=1 pnpm valet:setup-ml  # CPU-only (no unsloth; for testing only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${HOME}/.omnecor/ml-venv"
DETECT_GPU="${SCRIPT_DIR}/../packaging/scripts/detect_gpu.py"
MARKER="${VENV_DIR}/.setup-complete"

echo "[setup-valet-ml] Venv: ${VENV_DIR}"

# ── Idempotency check ─────────────────────────────────────────────────────────
if [[ -f "${MARKER}" && "${FORCE:-0}" != "1" ]]; then
  echo "[setup-valet-ml] Already installed (use FORCE=1 to reinstall)."
  exit 0
fi

# ── Detect GPU ────────────────────────────────────────────────────────────────
HAS_GPU=0
if [[ "${FORCE_CPU:-0}" != "1" ]]; then
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
    HAS_GPU=1; echo "[setup-valet-ml] NVIDIA GPU detected."
  elif command -v rocm-smi &>/dev/null && rocm-smi &>/dev/null 2>&1; then
    HAS_GPU=1; echo "[setup-valet-ml] AMD ROCm GPU detected."
  else
    echo "[setup-valet-ml] No GPU detected — installing CPU-only stack (no unsloth)."
  fi
fi

# ── Create venv ───────────────────────────────────────────────────────────────
if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

PIP="${VENV_DIR}/bin/pip"

"${PIP}" install --upgrade pip --quiet

# ── Core ML deps (always) ─────────────────────────────────────────────────────
"${PIP}" install \
  "transformers>=4.40.0" \
  "trl>=0.8.0" \
  "datasets>=2.19.0" \
  "accelerate>=0.30.0" \
  "peft>=0.10.0" \
  "sentencepiece" \
  --quiet

# ── Torch + Unsloth (GPU only) ────────────────────────────────────────────────
if [[ "${HAS_GPU}" -eq 1 ]]; then
  echo "[setup-valet-ml] Installing torch + unsloth (GPU)..."
  "${PIP}" install "torch>=2.3.0" --index-url https://download.pytorch.org/whl/cu121 --quiet || \
    "${PIP}" install "torch>=2.3.0" --quiet
  "${PIP}" install "unsloth[colab-new]@git+https://github.com/unslothai/unsloth.git" --quiet || \
    "${PIP}" install "unsloth" --quiet
else
  echo "[setup-valet-ml] Installing torch (CPU)..."
  "${PIP}" install "torch>=2.3.0" --quiet
fi

# ── Mark complete ─────────────────────────────────────────────────────────────
date -u +%Y-%m-%dT%H:%M:%SZ > "${MARKER}"

echo "[setup-valet-ml] Done. Activate with: source ${VENV_DIR}/bin/activate"
