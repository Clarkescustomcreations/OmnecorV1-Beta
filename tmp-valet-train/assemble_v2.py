#!/usr/bin/env python3
"""
Assemble V2 training data.

Two jobs:
  1. CLEAN the dataset. The V1 snapshot is mojibake-corrupted (UTF-8 read as
     cp1252: em-dash "—" stored as "â€"). The eval builds its system prompt
     CLEAN from the .md, so the V1 data was actually train/eval-mismatched on
     encoding. We fix the mojibake in every content field and rebuild the ChatML
     `text` with the clean system prompt — aligning train with eval.
  2. MERGE the validated agent-generated rows (skill/plan/code_review/
     instruction_writing/qa) into the cleaned base.

Output: data/valet/train.jsonl  (= cleaned V1 base + validated new rows)
Eval set is left UNTOUCHED so V2 stays comparable to Valet-V1.
"""
import json
import re
from pathlib import Path
from collections import Counter

ROOT = Path(".")
SNAP = ROOT / "tmp-valet-train/Valet-V1/train.snapshot.jsonl"
GEN_DIR = ROOT / "tmp-valet-train/v2-gen"
SYS_PATH = ROOT / "docs/ai-agents/valet-training/VALET_SYSTEM_PROMPT.md"
MAN_PATH = ROOT / "docs/ai-agents/valet-training/routing_manifest.json"
OUT = ROOT / "data/valet/train.jsonl"

ROUTE_CATEGORIES = {
    "code_generation", "code_review", "research", "synthesis", "media_generation",
    "knowledge_retrieval", "instruction_writing", "integration", "hardware",
    "reporting", "context_management", "memory_operations", "local_task",
}


def fix_mojibake(s):
    """Reverse UTF-8-read-as-cp1252 corruption. Idempotent on clean text and on
    legit non-cp1252 unicode (returns the original when the round-trip fails)."""
    if not isinstance(s, str):
        return s
    try:
        fixed = s.encode("cp1252").decode("utf-8")
        return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def load_system_prompt(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(r"```\n(.*?)```", text, re.DOTALL)
    return (m.group(1).strip() if m else text.strip())


def compact_manifest(path: Path) -> str:
    return json.dumps(json.loads(path.read_text(encoding="utf-8")), separators=(",", ":"))


SYS_TPL = fix_mojibake(load_system_prompt(SYS_PATH))   # ensure system prompt is clean too
MANIFEST = compact_manifest(MAN_PATH)


def build_text(input_text: str, output_text: str, rag_context: str = "") -> str:
    filled = (SYS_TPL
              .replace("{{ROUTING_MANIFEST}}", MANIFEST)
              .replace("{{RAG_CONTEXT}}", rag_context))
    return (f"<|im_start|>system\n{filled}<|im_end|>\n"
            f"<|im_start|>user\n{input_text}<|im_end|>\n"
            f"<|im_start|>assistant\n{output_text}<|im_end|>")


def clean_row(ex: dict) -> dict:
    """Fix mojibake in content fields and rebuild the text field."""
    ex = dict(ex)
    for k in ("input", "output", "rag_source", "instruction"):
        if k in ex:
            ex[k] = fix_mojibake(ex[k])
    rag = ex.get("rag_source", "") if ex.get("task_class") == "qa" else ""
    ex["text"] = build_text(ex["input"], ex["output"], rag or "")
    return ex


def valid_row(ex: dict) -> tuple[bool, str]:
    tc = ex.get("task_class")
    if tc not in {"skill", "plan", "route", "qa"}:
        return False, f"bad task_class={tc}"
    for k in ("instruction", "input", "output"):
        if not isinstance(ex.get(k), str) or not ex[k].strip():
            return False, f"missing/empty {k}"
    if tc == "route":
        try:
            o = json.loads(ex["output"])
        except Exception:
            return False, "output not JSON"
        if o.get("category") not in ROUTE_CATEGORIES:
            return False, f"bad category={o.get('category')}"
    if tc == "qa" and not (isinstance(ex.get("rag_source"), str) and ex["rag_source"].strip()):
        return False, "qa missing rag_source"
    return True, "ok"


def sanity_check() -> None:
    t = build_text("hello", '{"category":"local_task"}', "")
    assert "â€" not in t and "Ã©" not in t, "system prompt still has mojibake"
    assert t.count("<|im_start|>") == 3 and t.endswith("<|im_end|>"), "bad ChatML structure"
    assert "—" in SYS_TPL or "-" in SYS_TPL, "system prompt looks empty"
    print("[assemble] sanity-check PASSED (clean system prompt, valid ChatML).")


def main() -> None:
    sanity_check()

    base = [clean_row(json.loads(l))
            for l in SNAP.read_text(encoding="utf-8").splitlines() if l.strip()]
    seen = {(r.get("task_class"), r.get("input"), r.get("output")) for r in base}
    print(f"[assemble] V1 base rows (cleaned): {len(base)}  "
          f"{dict(Counter(r.get('task_class') for r in base))}")

    new_rows, dropped, dup, added = [], Counter(), 0, Counter()
    for f in sorted(GEN_DIR.glob("*.jsonl")):
        ok_n = 0
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ex = json.loads(line)
            except Exception:
                dropped[f"{f.name}:json_parse"] += 1
                continue
            ok, why = valid_row(ex)
            if not ok:
                dropped[f"{f.name}:{why}"] += 1
                continue
            ex = clean_row(ex)
            key = (ex["task_class"], ex["input"], ex["output"])
            if key in seen:
                dup += 1
                continue
            seen.add(key)
            new_rows.append(ex)
            added[ex["task_class"]] += 1
            ok_n += 1
        print(f"[assemble] {f.name}: +{ok_n} valid")

    print(f"\n[assemble] new valid rows: {len(new_rows)}  {dict(added)}")
    print(f"[assemble] duplicates skipped: {dup}")
    if dropped:
        print(f"[assemble] dropped: {dict(dropped)}")

    combined = base + new_rows
    with OUT.open("w", encoding="utf-8") as fh:
        for r in combined:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    final = Counter(r.get("task_class") for r in combined)
    route_cats = Counter(json.loads(r["output"]).get("category")
                         for r in combined if r.get("task_class") == "route")
    print(f"\n[assemble] wrote {OUT} — {len(combined)} rows (was {len(base)}, +{len(new_rows)})")
    print(f"[assemble] final task_class dist: {dict(final)}")
    print(f"[assemble] final route category dist: {dict(sorted(route_cats.items()))}")


if __name__ == "__main__":
    main()
