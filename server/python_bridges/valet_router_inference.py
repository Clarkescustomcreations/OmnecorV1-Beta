"""
valet_router_inference.py — Valet Router Inference Server
Hosts the trained Valet Router model for intelligent multi-API task routing.
Port: 8010 (configured via VALET_ROUTER_PORT or ENV.valetRouterUrl)

Artifact loading priority (from models/valet-router/current.json):
  gguf         → llama-cpp-python Llama()
  ollama       → local Ollama REST API (no weights loaded here)
  lora /
  merged_16bit /
  merged_4bit  → transformers AutoModelForCausalLM.from_pretrained(path)
  absent       → rule-based keyword fallback (clearly logged)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
from pathlib import Path
from contextlib import asynccontextmanager
import asyncio
import threading
import uvicorn
import json
import os
import re
import urllib.request

# ─── Paths ────────────────────────────────────────────────────────────────────
_BRIDGES_DIR = Path(__file__).parent
_PROJECT_ROOT = _BRIDGES_DIR.parent.parent

# When bundled in the Electron installer, this script lives at
# resources/python_bridges/valet_router_inference.py and the training docs
# are at resources/docs/ai-agents/valet-training/.
# In dev/standalone mode they live at docs/ai-agents/valet-training/ relative to repo root.
_RESOURCES_DIR = _BRIDGES_DIR.parent  # resources/ (packaged) or server/ (dev)
_PACKAGED_TRAINING_DIR = _RESOURCES_DIR / "docs" / "ai-agents" / "valet-training"
_DEV_TRAINING_DIR = _PROJECT_ROOT / "docs" / "ai-agents" / "valet-training"
_TRAINING_DIR = _PACKAGED_TRAINING_DIR if _PACKAGED_TRAINING_DIR.exists() else _DEV_TRAINING_DIR

_SYSTEM_PROMPT_PATH = _TRAINING_DIR / "VALET_SYSTEM_PROMPT.md"
_MANIFEST_PATH = _TRAINING_DIR / "routing_manifest.json"
# Registry root is overridable so the TS ValetServerService can pin both sides to
# the same directory regardless of platform (it resolves to %APPDATA% on Windows).
# Falls back to the repo-root models dir for standalone/CLI use.
_REGISTRY_ROOT = Path(
    os.environ.get("VALET_REGISTRY_ROOT", str(_PROJECT_ROOT / "models" / "valet-router"))
)
_CURRENT_JSON = _REGISTRY_ROOT / "current.json"

# ─── Prompts & manifest (loaded once at module import) ────────────────────────
_FALLBACK_PROMPT = "You are the Omnecor Valet — a local routing assistant."
_STOPWORDS = frozenset({
    "the", "and", "for", "are", "was", "its", "that", "this",
    "with", "from", "how", "what", "does", "can", "will", "you",
    "your", "not", "but", "they", "have", "has", "also",
})

def _load_system_prompt() -> str:
    try:
        text = _SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        match = re.search(r"```\n(.*?)```", text, re.DOTALL)
        if match:
            return match.group(1).strip()
    except Exception as e:
        print(f"[ValetRouter] Could not load system prompt: {e}")
    return _FALLBACK_PROMPT

def _load_manifest() -> str:
    try:
        data = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
        return json.dumps(data, separators=(",", ":"))
    except Exception as e:
        print(f"[ValetRouter] Could not load routing manifest: {e}")
    return "{}"

# Hot-reload caches — mtime-checked on each inference call (negligible I/O overhead)
_prompt_cache: dict = {"text": "", "mtime": 0.0}
_manifest_cache: dict = {"json": "", "mtime": 0.0}
_kb_cache: dict = {"text": "", "mtime": 0.0}

# Eager-load so first request is never slow; also seed mtime so the first
# _get_* call does not unconditionally re-read the file.
_prompt_cache["text"] = _load_system_prompt()
try:
    _prompt_cache["mtime"] = _SYSTEM_PROMPT_PATH.stat().st_mtime
except Exception:
    pass

_manifest_cache["json"] = _load_manifest()
try:
    _manifest_cache["mtime"] = _MANIFEST_PATH.stat().st_mtime
except Exception:
    pass


def _get_system_prompt() -> str:
    try:
        mtime = _SYSTEM_PROMPT_PATH.stat().st_mtime
        if mtime != _prompt_cache["mtime"]:
            _prompt_cache["text"] = _load_system_prompt()
            _prompt_cache["mtime"] = mtime
            print("[ValetRouter] System prompt reloaded from disk.")
    except Exception:
        pass
    return _prompt_cache["text"] or _FALLBACK_PROMPT


def _get_manifest_json() -> str:
    try:
        mtime = _MANIFEST_PATH.stat().st_mtime
        if mtime != _manifest_cache["mtime"]:
            _manifest_cache["json"] = _load_manifest()
            _manifest_cache["mtime"] = mtime
            print("[ValetRouter] Routing manifest reloaded from disk.")
    except Exception:
        pass
    return _manifest_cache["json"] or "{}"


def _get_kb_text() -> str:
    kb_path = _TRAINING_DIR / "OMNECOR_KNOWLEDGE_BASE.md"
    try:
        mtime = kb_path.stat().st_mtime
        if mtime != _kb_cache["mtime"]:
            _kb_cache["text"] = kb_path.read_text(encoding="utf-8")
            _kb_cache["mtime"] = mtime
    except Exception:
        pass
    return _kb_cache["text"]

# ─── Registry reader ──────────────────────────────────────────────────────────
def _read_registry() -> dict:
    try:
        return json.loads(_CURRENT_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {"artifact_path": None, "status": "pending"}

# ─── Backend state ────────────────────────────────────────────────────────────
_backend_type: Optional[str] = None   # "gguf" | "ollama" | "transformers"
_model = None                          # Llama (gguf) or HF model (transformers)
_tokenizer = None                      # HF tokenizer (transformers only)
_ollama_model: Optional[str] = None   # model name for Ollama backend
_load_attempted = False

# ─── Model loading ────────────────────────────────────────────────────────────
def get_model() -> bool:
    """
    Read models/valet-router/current.json and load the registered artifact.
    Returns True when a model backend is ready, False when using rule-based fallback.
    Idempotent: only attempts load once per process lifetime.
    """
    global _backend_type, _model, _tokenizer, _ollama_model, _load_attempted

    if _load_attempted:
        return _backend_type is not None
    _load_attempted = True

    registry = _read_registry()
    if registry.get("status") != "ready":
        print("[ValetRouter] No registered artifact (status != ready) — rule-based fallback active.")
        return False

    artifact_path = registry.get("artifact_path")
    if not artifact_path:
        print("[ValetRouter] Registry has no artifact_path — rule-based fallback active.")
        return False

    fmt = registry.get("format", "")
    print(f"[ValetRouter] Loading artifact: format={fmt!r} path={artifact_path!r}")

    if fmt == "gguf":
        return _load_gguf(artifact_path, registry)
    elif fmt == "ollama":
        return _load_ollama(registry)
    else:
        # lora, merged_16bit, merged_4bit, or unrecognised → try transformers
        return _load_transformers(artifact_path)


def _load_gguf(artifact_path: str, registry: dict) -> bool:
    global _backend_type, _model
    try:
        from llama_cpp import Llama  # type: ignore
    except ImportError:
        print(
            "[ValetRouter] llama-cpp-python not installed — rule-based fallback active. "
            "Install: pip install llama-cpp-python"
        )
        return False

    gguf_file = registry.get("gguf_file")
    p = Path(artifact_path)
    if gguf_file:
        model_path = str(p / gguf_file)
    elif p.is_file() and p.suffix == ".gguf":
        model_path = str(p)
    else:
        candidates = sorted(p.glob("*.gguf")) if p.is_dir() else []
        if not candidates:
            print(f"[ValetRouter] No .gguf file found in {artifact_path} — rule-based fallback active.")
            return False
        model_path = str(candidates[0])

    # The system prompt (~5KB) + routing manifest (~7KB) alone is ~3-3.5k tokens
    # before the user task, RAG context, and the 220-token JSON output. n_ctx must
    # exceed that or the system prompt is silently truncated (the transformers path
    # uses MAX_SEQ 3072 for the same reason). 4096 leaves headroom; override via env.
    n_ctx = int(os.environ.get("VALET_N_CTX", "4096"))
    # GPU offload: -1 = all layers (default), 0 = CPU-only. A 1.5B Q8 fits any modern
    # GPU and drops warm routing from ~2-3s to sub-second. Falls back to CPU on error.
    n_gpu_layers = int(os.environ.get("VALET_GPU_LAYERS", "-1"))
    try:
        _model = Llama(
            model_path=model_path, n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers, verbose=False,
        )
        _backend_type = "gguf"
        print(f"[ValetRouter] GGUF model loaded: {model_path} (n_ctx={n_ctx}, n_gpu_layers={n_gpu_layers})")
        return True
    except Exception as e:
        # Common cause: a CPU-only llama-cpp-python build can't honor n_gpu_layers>0.
        # Retry once on CPU before giving up to the rule-based fallback.
        if n_gpu_layers != 0:
            print(f"[ValetRouter] GGUF load failed ({e}); retrying CPU-only.")
            try:
                _model = Llama(
                    model_path=model_path, n_ctx=n_ctx,
                    n_gpu_layers=0, verbose=False,
                )
                _backend_type = "gguf"
                print(f"[ValetRouter] GGUF model loaded (CPU): {model_path} (n_ctx={n_ctx})")
                return True
            except Exception as e2:
                e = e2
        print(f"[ValetRouter] Could not load GGUF model: {e} — rule-based fallback active.")
        return False


def _load_ollama(registry: dict) -> bool:
    global _backend_type, _ollama_model
    model_name = registry.get("base_model", "")
    if not model_name:
        print("[ValetRouter] Ollama format but registry has no base_model — rule-based fallback active.")
        return False
    _ollama_model = model_name
    _backend_type = "ollama"
    print(f"[ValetRouter] Ollama backend configured: model={model_name}")
    return True


def _load_transformers(artifact_path: str) -> bool:
    global _backend_type, _model, _tokenizer
    try:
        from transformers import AutoTokenizer, AutoModelForCausalLM  # type: ignore
        import torch  # type: ignore
        _tokenizer = AutoTokenizer.from_pretrained(artifact_path)
        _model = AutoModelForCausalLM.from_pretrained(
            artifact_path,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            device_map="auto",
        )
        _backend_type = "transformers"
        print(f"[ValetRouter] Transformers model loaded from: {artifact_path}")
        return True
    except Exception as e:
        print(f"[ValetRouter] Could not load transformers model: {e} — rule-based fallback active.")
        return False


# ─── Prompt construction ──────────────────────────────────────────────────────
def _build_system_content(rag_context: str) -> str:
    return (
        _get_system_prompt()
        .replace("{{RAG_CONTEXT}}", rag_context)
        .replace("{{ROUTING_MANIFEST}}", _get_manifest_json())
    )


def _kb_keyword_search(query: str, n: int = 3) -> str:
    """Score KB sections by word overlap and return top-n as a context string."""
    text = _get_kb_text()
    if not text:
        return ""
    parts = re.split(r"\n(?=## )", text)
    query_words = set(re.findall(r"\b\w{3,}\b", query.lower())) - _STOPWORDS
    if not query_words:
        return ""
    scored: list[tuple[int, str]] = []
    for part in parts:
        words = set(re.findall(r"\b\w{3,}\b", part.lower()))
        score = len(query_words & words)
        if score:
            scored.append((score, part.strip()))
    scored.sort(key=lambda x: x[0], reverse=True)
    return "\n\n---\n\n".join(s for _, s in scored[:n])


def _rag_query_blocking(task: str, n: int, chroma_url: str) -> str:
    """Blocking ChromaDB lookup — always call via asyncio.to_thread."""
    req = urllib.request.Request(
        f"{chroma_url}/api/v1/collections/omnecor_valet_kb",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=2) as resp:
        coll = json.loads(resp.read())
    payload = json.dumps({
        "query_texts": [task[:400]],
        "n_results": n,
        "include": ["documents"],
    }).encode()
    req = urllib.request.Request(
        f"{chroma_url}/api/v1/collections/{coll['id']}/query",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=4) as resp:
        data = json.loads(resp.read())
    docs = data.get("documents", [[]])[0]
    return "\n\n---\n\n".join(str(d) for d in docs if d) if docs else ""


async def _rag_query(task: str, n: int = 3) -> str:
    """Query ChromaDB omnecor_valet_kb; fall back to keyword search of the KB file."""
    chroma_url = os.environ.get("CHROMA_URL", "http://localhost:8000")
    try:
        result = await asyncio.to_thread(_rag_query_blocking, task, n, chroma_url)
        if result:
            return result
    except Exception:
        pass  # fall through to keyword fallback
    return _kb_keyword_search(task, n)


def _should_rag(task: str, task_type: Optional[str]) -> bool:
    """Return True when RAG context should be auto-injected for this request."""
    if task_type == "qa":
        return True
    tl = task.lower()
    return any(kw in tl for kw in (
        "omnecor", "valet", "routing mode", "what is", "how does",
        "explain", "how to use", "tell me about", "sovereign", "scrapper",
        "execution mode", "knowledge", "brain map",
    ))


def _parse_decision(text: str) -> Optional[dict]:
    json_start = text.find("{")
    json_end = text.rfind("}") + 1
    if json_start >= 0 and json_end > json_start:
        try:
            return json.loads(text[json_start:json_end])
        except json.JSONDecodeError:
            pass
    return None

# ─── Backend-specific inference (all async-safe via asyncio.to_thread) ────────
async def _route_via_gguf(task: str, rag_context: str) -> Optional[dict]:
    system_content = _build_system_content(rag_context)

    def _infer():
        return _model.create_chat_completion(  # type: ignore[union-attr]
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": task[:500]},
            ],
            max_tokens=220,
            temperature=0,
        )

    try:
        response = await asyncio.to_thread(_infer)
        return _parse_decision(response["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"[ValetRouter] GGUF inference error: {e}")
        return None


async def _route_via_ollama(task: str, rag_context: str) -> Optional[dict]:
    system_content = _build_system_content(rag_context)
    ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434")

    def _call():
        payload = json.dumps({
            "model": _ollama_model,
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": task[:500]},
            ],
            "stream": False,
            "options": {"temperature": 0},
        }).encode()
        req = urllib.request.Request(
            f"{ollama_url}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # First route after the model goes cold has to pay the Ollama load cost
        # (a 1.5B Q8 GGUF can take 20-40s to page in on modest/LAN nodes). A 10s
        # timeout guaranteed a rule-based fallback on the very first request; warm
        # routing is ~2-3s, so a longer ceiling only bites on cold start.
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read())

    try:
        data = await asyncio.to_thread(_call)
        return _parse_decision(data["message"]["content"])
    except Exception as e:
        print(f"[ValetRouter] Ollama inference error: {e}")
        return None


async def _route_via_transformers(task: str, rag_context: str) -> Optional[dict]:
    system_content = _build_system_content(rag_context)

    def _infer():
        import torch  # type: ignore
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": task[:500]},
        ]
        prompt = _tokenizer.apply_chat_template(  # type: ignore[union-attr]
            messages, tokenize=False, add_generation_prompt=True
        )
        # The system prompt + routing manifest alone is ~2.8k tokens, so the cap must
        # match the training MAX_SEQ (3072). Left-truncate so that if a very long task
        # overflows, we drop the oldest system text — never the user turn or the
        # generation marker the model needs to start its JSON answer.
        inputs = _tokenizer(
            prompt, return_tensors="pt", max_length=3072,
            truncation=True, truncation_side="left",
        )
        # Move inputs onto the model's device (cuda when device_map="auto" placed
        # the weights on GPU) — otherwise generate() raises a CPU/CUDA mismatch.
        inputs = {k: v.to(_model.device) for k, v in inputs.items()}  # type: ignore[union-attr]
        with torch.no_grad():
            outputs = _model.generate(  # type: ignore[union-attr]
                **inputs, max_new_tokens=220, do_sample=False
            )
        return _tokenizer.decode(
            outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True
        )

    try:
        text = await asyncio.to_thread(_infer)
        return _parse_decision(text)
    except Exception as e:
        print(f"[ValetRouter] Transformers inference error: {e}")
        return None


# ─── FastAPI setup ────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Kick off model loading in a background thread so the server starts
    # accepting requests immediately while the (potentially slow) load runs.
    threading.Thread(target=get_model, daemon=True, name="valet-model-loader").start()
    yield


app = FastAPI(title="Omnecor Valet Router", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Pydantic models ──────────────────────────────────────────────────────────
RoutingMode = Literal[
    "api_direct", "valet_background", "local_omesh", "main_api",
    "multi_api", "main_api_omesh", "multi_api_omesh", "moe_chain",
    "moe_chain_omesh", "multi_task"
]
ExecutionMode = Literal["sovereign", "scrapper", "big_spender"]
TaskCategory = Literal[
    "code_generation", "code_review", "research", "synthesis",
    "media_generation", "knowledge_retrieval", "instruction_writing",
    "integration", "hardware", "reporting", "context_management",
    "memory_operations", "local_task"
]
CostTier = Literal["free", "low", "medium", "high"]


class RouteRequest(BaseModel):
    task: str
    context: Optional[str] = None
    preferred_mode: Optional[RoutingMode] = "main_api"
    available_providers: list[str] = []
    execution_mode: Optional[ExecutionMode] = "scrapper"
    task_type: Optional[str] = None  # "chat", "code", "research", "router"


class RouteDecision(BaseModel):
    category: TaskCategory = "local_task"
    mode: RoutingMode
    primary_provider: str
    primary_model: str = ""
    secondary_providers: list[str] = []
    cost_tier: CostTier = "free"
    local_capable: bool = True
    reasoning: str
    confidence: float
    requires_todo_md: bool
    requires_status_md: bool


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    version: str
    backend: Optional[str] = None


class RagRequest(BaseModel):
    query: str
    n_results: int = 3


# ─── Rule-based fallback ──────────────────────────────────────────────────────
def rule_based_route(request: RouteRequest) -> RouteDecision:
    task_lower = request.task.lower()
    providers = request.available_providers or ["ollama"]

    is_memory = any(kw in task_lower for kw in ["remember", "/btw", "by the way", "keep in mind", "recall", "what do you know about me", "my preference"])
    is_context = any(kw in task_lower for kw in ["/compress", "compress the context", "summarize the conversation", "token budget", "prune the history", "trim the context"])
    is_code = any(kw in task_lower for kw in ["code", "function", "implement", "debug", "script"])
    is_research = any(kw in task_lower for kw in ["research", "analyze", "compare", "summarize"])
    is_project = any(kw in task_lower for kw in ["project", "plan", "build", "create app", "create system"])
    is_media = any(kw in task_lower for kw in ["image", "video", "audio", "generate picture"])

    if is_memory:
        category, cost_tier, local_capable = "memory_operations", "free", True
    elif is_context:
        category, cost_tier, local_capable = "context_management", "free", True
    elif is_media:
        category, cost_tier, local_capable = "media_generation", "medium", True
    elif is_code:
        category, cost_tier, local_capable = "code_generation", "medium", False
    elif is_research:
        category, cost_tier, local_capable = "research", "low", False
    else:
        category, cost_tier, local_capable = "local_task", "free", True

    mode = request.preferred_mode or "main_api"
    primary = providers[0] if providers else "ollama"
    requires_docs = is_project or "plan" in task_lower

    print(f"[ValetRouter] Rule-based fallback active (model offline). category={category}")
    return RouteDecision(
        category=category,
        mode=mode,
        primary_provider=primary,
        primary_model="",
        secondary_providers=providers[1:3] if len(providers) > 1 else [],
        cost_tier=cost_tier,
        local_capable=local_capable,
        reasoning="Rule-based fallback — Valet Router model not loaded",
        confidence=0.6,
        requires_todo_md=requires_docs,
        requires_status_md=requires_docs,
    )


# ─── API endpoints ────────────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        model_loaded=_backend_type is not None,
        version="1.0.0",
        backend=_backend_type,
    )


@app.post("/route", response_model=RouteDecision)
async def route_task(request: RouteRequest):
    """Route a task to the appropriate provider(s)."""
    # If load hasn't been attempted yet (e.g. lifespan thread hasn't run),
    # do a synchronous attempt now so the first request isn't always rule-based.
    if not _load_attempted:
        get_model()

    rag_context = request.context or ""
    if not rag_context and _should_rag(request.task, request.task_type):
        rag_context = await _rag_query(request.task)
    data: Optional[dict] = None

    if _backend_type == "gguf":
        data = await _route_via_gguf(request.task, rag_context)
    elif _backend_type == "ollama":
        data = await _route_via_ollama(request.task, rag_context)
    elif _backend_type == "transformers":
        data = await _route_via_transformers(request.task, rag_context)

    if data is None:
        return rule_based_route(request)

    try:
        return RouteDecision(**data)
    except Exception as e:
        print(f"[ValetRouter] Decision parse error: {e}. Falling back to rules.")
        return rule_based_route(request)


@app.get("/modes")
async def list_modes():
    """List all available routing modes."""
    return {
        "modes": [
            {"id": "api_direct", "label": "API Direct", "description": "Bypass valet, send directly to provider"},
            {"id": "valet_background", "label": "Valet Background", "description": "Valet handles background tasks only"},
            {"id": "local_omesh", "label": "Local Omesh", "description": "Route to local Omesh model"},
            {"id": "main_api", "label": "Main API", "description": "Route to primary configured API"},
            {"id": "multi_api", "label": "Multi API", "description": "Distribute across multiple APIs"},
            {"id": "main_api_omesh", "label": "Main API + Omesh", "description": "Primary API + Omesh nodes in parallel"},
            {"id": "multi_api_omesh", "label": "Multi API + Omesh", "description": "Multiple APIs + Omesh nodes"},
            {"id": "moe_chain", "label": "MoE Chain", "description": "Sequential chain through fine-tuned models"},
            {"id": "moe_chain_omesh", "label": "MoE Chain + Omesh", "description": "Chain on main PC + parallel Omesh"},
            {"id": "multi_task", "label": "Multi Task", "description": "High-spec: run multiple models simultaneously"},
        ]
    }


@app.post("/rag")
async def rag_query_endpoint(req: RagRequest):
    """Retrieve relevant KB chunks (ChromaDB → keyword fallback)."""
    chunks = await _rag_query(req.query, req.n_results)
    return {"chunks": chunks, "query": req.query}


@app.post("/admin/reload")
async def admin_reload():
    """Force-reload manifest, system prompt, and KB cache from disk."""
    _prompt_cache["mtime"] = 0.0
    _manifest_cache["mtime"] = 0.0
    _kb_cache["mtime"] = 0.0
    _get_system_prompt()
    _get_manifest_json()
    _get_kb_text()
    return {"reloaded": True}


if __name__ == "__main__":
    port = int(os.environ.get("VALET_ROUTER_PORT", "8010"))
    uvicorn.run(app, host="127.0.0.1", port=port)
