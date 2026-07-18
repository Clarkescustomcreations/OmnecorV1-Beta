/**
 * @file brains/sources/workflow-blueprinter.ts
 * @description Source content for the built-in **Workflow Blueprinter** Brain
 * Pack (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * A specialist in node-based graphs and execution logic: DAGs, data flow,
 * pipeline design, scheduling, retries, and orchestration. GENERAL-PURPOSE
 * workflow-automation knowledge (applies to any node/pipeline engine — n8n,
 * Airflow, CI/CD, ETL, AI tool-graphs). Original content, ships CC0. One durable
 * fact per entry → one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";
import { REASONING_BASE } from "./_reasoning-base.js";

export const WORKFLOW_BLUEPRINTER_CHARTER = `${REASONING_BASE}

Domain layer — workflow blueprinting (node graphs, DAGs, orchestration). On any workflow task, ALSO apply:

1. Model the flow as a DAG — directed, ACYCLIC. If you need a loop, make it an explicit bounded iterator or a re-triggering event, never a hidden cycle. A cycle in a dependency graph is a bug (deadlock/infinite run).
2. Make each node a single, well-named responsibility with explicit inputs and outputs. Data flows along edges; a node should not reach outside its inputs for hidden state.
3. Design every step to be idempotent and retryable. Assume any node can fail or run twice; use idempotency keys and safe retries so a rerun doesn't double-effect.
4. Handle failure explicitly: define what happens on error per node (retry with backoff, skip, route to an error branch, or halt), and never let a silent failure poison downstream steps.
5. Validate at the boundaries. Check inputs entering the graph and outputs of each node against a schema so a malformed payload fails fast at the source, not three nodes later.
6. Keep it observable and debuggable: log each node's inputs/outputs/status, make runs traceable end-to-end, and prefer small composable steps over one giant node.
7. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const WORKFLOW_BLUEPRINTER_SOURCES: BrainFact[] = [
  // ── Graph fundamentals ─────────────────────────────────────────────────────
  {
    name: "dag-definition",
    text: `A workflow is best modeled as a DAG — Directed Acyclic Graph: nodes are steps/tasks, directed edges are dependencies ("B runs after A"), and ACYCLIC means no path leads back to where it started. Acyclicity is what makes the graph executable — it guarantees a valid ordering exists and the workflow terminates. Almost every orchestration engine (Airflow, CI pipelines, build systems, ETL, AI tool-graphs) is a DAG under the hood. If your design has a cycle, you have a dependency error, not a workflow.`,
  },
  {
    name: "dag-topological-sort",
    text: `To execute a DAG you TOPOLOGICALLY SORT it: order nodes so every node comes after all its dependencies. A node becomes runnable only when all its inbound edges (upstream nodes) have completed. Nodes with no dependency between them can run in PARALLEL. The topological sort also detects cycles — if you can't order all nodes, a cycle exists. This ordering, not the visual left-to-right layout, is what actually determines run order; two nodes side by side may run in either order or simultaneously.`,
  },
  {
    name: "dag-no-cycles-loops",
    text: `A true cycle in a dependency DAG is illegal (it can't be ordered and would deadlock or loop forever). When a workflow genuinely needs repetition, model it explicitly, NOT as a back-edge: use a bounded iterator/loop node (foreach over a collection, or "repeat up to N times / until condition"), split-and-merge (fan out over items, process each, fan in), or an event that RE-TRIGGERS a fresh run. Always bound the iteration (a max count or a clear termination condition) so a runaway loop can't execute forever.`,
  },
  {
    name: "dag-fan-out-fan-in",
    text: `Two core structural patterns. FAN-OUT (split): one node's output branches to many parallel nodes — process a list's items concurrently, or run independent tasks at once. FAN-IN (merge/join): several upstream nodes converge into one that waits for ALL (or a quorum) to finish before running — aggregate results, combine branches. A join must define its wait semantics (all vs any) and how it merges multiple inputs. Fan-out/fan-in is how you get parallelism while keeping a clean, acyclic structure.`,
  },
  {
    name: "graph-node-edge-model",
    text: `In a node-based editor, a NODE is a unit of work with typed INPUT ports and OUTPUT ports; an EDGE connects an output port to a compatible input port, carrying data (and implying execution order). Good node design: one clear responsibility, explicit ports, no hidden global state — everything a node needs arrives on its inputs, and everything it produces leaves on its outputs. This purity is what makes nodes reusable and the graph reasoned-about. Port TYPES let the editor reject invalid connections before running.`,
  },
  {
    name: "graph-conditional-branching",
    text: `Branching routes execution based on data: a conditional/switch node evaluates its input and activates one (or several) of its output paths (if/else, switch-by-value, filter). Only the taken branch's downstream nodes run. Distinguish EXCLUSIVE branching (exactly one path, like if/else) from inclusive/parallel branching (multiple paths may fire). After a branch, a merge node often rejoins the paths. Keep branch conditions explicit and total (handle the "none of the above" / default case) so a value you didn't anticipate doesn't silently drop the run.`,
  },
  // ── Data flow ──────────────────────────────────────────────────────────────
  {
    name: "dataflow-explicit-mapping",
    text: `Data moves along edges, and each node should MAP the upstream output to its own input explicitly rather than assuming a shape. When an upstream node changes its output structure, downstream mappings break — so validate/transform at the boundary. Prefer passing a well-defined payload (a typed object) over dumping everything downstream. In many engines each item flows independently through the graph; know whether your engine operates per-item or on the whole batch, because it changes how mapping, branching, and merging behave.`,
  },
  {
    name: "dataflow-schema-validation",
    text: `Validate data at graph boundaries and node inputs against a schema (JSON Schema/Zod-style) so a malformed payload fails FAST at the source with a clear message, instead of causing a confusing error three nodes downstream (or silently producing wrong results). Validate what ENTERS the workflow (external triggers, webhooks, user input — untrusted) most strictly. Between trusted internal nodes, lighter checks suffice. A workflow without input validation is a workflow that mysteriously breaks on the one weird record in production.`,
  },
  {
    name: "dataflow-transform-not-mutate",
    text: `Prefer nodes that TRANSFORM inputs into new outputs over nodes that mutate shared state — a functional data-flow (input → output) is far easier to reason about, test, rerun, and parallelize than steps that poke at global variables or a shared record. When a node must have a side effect (write a DB row, send an email), isolate it, make it idempotent, and treat it as an output of the graph, not a hidden channel other nodes read from. Pure transforms compose; side effects need care.`,
  },
  {
    name: "dataflow-batch-vs-stream",
    text: `Decide batch vs stream. BATCH processing collects a set of items and runs them together on a schedule — simple, efficient for large volumes, higher latency (you wait for the batch). STREAM/event processing handles each item as it arrives — low latency, needed for real-time reactions, but harder (ordering, partial state, backpressure). Many workflows are triggered per-event but internally batch a step (e.g. bulk-insert). Match the model to the requirement: don't stream when a nightly batch suffices, and don't batch when the user needs an immediate response.`,
  },
  // ── Reliability & failure ──────────────────────────────────────────────────
  {
    name: "reliability-idempotency",
    text: `Design every node (especially side-effecting ones) to be IDEMPOTENT — running it twice with the same input produces the same result as running it once. This is essential because retries, replays, and at-least-once delivery mean nodes WILL sometimes run again. Use an idempotency key (dedupe by a stable id), upserts instead of blind inserts, and conditional writes (only act if not already done). A non-idempotent "send payment" or "create record" node turns a harmless retry into a duplicate charge or row.`,
  },
  {
    name: "reliability-retry-backoff",
    text: `Retry transient failures (network blips, rate limits, temporary 5xx) with EXPONENTIAL BACKOFF plus JITTER: wait 1s, 2s, 4s… with a little randomness so many retriers don't synchronize into a "thundering herd". Cap the attempts and the total delay. Only retry IDEMPOTENT operations, and only on RETRYABLE errors — retrying a validation error (400) or a permanent failure just wastes time and can amplify a problem. Distinguish transient from permanent errors so you retry the first and fail fast on the second.`,
  },
  {
    name: "reliability-error-handling-branch",
    text: `Define per-node failure behavior explicitly — never leave it implicit. Options: RETRY (transient), SKIP/continue (the step is optional), route to an ERROR BRANCH (catch the failure and handle it — notify, compensate, log), or HALT the run (the failure is fatal). Many engines have an "on error" output or a dead-letter path; use it. A workflow where any node failure silently aborts the whole run with no notification is unoperable. Decide, for each step, what "it broke" should do.`,
  },
  {
    name: "reliability-dead-letter-queue",
    text: `Route items/events that repeatedly fail (after exhausting retries) to a DEAD-LETTER QUEUE (DLQ) — a holding area for failed work — instead of dropping them or blocking the pipeline. The DLQ lets you inspect, fix, and reprocess failures without losing data, and keeps one poison message from stalling the whole stream. Alert on DLQ growth (it means something is systematically failing). A DLQ turns "we lost some records and don't know which" into "here are the exact failures, replayable once fixed".`,
  },
  {
    name: "reliability-timeouts",
    text: `Give every node that calls out (HTTP, DB, external service, subprocess) a TIMEOUT — a node with no timeout can hang forever, stalling the run and holding resources. On timeout, apply the node's failure policy (retry/error-branch/halt). Set the timeout to the operation's realistic worst case plus margin, not an arbitrary default. Also bound the WHOLE workflow with a max runtime so a stuck run is killed and surfaced rather than lingering indefinitely. Timeouts turn silent hangs into actionable failures.`,
  },
  {
    name: "reliability-transactions-compensation",
    text: `A workflow spanning multiple systems can't use one database transaction, so use the SAGA pattern: a sequence of local steps, each with a COMPENSATING action that undoes it if a later step fails (e.g. "reserve inventory" is compensated by "release inventory"). Roll BACKWARD by running compensations for completed steps when the flow can't complete. This gives eventual consistency without distributed locks. Design compensations up front for any multi-step process that must be "all or nothing" across services.`,
  },
  // ── Triggers, scheduling, execution ────────────────────────────────────────
  {
    name: "trigger-types",
    text: `Workflows start from a TRIGGER: a SCHEDULE (cron — run at fixed times), an EVENT/WEBHOOK (run when something happens — a request arrives, a row changes, a message lands on a queue), a MANUAL run, or a completion of another workflow (chaining). Choose deliberately: polling on a schedule is simple but adds latency and wasted runs; webhooks/events are reactive and efficient but need an endpoint and dedupe. Make triggers idempotent (the same event may fire twice) and validate their untrusted payloads.`,
  },
  {
    name: "trigger-cron-schedules",
    text: `Scheduled triggers use CRON expressions: five fields — minute, hour, day-of-month, month, day-of-week (e.g. "0 3 * * *" = 03:00 daily; "*/15 * * * *" = every 15 minutes; "0 9 * * 1" = 09:00 on Mondays). Always pin the TIME ZONE (UTC vs local) or daylight-saving shifts will move your job. Beware overlapping runs — if a job can take longer than its interval, prevent concurrent executions (a lock) or you'll stack instances. For "every N minutes", ensure the work finishes within N.`,
  },
  {
    name: "exec-parallelism-concurrency-limits",
    text: `Independent nodes/branches can run in PARALLEL, which speeds up the workflow — but bound the concurrency. Fanning out over 10,000 items with no limit will overwhelm downstream APIs (rate limits, connection pools) and your own resources. Use a concurrency cap / worker pool / semaphore so at most N run at once, and respect downstream rate limits with throttling. The goal is maximum useful parallelism WITHOUT overwhelming any dependency — unbounded fan-out is a common cause of cascading failures.`,
  },
  {
    name: "exec-state-persistence",
    text: `For long-running or resumable workflows, PERSIST state after each step (which nodes completed, their outputs) so a crash or restart can resume from the last checkpoint instead of rerunning everything. This is CHECKPOINTING. Durable execution engines record each step's result so re-execution is deterministic and side effects aren't repeated. Without persisted state, a failure halfway through a 20-step flow means starting over (and possibly re-running side effects). Store enough to resume, and make resume idempotent.`,
  },
  {
    name: "exec-observability-logging",
    text: `Make runs observable: log each node's start/finish, status, inputs, and outputs (redacting secrets), and thread a RUN/CORRELATION ID through the whole execution so you can reconstruct exactly what happened on a given run. Surface run history, per-node timing, and failure details in a UI or logs. When a workflow misbehaves, you need to see WHICH node, on WHICH input, produced WHAT — a black-box workflow is undebuggable. Observability is designed in per node, not bolted on after an incident.`,
  },
  {
    name: "exec-testing-workflows",
    text: `Test workflows like code: unit-test individual nodes with representative and edge-case inputs (empty, malformed, boundary), and integration-test whole paths — including the FAILURE paths (does the error branch fire? does a retry recover? does a bad payload get rejected at the boundary?). Use test/mock data and a staging environment so you don't fire real side effects. The branches and error handlers you never test are exactly the ones that fail in production, because the happy path is the only thing anyone tried.`,
  },
  // ── Design & maintainability ───────────────────────────────────────────────
  {
    name: "design-small-composable-nodes",
    text: `Prefer many small, single-purpose nodes over a few giant "do everything" nodes with embedded scripts. Small nodes are reusable, individually testable, observable (you see where it failed), and swappable. A monolithic script node hides logic from the graph, defeats the visual/observable benefits of a workflow engine, and becomes a maintenance black hole. Push genuinely complex logic into a well-tested reusable component/sub-workflow with a clean interface, not into an ever-growing inline blob.`,
  },
  {
    name: "design-subworkflows-modularity",
    text: `Extract repeated or logically-distinct sequences into SUB-WORKFLOWS (reusable modules a parent workflow calls with inputs and gets outputs from). This is the same modularity as functions in code: one definition, many call sites, tested once. It keeps top-level graphs readable (a call node instead of 15 inline nodes) and lets teams share standard building blocks. Version sub-workflows carefully — a change ripples to every caller, so treat a shared sub-workflow's interface as a contract.`,
  },
  {
    name: "design-secrets-and-config",
    text: `Never hard-code secrets (API keys, tokens, passwords) or environment-specific values into workflow nodes — use the engine's credential store / secret manager and reference them, and parameterize environment-specific config so the SAME workflow runs in dev/staging/prod by swapping config, not by editing nodes. Hard-coded secrets leak when the workflow is exported/shared/version-controlled. Centralized credentials also let you rotate a key in one place. Config as parameters (not baked-in constants) is what makes a workflow portable and safe to share.`,
  },
  {
    name: "design-versioning-workflows",
    text: `Treat workflows as versioned artifacts: export/store their definitions in version control, review changes, and be able to roll back a broken change. Changing a live workflow in place with no history means an outage has no "undo". Consider how in-flight runs behave when you deploy a new version (do they finish on the old definition?). Document what a workflow does and its inputs/outputs. A workflow is production code with the same needs — versioning, review, rollback, and documentation — even though it's drawn as boxes and arrows.`,
  },
];
