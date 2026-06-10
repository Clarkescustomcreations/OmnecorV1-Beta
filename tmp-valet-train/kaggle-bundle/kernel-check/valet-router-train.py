#!/usr/bin/env python3
"""
Omnecor Valet Router â€” Kaggle GPU training kernel (script type).

Runs on a free Kaggle T4/P100 (16GB). The whole point of this run vs. the
local GTX 950 runs: max_length=3072 so the model actually SEES the assistant
answer during training (answers start ~token 2027 in every example; the local
512-token cap truncated them away, which is why both local runs scored ~14%).

Expects an attached Kaggle dataset containing train.jsonl / val.jsonl /
eval.jsonl. The dataset slug is auto-detected under /kaggle/input.
Outputs the trained LoRA adapter to /kaggle/working/valet-adapter/.
"""
import glob
import json
import os
import subprocess
import sys

# Kaggle's base image lacks trl and ships older peft/bitsandbytes â€” install first
# (kernel runs with internet enabled). Pinned to versions known to work together.
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q",
     "trl==0.12.2", "peft==0.13.2", "bitsandbytes==0.44.1",
     "accelerate==1.1.1", "datasets==3.1.0"],
    check=True,
)

import torch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
OUT = "/kaggle/working/valet-adapter"
MAX_SEQ = 3072          # covers the longest example (~2857 tokens) + answer
EPOCHS = 1.5            # fresh base, correct context â€” no overfit headroom needed

# â”€â”€ Locate the attached dataset (first /kaggle/input/* dir holding train.jsonl) â”€â”€
def find_data_dir() -> str:
    for d in sorted(glob.glob("/kaggle/input/*")):
        if os.path.exists(os.path.join(d, "train.jsonl")):
            return d
    # also handle nested one level
    for d in sorted(glob.glob("/kaggle/input/*/*")):
        if os.path.exists(os.path.join(d, "train.jsonl")):
            return d
    raise FileNotFoundError("No attached dataset with train.jsonl under /kaggle/input")

DATA_DIR = find_data_dir()
print(f"[valet] using data dir: {DATA_DIR}", flush=True)
print(f"[valet] CUDA: {torch.cuda.is_available()} "
      f"({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})", flush=True)

# â”€â”€ Tokenizer + 4-bit base model (T4/P100 support bitsandbytes 4-bit) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token

bnb = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.float16,
)
model = AutoModelForCausalLM.from_pretrained(
    MODEL, quantization_config=bnb, device_map={"": 0}, trust_remote_code=True,
)
model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
model.enable_input_require_grads()

lora = LoraConfig(
    r=8, lora_alpha=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05, bias="none", task_type=TaskType.CAUSAL_LM,
)
model = get_peft_model(model, lora)
model.print_trainable_parameters()

# â”€â”€ Dataset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ds = load_dataset("json", data_files={"train": f"{DATA_DIR}/train.jsonl"}, split="train")
print(f"[valet] train examples: {len(ds)}", flush=True)

# â”€â”€ Train â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
args = SFTConfig(
    output_dir="/kaggle/working/ckpts",
    num_train_epochs=EPOCHS,
    per_device_train_batch_size=1,       # conservative â€” avoids OOM on first run
    gradient_accumulation_steps=16,      # effective batch = 16
    gradient_checkpointing=True,
    warmup_steps=10,
    learning_rate=2e-4,
    fp16=True, bf16=False,
    logging_steps=5,
    save_strategy="epoch",
    save_total_limit=1,
    weight_decay=0.01,
    lr_scheduler_type="cosine",
    optim="paged_adamw_8bit",
    seed=3407,
    report_to="none",
    dataset_text_field="text",
    max_length=MAX_SEQ,
    dataloader_num_workers=2,
)
trainer = SFTTrainer(model=model, train_dataset=ds, processing_class=tok, args=args)
trainer.train()

# â”€â”€ Save adapter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
os.makedirs(OUT, exist_ok=True)
model.save_pretrained(OUT)
tok.save_pretrained(OUT)
with open(os.path.join(OUT, "train_config.json"), "w") as f:
    json.dump({"model": MODEL, "max_seq": MAX_SEQ, "epochs": EPOCHS,
               "r": 8, "lora_alpha": 16, "train_examples": len(ds)}, f, indent=2)
print(f"[valet] adapter saved to {OUT}", flush=True)

# â”€â”€ Sanity check: does it now emit routing JSON instead of manifest fragments? â”€â”€
print("\n[valet] === SANITY CHECK (5 eval examples) ===", flush=True)
model.eval()
eval_path = f"{DATA_DIR}/eval.jsonl"
if os.path.exists(eval_path):
    with open(eval_path) as f:
        evals = [json.loads(l) for l in f][:5]
    for i, ex in enumerate(evals):
        text = ex["text"]
        marker = "<|im_start|>assistant"
        prompt = text[:text.find(marker) + len(marker) + 1]  # include "assistant\n"
        ids = tok(prompt, return_tensors="pt", truncation=True, max_length=MAX_SEQ).to(model.device)
        with torch.no_grad():
            out = model.generate(**ids, max_new_tokens=80, do_sample=False,
                                 pad_token_id=tok.pad_token_id)
        gen = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
        print(f"\n--- ex{i} task_class={ex.get('task_class')}", flush=True)
        print(f"    GEN:      {gen.strip()[:160]}", flush=True)
        print(f"    EXPECTED: {str(ex.get('output'))[:160]}", flush=True)
else:
    print("[valet] no eval.jsonl found for sanity check", flush=True)

print("\n[valet] DONE.", flush=True)
