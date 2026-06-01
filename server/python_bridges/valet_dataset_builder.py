#!/usr/bin/env python3
"""
Valet Router Dataset Builder
Generates Alpaca-format JSONL routing examples using local Ollama.
Progress is streamed as JSON lines to stdout for ProcessManager consumption.
"""
import json
import os
import sys
import random
import requests
from pathlib import Path

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/valet_router_dataset.jsonl")
VAL_PATH = os.environ.get("VAL_PATH", "data/valet_router_validation.jsonl")
EXAMPLES_PER_CATEGORY = int(os.environ.get("EXAMPLES_PER_CATEGORY", "400"))
ORACLE_MODEL = os.environ.get("ORACLE_MODEL", "llama3.2:latest")

# (category, oracle_provider, oracle_model, local_capable, cost_tier)
CATEGORIES = [
    ("code_generation", "anthropic", "claude-sonnet-4-6", False, "medium"),
    ("code_review", "anthropic", "claude-sonnet-4-6", False, "medium"),
    ("creative_writing", "openai", "gpt-4o", False, "medium"),
    ("summarization", "ollama", "llama3.2:latest", True, "free"),
    ("question_answering", "ollama", "llama3.2:latest", True, "free"),
    ("data_analysis", "openai", "gpt-4o", False, "medium"),
    ("image_description", "openai", "gpt-4o", False, "medium"),
    ("translation", "gemini", "gemini-1.5-flash", False, "low"),
    ("math_reasoning", "anthropic", "claude-sonnet-4-6", False, "medium"),
    ("local_task", "ollama", "llama3.2:latest", True, "free"),
]

PROMPT_SEEDS = {
    "code_generation": ["Write a Python function that", "Create a TypeScript class for", "Implement an algorithm to", "Build a REST endpoint that"],
    "code_review": ["Review this code for bugs:", "What are the issues with this function?", "Is this SQL query safe?", "Find the performance bottleneck in:"],
    "creative_writing": ["Write a short story about", "Continue this narrative:", "Create a poem about", "Write dialogue between"],
    "summarization": ["Summarize this document:", "Give me the key points of", "TL;DR:", "What is the main argument of"],
    "question_answering": ["What is", "How does", "Explain", "What are the differences between"],
    "data_analysis": ["Analyze this CSV:", "What trends do you see in", "Interpret these statistics:", "Find anomalies in"],
    "image_description": ["Describe what you see in", "What objects are in this image:", "Identify the style of", "Caption this image:"],
    "translation": ["Translate to French:", "Translate this to Spanish:", "Convert to German:", "Translate from Japanese:"],
    "math_reasoning": ["Solve:", "What is the derivative of", "Prove that", "Calculate the integral of"],
    "local_task": ["List the files in", "What time is it in", "Check system status", "Run a quick calculation:"],
}

def ollama_generate(prompt: str) -> str:
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": ORACLE_MODEL, "prompt": prompt, "stream": False},
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception as e:
        return f"Example prompt about {prompt[:50]}"

def make_alpaca_example(category: str, provider: str, model: str, local_capable: bool, cost: str) -> dict:
    seeds = PROMPT_SEEDS.get(category, ["Tell me about"])
    seed = random.choice(seeds)
    user_prompt = ollama_generate(
        f"Generate a realistic one-sentence user prompt for the category '{category}'. "
        f"Start the prompt with: '{seed}'. Output only the prompt, nothing else."
    )
    instruction = (
        "You are an AI routing classifier. Given a user prompt, output the optimal "
        "routing decision as JSON with fields: provider, model, local_capable, cost_tier, reasoning."
    )
    output = json.dumps({
        "provider": provider,
        "model": model,
        "local_capable": local_capable,
        "cost_tier": cost,
        "reasoning": f"This is a {category} task best handled by {provider}/{model}.",
    })
    return {"instruction": instruction, "input": user_prompt, "output": output}

def make_negative_example() -> dict:
    cat, correct_provider, correct_model, local_capable, cost = random.choice(CATEGORIES)
    wrong_providers = [c for c in CATEGORIES if c[1] != correct_provider]
    if not wrong_providers:
        wrong_providers = CATEGORIES
    wrong = random.choice(wrong_providers)
    seeds = PROMPT_SEEDS.get(cat, ["Tell me about"])
    seed = random.choice(seeds)
    user_prompt = ollama_generate(
        f"Generate a realistic one-sentence user prompt for the category '{cat}'. "
        f"Start with: '{seed}'. Output only the prompt."
    )
    instruction = (
        "You are an AI routing classifier. Given a user prompt, output the optimal "
        "routing decision as JSON with fields: provider, model, local_capable, cost_tier, reasoning."
    )
    output = json.dumps({
        "provider": correct_provider,
        "model": correct_model,
        "local_capable": local_capable,
        "cost_tier": cost,
        "reasoning": f"Correct routing for {cat} despite initial wrong guess.",
    })
    return {"instruction": instruction, "input": user_prompt, "output": output}

def main():
    output_path = Path(OUTPUT_PATH)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    total_examples = EXAMPLES_PER_CATEGORY * len(CATEGORIES)
    negative_count = int(total_examples * 0.10)
    generated = 0
    examples = []

    print(json.dumps({"type": "start", "total": total_examples + negative_count}), flush=True)

    for cat, provider, model, local_capable, cost in CATEGORIES:
        for i in range(EXAMPLES_PER_CATEGORY):
            ex = make_alpaca_example(cat, provider, model, local_capable, cost)
            examples.append(ex)
            generated += 1
            if generated % 50 == 0:
                print(json.dumps({"type": "progress", "generated": generated, "total": total_examples + negative_count}), flush=True)

    for _ in range(negative_count):
        examples.append(make_negative_example())
        generated += 1

    random.shuffle(examples)
    split = int(len(examples) * 0.9)
    train_examples = examples[:split]
    val_examples = examples[split:]

    with open(output_path, "w") as f:
        for ex in train_examples:
            f.write(json.dumps(ex) + "\n")

    val_path = Path(VAL_PATH)
    with open(val_path, "w") as f:
        for ex in val_examples:
            f.write(json.dumps(ex) + "\n")

    print(json.dumps({
        "type": "complete",
        "train": len(train_examples),
        "validation": len(val_examples),
        "outputPath": str(output_path),
        "valPath": str(val_path),
    }), flush=True)

if __name__ == "__main__":
    main()
