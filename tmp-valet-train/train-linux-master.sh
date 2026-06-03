#!/usr/bin/env bash
# train-linux-master.sh — Linux rank-0 launcher
# Run this on the Linux machine (192.168.1.252) AFTER starting the Windows worker.
#
# Single-machine mode (no Windows):
#   SINGLE=1 bash tmp-valet-train/train-linux-master.sh
#
# Dual-PC mode (start Windows worker first, then run this):
#   bash tmp-valet-train/train-linux-master.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/tmp-valet-train/localLLMfine-tuning-qlora.py"
DATASET="$REPO_ROOT/data/valet/train.jsonl"
OUTPUT="$REPO_ROOT/tmp-valet-train/outputs"
VENV="${VENV:-$HOME/.omnecor/qlora-venv}"

MASTER_ADDR="192.168.1.252"
MASTER_PORT="29500"

if [[ ! -f "$DATASET" ]]; then
    echo "[ERROR] Dataset not found: $DATASET"
    echo "        Run dataset generation first: pnpm valet:build --dataset-only"
    exit 1
fi

source "$VENV/bin/activate" 2>/dev/null || true

if [[ "$SINGLE" == "1" ]]; then
    echo "[train] Single-machine mode (no distributed)"
    python3 "$SCRIPT" \
        --dataset_path "$DATASET" \
        --output_dir "$OUTPUT" \
        --save_method lora \
        --epochs 3
else
    echo "[train] Dual-PC master (rank 0) — waiting for Windows worker on $MASTER_PORT"
    echo "        Make sure valet-train-worker.bat is running on the Windows machine first."
    torchrun \
        --nproc_per_node=1 \
        --nnodes=2 \
        --node_rank=0 \
        --master_addr="$MASTER_ADDR" \
        --master_port="$MASTER_PORT" \
        "$SCRIPT" \
        --dataset_path "$DATASET" \
        --output_dir "$OUTPUT" \
        --save_method lora \
        --epochs 3
fi
