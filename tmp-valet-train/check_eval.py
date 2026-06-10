#!/usr/bin/env python3
import json

with open("data/valet/eval.jsonl") as f:
    for i, line in enumerate(f):
        if i >= 5:
            break
        obj = json.loads(line)
        tc = obj.get("task_class", "?")
        inp = obj.get("input", "")[:100]
        out = obj.get("output", "")[:150]
        print(f"Example {i+1} (class={tc})")
        print(f"  Input:\n    {repr(inp)}...")
        print(f"  Expected Output:\n    {repr(out)}...")
        print()
