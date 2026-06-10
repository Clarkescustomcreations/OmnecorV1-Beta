#!/usr/bin/env python3
"""Check how many tokens the full prompt needs."""
import json
import re
from pathlib import Path
from transformers import AutoTokenizer

ADAPTER_DIR = Path("tmp-valet-train/outputs")
SYSTEM_PROMPT_PATH = Path("docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md")
MANIFEST_PATH = Path("docs/ai-agents/valet-training/routing_manifest.json")

tokenizer = AutoTokenizer.from_pretrained(ADAPTER_DIR)

def load_system_prompt():
    try:
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
full_system = system_prompt.replace("{{RAG_CONTEXT}}", "").replace("{{ROUTING_MANIFEST}}", manifest)

# Token counts
system_tokens = len(tokenizer.encode(full_system))
user_input = "As a helpful AI assistant, I am here to assist you with your task category 'integration'. Please provide a routing decision."
user_tokens = len(tokenizer.encode(user_input))

print(f"System prompt tokens: {system_tokens}")
print(f"User input tokens:    {user_tokens}")
print(f"Total:                {system_tokens + user_tokens}")
print()
print(f"Truncation at 1024 means losing: {max(0, system_tokens + user_tokens - 1024)} tokens")
print()

# Apply chat template
messages = [
    {"role": "system", "content": full_system},
    {"role": "user", "content": user_input},
]
prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
prompt_tokens = len(tokenizer.encode(prompt))
print(f"Full prompt (with chat template): {prompt_tokens} tokens")
print(f"After truncation to 1024: LOSING {prompt_tokens - 1024} tokens" if prompt_tokens > 1024 else "✓ Fits within 1024")
