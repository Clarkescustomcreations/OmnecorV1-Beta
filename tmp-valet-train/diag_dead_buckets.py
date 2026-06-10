#!/usr/bin/env python3
"""Diagnose the 0% eval buckets: show raw model output vs expected vs scorer verdict.
Reuses valet_eval's exact inference + scoring path so results match the real eval."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path("server/python_bridges").resolve()))
import valet_eval as ve  # type: ignore

ART = "tmp-valet-train/Valet-V1"
EVAL = Path("data/valet/eval.jsonl")

print(f"[diag] loading model from {ART} ...", flush=True)
ok = ve._load_model({"format": "lora", "artifact_path": ART})
print(f"[diag] loaded={ok} backend={ve._backend_type}", flush=True)
if not ok:
    sys.exit(1)

rows = [json.loads(l) for l in EVAL.read_text().splitlines() if l.strip()]

def bucket_of(ex):
    tc = ex.get("task_class", "route")
    if tc == "route":
        try:
            return f"route:{json.loads(ex.get('output','')).get('category','?')}"
        except Exception:
            return "route:?"
    return tc

# target dead/weak buckets, up to N examples each
targets = {"skill": 3, "qa": 3, "route:reporting": 3, "route:research": 3}
picked = {k: [] for k in targets}
for ex in rows:
    b = bucket_of(ex)
    if b in picked and len(picked[b]) < targets[b]:
        picked[b].append(ex)

for bucket, exs in picked.items():
    print(f"\n{'='*70}\nBUCKET: {bucket}  ({len(exs)} samples)\n{'='*70}", flush=True)
    for ex in exs:
        tc = ex.get("task_class", "route")
        user = ex.get("input", "")
        gt = ex.get("output", "")
        out = ve._infer(user, ex.get("rag_source", "") or "")
        scorer = ve._SCORERS.get(tc, ve._score_qa)
        correct, detail = scorer(out, gt, user, ex)
        print(f"\n  INPUT:    {user[:120]}", flush=True)
        print(f"  EXPECTED: {gt[:160]}", flush=True)
        print(f"  MODEL:    {(out or '<none>')[:200]}", flush=True)
        print(f"  VERDICT:  {'PASS' if correct else 'FAIL'}  [{detail}]", flush=True)

print("\n[diag] done.", flush=True)
