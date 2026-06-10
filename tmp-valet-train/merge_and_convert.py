#!/usr/bin/env python3
"""Merge LoRA adapter with base model and convert to GGUF for Ollama."""
import json
import os
import subprocess
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ADAPTER_DIR = Path("tmp-valet-train/outputs")
MERGED_DIR = ADAPTER_DIR / "merged"
GGUF_PATH = ADAPTER_DIR / "valet-router.gguf"

print("=== Merging LoRA adapter ===")
adapter_cfg = json.loads((ADAPTER_DIR / "adapter_config.json").read_text())
base_name = adapter_cfg.get("base_model_name_or_path", "Qwen/Qwen2.5-1.5B-Instruct")

print(f"Base model: {base_name}")
print(f"Adapter:    {ADAPTER_DIR}")

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Device:     {device}")

# Load base + adapter
print("Loading base model...")
base = AutoModelForCausalLM.from_pretrained(
    base_name, dtype=torch.float16, device_map=device, trust_remote_code=True
)
print("Loading adapter...")
model = PeftModel.from_pretrained(base, str(ADAPTER_DIR))

# Merge
print("Merging...")
merged = model.merge_and_unload()

# Save merged
os.makedirs(MERGED_DIR, exist_ok=True)
print(f"Saving merged model to {MERGED_DIR}...")
merged.save_pretrained(str(MERGED_DIR), safe_serialization=True)

tokenizer = AutoTokenizer.from_pretrained(ADAPTER_DIR)
tokenizer.save_pretrained(str(MERGED_DIR))
print("✓ Merged model saved")

# Convert to GGUF (requires llama.cpp)
print("\n=== Converting to GGUF ===")
converter_script = None
candidates = [
    "convert_hf_to_gguf.py",
    str(Path.home() / "llama.cpp" / "convert_hf_to_gguf.py"),
    "/opt/llama.cpp/convert_hf_to_gguf.py",
]

for cand in candidates:
    if Path(cand).exists():
        converter_script = cand
        break

if converter_script:
    print(f"Found converter: {converter_script}")
    print(f"Converting to {GGUF_PATH}...")
    try:
        subprocess.check_call([
            sys.executable, converter_script,
            str(MERGED_DIR),
            "--outfile", str(GGUF_PATH),
            "--outtype", "q4_k_m",
        ])
        print(f"✓ GGUF saved: {GGUF_PATH}")
    except Exception as e:
        print(f"✗ Conversion failed: {e}")
        print("\nTo convert manually:")
        print(f"  python convert_hf_to_gguf.py {MERGED_DIR} --outfile {GGUF_PATH} --outtype q4_k_m")
else:
    print("✗ llama.cpp converter not found")
    print("\nTo convert manually after installing llama.cpp:")
    print(f"  python <llama.cpp>/convert_hf_to_gguf.py {MERGED_DIR} --outfile {GGUF_PATH} --outtype q4_k_m")

print("\n=== To load in Ollama ===")
print(f"""
1. Copy the GGUF file:
   cp {GGUF_PATH} ~/.ollama/models/blobs/

2. Create a Modelfile:
   cat > Modelfile.valet-router << 'EOF'
FROM {GGUF_PATH}
PARAMETER num_ctx 2048
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"
EOF

3. Create the model:
   ollama create valet-router -f Modelfile.valet-router

4. Run it:
   ollama run valet-router "Your question here"
""")
