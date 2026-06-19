# tmp-valet-train — Experimental QLoRA Dual-PC Trainer

> **⚠️ STATUS: Archived / Superseded.** The production Valet Router is trained
> via Kaggle's free-tier T4 GPU pipeline (`pnpm valet:build`, see
> [docs/ai-agents/VALET_ROUTER.md](../docs/ai-agents/VALET_ROUTER.md) and
> [docs/ai-agents/valet-training/](../docs/ai-agents/valet-training/)) and
> distributed as a GitHub Release GGUF artifact — that is the supported path.
> This folder is kept for reference only, in case local dual-PC training on
> older/low-VRAM GPUs (e.g. pre-Turing Maxwell cards without Unsloth support)
> is needed again. It is not part of the build or CI pipeline.

Experimental replacement for `localLLMfine-tuning.py` that works on Maxwell
GPUs (GTX 750 Ti sm_50, GTX 950 sm_52) without Unsloth.

**Do not merge into the main project until tested end-to-end.**

## Files

| File | Purpose |
|------|---------|
| `localLLMfine-tuning-qlora.py` | Trainer (bitsandbytes + PEFT + gloo DDP) |
| `setup-qlora-deps.sh` | One-time dep install on Linux |
| `train-linux-master.sh` | Linux launcher (rank 0 / master) |
| `valet-train-worker.bat` | Windows launcher (rank 1 / worker) |

## Hardware

| Machine | GPU | VRAM | Role |
|---------|-----|------|------|
| Linux 192.168.1.252 | GTX 750 Ti | 2 GB + 20 GB swap | master (rank 0) |
| Windows (LAN) | GTX 950 | 4 GB | worker (rank 1) |

## Step-by-step

### 1. Generate the dataset (Linux only)
```bash
cd OmnecorV1-Beta
pnpm valet:build   # or just the dataset step
```
Dataset lands at `data/valet/train.jsonl`.

### 2. Install QLoRA deps (Linux)
```bash
bash tmp-valet-train/setup-qlora-deps.sh
```

### 3. Set up Windows machine
```bat
pip install torch --index-url https://download.pytorch.org/whl/cu118
pip install transformers datasets accelerate trl peft bitsandbytes
```
Copy `localLLMfine-tuning-qlora.py` and `data/valet/train.jsonl` to Windows.
Edit paths in `valet-train-worker.bat`.

### 4. Open firewall port on Linux (rank 0 is the server)
```bash
sudo ufw allow 29500/tcp
```

### 5. Share dataset from Linux to Windows (optional — Samba)
```bash
# Linux: install and configure Samba to share the project folder
sudo apt install samba
# Then on Windows: net use Z: \\192.168.1.252\omnecor
```

### 6. Run training
Start the Windows worker FIRST (it will wait for the master):
```bat
valet-train-worker.bat
```
Then start the Linux master:
```bash
bash tmp-valet-train/train-linux-master.sh
```

For single-machine test (Linux only, no Windows needed):
```bash
SINGLE=1 bash tmp-valet-train/train-linux-master.sh
```

## Memory profile (expected)

| Component | VRAM usage |
|-----------|-----------|
| Qwen2.5-1.5B in 4-bit (NF4) | ~750 MB |
| LoRA adapters (r=8) | ~40 MB |
| Activations (gradient_checkpointing) | ~400 MB |
| paged_adamw_8bit (overflows to CPU) | ~200 MB GPU + swap |
| **Total GPU** | **~1.4 GB** (fits in 2 GB) |

## After training

Output lands in `tmp-valet-train/outputs/`.
- `adapter_config.json` + `adapter_model.safetensors` = LoRA adapters
- `metadata.json` = training record

To use with the inference server, copy the output dir path into
`models/valet-router/current.json` as `artifact_path` with `format: "lora"`.

## Known limitations

- gloo backend is slower than NCCL (~2–3× slower gradient sync over LAN)
- GGUF export requires `llama.cpp` checkout separately
- Windows worker must have the dataset locally or via a mapped network share
