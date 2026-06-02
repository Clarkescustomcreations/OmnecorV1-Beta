"""
valet_router_inference.py — Valet Router Inference Server
Hosts the 1.5B local model for intelligent multi-API task routing.
Port: 8010 (configured via ENV.valetRouterUrl)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
from pathlib import Path
import uvicorn
import json
import os
import re

app = FastAPI(title="Omnecor Valet Router", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve the canonical training package relative to this file
# server/python_bridges/ → project root → docs/ai-agents/valet-training/
_TRAINING_DIR = Path(__file__).parent.parent.parent / "docs" / "ai-agents" / "valet-training"
_SYSTEM_PROMPT_PATH = _TRAINING_DIR / "VALET_SYSTEM_PROMPT.md"
_MANIFEST_PATH = _TRAINING_DIR / "routing_manifest.json"

def _load_system_prompt() -> str:
    """Extract canonical prompt text from VALET_SYSTEM_PROMPT.md (between code fences)."""
    try:
        text = _SYSTEM_PROMPT_PATH.read_text()
        match = re.search(r"```\n(.*?)```", text, re.DOTALL)
        if match:
            return match.group(1).strip()
    except Exception as e:
        print(f"[ValetRouter] Could not load system prompt: {e}")
    return "You are the Omnecor Valet — a local routing assistant."

def _load_manifest() -> str:
    """Load routing_manifest.json as compact JSON string."""
    try:
        data = json.loads(_MANIFEST_PATH.read_text())
        return json.dumps(data, separators=(",", ":"))
    except Exception as e:
        print(f"[ValetRouter] Could not load routing manifest: {e}")
    return "{}"

_SYSTEM_PROMPT_TEMPLATE = _load_system_prompt()
_ROUTING_MANIFEST = _load_manifest()

RoutingMode = Literal[
    "api_direct", "valet_background", "local_omesh", "main_api",
    "multi_api", "main_api_omesh", "multi_api_omesh", "moe_chain",
    "moe_chain_omesh", "multi_task"
]
ExecutionMode = Literal["sovereign", "scrapper", "big_spender"]
TaskCategory = Literal[
    "code_generation", "code_review", "research", "synthesis",
    "media_generation", "knowledge_retrieval", "instruction_writing",
    "integration", "hardware", "reporting", "local_task"
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

# Model state
_model = None
_tokenizer = None

def get_model():
    """Lazy-load the 1.5B router model. Falls back to rule-based routing if unavailable."""
    global _model, _tokenizer
    if _model is None:
        try:
            from transformers import AutoTokenizer, AutoModelForCausalLM
            import torch
            model_name = os.environ.get("VALET_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")
            _tokenizer = AutoTokenizer.from_pretrained(model_name)
            _model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map="auto",
            )
        except Exception as e:
            print(f"[ValetRouter] Could not load model: {e}. Using rule-based routing.")
            _model = None
    return _model

def rule_based_route(request: RouteRequest) -> RouteDecision:
    """Fallback rule-based routing when model is unavailable."""
    task_lower = request.task.lower()
    providers = request.available_providers or ["ollama"]

    is_code = any(kw in task_lower for kw in ["code", "function", "implement", "debug", "script"])
    is_research = any(kw in task_lower for kw in ["research", "analyze", "compare", "summarize"])
    is_project = any(kw in task_lower for kw in ["project", "plan", "build", "create app", "create system"])
    is_media = any(kw in task_lower for kw in ["image", "video", "audio", "generate picture"])

    if is_media:
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
        reasoning=f"Rule-based routing: task_type={request.task_type}, is_code={is_code}",
        confidence=0.6,
        requires_todo_md=requires_docs,
        requires_status_md=requires_docs,
    )

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        model_loaded=_model is not None,
        version="1.0.0",
    )

@app.post("/route", response_model=RouteDecision)
async def route_task(request: RouteRequest):
    """Route a task to the appropriate provider(s)."""
    model = get_model()

    if model is None:
        # Rule-based fallback
        return rule_based_route(request)

    try:
        # Build the filled system prompt (A.2 + A.3): same template used in training
        rag_context = request.context or ""
        system_content = (
            _SYSTEM_PROMPT_TEMPLATE
            .replace("{{RAG_CONTEXT}}", rag_context)
            .replace("{{ROUTING_MANIFEST}}", _ROUTING_MANIFEST)
        )

        # Apply the tokenizer's chat template (fixes train/inference skew)
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": request.task[:500]},
        ]
        prompt = _tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = _tokenizer(prompt, return_tensors="pt", max_length=1024, truncation=True)

        with __import__("torch").no_grad():
            outputs = model.generate(
                **inputs, max_new_tokens=220, temperature=0, do_sample=False
            )
        response_text = _tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)

        # Extract the first balanced JSON object from the response
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start >= 0 and json_end > json_start:
            data = json.loads(response_text[json_start:json_end])
            return RouteDecision(**data)
    except Exception as e:
        print(f"[ValetRouter] Model inference error: {e}. Falling back to rule-based.")

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

if __name__ == "__main__":
    port = int(os.environ.get("VALET_ROUTER_PORT", "8010"))
    uvicorn.run(app, host="127.0.0.1", port=port)
