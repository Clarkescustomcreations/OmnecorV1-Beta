#!/usr/bin/env python3
"""
localLLMfine-tuning-qlora.py — TEMP / EXPERIMENTAL
QLoRA trainer for GTX 750 Ti (sm_50) + GTX 950 (sm_52) dual-PC setup.
Drop-in replacement for localLLMfine-tuning.py that removes Unsloth
and uses bitsandbytes + PEFT + gloo DDP for Maxwell GPU compatibility.

DO NOT use in production until tested. See tmp-valet-train/README.md.

─── Single machine ──────────────────────────────────────────────────────────
  python3 tmp-valet-train/localLLMfine-tuning-qlora.py \
          --dataset_path data/valet/train.jsonl

─── Distributed (run on EACH machine) ───────────────────────────────────────
  # Linux (rank 0 / master):
  torchrun --nproc_per_node=1 --nnodes=2 --node_rank=0 \
           --master_addr=192.168.1.252 --master_port=29500 \
           tmp-valet-train/localLLMfine-tuning-qlora.py \
           --dataset_path data/valet/train.jsonl

  # Windows (rank 1 / worker) — see valet-train-worker.bat:
  torchrun --nproc_per_node=1 --nnodes=2 --node_rank=1 \
           --master_addr=192.168.1.252 --master_port=29500 \
           localLLMfine-tuning-qlora.py \
           --dataset_path Z:\\omnecor\\data\\valet\\train.jsonl
"""
import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys

import torch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainerCallback,
    TrainingArguments,
)
from trl import SFTTrainer


# ─── Distributed helpers ──────────────────────────────────────────────────────

def _rank() -> int:
    return int(os.environ.get("RANK", "0"))

def _local_rank() -> int:
    return int(os.environ.get("LOCAL_RANK", "0"))

def _world_size() -> int:
    return int(os.environ.get("WORLD_SIZE", "1"))

def _is_main() -> bool:
    return _rank() == 0

def _is_distributed() -> bool:
    return _world_size() > 1


# ─── Callback ─────────────────────────────────────────────────────────────────

class JsonLoggingCallback(TrainerCallback):
    """Streams training metrics as JSON lines to stdout (rank-0 only)."""
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs and _is_main():
            loss = logs.get("loss") or logs.get("eval_loss")
            output = {
                "epoch": round(state.epoch or 0.0, 4),
                "step": state.global_step,
                "loss": round(loss, 4) if loss is not None else None,
                "learning_rate": logs.get("learning_rate"),
            }
            output = {k: v for k, v in output.items() if v is not None}
            sys.stdout.write(json.dumps(output) + "\n")
            sys.stdout.flush()


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Omnecor Valet Router: QLoRA trainer (sm_50/sm_52 compatible)."
    )
    parser.add_argument("--model_name", type=str, default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--dataset_path", type=str, required=True)
    parser.add_argument("--output_dir", type=str, default="./tmp-valet-train/outputs")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--r", type=int, default=8, help="LoRA rank (keep <=8 for router)")
    parser.add_argument("--lora_alpha", type=int, default=16)
    parser.add_argument("--max_seq_length", type=int, default=2048)
    parser.add_argument(
        "--save_method", type=str, default="lora",
        choices=["lora", "merged_16bit", "gguf"],
        help="lora=adapters only; merged_16bit=full fp16; gguf=merged+converted",
    )
    parser.add_argument("--registry_root", type=str, default=None)
    parser.add_argument("--dataset_hash", type=str, default=None)
    parser.add_argument("--git_sha", type=str, default=None)
    parser.add_argument("--master_addr", type=str, default=None,
                        help="Override MASTER_ADDR (default: set by torchrun env)")
    parser.add_argument("--master_port", type=str, default="29500")
    return parser.parse_args()


# ─── Utilities ────────────────────────────────────────────────────────────────

def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


def _write_metadata(output_dir: str, args, dataset_hash: str, git_sha: str) -> None:
    meta = {
        "base_model": args.model_name,
        "dataset_path": args.dataset_path,
        "dataset_hash": dataset_hash,
        "format": args.save_method,
        "config": {
            "r": args.r,
            "lora_alpha": args.lora_alpha,
            "epochs": args.epochs,
            "max_seq_length": args.max_seq_length,
            "save_method": args.save_method,
        },
        "eval_scores": {},
        "git_sha": git_sha,
        "created_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "trained",
    }
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")


def _write_current_json(
    registry_root: str, output_dir: str, args, dataset_hash: str, git_sha: str
) -> None:
    record = {
        "artifact_path": output_dir.rstrip("/") + "/",
        "status": "ready",
        "base_model": args.model_name,
        "dataset_hash": dataset_hash,
        "format": args.save_method,
        "config": {
            "r": args.r,
            "lora_alpha": args.lora_alpha,
            "epochs": args.epochs,
            "max_seq_length": args.max_seq_length,
            "save_method": args.save_method,
        },
        "eval_scores": {},
        "git_sha": git_sha,
        "created_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "trained",
    }
    os.makedirs(registry_root, exist_ok=True)
    with open(os.path.join(registry_root, "current.json"), "w") as f:
        json.dump(record, f, indent=2)
        f.write("\n")


def _export_gguf(merged_dir: str, output_dir: str) -> str:
    """Attempt GGUF conversion via llama.cpp convert script."""
    gguf_path = os.path.join(output_dir, "model.gguf")
    candidates = [
        "convert_hf_to_gguf.py",
        os.path.expanduser("~/llama.cpp/convert_hf_to_gguf.py"),
        "/opt/llama.cpp/convert_hf_to_gguf.py",
    ]
    for script in candidates:
        if os.path.exists(script):
            subprocess.check_call(
                [sys.executable, script, merged_dir,
                 "--outfile", gguf_path, "--outtype", "q4_k_m"],
                stdout=sys.stdout, stderr=sys.stderr,
            )
            return gguf_path

    sys.stderr.write(
        json.dumps({
            "warning": "GGUF conversion skipped — llama.cpp convert_hf_to_gguf.py not found. "
                       "Model saved as merged fp16. To convert manually: "
                       f"python convert_hf_to_gguf.py {merged_dir} "
                       f"--outfile {gguf_path} --outtype q4_k_m"
        }) + "\n"
    )
    return merged_dir


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    if args.master_addr:
        os.environ.setdefault("MASTER_ADDR", args.master_addr)
        os.environ.setdefault("MASTER_PORT", args.master_port)

    dataset_hash = args.dataset_hash or _sha256_file(args.dataset_path)
    git_sha = args.git_sha or _git_sha()

    # ── 1. Device ─────────────────────────────────────────────────────────────
    use_cuda = torch.cuda.is_available()
    device_id = _local_rank() if use_cuda else None
    device_str = f"cuda:{device_id}" if use_cuda else "cpu"

    if _is_main():
        vram_mb = torch.cuda.get_device_properties(0).total_memory // 1024 ** 2 if use_cuda else 0
        sys.stdout.write(json.dumps({
            "step": "init",
            "device": device_str,
            "vram_mb": vram_mb,
            "world_size": _world_size(),
            "rank": _rank(),
        }) + "\n")
        sys.stdout.flush()

    # ── 2. Init process group ─────────────────────────────────────────────────
    if _is_distributed():
        # Use gloo — works on sm_50/sm_52 and on CPU; nccl requires sm_70+
        if not torch.distributed.is_initialized():
            torch.distributed.init_process_group(backend="gloo")
        if use_cuda:
            torch.cuda.set_device(device_id)
        if _is_main():
            sys.stdout.write(json.dumps({"step": "dist_init", "backend": "gloo"}) + "\n")
            sys.stdout.flush()

    # ── 3. Load model in 4-bit (QLoRA) ───────────────────────────────────────
    # device_map="auto" is incompatible with DDP; pin each rank to its own GPU
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
    )

    device_map = {"": device_str} if use_cuda else "cpu"

    try:
        tokenizer = AutoTokenizer.from_pretrained(args.model_name, trust_remote_code=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            args.model_name,
            quantization_config=bnb_config if use_cuda else None,
            torch_dtype=torch.float16,
            device_map=device_map,
            trust_remote_code=True,
        )
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Failed to load base model: {e}"}) + "\n")
        sys.exit(1)

    # ── 4. PEFT / LoRA ────────────────────────────────────────────────────────
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    # Needed for gradient checkpointing + DDP on quantized models
    model.enable_input_require_grads()

    lora_config = LoraConfig(
        r=args.r,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)

    if _is_main():
        model.print_trainable_parameters()

    # ── 5. Dataset ────────────────────────────────────────────────────────────
    try:
        dataset = load_dataset(
            "json",
            data_files={"train": args.dataset_path},
            split="train",
        )
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Dataset load failed: {e}"}) + "\n")
        sys.exit(1)

    # ── 6. Training args ──────────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=1,       # 1 per GPU — VRAM is tight
        gradient_accumulation_steps=16,      # effective batch = 16 × world_size
        gradient_checkpointing=True,
        warmup_steps=10,
        learning_rate=2e-4,
        fp16=True,                           # sm_50/sm_52: use fp16, not bf16
        bf16=False,
        logging_steps=1,
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        optim="paged_adamw_8bit",            # pages optimizer states to CPU on VRAM pressure
        seed=3407,
        report_to="none",
        ddp_find_unused_parameters=False,    # base params frozen — intentionally unused by DDP
        dataloader_num_workers=0,
    )

    # ── 7. Train ──────────────────────────────────────────────────────────────
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        tokenizer=tokenizer,
        args=training_args,
        callbacks=[JsonLoggingCallback()],
    )

    try:
        trainer.train()
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Training failed: {e}"}) + "\n")
        sys.exit(1)

    # ── 8. Save + register (rank 0 only) ─────────────────────────────────────
    if _is_main():
        os.makedirs(args.output_dir, exist_ok=True)

        if args.save_method == "lora":
            model.save_pretrained(args.output_dir)
            tokenizer.save_pretrained(args.output_dir)

        elif args.save_method in ("merged_16bit", "gguf"):
            merged_dir = os.path.join(args.output_dir, "merged")
            merged_model = model.merge_and_unload()
            merged_model.save_pretrained(merged_dir, safe_serialization=True)
            tokenizer.save_pretrained(merged_dir)

            if args.save_method == "gguf":
                _export_gguf(merged_dir, args.output_dir)

        try:
            _write_metadata(args.output_dir, args, dataset_hash, git_sha)
        except Exception as e:
            sys.stderr.write(json.dumps({"warning": f"metadata.json write failed: {e}"}) + "\n")

        if args.registry_root:
            try:
                _write_current_json(
                    args.registry_root, args.output_dir, args, dataset_hash, git_sha
                )
            except Exception as e:
                sys.stderr.write(json.dumps({"warning": f"current.json write failed: {e}"}) + "\n")

        sys.stdout.write(json.dumps({
            "status": "completed",
            "output_dir": args.output_dir,
            "dataset_hash": dataset_hash,
            "git_sha": git_sha,
        }) + "\n")
        sys.stdout.flush()

    if _is_distributed():
        torch.distributed.destroy_process_group()


if __name__ == "__main__":
    main()
