/**
 * @file brains/eval/coding.cases.ts
 * @description A/B eval question set for the built-in **Coding** brain
 * (mirrors server/scripts/evalCodingBrain.ts — the original Phase-6 proof).
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "coding",
  name: "Coding",
  model: "qwen2.5-coder:7b",
  baseSystem:
    "You are a concise, accurate coding assistant. Answer the question directly in " +
    "3–5 sentences. Be specific and technically precise; prefer concrete rules and " +
    "examples over generalities.",
  cases: [
    {
      q: "In JavaScript, why does sorting an array of numbers with .sort() sometimes give the wrong order, and how do I fix it?",
      facts: [["string", "lexicographic", "utf-16", "code unit"], ["comparator", "compare function", "compare callback"], ["a - b", "a-b", "(a, b) =>"]],
    },
    {
      q: "Why does 0.1 + 0.2 not equal 0.3 in most languages, and how should I represent money?",
      facts: [["ieee", "floating", "binary", "double"], ["cents", "integer", "smallest unit", "decimal library"], ["epsilon", "tolerance", "never compare", "not ==="]],
    },
    {
      q: "How do I prevent SQL injection in my database queries?",
      facts: [["parameter", "prepared statement", "bound parameter", "placeholder"], ["concatenat", "string concat", "out-of-band", "separately"], ["allow-list", "allowlist", "allow list"]],
    },
    {
      q: "What is the correct way to store user passwords?",
      facts: [["argon2", "bcrypt", "scrypt"], ["salt"], ["slow", "memory-hard", "work factor"]],
    },
    {
      q: "How should I compare a secret token or HMAC signature to avoid leaking information?",
      facts: [["constant-time", "constant time", "timingsafeequal", "timing-safe"], ["short-circuit", "first differing", "early return", "timing attack"]],
    },
    {
      q: "Should I use == or === when comparing values in JavaScript, and why?",
      facts: [["===", "strict equality"], ["coercion", "coerce", "type conversion"], ["== null", "nan", "isnan"]],
    },
    {
      q: "A long synchronous computation is freezing my Node.js server for all requests. What is going on and how do I fix it?",
      facts: [["event loop", "single thread", "single-threaded"], ["worker thread", "worker_threads", "separate process", "offload"], ["block", "non-blocking", "stream"]],
    },
    {
      q: "I run one query to get rows then another query for each row and it's slow. What is this and how do I fix it?",
      facts: [["n+1", "n + 1"], ["join", "eager", "batch", "in ("], ["round trip", "per row", "dataloader"]],
    },
    {
      q: "How do I safely build a filesystem path from user-supplied input?",
      facts: [["../", "traversal", "dot-dot", "dot dot"], ["resolve", "normalize", "absolute path"], ["base dir", "inside", "allowed", "prefix"]],
    },
    {
      q: "What must I check when verifying a JWT to keep it secure?",
      facts: [["alg", "algorithm"], ["none", "rs256", "hs256"], ["exp", "expiry", "expiration"]],
    },
  ],
};

export default spec;
