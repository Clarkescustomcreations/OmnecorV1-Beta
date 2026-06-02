#!/usr/bin/env python3
import argparse
import datetime
import hashlib
import json
import os
import subprocess
import sys
from datasets import load_dataset
from transformers import TrainerCallback, TrainingArguments
from trl import SFTTrainer
from unsloth import FastLanguageModel


class JsonLoggingCallback(TrainerCallback):
    """
    Custom Hugging Face Trainer Callback that outputs metrics as strict JSON strings
    to stdout. This allows external parent processes (like a Node.js backend) to
    parse training progress (epoch, step, loss, learning rate) in real-time.
    """
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs:
            # We look for 'loss' (training loss) or 'eval_loss' if evaluation runs
            loss = logs.get("loss") or logs.get("eval_loss")
            
            # Formulate the JSON payload
            output = {
                "epoch": round(state.epoch or 0.0, 4),
                "step": state.global_step,
                "loss": round(loss, 4) if loss is not None else None,
                "learning_rate": logs.get("learning_rate"),
            }
            
            # Clean up keys with None values to keep the JSON succinct
            output = {k: v for k, v in output.items() if v is not None}
            
            # Print exclusively to stdout and flush immediately for real-time parsing
            sys.stdout.write(json.dumps(output) + "\n")
            sys.stdout.flush()


def parse_args():
    parser = argparse.ArgumentParser(
        description="Omnecor Workstation: Standalone Unsloth LoRA Fine-Tuning CLI."
    )
    parser.add_argument(
        "--model_name",
        type=str,
        default="Qwen/Qwen2.5-1.5B-Instruct",
        help="The Hugging Face stub or local path for an Unsloth-compatible 4-bit model."
    )
    parser.add_argument(
        "--dataset_path",
        type=str,
        required=True,
        help="Path to the local JSONL dataset file used for supervised fine-tuning."
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="./outputs",
        help="The directory where the final trained LoRA adapters will be saved."
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=1,
        help="Total number of full training epochs to perform."
    )
    parser.add_argument(
        "--r",
        type=int,
        default=16,
        help="LoRA rank dimension."
    )
    parser.add_argument(
        "--lora_alpha",
        type=int,
        default=16,
        help="LoRA scaling factor."
    )
    parser.add_argument(
        "--max_seq_length",
        type=int,
        default=2048,
        help="Maximum sequence length."
    )
    parser.add_argument(
        "--save_method",
        type=str,
        default="lora",
        choices=["lora", "merged_16bit", "merged_4bit", "gguf", "ollama"],
        help="Method used to save the final model."
    )
    parser.add_argument(
        "--task_type",
        type=str,
        default="chat",
        choices=["chat", "code", "research", "summarization", "router"],
        help="Task type for specialized fine-tuning (use 'router' to fine-tune the 1.5B Valet Router model)"
    )
    parser.add_argument(
        "--registry_root",
        type=str,
        default=None,
        help="Path to models/valet-router/. When set, writes metadata.json into output_dir and updates current.json in registry_root after a successful run.",
    )
    parser.add_argument(
        "--dataset_hash",
        type=str,
        default=None,
        help="SHA-256 hex digest of the dataset file. Auto-computed from --dataset_path if not provided.",
    )
    parser.add_argument(
        "--git_sha",
        type=str,
        default=None,
        help="Git commit SHA to record in metadata.json. Auto-detected via 'git rev-parse HEAD' if not provided.",
    )
    return parser.parse_args()


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
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


def _write_current_json(registry_root: str, output_dir: str, args, dataset_hash: str, git_sha: str) -> None:
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


def main():
    args = parse_args()

    # Resolve dataset hash and git SHA early so they're available at completion
    dataset_hash = args.dataset_hash or _sha256_file(args.dataset_path)
    git_sha = args.git_sha or _git_sha()

    # Router fine-tuning mode: adjust LoRA rank for the 1.5B Valet Router model
    if args.task_type == "router":
        # Valet Router fine-tuning: use smaller rank, routing-specific dataset format
        print("[ValetRouter] Fine-tuning in router mode: LoRA rank reduced, routing dataset expected")
        # The dataset should have fields: task, available_providers, decision (JSON)
        if hasattr(args, 'r'):
            args.r = min(args.r, 8)  # Router model stays small

    # 1. Load the pre-quantized 4-bit base model and its matching tokenizer via Unsloth
    max_seq_length = args.max_seq_length
    dtype = None           # None automatically detects and sets float16/bfloat16 depending on GPU
    load_in_4bit = True    # Strictly enforce 4-bit quantization to fit commodity hardware VRAM

    try:
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.model_name,
            max_seq_length=max_seq_length,
            dtype=dtype,
            load_in_4bit=load_in_4bit,
        )
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Failed to load base model: {str(e)}"}) + "\n")
        sys.exit(1)

    # 2. Configure Parameter-Efficient Fine-Tuning (PEFT/LoRA) wrappers on top of the base model
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.r,           # Rank dimension; higher means more expressiveness but more memory
        lora_alpha=args.lora_alpha, # Scaling factor for the LoRA adapter weights
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0,     # Optimally set to 0 by Unsloth for exact computational speedups
        bias="none",        # Optimally set to none
        use_gradient_checkpointing="unsloth", # Saves VRAM by recomputing activations during backward pass
        random_state=3407,  # Standard fixed seed for basic reproducibility
        max_seq_length=max_seq_length,
    )

    # 3. Load user-provided dataset (expects a local .jsonl or .json structured file)
    try:
        # If dataset_path points to JSONL, load it as a standard json dataset
        ext = os.path.splitext(args.dataset_path)[-1].lower()
        data_files = {"train": args.dataset_path}
        
        if ext == ".jsonl":
            dataset = load_dataset("json", data_files=data_files, split="train")
        else:
            # Fallback configuration attempting generic json structural parsing
            dataset = load_dataset("json", data_files=data_files, split="train")
            
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Failed to read dataset file: {str(e)}"}) + "\n")
        sys.exit(1)

    # 4. Define Supervised Fine-Tuning (SFT) parameters and execution configs
    training_args = TrainingArguments(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        num_train_epochs=args.epochs,
        learning_rate=2e-4,
        fp16=not FastLanguageModel.is_bfloat16_supported(),
        bf16=FastLanguageModel.is_bfloat16_supported(),
        logging_steps=1,  # Force callback triggering on every distinct tracking step
        output_dir=args.output_dir,
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=3407,
        report_to="none", # Suppress WAN/WandB streaming to prevent stdout noise pollution
    )

    # 5. Initialize the Trainer targeting the dataset format
    # Assumes the JSONL text data is mapped directly to a column named "text"
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=max_seq_length,
        tokenizer=tokenizer,
        args=training_args,
        callbacks=[JsonLoggingCallback()], # Hook our strict JSON printing parser layer
    )

    # 6. Execute training pipeline
    try:
        trainer.train()
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Exception encountered during trainer execution: {str(e)}"}) + "\n")
        sys.exit(1)

    # 7. Save the final adapters and register the artifact
    try:
        model.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Failed saving adapters to destination: {str(e)}"}) + "\n")
        sys.exit(1)

    # Write metadata.json into the artifact directory
    try:
        _write_metadata(args.output_dir, args, dataset_hash, git_sha)
    except Exception as e:
        sys.stderr.write(json.dumps({"warning": f"metadata.json write failed: {str(e)}"}) + "\n")

    # Update the model registry if --registry_root was provided
    if args.registry_root:
        try:
            _write_current_json(args.registry_root, args.output_dir, args, dataset_hash, git_sha)
        except Exception as e:
            sys.stderr.write(json.dumps({"warning": f"current.json write failed: {str(e)}"}) + "\n")

    sys.stdout.write(json.dumps({
        "status": "completed",
        "output_dir": args.output_dir,
        "dataset_hash": dataset_hash,
        "git_sha": git_sha,
    }) + "\n")


if __name__ == "__main__":
    main()