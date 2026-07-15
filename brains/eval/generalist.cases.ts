/**
 * @file brains/eval/generalist.cases.ts
 * @description A/B eval question set for the built-in **Generalist** brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "generalist",
  name: "Generalist",
  model: "qwen2.5:7b",
  baseSystem:
    "You are a capable general-purpose AI assistant working inside the Omnecor AI " +
    "workstation. Answer directly in 3–5 sentences. Be specific and concrete; prefer " +
    "actionable rules, named tools, and checklists over generalities.",
  cases: [
    {
      q: "Before starting a complex multi-step task, what should you do first?",
      facts: [
        ["plan", "decompose", "break"],
        ["goal", "success criteria", "restate"],
        ["confirm", "ask", "user", "ambigu"],
      ],
    },
    {
      q: "How should an agent track its plan and progress across a long task?",
      facts: [
        ["todo.md", "todo"],
        ["checkbox", "checklist", "step"],
        ["update", "mark", "done", "verified"],
      ],
    },
    {
      q: "What input edge cases should you check before calling code done?",
      facts: [
        ["empty", "null", "zero"],
        ["boundary", "off-by-one", "max", "huge"],
        ["unicode", "duplicate", "negative", "whitespace"],
      ],
    },
    {
      q: "How do you verify a claim about what some code does instead of guessing?",
      facts: [
        ["read", "open", "actual"],
        ["run", "test", "execute"],
        ["cite", "evidence", "file", "line"],
      ],
    },
    {
      q: "Why shouldn't you trust your training data for library versions or APIs, and what should you do instead?",
      facts: [
        ["stale", "outdated", "cutoff", "change"],
        ["web search", "search", "docs", "documentation", "registry"],
        ["verify", "current", "check", "live"],
      ],
    },
    {
      q: "A small local model needs a bigger GPU than its machine has. What can Omnecor do about it?",
      facts: [
        ["ommesh", "mesh", "peer"],
        ["vram", "gpu", "offload"],
        ["mtls", "routing", "lan", "telemetry"],
      ],
    },
    {
      q: "Which built-in expert brain should be attached when designing a PCB layout, and what does it know?",
      facts: [
        ["pcb", "schematics"],
        ["kicad", "routing", "footprint", "clearance"],
        ["attach", "brain", "expert"],
      ],
    },
    {
      q: "How should structural or engineering numbers be produced by an AI agent in Omnecor?",
      facts: [
        ["calc engine", "fea", "deterministic", "blueprint"],
        ["never", "not", "hallucinat", "invent", "estimat"],
        ["comput", "tool", "engine"],
      ],
    },
    {
      q: "What happens in Omnecor when a model emits a malformed tool call, and what should the model do next?",
      facts: [
        ["try-fail-fix", "error", "fed back", "injected"],
        ["retry", "self-correct", "fix", "try again"],
        ["crash", "fatal", "not", "abort"],
      ],
    },
    {
      q: "What should an agent do when a task is too complex for it to complete alone?",
      facts: [
        ["walk-through", "walkthrough", "guided walk"],
        ["user", "collaborat", "paste", "step-by-step", "step by step"],
        ["escalat", "cloud", "free", "web ui", "stronger", "mesh", "delegate"],
      ],
    },
    {
      q: "How can an agent avoid re-deriving an error-prone procedure from scratch when a known recipe might exist?",
      facts: [
        ["skill", "list_agent_skills", "read_agent_skill"],
        ["recipe", "procedure", "known-good", "checklist"],
        ["follow", "read", "discover"],
      ],
    },
    {
      q: "What security checks should you run on any endpoint that accepts user input?",
      facts: [
        ["validat", "allowlist", "schema", "trust boundary"],
        ["injection", "parameteriz", "sql", "escap"],
        ["author", "idor", "ownership"],
      ],
    },
    {
      q: "How should you debug a bug that only happens sometimes?",
      facts: [
        ["reproduce", "reproduction"],
        ["hypothes", "evidence", "discriminat"],
        ["one variable", "one change", "cause", "regression"],
      ],
    },
    {
      q: "What must an agent respect about a user in sovereign execution mode?",
      facts: [
        ["cloud", "blocked", "forbidden", "air-gapped"],
        ["local", "mesh", "lan"],
        ["sovereign", "execution mode"],
      ],
    },
  ],
};

export default spec;
