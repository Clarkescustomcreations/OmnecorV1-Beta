#!/usr/bin/env python3
"""
check_valet_drift.py — Valet Router Schema Drift Checker (Phase 7.4)

Verifies that the RouteDecision schema in both implementation files
(valet_router_inference.py and ValetRouterService.ts) matches the
canonical definition in IO_CONTRACT.md.

Also checks that the system prompt is loaded from disk (not inlined), so
train/inference skew cannot silently creep back in.

Usage:   python3 scripts/check_valet_drift.py
Exit 0 = no drift detected.
Exit 1 = drift detected — prints all findings.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

IO_CONTRACT    = ROOT / "docs" / "ai-agents" / "valet-training" / "IO_CONTRACT.md"
INFERENCE_FILE = ROOT / "server" / "python_bridges" / "valet_router_inference.py"
TS_SERVICE     = ROOT / "server" / "phase2" / "services" / "ValetRouterService.ts"

# Canonical field set per IO_CONTRACT §3 (used as ground-truth fallback if parse fails)
CANONICAL_FIELDS = frozenset({
    "category", "mode", "primary_provider", "primary_model",
    "secondary_providers", "cost_tier", "local_capable",
    "reasoning", "confidence", "requires_todo_md", "requires_status_md",
})

# ─── Parsers ──────────────────────────────────────────────────────────────────

def parse_contract_fields(text: str) -> frozenset[str]:
    """Extract field names from the JSON example block in IO_CONTRACT §3."""
    m = re.search(r"## 3\..*?```json(.*?)```", text, re.DOTALL)
    if not m:
        return CANONICAL_FIELDS
    return frozenset(re.findall(r'"(\w+)"\s*:', m.group(1)))


def parse_pydantic_fields(text: str) -> frozenset[str]:
    """Extract field names from the RouteDecision Pydantic model."""
    m = re.search(r"class RouteDecision\(BaseModel\):(.*?)(?=\nclass |\Z)", text, re.DOTALL)
    if not m:
        return frozenset()
    return frozenset(re.findall(r"^\s{4}(\w+)\s*[=:]", m.group(1), re.MULTILINE))


def _camel_to_snake(name: str) -> str:
    return re.sub(r"([A-Z])", lambda m: f"_{m.group(1).lower()}", name)


def parse_ts_interface_fields(text: str) -> frozenset[str]:
    """Extract field names from the RouteDecision TS interface, converting to snake_case."""
    m = re.search(r"export interface RouteDecision\s*\{(.*?)\}", text, re.DOTALL)
    if not m:
        return frozenset()
    raw = re.findall(r"^\s{2}(\w+)\s*[?:]", m.group(1), re.MULTILINE)
    return frozenset(_camel_to_snake(f) for f in raw)

# ─── Checks ───────────────────────────────────────────────────────────────────

def check_system_prompt_loaded_from_disk(text: str) -> list[str]:
    errors = []
    if "_SYSTEM_PROMPT_PATH" not in text:
        errors.append(
            "inference server: _SYSTEM_PROMPT_PATH not found — "
            "system prompt may be inlined (train/inference skew risk)"
        )
    if "_get_system_prompt" not in text and "_SYSTEM_PROMPT_TEMPLATE" in text:
        errors.append(
            "inference server: still using module-level _SYSTEM_PROMPT_TEMPLATE — "
            "hot-reload not wired (Phase 7.1 incomplete)"
        )
    return errors


def check_manifest_hot_reload(text: str) -> list[str]:
    errors = []
    if "_get_manifest_json" not in text:
        errors.append(
            "inference server: _get_manifest_json() not found — "
            "manifest hot-reload (Phase 7.1) not implemented"
        )
    if "/admin/reload" not in text:
        errors.append(
            "inference server: /admin/reload endpoint not found — "
            "external reload trigger (Phase 7.1) missing"
        )
    return errors


def check_rag_wired(text: str) -> list[str]:
    errors = []
    if "_rag_query" not in text:
        errors.append("inference server: _rag_query() not found — Phase 7.2 RAG not implemented")
    if "_should_rag" not in text:
        errors.append("inference server: _should_rag() not found — RAG auto-injection (Phase 7.2) missing")
    return errors

# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    errors: list[str] = []

    # Read source files
    missing = [p for p in (IO_CONTRACT, INFERENCE_FILE, TS_SERVICE) if not p.exists()]
    if missing:
        for p in missing:
            print(f"ERROR: File not found: {p}")
        return 1

    contract_text  = IO_CONTRACT.read_text()
    inference_text = INFERENCE_FILE.read_text()
    ts_text        = TS_SERVICE.read_text()

    # Parse fields
    contract_fields = parse_contract_fields(contract_text) or CANONICAL_FIELDS
    pydantic_fields = parse_pydantic_fields(inference_text)
    ts_fields       = parse_ts_interface_fields(ts_text)

    # Schema completeness
    missing_py = contract_fields - pydantic_fields
    if missing_py:
        errors.append(
            f"inference server RouteDecision missing fields: {sorted(missing_py)}"
        )

    missing_ts = contract_fields - ts_fields
    if missing_ts:
        errors.append(
            f"ValetRouterService.ts RouteDecision missing fields: {sorted(missing_ts)}"
        )

    # Phase 7 structural checks
    errors.extend(check_system_prompt_loaded_from_disk(inference_text))
    errors.extend(check_manifest_hot_reload(inference_text))
    errors.extend(check_rag_wired(inference_text))

    # Report
    if errors:
        print("VALET DRIFT DETECTED — CI FAIL:")
        for e in errors:
            print(f"  ✗ {e}")
        return 1

    print(f"OK — RouteDecision schema consistent ({len(contract_fields)} fields).")
    print(f"     contract  : {sorted(contract_fields)}")
    print(f"     pydantic  : {sorted(pydantic_fields & contract_fields)}")
    print(f"     typescript: {sorted(ts_fields & contract_fields)}")
    print("     Phase 7.1 manifest hot-reload : present")
    print("     Phase 7.2 RAG injection       : present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
