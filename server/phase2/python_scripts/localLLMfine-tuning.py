#!/usr/bin/env python3
import argparse
import json
import os
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
        default="unsloth/llama-3-8b-bnb-4bit",
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
    return parser.parse_args()


def main():
    args = parse_args()

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

    # 7. Save only the final LoRA adapters to output directory
    try:
        model.save_pretrained(args.output_dir)
        tokenizer.save_pretrained(args.output_dir)
        sys.stdout.write(json.dumps({"status": "completed", "output_dir": args.output_dir}) + "\n")
    except Exception as e:
        sys.stderr.write(json.dumps({"error": f"Failed saving adapters to destination: {str(e)}"}) + "\n")
        sys.exit(1)


if __name__ == "__main__":
    main()