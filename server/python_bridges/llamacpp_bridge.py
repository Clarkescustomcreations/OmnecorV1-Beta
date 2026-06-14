from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
import threading
import uvicorn

LLAMA_CPP_AVAILABLE = False
try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except ImportError:
    pass

ALLOWED_MODEL_DIRS = [
    os.path.expanduser("~/.ollama/models"),
    os.path.expanduser("~/models"),
    "/opt/omnecor/models",
]

app = FastAPI()

# ---------------------------------------------------------------------------
# Warm model cache — keyed by model_path; separate caches for generate vs embed
# so each model_path can be loaded in either mode without collision.
# ---------------------------------------------------------------------------
_gen_cache: dict[str, tuple] = {}   # path → (Llama, threading.Lock)
_emb_cache: dict[str, tuple] = {}   # path → (Llama, threading.Lock)
_cache_mu = threading.Lock()        # guards cache dicts during load/unload


def _is_within(child: str, parent: str) -> bool:
    """Separator-aware containment check (fixes prefix-bypass from F5)."""
    parent = parent.rstrip(os.sep)
    return child == parent or child.startswith(parent + os.sep)


def is_safe_model_path(path: str) -> bool:
    real = os.path.realpath(path)
    if not real.endswith(".gguf"):
        return False
    return any(_is_within(real, os.path.realpath(d)) for d in ALLOWED_MODEL_DIRS)


def _get_or_load(model_path: str, embedding: bool = False) -> tuple:
    """Return a (Llama, Lock) pair from the warm cache, loading if needed."""
    cache = _emb_cache if embedding else _gen_cache
    if model_path in cache:
        return cache[model_path]
    with _cache_mu:
        # double-check inside the lock
        if model_path in cache:
            return cache[model_path]
        llm = Llama(
            model_path=model_path,
            n_ctx=2048,
            verbose=False,
            embedding=embedding,
        )
        entry = (llm, threading.Lock())
        cache[model_path] = entry
        return entry


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    prompt: str
    model_path: str
    max_tokens: int = 256
    temperature: float = 0.7


class EmbeddingRequest(BaseModel):
    text: str
    model_path: str


class LoadRequest(BaseModel):
    model_path: str
    embedding: bool = False


class UnloadRequest(BaseModel):
    model_path: str
    embedding: Optional[bool] = None  # None = unload from both caches


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "llama_cpp_available": LLAMA_CPP_AVAILABLE,
        "port": 8013,
        "loaded_generate": list(_gen_cache.keys()),
        "loaded_embed": list(_emb_cache.keys()),
    }


@app.get("/loaded")
def loaded():
    return {
        "generate": list(_gen_cache.keys()),
        "embed": list(_emb_cache.keys()),
    }


@app.post("/load")
def load_model(req: LoadRequest):
    """Pre-warm a model into the cache before the first generation request."""
    if not LLAMA_CPP_AVAILABLE:
        raise HTTPException(status_code=503, detail="llama-cpp-python not installed")
    if not is_safe_model_path(req.model_path):
        raise HTTPException(status_code=403, detail="Model path not allowed")
    _get_or_load(req.model_path, embedding=req.embedding)
    return {"loaded": req.model_path, "embedding": req.embedding}


@app.post("/unload")
def unload_model(req: UnloadRequest):
    """Remove a model from the cache and free its memory."""
    removed = []
    with _cache_mu:
        if req.embedding is None or req.embedding is False:
            if req.model_path in _gen_cache:
                del _gen_cache[req.model_path]
                removed.append("generate")
        if req.embedding is None or req.embedding is True:
            if req.model_path in _emb_cache:
                del _emb_cache[req.model_path]
                removed.append("embed")
    return {"unloaded": req.model_path, "caches": removed}


@app.post("/generate")
def generate(req: GenerateRequest):
    if not LLAMA_CPP_AVAILABLE:
        raise HTTPException(status_code=503, detail="llama-cpp-python not installed. Run: pip install llama-cpp-python")
    if not is_safe_model_path(req.model_path):
        raise HTTPException(status_code=403, detail="Model path not allowed. Must be a .gguf file in an allowed directory.")
    llm, lock = _get_or_load(req.model_path, embedding=False)
    with lock:
        output = llm(req.prompt, max_tokens=req.max_tokens, temperature=req.temperature)
    text = output["choices"][0]["text"]
    tokens_used = output.get("usage", {}).get("total_tokens", 0)
    return {"text": text, "tokens_used": tokens_used}


@app.post("/embeddings")
def embeddings(req: EmbeddingRequest):
    if not LLAMA_CPP_AVAILABLE:
        raise HTTPException(status_code=503, detail="llama-cpp-python not installed")
    if not is_safe_model_path(req.model_path):
        raise HTTPException(status_code=403, detail="Model path not allowed")
    llm, lock = _get_or_load(req.model_path, embedding=True)
    with lock:
        embedding = llm.create_embedding(req.text)["data"][0]["embedding"]
    return {"embedding": embedding}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8013)
