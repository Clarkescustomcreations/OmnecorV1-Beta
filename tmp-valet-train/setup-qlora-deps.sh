#!/usr/bin/env bash
# setup-qlora-deps.sh — Install QLoRA deps for sm_50/sm_52 (no Unsloth required)
# Run once on Linux before training.
set -e

VENV="${VENV:-$HOME/.omnecor/qlora-venv}"

if [[ -f "$VENV/.setup-complete" && "$FORCE" != "1" ]]; then
    echo "[setup] Already complete. Set FORCE=1 to reinstall."
    exit 0
fi

echo "[setup] Creating venv at $VENV"
python3 -m venv "$VENV"
source "$VENV/bin/activate"

pip install --upgrade pip wheel

# PyTorch — current system has 2.10 with CUDA 12.8 which works for sm_50
# Use the version already verified working on this machine
pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cu128 || \
pip install torch --index-url https://download.pytorch.org/whl/cu128

# Core ML deps
pip install \
    transformers \
    datasets \
    accelerate \
    trl \
    peft \
    "bitsandbytes>=0.43.0"   # 0.43+ has sm_50 support

touch "$VENV/.setup-complete"
echo "[setup] Done. Activate with: source $VENV/bin/activate"
