"""
server/python_bridges/liteagent_bridge.py
Omnecor — LiteAgent Bridge (child-process mode)

Spawned by AgentService.runLiteAgent() with the AgentTaskConfig JSON as sys.argv[1].
Emits newline-delimited JSON messages (AgentMessageBus format) to stdout.

LiteAgent is a lightweight single-agent reasoning loop backed by a local Ollama
model (no CrewAI dependency). It runs a minimal ReAct-style loop: Thought →
Action → Observation until the model signals completion or the iteration cap
is reached.
"""

from __future__ import annotations

import json
import os
import sys
import time

# Maximum reasoning iterations before forcing a final answer
MAX_ITERATIONS = 8

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


def _ollama_chat(messages: list[dict], timeout: float = 120.0) -> str:
    """Send a messages list to Ollama /api/chat; return assistant content."""
    import httpx

    base = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL", "llama3")
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(
            f"{base}/api/chat",
            json={"model": model, "messages": messages, "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def _build_system_prompt(goal: str, backstory: str, tools: list[str]) -> str:
    tool_section = (
        f"Available tools: {', '.join(tools)}.\n"
        "When you need to use a tool, write 'Action: <tool_name>(<input>)'.\n"
        if tools
        else "No external tools are available for this task.\n"
    )
    return (
        f"{backstory}\n\n"
        f"{tool_section}"
        "Approach the task step-by-step using the following format:\n"
        "Thought: <your reasoning>\n"
        "Action: <tool>(<input>) OR Final Answer: <your answer>\n\n"
        "When you have enough information, respond with:\n"
        "Final Answer: <complete answer to the goal>"
    )


def _run(config: dict) -> None:
    goal = config.get("goal", "")
    backstory = config.get("backstory") or "You are a precise, helpful AI assistant."
    tools: list[str] = config.get("tools") or []

    system_prompt = _build_system_prompt(goal, backstory, tools)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": goal},
    ]

    emit("lite_agent", "system", f"LiteAgent starting — goal: {goal[:120]}")

    for iteration in range(1, MAX_ITERATIONS + 1):
        try:
            response = _ollama_chat(messages)
        except Exception as exc:
            emit("lite_agent", "system",
                 f"Ollama request failed on iteration {iteration}: {exc}",
                 flagged=True)
            sys.exit(1)

        emit("lite_agent", "assistant", response)

        # Check for final answer signal
        lower = response.lower()
        if "final answer:" in lower:
            final_idx = lower.find("final answer:")
            final_text = response[final_idx + len("final answer:"):].strip()
            emit("lite_agent", "assistant", f"[Final] {final_text}")
            emit("lite_agent", "system", "LiteAgent completed.")
            return

        # Append assistant turn and prompt for continuation
        messages.append({"role": "assistant", "content": response})
        messages.append({
            "role": "user",
            "content": (
                "Continue. If you have gathered enough information, "
                "provide the Final Answer now."
            ),
        })

    # Iteration cap reached — extract best answer from last response
    emit("lite_agent", "system",
         f"Iteration cap ({MAX_ITERATIONS}) reached — returning last response.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        emit("lite_agent", "system", "No config provided.", flagged=True)
        sys.exit(1)

    try:
        config: dict = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit("lite_agent", "system",
             f"Invalid config JSON: {exc}", flagged=True)
        sys.exit(1)

    _run(config)


if __name__ == "__main__":
    main()
