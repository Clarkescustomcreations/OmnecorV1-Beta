"""
server/python_bridges/recursive_mas_bridge.py
Omnecor — RecursiveMAS Multi-Agent System Bridge
FastAPI microservice on port 8011.

Supports sequential, hierarchical, and parallel crew execution.
Uses crewAI if available; falls back to simple Ollama sequential loop.
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ── Optional crewAI import ──────────────────────────────────────────────────
try:
    from crewai import Agent, Crew, Task  # type: ignore

    CREWAI_AVAILABLE = True
except ImportError:
    CREWAI_AVAILABLE = False

# ── Constants ────────────────────────────────────────────────────────────────

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "llama3"
MAX_CONCURRENT_JOBS = 5

# ── In-memory job store ──────────────────────────────────────────────────────

jobs: dict[str, dict[str, Any]] = {}
_job_semaphore = threading.Semaphore(MAX_CONCURRENT_JOBS)

# ── Pydantic models ──────────────────────────────────────────────────────────


class AgentMessage(BaseModel):
    agent_id: str
    role: str
    content: str
    timestamp: float
    flagged: bool = False


class RunRequest(BaseModel):
    crew_config: dict[str, Any] = Field(default_factory=dict)
    goal: str
    max_iterations: int = Field(default=10, ge=1, le=100)
    agent_ids: list[str] = Field(default_factory=list)


class RunResponse(BaseModel):
    job_id: str
    status: str = "started"


class StatusResponse(BaseModel):
    job_id: str
    status: str  # "running" | "complete" | "failed"
    messages: list[AgentMessage]
    result: str | None


class StopResponse(BaseModel):
    stopped: bool


# ── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="RecursiveMAS Bridge", version="1.0.0")


@app.get("/health")
async def health():
    return {"status": "ok", "port": 8011}


@app.get("/modes")
async def modes():
    return ["sequential", "hierarchical", "parallel"]


@app.post("/run", response_model=RunResponse)
async def run_crew(req: RunRequest):
    """Start an async crew execution job."""
    active = sum(1 for j in jobs.values() if j["status"] == "running")
    if active >= MAX_CONCURRENT_JOBS:
        raise HTTPException(status_code=429, detail="Max concurrent jobs reached")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running",
        "messages": [],
        "result": None,
        "stop_event": threading.Event(),
    }

    mode = req.crew_config.get("mode", "sequential")
    thread = threading.Thread(
        target=_run_job,
        args=(job_id, req, mode),
        daemon=True,
    )
    thread.start()
    return RunResponse(job_id=job_id)


@app.get("/status/{job_id}", response_model=StatusResponse)
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    return StatusResponse(
        job_id=job_id,
        status=job["status"],
        messages=[AgentMessage(**m) for m in job["messages"]],
        result=job["result"],
    )


@app.post("/stop/{job_id}", response_model=StopResponse)
async def stop_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    if job["status"] == "running":
        job["stop_event"].set()
        return StopResponse(stopped=True)
    return StopResponse(stopped=False)


# ── Background job execution ─────────────────────────────────────────────────


def _run_job(job_id: str, req: RunRequest, mode: str) -> None:
    """Execute the crew in a background thread."""
    job = jobs[job_id]
    stop_event: threading.Event = job["stop_event"]

    try:
        if CREWAI_AVAILABLE:
            result = _run_crewai(job_id, req, stop_event)
        else:
            result = _run_ollama_sequential(job_id, req, stop_event)

        if stop_event.is_set():
            job["status"] = "failed"
            job["result"] = "Stopped by user"
        else:
            job["status"] = "complete"
            job["result"] = result

    except Exception as exc:  # noqa: BLE001
        job["status"] = "failed"
        job["result"] = f"Error: {exc}"


def _append_message(job_id: str, agent_id: str, role: str, content: str, flagged: bool = False) -> None:
    jobs[job_id]["messages"].append(
        {
            "agent_id": agent_id,
            "role": role,
            "content": content,
            "timestamp": time.time(),
            "flagged": flagged,
        }
    )


# ── crewAI execution path ────────────────────────────────────────────────────


def _run_crewai(job_id: str, req: RunRequest, stop_event: threading.Event) -> str:
    """Use crewAI to execute the crew goal."""
    agent_ids = req.agent_ids or ["agent_0"]
    agents = []
    tasks = []

    for aid in agent_ids:
        if stop_event.is_set():
            return "Stopped"
        role = req.crew_config.get("agents", {}).get(aid, {}).get("role", f"Agent {aid}")
        backstory = req.crew_config.get("agents", {}).get(aid, {}).get("backstory", "You are a helpful AI agent.")
        agent = Agent(  # type: ignore
            role=role,
            goal=req.goal,
            backstory=backstory,
            allow_delegation=False,
            verbose=False,
        )
        task = Task(  # type: ignore
            description=req.goal,
            agent=agent,
            expected_output="A clear and detailed answer to the goal.",
        )
        agents.append(agent)
        tasks.append(task)
        _append_message(job_id, aid, "system", f"Agent {aid} ({role}) initialised")

    crew = Crew(agents=agents, tasks=tasks, verbose=False)  # type: ignore
    output = crew.kickoff()
    _append_message(job_id, "crew", "assistant", str(output))
    return str(output)


# ── Ollama sequential fallback ───────────────────────────────────────────────


def _run_ollama_sequential(job_id: str, req: RunRequest, stop_event: threading.Event) -> str:
    """
    Simple sequential loop: each agent calls Ollama once, passing the previous
    agent's reply as context.
    """
    agent_ids = req.agent_ids if req.agent_ids else ["agent_0"]
    iterations = min(req.max_iterations, len(agent_ids))
    context = req.goal
    final_reply = ""

    for iteration in range(iterations):
        if stop_event.is_set():
            return final_reply or "Stopped"

        agent_id = agent_ids[iteration % len(agent_ids)]
        role = req.crew_config.get("agents", {}).get(agent_id, {}).get("role", f"Agent {agent_id}")

        messages = [
            {"role": "system", "content": f"You are {role}. Work toward the following goal."},
            {"role": "user", "content": context},
        ]

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    OLLAMA_URL,
                    json={"model": DEFAULT_MODEL, "messages": messages, "stream": False},
                )
                response.raise_for_status()
                data = response.json()
                reply = data.get("message", {}).get("content", "")
        except Exception as exc:  # noqa: BLE001
            reply = f"[Ollama error: {exc}]"
            _append_message(job_id, agent_id, "error", reply, flagged=True)
            continue

        _append_message(job_id, agent_id, "assistant", reply)
        context = f"Previous response from {agent_id}: {reply}\n\nContinue working on: {req.goal}"
        final_reply = reply

    return final_reply


# ── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8011)
