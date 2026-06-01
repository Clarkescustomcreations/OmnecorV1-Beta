from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
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


def is_safe_model_path(path: str) -> bool:
    real = os.path.realpath(path)
    if not real.endswith(".gguf"):
        return False
    return any(real.startswith(os.path.realpath(d)) for d in ALLOWED_MODEL_DIRS)


class GenerateRequest(BaseModel):
    prompt: str
    model_path: str
    max_tokens: int = 256
    temperature: float = 0.7


class EmbeddingRequest(BaseModel):
    text: str
    model_path: str


@app.get("/health")
def health():
    return {"status": "ok", "llama_cpp_available": LLAMA_CPP_AVAILABLE, "port": 8013}


@app.post("/generate")
def generate(req: GenerateRequest):
    if not LLAMA_CPP_AVAILABLE:
        raise HTTPException(status_code=503, detail="llama-cpp-python not installed. Run: pip install llama-cpp-python")
    if not is_safe_model_path(req.model_path):
        raise HTTPException(status_code=403, detail="Model path not allowed. Must be a .gguf file in an allowed directory.")
    model = Llama(model_path=req.model_path, n_ctx=2048, verbose=False)
    output = model(req.prompt, max_tokens=req.max_tokens, temperature=req.temperature)
    text = output["choices"][0]["text"]
    tokens_used = output.get("usage", {}).get("total_tokens", 0)
    return {"text": text, "tokens_used": tokens_used}


@app.post("/embeddings")
def embeddings(req: EmbeddingRequest):
    if not LLAMA_CPP_AVAILABLE:
        raise HTTPException(status_code=503, detail="llama-cpp-python not installed")
    if not is_safe_model_path(req.model_path):
        raise HTTPException(status_code=403, detail="Model path not allowed")
    model = Llama(model_path=req.model_path, embedding=True, verbose=False)
    embedding = model.create_embedding(req.text)["data"][0]["embedding"]
    return {"embedding": embedding}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8013)
