"""
valet_router_inference.py — Valet Router Inference Server
Hosts the 1.5B local model for intelligent multi-API task routing.
Port: 8010 (configured via ENV.valetRouterUrl)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
import uvicorn
import json
import os

app = FastAPI(title="Omnecor Valet Router", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RoutingMode = Literal[
    "api_direct", "valet_background", "local_omesh", "main_api",
    "multi_api", "main_api_omesh", "multi_api_omesh", "moe_chain",
    "moe_chain_omesh", "multi_task"
]

class RouteRequest(BaseModel):
    task: str
    context: Optional[str] = None
    preferred_mode: Optional[RoutingMode] = "main_api"
    available_providers: list[str] = []
    task_type: Optional[str] = None  # "chat", "code", "research", "router"

class RouteDecision(BaseModel):
    mode: RoutingMode
    primary_provider: str
    secondary_providers: list[str] = []
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
            model_name = os.environ.get("VALET_MODEL", "unsloth/Llama-3.2-1B-Instruct")
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

    # Detect task complexity
    is_code_task = any(kw in task_lower for kw in ["code", "function", "implement", "debug", "script"])
    is_research = any(kw in task_lower for kw in ["research", "analyze", "compare", "summarize"])
    is_project = any(kw in task_lower for kw in ["project", "plan", "build", "create app", "create system"])

    mode = request.preferred_mode or "main_api"
    primary = providers[0] if providers else "ollama"

    # Project tasks need todo.md + status.md
    requires_docs = is_project or "plan" in task_lower

    return RouteDecision(
        mode=mode,
        primary_provider=primary,
        secondary_providers=providers[1:3] if len(providers) > 1 else [],
        reasoning=f"Rule-based routing: task_type={request.task_type}, is_code={is_code_task}",
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
        # Use the loaded model to make a routing decision
        prompt = f"""You are a routing assistant. Given a task, choose the best routing mode and provider.

Task: {request.task[:500]}
Available providers: {', '.join(request.available_providers)}
Preferred mode: {request.preferred_mode}

Respond with JSON: {{"mode": "...", "primary_provider": "...", "secondary_providers": [], "reasoning": "...", "confidence": 0.0-1.0, "requires_todo_md": bool, "requires_status_md": bool}}"""

        inputs = _tokenizer(prompt, return_tensors="pt", max_length=512, truncation=True)
        with __import__("torch").no_grad():
            outputs = model.generate(**inputs, max_new_tokens=200, temperature=0.1, do_sample=False)
        response_text = _tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)

        # Parse JSON from response
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
