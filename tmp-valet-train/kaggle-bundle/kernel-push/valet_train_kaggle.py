#!/usr/bin/env python3
"""
Omnecor Valet Router — Kaggle GPU training kernel (script type), GPU-AGNOSTIC.

Why this version: the account kept drawing a Tesla P100 (sm_60), which Kaggle's
current base-image PyTorch does NOT support (it only ships sm_70+). Fix: install
a stock PyTorch wheel (cu121) that includes sm_60..sm_90 kernels, and skip
bitsandbytes/4-bit entirely — plain fp16 fits a 1.5B model easily in the
P100/T4's 16GB. So this runs on whatever GPU Kaggle hands us.

The whole point vs. the local GTX 950 runs: max_length=3072 so the model
actually SEES the assistant answer during training (answers start ~token 2027;
the local 512-token cap truncated them away → both local runs scored ~14%).

Expects an attached Kaggle dataset containing train.jsonl / val.jsonl / eval.jsonl.
Outputs the trained LoRA adapter to /kaggle/working/valet-adapter/.
"""
import glob
import json
import os
import subprocess
import sys

# ── Install a coherent, GPU-agnostic stack BEFORE importing torch ───────────────
# Stock torch 2.4.1 cu121 includes sm_60 (P100) through sm_90. No bitsandbytes.
# torchvision must match torch exactly, or transformers' import of it fails with
# "operator torchvision::nms does not exist" (the image ships a newer torchvision).
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q",
     "torch==2.4.1", "torchvision==0.19.1",
     "--index-url", "https://download.pytorch.org/whl/cu121"],
    check=True,
)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q",
     "transformers==4.46.3", "trl==0.12.2", "peft==0.13.2",
     "accelerate==1.1.1", "datasets==3.1.0"],
    check=True,
)

import torch
print(f"[valet] torch {torch.__version__} | arch list: {torch.cuda.get_arch_list()}", flush=True)
if not torch.cuda.is_available():
    print("[valet] FATAL: no CUDA GPU. Enable the GPU accelerator.", flush=True)
    sys.exit(1)
_cap = torch.cuda.get_device_capability(0)
print(f"[valet] GPU: {torch.cuda.get_device_name(0)}  sm_{_cap[0]}{_cap[1]}", flush=True)
print(f"[valet] /kaggle/input: {os.listdir('/kaggle/input') if os.path.isdir('/kaggle/input') else 'MISSING'}", flush=True)

from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer

MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
OUT = "/kaggle/working/valet-adapter"
MAX_SEQ = 3072          # covers the longest example (~2857 tokens) + answer
EPOCHS = 1.5            # fresh base, correct context — no overfit headroom needed

# ── Locate the attached dataset (recurse: Kaggle may mount under input/datasets/*)
def find_data_dir() -> str:
    for pat in ("/kaggle/input/*", "/kaggle/input/*/*", "/kaggle/input/*/*/*"):
        for d in sorted(glob.glob(pat)):
            if os.path.exists(os.path.join(d, "train.jsonl")):
                return d
    raise FileNotFoundError("No attached dataset with train.jsonl under /kaggle/input")

DATA_DIR = find_data_dir()
print(f"[valet] data dir: {DATA_DIR}", flush=True)

# ── Tokenizer + fp16 base model (no quantization) ───────────────────────────────
tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token

model = AutoModelForCausalLM.from_pretrained(
    MODEL, torch_dtype=torch.float16, device_map={"": 0}, trust_remote_code=True,
)
model.gradient_checkpointing_enable()
model.enable_input_require_grads()

lora = LoraConfig(
    r=8, lora_alpha=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05, bias="none", task_type=TaskType.CAUSAL_LM,
)
model = get_peft_model(model, lora)
model.print_trainable_parameters()

ds = load_dataset("json", data_files={"train": f"{DATA_DIR}/train.jsonl"}, split="train")
print(f"[valet] train examples: {len(ds)}", flush=True)

# ── Train (adamw_torch — LoRA params only, tiny optimizer state) ─────────────────
args = SFTConfig(
    output_dir="/kaggle/working/ckpts",
    num_train_epochs=EPOCHS,
    per_device_train_batch_size=1,
    gradient_accumulation_steps=16,
    gradient_checkpointing=True,
    warmup_steps=10,
    learning_rate=2e-4,
    fp16=True, bf16=False,
    logging_steps=5,
    save_strategy="epoch",
    save_total_limit=1,
    weight_decay=0.01,
    lr_scheduler_type="cosine",
    optim="adamw_torch",
    seed=3407,
    report_to="none",
    dataset_text_field="text",
    max_seq_length=MAX_SEQ,   # trl 0.12.x name (renamed to max_length in 0.13+)
    dataloader_num_workers=2,
)
trainer = SFTTrainer(model=model, train_dataset=ds, processing_class=tok, args=args)
trainer.train()

# ── Save adapter ────────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
model.save_pretrained(OUT)
tok.save_pretrained(OUT)
with open(os.path.join(OUT, "train_config.json"), "w") as f:
    json.dump({"model": MODEL, "max_seq": MAX_SEQ, "epochs": EPOCHS,
               "r": 8, "lora_alpha": 16, "precision": "fp16",
               "train_examples": len(ds)}, f, indent=2)
print(f"[valet] adapter saved to {OUT}", flush=True)

# ── Sanity check: does it now emit routing JSON instead of manifest fragments? ──
print("\n[valet] === SANITY CHECK (5 eval examples) ===", flush=True)
model.eval()
eval_path = f"{DATA_DIR}/eval.jsonl"
if os.path.exists(eval_path):
    with open(eval_path) as f:
        evals = [json.loads(l) for l in f][:5]
    for i, ex in enumerate(evals):
        text = ex["text"]
        marker = "<|im_start|>assistant"
        prompt = text[:text.find(marker) + len(marker) + 1]
        ids = tok(prompt, return_tensors="pt", truncation=True, max_length=MAX_SEQ).to(model.device)
        with torch.no_grad():
            out = model.generate(**ids, max_new_tokens=80, do_sample=False,
                                 pad_token_id=tok.pad_token_id)
        gen = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
        print(f"\n--- ex{i} task_class={ex.get('task_class')}", flush=True)
        print(f"    GEN:      {gen.strip()[:160]}", flush=True)
        print(f"    EXPECTED: {str(ex.get('output'))[:160]}", flush=True)
else:
    print("[valet] no eval.jsonl for sanity check", flush=True)

print("\n[valet] DONE.", flush=True)
