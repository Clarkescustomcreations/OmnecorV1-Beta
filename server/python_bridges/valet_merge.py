#!/usr/bin/env python3
"""
Generic CPU-only LoRA → merged fp16 model script.

Used by the Valet Router training pipeline to merge a LoRA adapter (e.g. pulled
from a Kaggle training run) into the base model so the inference bridge can load
it directly via _load_transformers().

Environment variables:
  VALET_MERGE_ADAPTER   Path to the LoRA adapter directory (contains adapter_config.json)
  VALET_MERGE_BASE      HuggingFace model ID or local path (default: Qwen/Qwen2.5-1.5B-Instruct)
  VALET_MERGE_OUT       Output directory for the merged fp16 model

Streams JSON progress lines for ProcessManager.
"""
import os
import json
import sys


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


ADAPTER = os.environ.get("VALET_MERGE_ADAPTER", "")
BASE = os.environ.get("VALET_MERGE_BASE", "Qwen/Qwen2.5-1.5B-Instruct")
OUT = os.environ.get("VALET_MERGE_OUT", "")

if not ADAPTER:
    emit({"step": "error", "status": "failed", "error": "VALET_MERGE_ADAPTER not set"})
    sys.exit(1)
if not OUT:
    emit({"step": "error", "status": "failed", "error": "VALET_MERGE_OUT not set"})
    sys.exit(1)

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

emit({"step": "load_base", "status": "running", "base": BASE, "adapter": ADAPTER})
tokenizer = AutoTokenizer.from_pretrained(ADAPTER)
base_model = AutoModelForCausalLM.from_pretrained(
    BASE, torch_dtype=torch.float16, device_map="cpu"
)

emit({"step": "merge", "status": "running"})
peft_model = PeftModel.from_pretrained(base_model, ADAPTER)
merged = peft_model.merge_and_unload()

emit({"step": "save", "status": "running", "output": OUT})
os.makedirs(OUT, exist_ok=True)
merged.save_pretrained(OUT, safe_serialization=True)
tokenizer.save_pretrained(OUT)

emit({"step": "done", "status": "complete", "output": OUT})
