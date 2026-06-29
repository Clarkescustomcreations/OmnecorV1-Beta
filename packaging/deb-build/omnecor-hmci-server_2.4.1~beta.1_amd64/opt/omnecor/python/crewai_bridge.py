"""
server/python_bridges/crewai_bridge.py
Omnecor — CrewAI Bridge (child-process mode)

Spawned by AgentService.runCrew() with the AgentTaskConfig JSON as sys.argv[1].
Emits newline-delimited JSON messages (AgentMessageBus format) to stdout.
Uses crewai when installed; falls back to a direct Ollama chat completion.
"""

from __future__ import annotations

import json
import os
import sys
import time


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def emit(agent_id: str, role: str, content: str, flagged: bool = False) -> None:
    """Print one JSON line in AgentMessageBus wire format."""
    print(
        json.dumps({
            "agent_id": agent_id,
            "role": role,
            "content": content,
            "timestamp": time.time(),
            "flagged": flagged,
        }),
        flush=True,
    )


def _ollama_chat(system: str, user: str) -> str:
    """Single-shot Ollama /api/chat call; returns the assistant content string."""
    import httpx  # bundled with fastapi ecosystem; present in Omnecor venv

    base = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL", "llama3")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
    }
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(f"{base}/api/chat", json=payload)
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")


# ---------------------------------------------------------------------------
# Execution strategies
# ---------------------------------------------------------------------------

def _run_with_ollama(config: dict) -> None:
    """Fallback path when crewai is not installed."""
    goal = config.get("goal", "")
    backstory = config.get("backstory") or "You are a helpful AI agent."
    tools = config.get("tools") or []

    tool_note = ""
    if tools:
        tool_note = f"\nAvailable tools: {', '.join(tools)}. Reference them in your reasoning."

    emit("crew_coordinator", "system",
         "crewai not installed — running via Ollama fallback. "
         "Install crewai for full multi-agent crew support.")

    try:
        content = _ollama_chat(system=backstory + tool_note, user=goal)
        emit("crew_agent_1", "assistant", content or "[no output]")
    except Exception as exc:
        emit("crew_coordinator", "system", f"Ollama request failed: {exc}", flagged=True)
        sys.exit(1)


def _run_with_crewai(config: dict) -> None:
    from crewai import Agent, Crew, Task  # type: ignore

    goal = config.get("goal", "Complete the assigned task.")
    backstory = config.get("backstory") or (
        "You are a skilled specialist working as part of a multi-agent crew "
        "dedicated to delivering high-quality, accurate results."
    )

    emit("crew_coordinator", "system",
         f"Initializing CrewAI crew — goal: {goal[:120]}")

    agent = Agent(
        role="Specialist",
        goal=goal,
        backstory=backstory,
        verbose=False,
        allow_delegation=False,
    )

    task = Task(
        description=goal,
        expected_output="A thorough, accurate response addressing the goal.",
        agent=agent,
    )

    # step_callback exists in crewai ≥0.28 — guard for older installs
    crew_kwargs: dict = {"agents": [agent], "tasks": [task], "verbose": False}
    try:
        crew = Crew(
            **crew_kwargs,
            step_callback=lambda step: emit(
                "crew_agent_1", "assistant", str(step)
            ) if step else None,
        )
    except TypeError:
        crew = Crew(**crew_kwargs)

    try:
        emit("crew_coordinator", "system", "Crew executing…")
        result = crew.kickoff()
        result_text = str(result.raw) if hasattr(result, "raw") else str(result)
        emit("crew_agent_1", "assistant", result_text)
        emit("crew_coordinator", "system", "Crew completed.")
    except Exception as exc:
        emit("crew_coordinator", "system",
             f"Crew execution failed: {exc}", flagged=True)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        emit("crew_coordinator", "system", "No config provided.", flagged=True)
        sys.exit(1)

    try:
        config: dict = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit("crew_coordinator", "system",
             f"Invalid config JSON: {exc}", flagged=True)
        sys.exit(1)

    try:
        import crewai  # noqa: F401
        _run_with_crewai(config)
    except ImportError:
        _run_with_ollama(config)


if __name__ == "__main__":
    main()
