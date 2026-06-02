#!/usr/bin/env python3
"""
Valet Router Dataset Builder (Phase B)
======================================
Assembles the full Valet training set from the canonical training package
(docs/ai-agents/valet-training/): seeds + routing manifest + knowledge base +
system prompt. Generates all five behavior classes — route / qa / rules / plan /
skill — at the target mix, emits the canonical IO-contract schema for `route`
rows with manifest-derived labels, and writes a Qwen2.5 ChatML `text` field per
row so localLLMfine-tuning.py trains unmodified (fixes M3).

Outputs:
  --out        train split (JSONL)
  --val-out    validation split (JSONL, 10%)
  --eval-out   stratified holdout for Phase 4 eval (>=30 per route category)
  metadata.json (alongside --out): per-class counts, manifest_version, oracle, seed

Progress is streamed as JSON lines to stdout for ProcessManager consumption.

Backward-compatible env vars (used as defaults when CLI flags are absent):
  OLLAMA_URL, ORACLE_MODEL, OUTPUT_PATH, VAL_PATH, EXAMPLES_PER_CATEGORY
"""
import argparse
import datetime
import hashlib
import json
import os
import random
import re
import sys
from pathlib import Path

try:
    import requests
except Exception:  # requests is optional when running fully offline
    requests = None

# Default locations of the canonical training package.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_VT = _REPO_ROOT / "docs" / "ai-agents" / "valet-training"

# Target class mix per DATASET_GENERATION.md §2.
MIX = {"route": 0.55, "qa": 0.20, "rules": 0.10, "plan": 0.10, "skill": 0.05}

# Categories that start/advance a project → todo.md + status.md required (from seeds).
PROJECT_CATEGORIES = {"code_generation", "code_review", "integration", "research"}
STATUS_ONLY_CATEGORIES = {"reporting"}

# Per-category prompt seeds for oracle-driven route prompt synthesis. Keys MUST be
# manifest category keys (taxonomy is unified on the manifest — A.5 / B.1).
PROMPT_SEEDS = {
    "code_generation": ["Write a Python function that", "Create a TypeScript class for", "Implement an algorithm to", "Build a REST endpoint that"],
    "code_review": ["Review this code for bugs:", "Audit this function for security issues:", "Is this SQL query safe?", "Find the performance bottleneck in:"],
    "research": ["Research the latest", "What is the current state of", "Find recent information about", "Compare the 2026 options for"],
    "synthesis": ["Summarize these documents:", "Merge these notes into one brief:", "Translate this email to Spanish:", "Compare and contrast"],
    "media_generation": ["Generate an image of", "Create a hero graphic for", "Design a logo concept for", "Render a short video of"],
    "knowledge_retrieval": ["What did we decide about", "Search the Brain Map for", "Recall from my imported notes", "Find in this project's history"],
    "instruction_writing": ["Write a step-by-step guide to", "Create setup instructions for", "Draft a prompt that", "Explain how to configure"],
    "integration": ["Merge this module into the codebase", "Resolve the merge conflicts in", "Integrate the generated auth into", "Wire this new feature into"],
    "hardware": ["Flash this firmware to the ESP32", "Render this scene in Blender", "Run DRC on this KiCad board", "Queue this ComfyUI workflow"],
    "reporting": ["Give me a status report on", "Summarize what we finished", "Report progress on", "What's the current status of"],
    "local_task": ["List the files in", "What time is it in", "Check system status", "Quick calculation:"],
}

# Confusable sibling categories for hard-negative synthesis (near-miss prompts).
CONFUSABLES = {
    "code_generation": "code_review",
    "code_review": "code_generation",
    "research": "knowledge_retrieval",
    "knowledge_retrieval": "research",
    "synthesis": "reporting",
    "reporting": "synthesis",
    "instruction_writing": "synthesis",
    "integration": "code_generation",
    "media_generation": "hardware",
    "hardware": "media_generation",
    "local_task": "reporting",
}

EXEC_MODES = ["sovereign", "scrapper", "big_spender"]


# ---------------------------------------------------------------------------
# Oracle (local Ollama) — used ONLY to vary user phrasing, never to pick labels.
# ---------------------------------------------------------------------------
class Oracle:
    def __init__(self, url: str, model: str):
        self.url = url
        self.model = model
        self.online = False
        if requests is not None:
            try:
                r = requests.get(f"{url}/api/tags", timeout=3)
                self.online = r.ok
            except Exception:
                self.online = False

    def generate(self, prompt: str, fallback: str) -> str:
        if not self.online or requests is None:
            return fallback
        try:
            r = requests.post(
                f"{self.url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": False},
                timeout=30,
            )
            r.raise_for_status()
            text = r.json().get("response", "").strip()
            return text or fallback
        except Exception:
            return fallback


# ---------------------------------------------------------------------------
# Loading the canonical package
# ---------------------------------------------------------------------------
def extract_system_prompt(md_path: Path) -> str:
    """Pull the canonical system prompt verbatim from the first fenced block."""
    text = md_path.read_text(encoding="utf-8")
    m = re.search(r"## SYSTEM PROMPT.*?```(.*?)```", text, re.DOTALL)
    if not m:
        # Fallback: first fenced block anywhere
        m = re.search(r"```(.*?)```", text, re.DOTALL)
    if not m:
        raise ValueError(f"No fenced system prompt found in {md_path}")
    return m.group(1).strip("\n")


def compact_manifest(manifest: dict) -> str:
    """Compact JSON snapshot of manifest categories for the system turn (B.3 §4)."""
    cats = {}
    for k, v in manifest["categories"].items():
        cats[k] = {
            "primary": f'{v["primary"]["provider"]}/{v["primary"]["model"]}',
            "local": f'{v["local"]["provider"]}/{v["local"]["model"]}',
            "local_capable": v["local_capable"],
            "cost_tier": v["cost_tier"],
            "default_mode": v["default_mode"],
        }
    return json.dumps({"categories": cats}, separators=(",", ":"))


def load_seed(seeds_dir: Path, name: str) -> list:
    path = seeds_dir / name
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def extract_kb_bullets(kb_path: Path) -> list:
    """Atomic fact bullets under numbered '## N.' sections (skips intro/maintenance)."""
    bullets = []
    in_numbered = False
    for line in kb_path.read_text(encoding="utf-8").splitlines():
        if re.match(r"^##\s+\d+\.", line):
            in_numbered = True
            continue
        if line.startswith("##") or line.startswith("###"):
            in_numbered = False
            continue
        if in_numbered and line.lstrip().startswith("- "):
            fact = line.lstrip()[2:].strip()
            # Clean markdown emphasis, code ticks, emoji markers.
            fact = re.sub(r"\*\*(.*?)\*\*", r"\1", fact)
            fact = fact.replace("`", "")
            fact = re.sub(r"[🔴⚡🔥]", "", fact).strip()
            if len(fact) > 25:
                bullets.append(fact)
    return bullets


# ---------------------------------------------------------------------------
# Routing decision construction — labels derived from the manifest (B.2)
# ---------------------------------------------------------------------------
def _kinds(manifest: dict) -> dict:
    return {p: meta["kind"] for p, meta in manifest["providers"].items()}


def choose_primary(cat: dict, exec_mode: str, providers: list, kinds: dict):
    prim, loc, secs = cat["primary"], cat["local"], cat.get("secondary", [])
    local_first = (exec_mode == "sovereign") or (exec_mode == "scrapper" and cat["local_capable"])

    if local_first:
        cands = [(loc["provider"], loc["model"]), (prim["provider"], prim["model"])]
        cands += [(s["provider"], s["model"]) for s in secs]
    else:
        cands = [(prim["provider"], prim["model"])]
        cands += [(s["provider"], s["model"]) for s in secs]
        cands.append((loc["provider"], loc["model"]))

    for p, m in cands:
        if exec_mode == "sovereign" and kinds.get(p) == "cloud":
            continue
        if p == "local_bridge" or p in providers:
            return p, m
    # Local substitution: any available local provider (e.g. an OMMESH peer) runs the
    # category's local model — so we never emit an "unknown" model in local modes.
    local_avail = [p for p in providers if kinds.get(p) == "local"]
    if local_avail:
        return local_avail[0], loc["model"]
    if "ollama" in providers or not providers:
        return "ollama", loc.get("model", "llama3.2:latest")
    return providers[0], loc.get("model", "unknown")


def choose_mode(cat: dict, exec_mode: str, providers: list, primary_provider: str) -> str:
    dm = cat["default_mode"]
    if primary_provider == "local_bridge":
        return "api_direct"
    if exec_mode == "sovereign":
        if "ommesh" in providers:
            return "local_omesh"
        return "valet_background" if dm in ("main_api", "multi_api", "moe_chain") else dm
    return dm


def choose_secondaries(cat: dict, exec_mode: str, providers: list, primary_provider: str, kinds: dict) -> list:
    out = []
    pool = [cat["primary"]["provider"]] + [s["provider"] for s in cat.get("secondary", [])] + [cat["local"]["provider"]]
    for p in pool:
        if p == primary_provider or p in out or p == "local_bridge":
            continue
        if exec_mode == "sovereign" and kinds.get(p) == "cloud":
            continue
        if p in providers:
            out.append(p)
        if len(out) >= 2:
            break
    return out


def base_confidence(cat_key: str, seed_token: str) -> float:
    ambiguous = {"synthesis", "instruction_writing", "reporting", "local_task"}
    lo = 0.78 if cat_key in ambiguous else 0.86
    jitter = (int(hashlib.sha256(seed_token.encode()).hexdigest(), 16) % 9) / 100.0
    return round(min(0.97, lo + jitter), 2)


def build_decision(cat_key: str, manifest: dict, exec_mode: str, providers: list,
                   kinds: dict, conf_token: str, hard_negative: bool = False) -> dict:
    cat = manifest["categories"][cat_key]
    primary_provider, primary_model = choose_primary(cat, exec_mode, providers, kinds)
    mode = choose_mode(cat, exec_mode, providers, primary_provider)
    secondaries = choose_secondaries(cat, exec_mode, providers, primary_provider, kinds)
    is_local = kinds.get(primary_provider, "local") == "local" or primary_provider in ("local_bridge", "ollama", "ommesh", "llamacpp")
    # cost_tier reflects the CHOSEN provider, not the category — a local-primary category
    # routed to its cloud fallback must report the cloud provider's real cost tier.
    if is_local:
        cost_tier = "free"
    else:
        cost_tier = manifest["providers"].get(primary_provider, {}).get("cost_tier", cat["cost_tier"])

    requires_todo = cat_key in PROJECT_CATEGORIES
    requires_status = cat_key in PROJECT_CATEGORIES or cat_key in STATUS_ONLY_CATEGORIES

    if hard_negative:
        sibling = CONFUSABLES.get(cat_key, cat_key)
        reasoning = (f"Looks like {sibling.replace('_', ' ')} at first glance, but it is "
                     f"{cat_key.replace('_', ' ')}; routing to the correct handler.")
        confidence = round(max(0.55, base_confidence(cat_key, conf_token) - 0.25), 2)
    else:
        reasoning = _reasoning(cat_key, exec_mode, primary_provider, is_local)
        confidence = base_confidence(cat_key, conf_token)

    return {
        "category": cat_key,
        "mode": mode,
        "primary_provider": primary_provider,
        "primary_model": primary_model,
        "secondary_providers": secondaries,
        "cost_tier": cost_tier,
        "local_capable": cat["local_capable"],
        "reasoning": reasoning,
        "confidence": confidence,
        "requires_todo_md": requires_todo,
        "requires_status_md": requires_status,
    }


def _reasoning(cat_key: str, exec_mode: str, provider: str, is_local: bool) -> str:
    nice = cat_key.replace("_", " ")
    if provider == "local_bridge":
        return f"{nice.capitalize()} is handled by a local hardware bridge, not an AI provider."
    if exec_mode == "sovereign":
        return f"Sovereign mode forbids cloud; {nice} runs locally on {provider}."
    if exec_mode == "scrapper":
        if is_local:
            return f"{nice.capitalize()} is local-capable; Scrapper prefers local with cloud fallback."
        return f"{nice.capitalize()} needs a cloud model; Scrapper falls back to cloud here."
    return f"Big Spender selects the highest-quality provider for {nice}."


# ---------------------------------------------------------------------------
# Row construction
# ---------------------------------------------------------------------------
ROUTE_INSTRUCTION = "Route this task. Output one routing-decision JSON object only."


def chatml_text(system_prompt_tmpl: str, manifest_compact: str, rag_context: str,
                user_input: str, assistant_output: str) -> str:
    sysmsg = (system_prompt_tmpl
              .replace("{{ROUTING_MANIFEST}}", manifest_compact)
              .replace("{{RAG_CONTEXT}}", rag_context or "(none)"))
    return (f"<|im_start|>system\n{sysmsg}\n<|im_end|>\n"
            f"<|im_start|>user\n{user_input}\n<|im_end|>\n"
            f"<|im_start|>assistant\n{assistant_output}\n<|im_end|>")


def make_row(task_class, instruction, user_input, output, *, emit_text,
             system_prompt, manifest_compact, rag_context=""):
    row = {
        "task_class": task_class,
        "instruction": instruction,
        "input": user_input,
        "output": output,
    }
    if emit_text:
        row["text"] = chatml_text(system_prompt, manifest_compact, rag_context, user_input, output)
    return row


# ---------------------------------------------------------------------------
# Per-class generation
# ---------------------------------------------------------------------------
def gen_route_prompt(oracle, cat_key, sibling=None):
    seeds = PROMPT_SEEDS.get(cat_key, ["Tell me about"])
    seed = random.choice(seeds)
    if sibling:
        sib_seed = random.choice(PROMPT_SEEDS.get(sibling, [seed]))
        ask = (f"Write one realistic one-sentence user request that sounds a bit like "
               f"'{sib_seed}...' but is actually a {cat_key.replace('_',' ')} task. "
               f"Start with '{seed}'. Output only the sentence.")
    else:
        ask = (f"Write one realistic one-sentence user request for a "
               f"{cat_key.replace('_',' ')} task. Start with '{seed}'. "
               f"Output only the sentence.")
    fallback = f"{seed} {cat_key.replace('_', ' ')} for my current project."
    text = oracle.generate(ask, fallback).split("\n")[0].strip().strip('"')
    return text or fallback


def providers_for(exec_mode, manifest):
    """A realistic available_providers list for the given execution mode."""
    local = [p for p, m in manifest["providers"].items() if m["kind"] == "local"]
    cloud = [p for p, m in manifest["providers"].items() if m["kind"] == "cloud"]
    if exec_mode == "sovereign":
        return random.sample(local, k=random.randint(1, min(2, len(local))))
    chosen_local = random.sample(local, k=random.randint(1, min(2, len(local))))
    chosen_cloud = random.sample(cloud, k=random.randint(1, min(3, len(cloud))))
    return chosen_local + chosen_cloud


def gen_qa_questions(oracle, fact, n):
    ask = (f"Generate {n} short, natural user questions whose answer is the following "
           f"Omnecor fact. One question per line, no numbering.\nFact: {fact}")
    fallback = ""
    text = oracle.generate(ask, fallback)
    qs = [q.strip().lstrip("0123456789.-) ").strip() for q in text.split("\n") if q.strip()]
    qs = [q for q in qs if q.endswith("?") or len(q.split()) >= 3]
    if not qs:
        # Offline fallback: synthesize a single question from the fact's subject.
        subject = fact.split(" — ")[0].split(".")[0][:60]
        qs = [f"Tell me about {subject.lower()} in Omnecor."]
    return qs[:n]


def paraphrase_user(oracle, original):
    ask = (f"Rephrase this user message in different words, keeping the same intent and "
           f"length. Output only the rephrased message.\nMessage: {original}")
    text = oracle.generate(ask, original).split("\n")[0].strip().strip('"')
    return text or original


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(description="Valet Router Dataset Builder (Phase B)")
    p.add_argument("--seeds", default=str(_VT / "seed"))
    p.add_argument("--manifest", default=str(_VT / "routing_manifest.json"))
    p.add_argument("--knowledge", default=str(_VT / "OMNECOR_KNOWLEDGE_BASE.md"))
    p.add_argument("--system-prompt", dest="system_prompt", default=str(_VT / "VALET_SYSTEM_PROMPT.md"))
    p.add_argument("--out", default=os.environ.get("OUTPUT_PATH", "data/valet/train.jsonl"))
    p.add_argument("--val-out", dest="val_out", default=os.environ.get("VAL_PATH", "data/valet/val.jsonl"))
    p.add_argument("--eval-out", dest="eval_out", default="data/valet/eval.jsonl")
    p.add_argument("--target-total", dest="target_total", type=int,
                   default=int(os.environ.get("TARGET_TOTAL", "2000")))
    p.add_argument("--eval-per-category", dest="eval_per_category", type=int, default=30)
    p.add_argument("--emit-text", dest="emit_text", action="store_true")
    p.add_argument("--seed", type=int, default=3407)
    p.add_argument("--oracle-model", dest="oracle_model",
                   default=os.environ.get("ORACLE_MODEL", "llama3.2:latest"))
    p.add_argument("--ollama-url", dest="ollama_url",
                   default=os.environ.get("OLLAMA_URL", "http://localhost:11434"))
    return p.parse_args()


def main():
    args = parse_args()
    random.seed(args.seed)

    seeds_dir = Path(args.seeds)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    kb_path = Path(args.knowledge)
    system_prompt = extract_system_prompt(Path(args.system_prompt))
    manifest_compact = compact_manifest(manifest)
    kinds = _kinds(manifest)
    route_categories = list(manifest["categories"].keys())

    # Resolve target counts. EXAMPLES_PER_CATEGORY (if explicitly set) drives totals
    # for backward compatibility with the existing tRPC dataset job.
    epc_env = os.environ.get("EXAMPLES_PER_CATEGORY")
    if epc_env:
        route_total = int(epc_env) * len(route_categories)
        target_total = round(route_total / MIX["route"])
    else:
        target_total = args.target_total
    counts = {c: max(1, round(target_total * share)) for c, share in MIX.items()}

    emit = args.emit_text
    progress_total = sum(counts.values())
    print(json.dumps({"type": "start", "total": progress_total, "oracle_online": False}), flush=True)

    oracle = Oracle(args.ollama_url, args.oracle_model)
    # Re-announce oracle availability now that we've probed it.
    print(json.dumps({"type": "info", "oracle_online": oracle.online,
                      "oracle_model": args.oracle_model}), flush=True)

    generated = 0

    def tick(n=1):
        nonlocal generated
        generated += n
        if generated % 50 == 0:
            print(json.dumps({"type": "progress", "generated": generated, "total": progress_total}), flush=True)

    # ---- ROUTE (55%) — seeds verbatim + manifest-derived augmentation + 10% hard negatives
    route_by_cat = {c: [] for c in route_categories}
    seed_routes = load_seed(seeds_dir, "routing.seed.jsonl")
    for sr in seed_routes:
        out_obj = json.loads(sr["output"])
        cat = out_obj.get("category")
        if cat not in route_by_cat:
            continue
        rag = ""
        row = make_row("route", sr.get("instruction", ROUTE_INSTRUCTION), sr["input"], sr["output"],
                       emit_text=emit, system_prompt=system_prompt,
                       manifest_compact=manifest_compact, rag_context=rag)
        route_by_cat[cat].append(row)

    per_cat = max(1, counts["route"] // len(route_categories))
    neg_per_cat = max(0, int(per_cat * 0.10))
    for cat_key in route_categories:
        for i in range(per_cat):
            exec_mode = EXEC_MODES[i % len(EXEC_MODES)]
            providers = providers_for(exec_mode, manifest)
            hard_neg = i < neg_per_cat
            sibling = CONFUSABLES.get(cat_key) if hard_neg else None
            user_input = gen_route_prompt(oracle, cat_key, sibling)
            decision = build_decision(cat_key, manifest, exec_mode, providers, kinds,
                                      conf_token=f"{cat_key}:{i}:{exec_mode}", hard_negative=hard_neg)
            row = make_row("route", ROUTE_INSTRUCTION, user_input, json.dumps(decision),
                           emit_text=emit, system_prompt=system_prompt,
                           manifest_compact=manifest_compact)
            route_by_cat[cat_key].append(row)
            tick()

    # ---- QA (20%) — seeds verbatim + knowledge-base-grounded pairs (B.4, RAG context)
    qa_rows = []
    for s in load_seed(seeds_dir, "omnecor_qa.seed.jsonl"):
        qa_rows.append(make_row("qa", s["instruction"], s["input"], s["output"],
                                emit_text=emit, system_prompt=system_prompt,
                                manifest_compact=manifest_compact, rag_context=s["output"]))
    bullets = extract_kb_bullets(kb_path) if kb_path.exists() else []
    qa_instr = "Answer as the Omnecor expert. Be concise and accurate."
    if bullets:
        bi = 0
        while len([r for r in qa_rows]) < counts["qa"] and bullets:
            fact = bullets[bi % len(bullets)]
            n_q = random.randint(2, 4)
            for q in gen_qa_questions(oracle, fact, n_q):
                if len(qa_rows) >= counts["qa"]:
                    break
                qa_rows.append(make_row("qa", qa_instr, q, fact, emit_text=emit,
                                        system_prompt=system_prompt,
                                        manifest_compact=manifest_compact, rag_context=fact))
                tick()
            bi += 1
            if bi > len(bullets) * 6:  # safety: avoid infinite loop if counts unreachable
                break

    # ---- RULES / PLAN / SKILL — seeds + faithful paraphrase variants (user turn only)
    def expand_class(seed_file, task_class, target):
        rows = []
        seed_rows = load_seed(seeds_dir, seed_file)
        for s in seed_rows:
            rows.append(make_row(task_class, s["instruction"], s["input"], s["output"],
                                 emit_text=emit, system_prompt=system_prompt,
                                 manifest_compact=manifest_compact))
        i = 0
        while len(rows) < target and seed_rows:
            s = seed_rows[i % len(seed_rows)]
            new_input = paraphrase_user(oracle, s["input"])
            rows.append(make_row(task_class, s["instruction"], new_input, s["output"],
                                 emit_text=emit, system_prompt=system_prompt,
                                 manifest_compact=manifest_compact))
            tick()
            i += 1
            if i > target * 3:  # safety guard
                break
        return rows

    rules_rows = expand_class("hardcoded_rules.seed.jsonl", "rules", counts["rules"])
    plan_rows = expand_class("plan_mode.seed.jsonl", "plan", counts["plan"])
    skill_rows = expand_class("skills.seed.jsonl", "skill", counts["skill"])

    # ---- Stratified holdout eval set (Phase 4) — >=N per route category, from augmented rows
    eval_rows = []
    train_route = []
    for cat_key, rows in route_by_cat.items():
        # Keep seed rows in train; hold out augmented rows for eval to avoid leaking seeds.
        augmented = [r for r in rows if r["input"] not in {sr["input"] for sr in seed_routes}]
        hold = augmented[: args.eval_per_category]
        rest = augmented[args.eval_per_category:]
        seed_rows_cat = [r for r in rows if r not in augmented]
        eval_rows.extend(hold)
        train_route.extend(seed_rows_cat + rest)

    # ---- Assemble train/val pool (everything except the eval holdout)
    pool = train_route + qa_rows + rules_rows + plan_rows + skill_rows
    random.shuffle(pool)
    split = int(len(pool) * 0.9)
    train_rows, val_rows = pool[:split], pool[split:]

    # ---- Write outputs
    def write_jsonl(path_str, rows):
        path = Path(path_str)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        return str(path)

    out_p = write_jsonl(args.out, train_rows)
    val_p = write_jsonl(args.val_out, val_rows)
    eval_p = write_jsonl(args.eval_out, eval_rows)

    # ---- metadata.json (B.5)
    def class_counts(rows):
        c = {}
        for r in rows:
            c[r["task_class"]] = c.get(r["task_class"], 0) + 1
        return c

    metadata = {
        "manifest_version": manifest.get("manifest_version"),
        "knowledge_base_version": manifest.get("knowledge_base_version"),
        "oracle_model": args.oracle_model,
        "oracle_online": oracle.online,
        "seed": args.seed,
        "target_total": target_total,
        "emit_text": emit,
        "created_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": {
            "train": class_counts(train_rows),
            "val": class_counts(val_rows),
            "eval": class_counts(eval_rows),
            "train_total": len(train_rows),
            "val_total": len(val_rows),
            "eval_total": len(eval_rows),
        },
        "outputs": {"train": out_p, "val": val_p, "eval": eval_p},
    }
    meta_path = Path(args.out).parent / "metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "type": "complete",
        "train": len(train_rows),
        "validation": len(val_rows),
        "eval": len(eval_rows),
        "outputPath": out_p,
        "valPath": val_p,
        "evalPath": eval_p,
        "metadataPath": str(meta_path),
    }), flush=True)


if __name__ == "__main__":
    main()
