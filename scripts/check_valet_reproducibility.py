#!/usr/bin/env python3
"""
check_valet_reproducibility.py — verify that valet_dataset_builder.py is deterministic.

Runs the dataset builder twice with the same seed and static fallbacks (no Ollama
oracle needed), then compares the two outputs line-by-line.  Two runs are
considered equivalent when every JSON row matches after sorting by the row's
content.  Exits 0 on pass, 1 on failure.

Usage (from repo root):
    python3 scripts/check_valet_reproducibility.py [--n 200] [--seed 42]

Options:
    --n      Number of examples to generate per run (default: 200, faster than full 2000)
    --seed   RNG seed (default: 42, must match valet.config.json)
    --verbose  Print diff on mismatch instead of just the count
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDER = os.path.join(REPO_ROOT, "server", "python_bridges", "valet_dataset_builder.py")


def run_builder(out_dir: str, n: int, seed: int) -> str:
    out_path = os.path.join(out_dir, "train.jsonl")
    cmd = [
        sys.executable, BUILDER,
        "--output", out_path,
        "--n", str(n),
        "--seed", str(seed),
        "--emit-text",
        "--static-fallbacks",   # skip Ollama oracle — uses pre-written seed examples only
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    if result.returncode != 0:
        print("Builder failed:")
        print(result.stderr[-2000:])
        sys.exit(1)
    return out_path


def load_sorted_rows(path: str) -> list[str]:
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                obj = json.loads(line)
                # Normalise by re-serialising with sorted keys so key order doesn't matter
                rows.append(json.dumps(obj, sort_keys=True))
    return sorted(rows)


def main():
    parser = argparse.ArgumentParser(description="Valet dataset reproducibility check")
    parser.add_argument("--n", type=int, default=200, help="Examples per run")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not os.path.isfile(BUILDER):
        print(f"ERROR: builder not found at {BUILDER}")
        sys.exit(1)

    with tempfile.TemporaryDirectory(prefix="valet_repro_") as tmp:
        dir_a = os.path.join(tmp, "run_a")
        dir_b = os.path.join(tmp, "run_b")
        os.makedirs(dir_a)
        os.makedirs(dir_b)

        print(f"Run A: generating {args.n} examples with seed={args.seed} ...")
        path_a = run_builder(dir_a, args.n, args.seed)
        rows_a = load_sorted_rows(path_a)
        print(f"  → {len(rows_a)} rows")

        print(f"Run B: generating {args.n} examples with seed={args.seed} ...")
        path_b = run_builder(dir_b, args.n, args.seed)
        rows_b = load_sorted_rows(path_b)
        print(f"  → {len(rows_b)} rows")

    if len(rows_a) != len(rows_b):
        print(f"FAIL: row count differs (A={len(rows_a)}, B={len(rows_b)})")
        sys.exit(1)

    mismatches = [(i, a, b) for i, (a, b) in enumerate(zip(rows_a, rows_b)) if a != b]
    if mismatches:
        print(f"FAIL: {len(mismatches)}/{len(rows_a)} rows differ")
        if args.verbose:
            for i, a, b in mismatches[:5]:
                print(f"\n--- row {i} (run A):\n{a[:200]}")
                print(f"+++ row {i} (run B):\n{b[:200]}")
        sys.exit(1)

    print(f"PASS: both runs produced identical {len(rows_a)}-row datasets (seed={args.seed})")
    print("Reproducibility check: OK")


if __name__ == "__main__":
    main()
