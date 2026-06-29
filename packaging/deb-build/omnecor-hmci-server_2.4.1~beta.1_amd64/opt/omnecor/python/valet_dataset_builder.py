#!/usr/bin/env python3
"""
Valet Router Dataset Builder — Phase B
Generates all five behavior classes (route/qa/rules/plan/skill) at the target
class mix from: seed files + routing_manifest.json + OMNECOR_KNOWLEDGE_BASE.md.
Progress is streamed as JSON lines to stdout for ProcessManager consumption.

Canonical usage (per DATASET_GENERATION.md §6):
  python3 server/python_bridges/valet_dataset_builder.py \
    --seeds docs/ai-agents/valet-training/seed \
    --manifest docs/ai-agents/valet-training/routing_manifest.json \
    --knowledge docs/ai-agents/valet-training/OMNECOR_KNOWLEDGE_BASE.md \
    --system-prompt docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md \
    --out data/valet/train.jsonl --val-out data/valet/val.jsonl --emit-text
"""
import argparse
import json
import os
import re
import random
import requests
from pathlib import Path

# ─── default paths (resolved relative to this file) ──────────────────────────

_TRAINING_DIR = Path(__file__).parent.parent.parent / "docs" / "ai-agents" / "valet-training"

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# ─── class mix — fractions must sum to 1.0 ───────────────────────────────────

CLASS_MIX = {"route": 0.55, "qa": 0.20, "rules": 0.10, "plan": 0.10, "skill": 0.05}

# ─── todo.md / status.md reflexes per category (matches the seed labels) ──────
# Project-advancing categories require both files; reporting advances status only.
# Everything else (synthesis, media, knowledge_retrieval, hardware, local_task,
# instruction_writing) requires neither — so the model isn't taught to always set true.

PROJECT_CATEGORIES = {"code_generation", "code_review", "integration", "research"}
STATUS_ONLY_CATEGORIES = {"reporting"}

# ─── seed file name per class ────────────────────────────────────────────────

SEED_FILES = {
    "route": "routing.seed.jsonl",
    "qa":    "omnecor_qa.seed.jsonl",
    "rules": "hardcoded_rules.seed.jsonl",
    "plan":  "plan_mode.seed.jsonl",
    "skill": "skills.seed.jsonl",
}

# ─── oracle prompt starters per manifest category ────────────────────────────

PROMPT_SEEDS = {
    "code_generation":    ["Write a Python function that", "Create a TypeScript class for", "Implement an algorithm to", "Build a REST endpoint that"],
    "code_review":        ["Review this code for bugs:", "What are the issues with this function?", "Is this SQL query safe?", "Find the performance bottleneck in:"],
    "research":           ["Research and summarize", "Find information about", "Analyze the current state of", "Compare and contrast"],
    "synthesis":          ["Summarize this document:", "Give me the key points of", "Combine these findings into a report on", "What is the main argument of"],
    "media_generation":   ["Generate an image of", "Create a visual for", "Produce a diagram showing", "Design a logo for"],
    "knowledge_retrieval":["What does Omnecor know about", "Retrieve from the Brain Map:", "Look up in the knowledge base:", "Find context about"],
    "instruction_writing":["Write step-by-step instructions for", "Create a guide to", "Document the process of", "Write a how-to for"],
    "integration":        ["Merge these AI outputs:", "Integrate the results of", "Resolve conflicts between", "Combine these responses into"],
    "hardware":           ["Run the Blender operation:", "Execute a KiCad task:", "Flash firmware with ESPTool:", "Run a ComfyUI workflow:"],
    "reporting":          ["Summarize the results of", "Report on the outcome of", "Give me a status update on", "What happened with"],
    "context_management": ["Compress the conversation history", "We're running low on context tokens —", "Summarize this chat so far to save tokens", "Trim the older messages but keep the goal"],
    "memory_operations":  ["Remember that", "By the way,", "What do you know about my preferences?", "Save this note for later:"],
    "local_task":         ["List the files in", "Check system status", "What is the current time in", "Run a quick calculation:"],
}

EXECUTION_MODES = ["sovereign", "scrapper", "big_spender"]


# ─── argument parsing ─────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Valet router dataset builder (Phase B)")
    p.add_argument("--seeds",         default=str(_TRAINING_DIR / "seed"),                      help="Dir containing *.seed.jsonl files")
    p.add_argument("--manifest",      default=str(_TRAINING_DIR / "routing_manifest.json"),     help="routing_manifest.json path")
    p.add_argument("--knowledge",     default=str(_TRAINING_DIR / "OMNECOR_KNOWLEDGE_BASE.md"), help="OMNECOR_KNOWLEDGE_BASE.md path")
    p.add_argument("--system-prompt", default=str(_TRAINING_DIR / "VALET_SYSTEM_PROMPT.md"),   help="VALET_SYSTEM_PROMPT.md path")
    p.add_argument("--out",           default=os.environ.get("OUTPUT_PATH", "data/valet/train.jsonl"))
    p.add_argument("--val-out",       default=os.environ.get("VAL_PATH",    "data/valet/val.jsonl"))
    p.add_argument("--eval-out",      default="data/valet/eval.jsonl",                         help="Stratified holdout eval set (Phase 4)")
    p.add_argument("--total",         type=int,
                   default=int(os.environ.get("TOTAL_EXAMPLES",
                       str(int(os.environ.get("EXAMPLES_PER_CATEGORY", "100")) * 11))),
                   help="Approx total examples to generate")
    p.add_argument("--emit-text",     action="store_true", default=False,                       help="Write ChatML text field (required for SFT trainer)")
    p.add_argument("--oracle-model",  default=os.environ.get("ORACLE_MODEL", "llama3.2:latest"))
    p.add_argument("--seed",          type=int, default=42,                                     help="Random seed for determinism")
    return p.parse_args()


# ─── helpers ──────────────────────────────────────────────────────────────────

def _emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def ollama_generate(prompt: str, oracle_model: str, timeout: int = 30) -> str:
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": oracle_model, "prompt": prompt, "stream": False},
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception:
        return ""


def load_system_prompt(path: Path) -> str:
    """Extract canonical prompt text from VALET_SYSTEM_PROMPT.md (between code fences)."""
    try:
        text = path.read_text()
        match = re.search(r"```\n(.*?)```", text, re.DOTALL)
        return match.group(1).strip() if match else text.strip()
    except Exception:
        return "You are the Omnecor Valet — a local routing assistant."


def build_chatml_text(
    system_tpl: str, input_text: str, output_text: str,
    manifest_json: str = "", rag_context: str = "",
) -> str:
    filled = (
        system_tpl
        .replace("{{ROUTING_MANIFEST}}", manifest_json)
        .replace("{{RAG_CONTEXT}}", rag_context)
    )
    return (
        f"<|im_start|>system\n{filled}<|im_end|>\n"
        f"<|im_start|>user\n{input_text}<|im_end|>\n"
        f"<|im_start|>assistant\n{output_text}<|im_end|>"
    )


def extract_kb_bullets(kb_path: Path) -> list[str]:
    """Return all leaf bullet points from the knowledge base."""
    bullets = []
    try:
        for line in kb_path.read_text().splitlines():
            s = line.strip()
            if s.startswith("- ") and len(s) > 25:
                bullets.append(s[2:].strip())
    except Exception:
        pass
    return bullets


def load_seeds(seeds_dir: Path, class_name: str) -> list[dict]:
    seed_file = seeds_dir / SEED_FILES[class_name]
    if not seed_file.exists():
        return []
    rows = []
    for line in seed_file.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def manifest_decision(
    category: str, cat_data: dict, execution_mode: str, available_providers: list[str],
) -> dict:
    """Derive canonical RouteDecision fields from the manifest + execution mode.
    Labels come from the manifest — the oracle never picks the model (B.2)."""
    primary = cat_data["primary"]
    local = cat_data["local"]
    local_capable = cat_data["local_capable"]
    cost_tier = cat_data["cost_tier"]
    default_mode = cat_data["default_mode"]
    secondary_list = cat_data.get("secondary", [])

    if execution_mode == "sovereign":
        provider = local["provider"]
        model = local["model"]
        used_cost = "free"
        secondaries: list[str] = []
    elif execution_mode == "scrapper":
        if local_capable and local["provider"] in available_providers:
            provider = local["provider"]
            model = local["model"]
            used_cost = "free"
            secondaries = [s["provider"] for s in secondary_list if s["provider"] in available_providers]
        else:
            provider = primary["provider"]
            model = primary["model"]
            used_cost = cost_tier
            secondaries = [s["provider"] for s in secondary_list if s["provider"] in available_providers]
    else:  # big_spender
        provider = primary["provider"]
        model = primary["model"]
        used_cost = cost_tier
        secondaries = [s["provider"] for s in secondary_list if s["provider"] in available_providers]

    # Ensure chosen provider appears in available_providers (training data must be consistent)
    if provider not in available_providers:
        available_providers = [provider] + available_providers

    # Sovereign mode never emits a cloud-implying routing mode: collapse to a local
    # mode (matches the seed examples, e.g. sovereign no-keys synthesis → valet_background).
    mode = default_mode
    if execution_mode == "sovereign":
        if "ommesh" in available_providers:
            mode = "local_omesh"
        elif default_mode in ("main_api", "multi_api", "moe_chain"):
            mode = "valet_background"

    # todo/status reflexes are category-derived, not always-on (matches the seeds).
    requires_todo = category in PROJECT_CATEGORIES
    requires_status = category in PROJECT_CATEGORIES or category in STATUS_ONLY_CATEGORIES

    return {
        "category": category,
        "mode": mode,
        "primary_provider": provider,
        "primary_model": model,
        "secondary_providers": secondaries[:2],
        "cost_tier": used_cost,
        "local_capable": local_capable,
        "confidence": round(random.uniform(0.82, 0.97), 2),
        "requires_todo_md": requires_todo,
        "requires_status_md": requires_status,
    }


# ─── per-class generators ─────────────────────────────────────────────────────

def make_route_example(
    category: str, cat_data: dict, execution_mode: str,
    available_providers: list[str], oracle_model: str,
    system_tpl: str, manifest_json: str, emit_text: bool,
) -> dict:
    seed = random.choice(PROMPT_SEEDS.get(category, ["Tell me about"]))
    user_prompt = ollama_generate(
        f"Generate a realistic, specific one-sentence user request for the task category '{category}'. "
        f"Start with: '{seed}'. Output only the user's request, nothing else.",
        oracle_model,
    ) or f"{seed} something relevant."

    decision = manifest_decision(category, cat_data, execution_mode, available_providers)
    reasoning = ollama_generate(
        f"In one short sentence, explain why '{user_prompt[:80]}' should route to "
        f"{decision['primary_provider']}/{decision['primary_model']} in {execution_mode} mode. "
        "Output only the sentence.",
        oracle_model,
    ) or f"{category} task — manifest-derived routing for {execution_mode} mode."
    decision["reasoning"] = reasoning

    output = json.dumps(decision)
    row: dict = {
        "task_class": "route",
        "instruction": "Route this task. Output one routing-decision JSON object only.",
        "input": user_prompt,
        "execution_mode": execution_mode,
        "available_providers": available_providers,
        "output": output,
    }
    if emit_text:
        row["text"] = build_chatml_text(system_tpl, user_prompt, output, manifest_json, "")
    return row


def make_hard_negative(
    categories: dict, oracle_model: str,
    system_tpl: str, manifest_json: str,
    emit_text: bool, available_providers: list[str],
) -> dict:
    """Near-miss example: prompt that could be mistaken for a wrong category, correct label."""
    cat_names = list(categories.keys())
    correct_cat = random.choice(cat_names)
    wrong_cat = random.choice([c for c in cat_names if c != correct_cat] or cat_names)

    seed = random.choice(PROMPT_SEEDS.get(correct_cat, ["Tell me about"]))
    user_prompt = ollama_generate(
        f"Generate a one-sentence user request that superficially resembles '{wrong_cat}' "
        f"but actually belongs to '{correct_cat}'. Start with '{seed}'. Output only the request.",
        oracle_model,
    ) or f"{seed} something that looks like {wrong_cat} but is {correct_cat}."

    execution_mode = random.choice(EXECUTION_MODES)
    decision = manifest_decision(correct_cat, categories[correct_cat], execution_mode, available_providers)
    decision["reasoning"] = (
        f"Despite surface similarity to {wrong_cat}, this is a {correct_cat} task — "
        "manifest routing applied."
    )
    output = json.dumps(decision)
    row: dict = {
        "task_class": "route",
        "instruction": "Route this task. Output one routing-decision JSON object only.",
        "input": user_prompt,
        "execution_mode": execution_mode,
        "available_providers": available_providers,
        "output": output,
        "hard_negative": True,
    }
    if emit_text:
        row["text"] = build_chatml_text(system_tpl, user_prompt, output, manifest_json, "")
    return row


def make_qa_from_bullet(
    bullet: str, oracle_model: str,
    system_tpl: str, manifest_json: str, emit_text: bool,
) -> list[dict]:
    """Generate 1-3 QA pairs from a single KB bullet (B.4).
    The answer is the bullet text — keeps answers factual, not oracle-invented."""
    raw = ollama_generate(
        f"Given this Omnecor fact:\n{bullet}\n\n"
        "Write 2 natural questions a user might ask whose answer is this fact. "
        "Output one question per line, nothing else.",
        oracle_model,
    )
    questions = [q.strip() for q in raw.splitlines() if q.strip() and "?" in q][:3]
    if not questions:
        questions = [f"What does Omnecor do about: {bullet[:70]}?"]

    rows = []
    for q in questions:
        row: dict = {
            "task_class": "qa",
            "instruction": "Answer as the Omnecor expert. Be concise and accurate.",
            "input": q,
            "output": bullet,
            "rag_source": bullet,
        }
        if emit_text:
            row["text"] = build_chatml_text(system_tpl, q, bullet, manifest_json, bullet)
        rows.append(row)
    return rows


def paraphrase_seed(
    seed_row: dict, class_name: str, oracle_model: str,
    system_tpl: str, manifest_json: str, emit_text: bool,
) -> dict:
    """Vary the user input of a seed row; keep the assistant output faithful."""
    original_input = seed_row.get("input", "")
    paraphrased = ollama_generate(
        f"Rewrite this user message in different words, keeping the same intent. "
        f"Output only the rewritten message:\n{original_input}",
        oracle_model,
    ) or original_input

    output = seed_row.get("output", "")
    row: dict = {
        "task_class": class_name,
        "instruction": seed_row.get("instruction", ""),
        "input": paraphrased,
        "output": output,
    }
    if emit_text:
        rag = seed_row.get("rag_source", "")
        row["text"] = build_chatml_text(system_tpl, paraphrased, output, manifest_json, rag)
    return row


# ─── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()
    random.seed(args.seed)

    seeds_dir    = Path(args.seeds)
    manifest_path = Path(args.manifest)
    knowledge_path = Path(args.knowledge)
    system_prompt_path = Path(args.system_prompt)
    out_path     = Path(args.out)
    val_path     = Path(args.val_out)
    eval_path    = Path(args.eval_out)
    emit_text    = args.emit_text
    oracle_model = args.oracle_model
    total        = args.total

    for p in (out_path, val_path, eval_path):
        p.parent.mkdir(parents=True, exist_ok=True)

    # ── load sources ──────────────────────────────────────────────────────────
    manifest     = json.loads(manifest_path.read_text())
    categories   = manifest["categories"]
    all_providers = list(manifest.get("providers", {}).keys())
    manifest_json = json.dumps({"categories": categories}, separators=(",", ":"))
    system_tpl   = load_system_prompt(system_prompt_path)
    kb_bullets   = extract_kb_bullets(knowledge_path)

    # ── target counts ─────────────────────────────────────────────────────────
    class_counts = {cls: max(1, int(total * frac)) for cls, frac in CLASS_MIX.items()}
    actual_total = sum(class_counts.values())

    _emit({
        "type": "start",
        "total": actual_total,
        "class_counts": class_counts,
        "oracle_model": oracle_model,
        "emit_text": emit_text,
        "manifest_version": manifest.get("manifest_version"),
    })

    examples: list[dict] = []
    generated = 0

    def _progress() -> None:
        nonlocal generated
        generated += 1
        if generated % 20 == 0:
            _emit({"type": "progress", "generated": generated, "total": actual_total})

    # ── route: include seeds directly + generate augmented examples ───────────
    route_seeds = load_seeds(seeds_dir, "route")
    for s in route_seeds:
        row: dict = {k: v for k, v in s.items() if k != "text"}
        if emit_text:
            avail = s.get("available_providers", all_providers)
            ex_mode = s.get("execution_mode", "scrapper")
            row["text"] = build_chatml_text(
                system_tpl, s.get("input", ""), s.get("output", ""), manifest_json, ""
            )
        examples.append(row)

    n_route = class_counts["route"]
    n_negatives = max(1, int(n_route * 0.10))
    n_positive   = n_route - n_negatives - len(route_seeds)
    cat_names    = list(categories.keys())
    per_cat      = max(1, n_positive // len(cat_names))

    for cat in cat_names:
        for _ in range(per_cat):
            ex_mode = random.choice(EXECUTION_MODES)
            avail = random.sample(all_providers, k=random.randint(2, len(all_providers)))
            ex = make_route_example(
                cat, categories[cat], ex_mode, avail,
                oracle_model, system_tpl, manifest_json, emit_text,
            )
            examples.append(ex)
            _progress()

    for _ in range(n_negatives):
        avail = random.sample(all_providers, k=random.randint(2, len(all_providers)))
        ex = make_hard_negative(
            categories, oracle_model, system_tpl, manifest_json, emit_text, avail
        )
        examples.append(ex)
        _progress()

    # ── qa: seeds + KB-derived pairs (B.4) ───────────────────────────────────
    n_qa = class_counts["qa"]
    qa_seeds = load_seeds(seeds_dir, "qa")
    qa_examples: list[dict] = []

    # Include seeds first (highest quality)
    for s in qa_seeds:
        row = {k: v for k, v in s.items() if k != "text"}
        if emit_text:
            rag = s.get("rag_source", "")
            row["text"] = build_chatml_text(system_tpl, s.get("input", ""), s.get("output", ""), manifest_json, rag)
        qa_examples.append(row)

    # Generate QA from KB bullets
    random.shuffle(kb_bullets)
    for bullet in kb_bullets:
        if len(qa_examples) >= n_qa:
            break
        qa_examples.extend(
            make_qa_from_bullet(bullet, oracle_model, system_tpl, manifest_json, emit_text)
        )
        _progress()

    random.shuffle(qa_examples)
    for ex in qa_examples[:n_qa]:
        examples.append(ex)

    # ── rules / plan / skill: paraphrase seeds ────────────────────────────────
    for cls in ("rules", "plan", "skill"):
        n_cls = class_counts[cls]
        seeds = load_seeds(seeds_dir, cls)
        if not seeds:
            continue
        cls_examples: list[dict] = []
        # Include seeds directly first
        for s in seeds:
            row = {k: v for k, v in s.items() if k != "text"}
            if emit_text:
                row["text"] = build_chatml_text(
                    system_tpl, s.get("input", ""), s.get("output", ""), manifest_json, ""
                )
            cls_examples.append(row)
        # Augment by paraphrasing
        while len(cls_examples) < n_cls:
            seed_row = random.choice(seeds)
            cls_examples.append(
                paraphrase_seed(seed_row, cls, oracle_model, system_tpl, manifest_json, emit_text)
            )
            _progress()
        for ex in cls_examples[:n_cls]:
            examples.append(ex)

    # ── shuffle + stratified eval split ───────────────────────────────────────
    random.shuffle(examples)

    eval_set: list[dict] = []
    remainder: list[dict] = []
    # Buckets track how many eval examples we have per key
    eval_counts: dict[str, int] = {}

    for ex in examples:
        task_class = ex.get("task_class", "")
        if task_class == "route":
            try:
                cat_key = json.loads(ex.get("output", "{}")).get("category", "local_task")
            except Exception:
                cat_key = "local_task"
            bucket_key = f"route:{cat_key}"
            target = 30
        else:
            bucket_key = task_class
            target = 10

        if eval_counts.get(bucket_key, 0) < target:
            eval_set.append(ex)
            eval_counts[bucket_key] = eval_counts.get(bucket_key, 0) + 1
        else:
            remainder.append(ex)

    # 90/10 train/val split on the remainder
    split = int(len(remainder) * 0.9)
    train_examples = remainder[:split]
    val_examples   = remainder[split:]

    # ── write outputs ─────────────────────────────────────────────────────────
    def _write_jsonl(path: Path, rows: list[dict]) -> None:
        with open(path, "w") as f:
            for row in rows:
                f.write(json.dumps(row) + "\n")

    _write_jsonl(out_path,  train_examples)
    _write_jsonl(val_path,  val_examples)
    _write_jsonl(eval_path, eval_set)

    # ── metadata.json (B.5) ───────────────────────────────────────────────────
    per_class: dict[str, int] = {}
    for ex in train_examples + val_examples + eval_set:
        cls = ex.get("task_class", "unknown")
        per_class[cls] = per_class.get(cls, 0) + 1

    meta = {
        "manifest_version":       manifest.get("manifest_version", "unknown"),
        "knowledge_base_version": manifest.get("knowledge_base_version", "unknown"),
        "oracle_model":           oracle_model,
        "random_seed":            args.seed,
        "emit_text":              emit_text,
        "total":                  len(train_examples) + len(val_examples) + len(eval_set),
        "train":                  len(train_examples),
        "val":                    len(val_examples),
        "eval":                   len(eval_set),
        "per_class":              per_class,
    }
    meta_path = out_path.parent / "metadata.json"
    meta_path.write_text(json.dumps(meta, indent=2))

    _emit({
        "type":        "complete",
        "train":       len(train_examples),
        "val":         len(val_examples),
        "eval":        len(eval_set),
        "outputPath":  str(out_path),
        "valPath":     str(val_path),
        "evalPath":    str(eval_path),
        "metaPath":    str(meta_path),
        "perClass":    per_class,
    })


if __name__ == "__main__":
    main()
