"""
valet_knowledge_refresh.py — Valet Knowledge Base Refresh
Chunks OMNECOR_KNOWLEDGE_BASE.md and upserts into ChromaDB 'omnecor_valet_kb'.
Bumps knowledge_base_version in routing_manifest.json, then signals the
inference server to hot-reload via POST /admin/reload.

Usage (standalone, invoked by valetRouter.refreshKnowledge tRPC procedure):
  python3 server/python_bridges/valet_knowledge_refresh.py

Usage (FastAPI server on port 8014):
  python3 server/python_bridges/valet_knowledge_refresh.py --serve
"""

import argparse
import json
import logging
import os
import re
import sys
import urllib.request
from pathlib import Path

log = logging.getLogger("omnecor.valet_kb")

_PROJECT_ROOT = Path(__file__).parent.parent.parent
_TRAINING_DIR = _PROJECT_ROOT / "docs" / "ai-agents" / "valet-training"
_KB_PATH = _TRAINING_DIR / "OMNECOR_KNOWLEDGE_BASE.md"
_MANIFEST_PATH = _TRAINING_DIR / "routing_manifest.json"
_CHROMA_URL = "http://localhost:8000"
_COLLECTION_NAME = "omnecor_valet_kb"


def _valet_url() -> str:
    return os.environ.get("VALET_ROUTER_URL", "http://127.0.0.1:8010")

# ─── KB chunking ──────────────────────────────────────────────────────────────

def _chunk_kb(text: str) -> list[dict]:
    """Split KB into sections by ## headings, returning id/text/metadata dicts."""
    sections = re.split(r"\n(?=## )", text.strip())
    chunks = []
    for i, section in enumerate(sections):
        if not section.strip():
            continue
        lines = section.strip().splitlines()
        heading = lines[0].lstrip("# ").strip() if lines and lines[0].startswith("#") else "Introduction"
        chunks.append({
            "id": f"kb_section_{i}",
            "text": section.strip(),
            "metadata": {
                "heading": heading,
                "section_index": i,
                "source": "OMNECOR_KNOWLEDGE_BASE.md",
            },
        })
    return chunks

# ─── Manifest version bump ────────────────────────────────────────────────────

def _bump_patch(version: str) -> str:
    parts = version.split(".")
    try:
        last = int(parts[-1])
        parts[-1] = str(last + 1)
    except (ValueError, IndexError):
        return "1.0.1"
    return ".".join(parts)

def _update_manifest_version() -> str:
    try:
        data = json.loads(_MANIFEST_PATH.read_text())
        old_ver = data.get("knowledge_base_version", "1.0.0")
        new_ver = _bump_patch(old_ver)
        data["knowledge_base_version"] = new_ver
        _MANIFEST_PATH.write_text(json.dumps(data, indent=2))
        print(f"[KBRefresh] knowledge_base_version: {old_ver} → {new_ver}")
        return new_ver
    except Exception as e:
        print(f"[KBRefresh] Could not update manifest version: {e}")
        return "unknown"

# ─── Inference server reload signal ──────────────────────────────────────────

def _signal_inference_reload() -> bool:
    url = _valet_url()
    try:
        req = urllib.request.Request(
            f"{url}/admin/reload",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()
        print("[KBRefresh] Inference server reloaded manifest.")
        return True
    except Exception as e:
        print(f"[KBRefresh] Could not signal inference server (offline?): {e}")
        return False

# ─── ChromaDB upsert ──────────────────────────────────────────────────────────

def _ensure_collection() -> str | None:
    """Get or create the omnecor_valet_kb collection; return its id or None."""
    try:
        req = urllib.request.Request(
            f"{_CHROMA_URL}/api/v1/collections/{_COLLECTION_NAME}",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read())["id"]
    except Exception:
        pass
    try:
        payload = json.dumps({
            "name": _COLLECTION_NAME,
            "metadata": {"source": "valet_knowledge_base"},
        }).encode()
        req = urllib.request.Request(
            f"{_CHROMA_URL}/api/v1/collections",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())["id"]
    except Exception as e:
        print(f"[KBRefresh] Could not create ChromaDB collection: {e}")
        return None

def _embed_to_chroma(chunks: list[dict]) -> dict:
    """Upsert KB chunks into ChromaDB; return status dict."""
    coll_id = _ensure_collection()
    if not coll_id:
        return {"success": False, "reason": "ChromaDB unavailable or not running"}
    try:
        payload = json.dumps({
            "ids": [c["id"] for c in chunks],
            "documents": [c["text"] for c in chunks],
            "metadatas": [c["metadata"] for c in chunks],
        }).encode()
        req = urllib.request.Request(
            f"{_CHROMA_URL}/api/v1/collections/{coll_id}/upsert",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        print(f"[KBRefresh] Upserted {len(chunks)} chunks to '{_COLLECTION_NAME}'.")
        return {"success": True, "chunks": len(chunks)}
    except Exception as e:
        print(f"[KBRefresh] ChromaDB upsert failed: {e}")
        return {"success": False, "reason": str(e)}

# ─── Main refresh logic ───────────────────────────────────────────────────────

def run_refresh() -> dict:
    """
    Chunk the KB, upsert into ChromaDB (graceful degrade), bump
    knowledge_base_version, and signal the inference server to reload.
    """
    if not _KB_PATH.exists():
        return {"error": f"KB file not found: {_KB_PATH}"}

    kb_text = _KB_PATH.read_text()
    chunks = _chunk_kb(kb_text)
    print(f"[KBRefresh] KB chunked into {len(chunks)} sections.")

    chroma_result = _embed_to_chroma(chunks)
    new_version = _update_manifest_version()
    inference_reloaded = _signal_inference_reload()

    return {
        "chunks": len(chunks),
        "knowledge_base_version": new_version,
        "chroma": chroma_result,
        "inference_reloaded": inference_reloaded,
    }

# ─── FastAPI server (--serve mode only — imports deferred so standalone works
#     even without fastapi/uvicorn installed) ──────────────────────────────────

def _serve(port: int) -> None:
    try:
        import asyncio
        import uvicorn
        from fastapi import FastAPI
    except ImportError as exc:
        print(f"[KBRefresh] --serve requires fastapi and uvicorn: {exc}")
        sys.exit(1)

    app = FastAPI(title="Valet KB Refresh", version="1.0.0")

    @app.post("/refresh")
    async def refresh_endpoint():
        """Refresh KB embeddings, bump version, and reload inference server."""
        result = await asyncio.to_thread(run_refresh)
        return result

    @app.get("/status")
    async def status_endpoint():
        """Return current manifest versions and KB file state."""
        try:
            data = json.loads(_MANIFEST_PATH.read_text())
            return {
                "manifest_version": data.get("manifest_version"),
                "knowledge_base_version": data.get("knowledge_base_version"),
                "kb_exists": _KB_PATH.exists(),
                "kb_size_bytes": _KB_PATH.stat().st_size if _KB_PATH.exists() else 0,
            }
        except Exception as e:
            log.error("Error reading valet KB status", exc_info=True)
            return {"error": "Internal error reading status"}

    uvicorn.run(app, host="127.0.0.1", port=port)

# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Valet KB refresh utility")
    parser.add_argument("--serve", action="store_true", help="Run as FastAPI server on --port")
    parser.add_argument("--port", type=int, default=8014, help="Port for --serve mode")
    args = parser.parse_args()

    if args.serve:
        _serve(args.port)
    else:
        result = run_refresh()
        print(json.dumps(result, indent=2))
        sys.exit(0 if "error" not in result else 1)
