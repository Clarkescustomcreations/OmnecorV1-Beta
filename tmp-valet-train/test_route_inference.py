#!/usr/bin/env python3
"""Test routing inference with properly formatted route request."""
import json, torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

ADAPTER = Path("tmp-valet-train/outputs")
adapter_cfg = json.loads((ADAPTER / "adapter_config.json").read_text())
base_name = adapter_cfg.get("base_model_name_or_path", "Qwen/Qwen2.5-1.5B-Instruct")

print(f"Base model : {base_name}")
print(f"Adapter    : {ADAPTER}")
print("Loading...")

device = "cuda" if torch.cuda.is_available() else "cpu"
tokenizer = AutoTokenizer.from_pretrained(ADAPTER)
base = AutoModelForCausalLM.from_pretrained(base_name, dtype=torch.float16, device_map=device)
model = PeftModel.from_pretrained(base, str(ADAPTER))
model.eval()
print(f"Loaded on  : {device}\n")

# Use a ROUTING TASK example (not a plain question)
SYSTEM = (
    "You are the Omnecor Valet — a local routing assistant. "
    "When asked to route respond with ONE JSON object only, e.g. "
    '{"category": "code_generation", "confidence": 0.9}'
)
USER = (
    "As a helpful AI assistant, I am here to assist you with your task category 'code_generation'. "
    "Please provide a routing decision in JSON format for a request to write Python code."
)

messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}]
prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(prompt, return_tensors="pt").to(device)

print("=== PROMPT (last 300 chars) ===")
print(prompt[-300:])
print("\n=== RAW MODEL OUTPUT ===")
with torch.no_grad():
    out = model.generate(**inputs, max_new_tokens=150, do_sample=False)
reply = tokenizer.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
print(repr(reply))
print("\n=== PLAIN ===")
print(reply)
print("\n=== PARSE TEST ===")
try:
    parsed = json.loads(reply)
    print(f"✓ Valid JSON: {parsed}")
except Exception as e:
    print(f"✗ JSON parse failed: {e}")
    # Try to extract JSON substring
    import re
    match = re.search(r'\{[^}]*\}', reply)
    if match:
        try:
            parsed = json.loads(match.group(0))
            print(f"✓ Extracted JSON: {parsed}")
        except:
            print("✗ Couldn't parse extracted JSON either")
