/**
 * @file brains/eval/omnecor-expert.cases.ts
 * @description A/B eval question set for the built-in **Omnecor Expert** brain
 * (the one Omnecor-internals expert). Questions target specific architecture
 * facts the base model cannot know without the brain.
 */
import type { EvalSpec } from "./_types.js";

const spec: EvalSpec = {
  slug: "omnecor-expert",
  name: "Omnecor Expert",
  model: "qwen2.5-coder:7b",
  baseSystem:
    "You are a concise, accurate assistant for the Omnecor codebase. Answer directly " +
    "in 3–5 sentences. Be specific about Omnecor's architecture, file paths, and " +
    "conventions; prefer concrete rules over generalities.",
  cases: [
    {
      q: "In Omnecor, which tRPC procedure type must I use for a procedure that calls an external cloud AI provider, and why?",
      facts: [["cloudprocedure", "cloud procedure"], ["sovereign"], ["forbidden", "blocked", "enforced"]],
    },
    {
      q: "What exactly does Omnecor's Sovereign execution mode block, and what does it never block?",
      facts: [["ai inference", "external ai", "cloud provider", "openai", "anthropic"], ["email", "oauth", "social", "github", "never block"], ["air-gap", "air gap", "cloudprocedure"]],
    },
    {
      q: "What database engine does Omnecor use and how do I apply a schema change?",
      facts: [["libsql", "sqlite"], ["drizzle"], ["build:push", "build push", "drizzle-kit generate", "migrate", "schema.ts"]],
    },
    {
      q: "Where is the single server entry point in Omnecor and what does it bootstrap?",
      facts: [["_core/index", "server/_core", "index.ts"], ["express", "trpc"], ["/api/trpc", "websocket", "/ws", "/health"]],
    },
    {
      q: "How do route-level tests work in Omnecor and what must I stub?",
      facts: [["createcaller", "appROUTER", "real"], ["createtestdb", "in-memory", "trpcharness", "migrations"], ["auditlogservice", "audit", "stub"]],
    },
    {
      q: "How do I add a new tRPC router to Omnecor?",
      facts: [["server/routers", "myrouter", "routers/"], ["routers.ts", "register", "namespace"], ["_core/trpc", "cloudprocedure", "procedure"]],
    },
    {
      q: "In Omnecor, where must dependency overrides and security pins go, and why?",
      facts: [["pnpm-workspace", "workspace.yaml", "workspace yaml"], ["package.json", "pnpm field", "ignored", "pnpm 10"], ["pnpm"]],
    },
    {
      q: "What is an Omnecor Brain Pack made of, and does attaching one change the model's weights?",
      facts: [["charter"], ["corpus", "top-k", "retrieved", "rag"], ["never", "not", "weights", "inference time", "prompt"]],
    },
    {
      q: "Which embedder and vector backend does Omnecor's Brains feature use by default?",
      facts: [["all-minilm", "minilm", "384"], ["libsql", "embedded", "vector_top_k", "on-device"], ["chroma", "optional", "omnecor_vector_backend"]],
    },
    {
      q: "How does a user durably attach a brain to a persona in Omnecor, and does Valet auto-attach suggested brains?",
      facts: [["persona", "data.brains", "attachbrain"], ["union", "per-chat", "resolveattached", "16"], ["suggest", "confirmable", "never auto", "not forced"]],
    },
    {
      q: "What are Omnecor's three database migration paths?",
      facts: [["build:push", "build push", "drizzle-kit generate"], ["db:migrate", "db migrate", "prod", "ci"], ["runtime", "first connect", "auto-migrate", "fallback"]],
    },
    {
      q: "How does OMMESH secure cross-node inference between peers?",
      facts: [["mtls", "mutual tls", "tlsv1.3"], ["fingerprint", "pinned", "pin"], ["mesh_port", "3001", "rejectunauthorized", "requestcert"]],
    },
  ],
};

export default spec;
