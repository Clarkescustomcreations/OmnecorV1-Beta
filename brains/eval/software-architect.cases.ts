/**
 * @file brains/eval/software-architect.cases.ts
 * @description A/B eval question set for the built-in **Software Architect** brain.
 * Questions target specific corpus facts a 7B model may only partially recall.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "software-architect",
  name: "Software Architect",
  model: "qwen2.5-coder:7b",
  baseSystem:
    "You are a concise, accurate senior full-stack engineer (React, Node.js, tRPC, " +
    "Drizzle ORM). Answer directly in 3–5 sentences. Be specific and technically " +
    "precise; prefer concrete rules and examples over generalities.",
  cases: [
    {
      q: "In tRPC, how do I get end-to-end type safety on the client without codegen or writing DTOs?",
      facts: [["approuter", "app router", "router type"], ["import type", "type only", "only the type"], ["infer", "inferrouterinputs", "inferrouteroutputs", "automatically"]],
    },
    {
      q: "How should I validate inputs to a tRPC procedure?",
      facts: [["zod", "schema", ".input"], ["runtime", "compile-time", "compile time", "inferred"], ["bad_request", "before", "throws"]],
    },
    {
      q: "How do I get the generated id back after inserting a row with Drizzle ORM?",
      facts: [["returning", ".returning"], ["insertid", "as any", "raw driver", "cast"], ["type-safe", "type safe", "dialect"]],
    },
    {
      q: "When building a React app, where should server data live versus client UI state?",
      facts: [["tanstack", "react query", "data-fetching", "query"], ["zustand", "client state", "ui state", "component state"], ["source of truth", "stale", "invalidate", "duplicate"]],
    },
    {
      q: "In React, why shouldn't I use the array index as a list key?",
      facts: [["stable", "unique", "identity", "item.id"], ["reorder", "insert", "delete", "reconcile"], ["focus", "wrong", "state"]],
    },
    {
      q: "How do I run a shell command with user input safely in Node.js?",
      facts: [["spawn"], ["exec", "injection", "shell"], ["argv", "array", "allow-list", "allowlist", "validate"]],
    },
    {
      q: "How should authorization tiers be modeled across many tRPC procedures?",
      facts: [["middleware"], ["protectedprocedure", "protected procedure", "publicprocedure"], ["ctx.user", "unauthorized", "context"]],
    },
    {
      q: "What's the right way to paginate a large list endpoint in an API?",
      facts: [["cursor", "keyset", "seek"], ["offset", "scan", "skip"], ["unbounded", "limit", "hasmore", "has more"]],
    },
    {
      q: "In a React useEffect, what causes stale data or an infinite loop?",
      facts: [["dependency", "dependencies", "deps", "exhaustive"], ["stale closure", "stale", "old state"], ["unstable", "new object", "usecallback", "usememo", "infinite"]],
    },
    {
      q: "How do I make a write API endpoint safe against client retries?",
      facts: [["idempoten"], ["idempotency key", "unique constraint", "upsert", "compare-and-set"], ["duplicate", "retry", "at-least-once", "double"]],
    },
    {
      q: "How should I test a router that enforces per-user ownership of data?",
      facts: [["integration", "route-level", "route level", "real", "createcaller"], ["in-memory", "real database", "schema", "migrations"], ["ownership", "leak", "another user", "user b"]],
    },
    {
      q: "What throwaway React optimization should I avoid unless I've measured a problem?",
      facts: [["memo", "usememo", "usecallback", "react.memo"], ["measured", "profile", "premature"], ["allocation", "complexity", "no gain", "slow"]],
    },
  ],
};

export default spec;
