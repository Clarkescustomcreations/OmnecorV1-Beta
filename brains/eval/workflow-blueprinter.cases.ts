/**
 * @file brains/eval/workflow-blueprinter.cases.ts
 * @description A/B eval question set for the built-in **Workflow Blueprinter** brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "workflow-blueprinter",
  name: "Workflow Blueprinter",
  model: "qwen2.5-coder:7b",
  baseSystem:
    "You are a concise, accurate expert in node-based workflows and orchestration " +
    "(DAGs, pipelines, data flow). Answer directly in 3–5 sentences. Be specific and " +
    "technically precise; prefer concrete rules over generalities.",
  cases: [
    {
      q: "Why is a workflow modeled as a DAG, and what does 'acyclic' guarantee?",
      facts: [["directed acyclic", "dag"], ["node", "edge", "dependency", "step"], ["acyclic", "no cycle", "terminate", "ordering", "executable"]],
    },
    {
      q: "How does an engine decide the order to run nodes in a dependency graph?",
      facts: [["topological", "topological sort", "topo"], ["dependencies", "upstream", "complete", "after"], ["parallel", "no dependency", "concurrent"]],
    },
    {
      q: "My workflow needs to repeat a step. How do I do that without creating a cycle?",
      facts: [["bounded", "iterator", "loop node", "foreach", "max"], ["re-trigger", "retrigger", "event", "split", "fan out"], ["cycle", "back-edge", "back edge", "deadlock", "terminat"]],
    },
    {
      q: "Why must side-effecting workflow nodes be idempotent?",
      facts: [["idempoten"], ["retry", "replay", "at-least-once", "twice", "again"], ["idempotency key", "upsert", "dedupe", "duplicate", "double"]],
    },
    {
      q: "How should I retry a node that fails calling an external API?",
      facts: [["exponential", "backoff"], ["jitter", "thundering herd", "cap", "attempts"], ["transient", "retryable", "idempotent", "not", "permanent"]],
    },
    {
      q: "What should happen to items that keep failing after all retries are exhausted?",
      facts: [["dead-letter", "dead letter", "dlq"], ["inspect", "reprocess", "replay", "fix"], ["poison", "block", "drop", "lost", "alert"]],
    },
    {
      q: "How do I ensure a multi-system process is all-or-nothing without a distributed transaction?",
      facts: [["saga"], ["compensat", "undo", "roll back", "backward"], ["local", "step", "eventual"]],
    },
    {
      q: "What is fan-out / fan-in in a workflow?",
      facts: [["fan-out", "fan out", "split", "branch"], ["fan-in", "fan in", "merge", "join"], ["parallel", "wait", "all", "aggregate", "converge"]],
    },
    {
      q: "How should I handle a runaway fan-out over thousands of items?",
      facts: [["concurrency", "limit", "cap", "semaphore", "pool"], ["rate limit", "throttle", "overwhelm", "downstream"], ["unbounded", "cascading", "bound"]],
    },
    {
      q: "Why validate data at workflow boundaries, and where most strictly?",
      facts: [["schema", "validate", "json schema"], ["fail fast", "at the source", "boundary", "malformed"], ["untrusted", "webhook", "external", "trigger", "input"]],
    },
    {
      q: "What do I need to know about cron schedules to avoid common mistakes?",
      facts: [["cron", "five fields", "minute", "hour"], ["time zone", "timezone", "utc", "daylight"], ["overlap", "concurrent", "lock", "longer than"]],
    },
    {
      q: "How do I make a long-running workflow resumable after a crash?",
      facts: [["persist", "state", "checkpoint"], ["resume", "last", "step", "completed"], ["idempotent", "deterministic", "side effect", "rerun"]],
    },
  ],
};

export default spec;
