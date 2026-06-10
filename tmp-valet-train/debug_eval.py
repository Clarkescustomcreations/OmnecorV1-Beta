#!/usr/bin/env python3
"""Debug: Show raw model outputs for first 5 eval examples."""
import json
import sys
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

# Load model
ADAPTER_DIR = Path("tmp-valet-train/outputs")
adapter_cfg = json.loads((ADAPTER_DIR / "adapter_config.json").read_text())
base_name = adapter_cfg.get("base_model_name_or_path", "Qwen/Qwen2.5-1.5B-Instruct")

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Loading model on {device}...")
tokenizer = AutoTokenizer.from_pretrained(ADAPTER_DIR)
base = AutoModelForCausalLM.from_pretrained(base_name, dtype=torch.float16, device_map=device)
model = PeftModel.from_pretrained(base, str(ADAPTER_DIR))
model.eval()
print("✓ Model loaded\n")

# Load system prompt + manifest
SYSTEM_PROMPT_PATH = Path("docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md")
MANIFEST_PATH = Path("docs/ai-agents/valet-training/routing_manifest.json")

def load_system_prompt():
    try:
        import re
        text = SYSTEM_PROMPT_PATH.read_text()
        match = re.search(r"```\n(.*?)```", text, re.DOTALL)
        if match:
            return match.group(1).strip()
        return text.strip()
    except Exception:
        return "You are the Omnecor Valet"

def load_manifest():
    try:
        return json.dumps(json.loads(MANIFEST_PATH.read_text()), separators=(",", ":"))
    except Exception:
        return "{}"

system_prompt = load_system_prompt()
manifest = load_manifest()
system_prompt = system_prompt.replace("{{RAG_CONTEXT}}", "").replace("{{ROUTING_MANIFEST}}", manifest)

print(f"System prompt length: {len(system_prompt)} chars")
print(f"Manifest size: {len(manifest)} chars\n")

# Load eval examples
eval_path = Path("data/valet/eval.jsonl")
examples = []
for line in eval_path.read_text().splitlines():
    if line.strip():
        examples.append(json.loads(line))

# Test first 5
for i, ex in enumerate(examples[:5]):
    task_class = ex.get("task_class", "?")
    user_input = ex.get("input", "")
    gt_output = ex.get("output", "")

    print(f"=== Example {i+1} (task_class={task_class}) ===")
    print(f"Input (first 100 chars): {user_input[:100]}")

    # Build messages
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_input[:500]},
    ]

    # Generate
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt", max_length=1024, truncation=True)
    device_actual = next(model.parameters()).device
    inputs = {k: v.to(device_actual) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model.generate(**inputs, max_new_tokens=220, do_sample=False)

    reply = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)

    print(f"Output: {repr(reply[:200])}")
    print(f"Expected: {repr(gt_output[:100])}")

    # Try to parse
    try:
        parsed = json.loads(reply)
        print(f"✓ Valid JSON, category={parsed.get('category', '?')}")
    except Exception as e:
        print(f"✗ JSON parse failed: {e}")

    print()
