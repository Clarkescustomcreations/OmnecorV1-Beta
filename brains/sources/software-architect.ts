/**
 * @file brains/sources/software-architect.ts
 * @description Source content for the built-in **Software Architect** Brain Pack
 * (Brains-Upgrade Phase 6 — "Team of Experts").
 *
 * A senior full-stack engineer for the modern TypeScript stack: React on the
 * front, Node.js + tRPC + Drizzle ORM on the back. GENERAL-PURPOSE knowledge —
 * standard framework patterns and architecture that apply to any project, not
 * tied to any one codebase. Distinct from the Coding brain (language-level CS /
 * security fundamentals): this corpus is framework and system-design conventions.
 * Original content, ships CC0. One durable fact per entry → one retrieval chunk.
 */
import type { BrainFact } from "./_types.js";
import { REASONING_BASE } from "./_reasoning-base.js";

export const SOFTWARE_ARCHITECT_CHARTER = `${REASONING_BASE}

Domain layer — software architecture (modern TypeScript full-stack). On any architecture task, ALSO apply:

1. Type safety is non-negotiable. Never use \`any\` or implicit typing; define explicit interfaces for props, inputs, and returns. Prefer precise unions/enums over stringly-typed values, and let types flow end-to-end from the server contract to the client.
2. Use named exports for components — never default exports. Name for meaning; keep components and functions small and single-purpose.
3. Validate at every trust boundary with a schema (e.g. Zod): API inputs, form data, env vars, and anything crossing the network. Parse, don't merely assert.
4. Never build SQL by string concatenation or shell commands by string interpolation — use a query builder / parameterized queries and \`spawn\` with an argv array, never \`exec\`.
5. Separate server state from client state. Server data belongs to a data-fetching cache (e.g. TanStack Query); a client store (e.g. Zustand/Redux) holds only transient UI/shell state. Never keep two sources of truth.
6. Fail fast at the edge and keep the core total. Return typed errors with correct status codes; never swallow an error. Log context, never secrets or PII.
7. Design for change: thin controllers/routers, business logic in services, persistence behind the schema. Keep layers and boundaries clean.
8. Cite the corpus when you use it; prefer its specific guidance over a generic recollection, and surface any conflict rather than silently choosing.`;

export const SOFTWARE_ARCHITECT_SOURCES: BrainFact[] = [
  // ── tRPC / typed API layer ─────────────────────────────────────────────────
  {
    name: "trpc-end-to-end-types",
    text: `tRPC gives end-to-end type safety without codegen or manual DTOs: the server composes procedures into an AppRouter, and the client imports ONLY that router's TYPE (import type { AppRouter }). Query/mutation hooks then infer inputs and outputs automatically. Consequence: changing a procedure's input/output immediately surfaces as a compile error at every call site. Derive client types with inferRouterInputs/inferRouterOutputs — never re-declare request/response shapes on the client.`,
  },
  {
    name: "trpc-input-validation-zod",
    text: `Validate every tRPC procedure's input with a schema via .input(z.object({...})) — one declaration gives BOTH runtime validation and the compile-time input type, inferred into the resolver and the client. A validation failure throws a BAD_REQUEST before your resolver runs. Use .optional(), .default(), .min()/.max(), z.enum() for constrained fields, z.string().uuid()/.email() for formats. Never accept an untyped input.`,
  },
  {
    name: "trpc-middleware-protected",
    text: `Model authorization as reusable procedure tiers built from middleware, not per-resolver checks: a publicProcedure (unauthenticated) and a protectedProcedure that runs an auth middleware asserting ctx.user exists (throwing UNAUTHORIZED otherwise) and narrows the context type so ctx.user is non-null downstream. Layer further tiers (admin/owner) by chaining middleware. This centralizes auth and makes each procedure's privilege level explicit at its definition.`,
  },
  {
    name: "trpc-error-codes",
    text: `Throw a TRPCError with the correct code, never a bare Error, so the client receives a typed, correctly-mapped status: UNAUTHORIZED (no/invalid session), FORBIDDEN (authenticated but not permitted), NOT_FOUND, BAD_REQUEST (bad input), CONFLICT (duplicate/version clash), TOO_MANY_REQUESTS, INTERNAL_SERVER_ERROR. Include a human message and attach a cause for logging. To avoid leaking a resource's existence to an unauthorized caller, prefer NOT_FOUND over FORBIDDEN.`,
  },
  {
    name: "trpc-router-composition",
    text: `Keep routers thin — validate input, enforce ownership, orchestrate — and push real logic into services. Compose feature routers into one root router under namespace keys (e.g. { user: userRouter, billing: billingRouter }) and export its type. A router should read like a table of contents; when a resolver grows past orchestration, extract a service method. All procedures share a single request context (ctx) carrying the user and shared dependencies.`,
  },
  {
    name: "trpc-ownership-in-resolver",
    text: `Enforce ownership inside the resolver, never trust the client. Take the userId from ctx.user (set by auth middleware), and filter EVERY query by it; refuse to read or mutate another user's row. Do not accept a userId in the input for "whose data" decisions — that is an authorization bypass. Test this by driving the real router with a caller for user A and asserting user B's rows are invisible.`,
  },
  // ── React / frontend ──────────────────────────────────────────────────────
  {
    name: "react-named-exports",
    text: `Prefer named exports for components (export function UserCard(...)) over default exports. Named exports keep the symbol name stable across the codebase, make re-exports and auto-import unambiguous, and preserve grep-ability. Default exports let each importer rename the component, fracturing tooling and search. Reserve default exports for framework-required entry points (e.g. a page file where the framework demands it).`,
  },
  {
    name: "react-server-vs-client-state",
    text: `Separate two kinds of state. SERVER state (anything fetched from a backend) belongs to a data-fetching library (TanStack Query / RTK Query) that owns caching, refetch, invalidation, and loading/error status. CLIENT state (modal open, active tab, theme, form draft) belongs to component state or a small store (Zustand/Redux). Never copy server data into a client store — you create a second source of truth that goes stale. Invalidate a query to refresh; don't hand-sync.`,
  },
  {
    name: "react-query-invalidation",
    text: `After a mutation, refresh dependent data with queryClient.invalidateQueries using a query-key filter (the key prefix), not by manually refetching each hook. For snappy UX use optimistic updates: apply the new value in onMutate, roll back with the returned context in onError, and invalidate in onSettled to reconcile with the server. Never mutate the cache in place without a matching invalidation.`,
  },
  {
    name: "react-effect-dependencies",
    text: `useEffect runs after render whenever a dependency changes; list EVERY reactive value it reads in the dependency array (the exhaustive-deps rule). A missing dep causes a stale closure (the effect reads old state); an unstable dep — a new object/array/function created each render — causes an infinite loop. Stabilize with useCallback/useMemo or move the value inside the effect. Return a cleanup function to cancel subscriptions/timers and avoid setting state after unmount.`,
  },
  {
    name: "react-key-stability",
    text: `List keys must be stable, unique identities from the data (item.id), never the array index. Index keys make React reconcile the wrong elements when the list reorders, inserts, or deletes — causing lost input focus, wrong checkbox state, and stale content. If items truly lack an id, derive a stable key from their content, and never use Math.random() (it remounts the element every render, destroying state and performance).`,
  },
  {
    name: "react-controlled-inputs",
    text: `Use controlled inputs (value + onChange bound to state) for forms you validate or submit programmatically; use uncontrolled (defaultValue + ref) only for simple fire-and-forget fields. Never switch an input between controlled and uncontrolled across renders (value going from undefined to a string) — React warns and focus/cursor breaks. Initialize controlled values to "" not undefined.`,
  },
  {
    name: "react-memo-when-needed",
    text: `Reach for React.memo, useMemo, and useCallback only to fix a MEASURED problem: an expensive computation re-running, or a stable reference needed to keep a memoized child from re-rendering or an effect from looping. Blanket-memoizing everything adds allocation and complexity for no gain and can even slow renders. Profile first; most components re-render cheaply. Correctness (right deps) beats premature memoization.`,
  },
  {
    name: "react-lazy-and-boundaries",
    text: `Code-split at the route level and for heavy, conditionally-rendered subtrees with React.lazy + Suspense (give Suspense a fallback). Wrap routes/features in an error boundary so one crash is isolated instead of blanking the whole app; provide a reset path. Split at meaningful seams — routes and large components — not per tiny component, which just adds request waterfalls.`,
  },
  {
    name: "react-explicit-prop-types",
    text: `Define an explicit interface for every component's props (name it <Component>Props) — never rely on implicit any or inline untyped destructuring for non-trivial props. Mark optional props with ? and give sensible defaults. Explicit prop types document the component's contract, catch call-site mistakes at compile time, and make the component self-describing to editors and teammates.`,
  },
  {
    name: "react-accessibility-basics",
    text: `Build accessible components by default: use semantic elements (button, a, nav, label) over div-with-onClick; associate every input with a label (htmlFor/id); ensure interactive elements are keyboard-reachable and have visible focus; add aria-* only to fill gaps semantics can't. Icon-only buttons need an aria-label. Color alone must never convey state. Accessibility is part of "done", not a later pass.`,
  },
  // ── Drizzle ORM ────────────────────────────────────────────────────────────
  {
    name: "drizzle-returning-insert-id",
    text: `To get a generated id back from a Drizzle insert, use .returning({ id: table.id }) — never a raw-driver cast like (result as any)[0]?.insertId. .returning() is type-safe and dialect-correct, returning an array of the selected columns: const [row] = await db.insert(t).values(v).returning({ id: t.id }). Casting to any to dig out insertId is unsafe and wrong for SQLite/Postgres via Drizzle.`,
  },
  {
    name: "drizzle-infer-types",
    text: `Derive row types from the schema, never hand-write them: type User = typeof users.$inferSelect for a read shape, typeof users.$inferInsert for an insert shape (columns with defaults/optional become optional). This keeps types in lockstep with the schema definition — change a column and every consumer updates automatically, with mismatches surfacing at compile time.`,
  },
  {
    name: "drizzle-query-builder-not-raw",
    text: `Use Drizzle's query builder (db.select().from(t).where(eq(t.col, v))) rather than raw SQL strings — it binds values as parameters (injection-safe) and is fully typed. Compose predicates with eq, and, or, inArray, like, gt/lt, isNull, between. When you genuinely need raw SQL, use the sql\`\` tagged template with \${param} placeholders (bound), never string concatenation. The query builder is the default; raw SQL is the rare escape hatch.`,
  },
  {
    name: "drizzle-upsert-onconflict",
    text: `Do an upsert with .onConflictDoUpdate({ target: table.uniqueCol, set: {...} }) or .onConflictDoNothing() — INSERT ... ON CONFLICT. The target must be a column (or set) with a unique/primary constraint, or the clause silently no-ops. Use it for idempotent writes so re-running a sync doesn't duplicate rows. In set, reference the attempted-insert value via sql\`excluded.col\` (Postgres/SQLite) when needed.`,
  },
  {
    name: "drizzle-relations-vs-joins",
    text: `Drizzle offers two ways to read related data: the relational query API (db.query.users.findMany({ with: { posts: true } })) for ergonomic nested results, and manual .leftJoin()/.innerJoin() for full control over the SQL. Declare relations() to use the query API. Prefer a single join/with over N follow-up queries to avoid the N+1 problem. Select only the columns you need rather than SELECT *.`,
  },
  {
    name: "drizzle-migrations-workflow",
    text: `Keep the schema as the single source of truth and let drizzle-kit generate migrations from it — do not hand-write schema drift. Workflow: edit the schema, run drizzle-kit generate to emit a versioned SQL migration, then apply it with a migrate step. In CI/prod, apply already-generated migrations explicitly before starting the app rather than relying on an implicit runtime migrate. Never edit the database out-of-band.`,
  },
  {
    name: "drizzle-foreign-key-cascade",
    text: `Define foreign keys with an explicit onDelete behavior: references(() => parent.id, { onDelete: "cascade" }) (or "set null"/"restrict"). Decide deletion semantics deliberately — cascade for owned children, restrict to prevent orphaning. Note SQLite enforces FKs only when PRAGMA foreign_keys=ON, and a cascade generally must exist at table-create time, so design child tables with the FK from the start rather than bolting it on later.`,
  },
  // ── Node / backend ─────────────────────────────────────────────────────────
  {
    name: "node-spawn-not-exec",
    text: `Never build a shell command by interpolating input into child_process.exec — that is command injection. Use spawn(cmd, [arg1, arg2], opts) with an argv array so arguments go straight to the process, never parsed by a shell; avoid shell: true. Validate/allow-list the executable and any path arguments first. exec is only defensible for fixed, input-free commands — and even then spawn is preferred.`,
  },
  {
    name: "node-async-error-propagation",
    text: `Await the promises you depend on and let errors reject up to a boundary that handles them (a route/resolver). An unawaited promise that rejects becomes an unhandledRejection and can crash the process or silently drop a result. Wrap only where you add context or recover; otherwise let it propagate. Use Promise.all for independent concurrent work (it rejects on first failure) and Promise.allSettled when partial success is acceptable.`,
  },
  {
    name: "node-env-config-boundary",
    text: `Read and validate environment variables once at a config boundary and export typed config objects — don't scatter process.env lookups through the code. Parse env with a schema so missing/invalid values fail loudly at boot; provide safe defaults for local dev but require prod secrets (JWT signing keys, DB URLs). Centralizing config makes the contract explicit and keeps business logic free of stringly-typed env reads.`,
  },
  {
    name: "node-graceful-shutdown",
    text: `Handle SIGTERM/SIGINT to shut down gracefully: stop accepting new connections, finish in-flight requests within a timeout, close DB pools and other resources, then exit. Abrupt exits drop requests and can corrupt state or leak connections. Also install process-level handlers for unhandledRejection and uncaughtException that log and (for uncaughtException) exit — a process in an unknown state should not keep serving.`,
  },
  {
    name: "node-stream-large-io",
    text: `For large files or responses, stream rather than buffering the whole payload into memory (fs.createReadStream, pipeline()). Buffering a big file blocks the event loop during allocation and can OOM under concurrency. Use pipeline() (not raw .pipe()) so errors and backpressure propagate and resources are cleaned up. Apply the same principle to HTTP: stream responses and use pagination/limits on list endpoints.`,
  },
  {
    name: "backpressure-and-timeouts",
    text: `Every outbound call (HTTP, DB, queue) needs a timeout and a failure path — a call with no timeout can hang a request indefinitely and exhaust the connection pool. Add retries with exponential backoff and jitter for idempotent operations only, and a circuit breaker for a repeatedly-failing dependency so you fail fast instead of piling up. Bound concurrency (a pool/semaphore) so a burst can't overwhelm a downstream service.`,
  },
  // ── Architecture / system design ───────────────────────────────────────────
  {
    name: "arch-layered-boundaries",
    text: `Keep layers thin and separated: controllers/routers validate input, enforce authorization, and orchestrate; services hold business logic and own external I/O; the data layer owns persistence. Dependencies point inward (toward domain logic), not outward toward frameworks. A controller should read like a table of contents. This separation makes logic testable without HTTP and lets you swap a framework or database without rewriting the core.`,
  },
  {
    name: "arch-shared-contract-types",
    text: `Put types and constants shared by client and server in one shared module imported by both, so a contract exists in exactly one place — never duplicate a DTO or a constant across the boundary (they drift). Keep that shared layer free of server-only code (DB clients, node builtins, secrets) so it stays safe to import into the browser bundle. When client and server derive from the same types, breaking changes fail at compile time.`,
  },
  {
    name: "arch-idempotency",
    text: `Make write operations idempotent where a client might retry: use an idempotency key or a natural unique constraint so a duplicate request is a no-op, not a double-charge/double-insert. Networks retry; at-least-once delivery is the norm for webhooks and queues. Design handlers to tolerate seeing the same event twice. Upserts, conditional writes (compare-and-set), and dedupe tables are the common tools.`,
  },
  {
    name: "arch-pagination-not-unbounded",
    text: `Never return an unbounded list — always paginate. Prefer cursor/keyset pagination (WHERE id > :lastId ORDER BY id LIMIT n) over OFFSET, which scans and skips rows and drifts when data changes underneath. Return a stable cursor and a hasMore flag. Unbounded list endpoints are a latency and memory time bomb that works in dev with 10 rows and falls over in prod with 10 million.`,
  },
  {
    name: "arch-cache-invalidation",
    text: `Caching trades freshness for speed, and the hard part is invalidation. Prefer short TTLs plus explicit invalidation on write over long TTLs and hope. Key caches precisely (include the inputs that change the result) and beware stampedes (many misses at once) — use single-flight or a slightly randomized TTL. Never cache per-user data under a shared key. Measure hit rate; a cache with a poor hit rate is pure complexity.`,
  },
  {
    name: "arch-graceful-degradation",
    text: `Treat every external dependency as optionally-unavailable: guard the call, time it out, and surface a clear "unavailable" state instead of an unhandled crash. A feature backed by a flaky third-party or optional microservice should degrade (show a fallback, queue for later) rather than take down the page. Design so the core app stays usable when a non-essential dependency is down — resilience is a design property, not an afterthought.`,
  },
  {
    name: "arch-observability",
    text: `Instrument services with structured logs (JSON with a request/correlation id), metrics (latency, error rate, throughput — the RED method), and traces across service hops. A correlation id threaded through a request lets you reconstruct one user's journey across logs. Log at boundaries with context; never log secrets/PII. You cannot operate what you cannot see — observability is built in, not bolted on after an incident.`,
  },
  {
    name: "arch-feature-flags-migrations",
    text: `Ship risky changes behind a feature flag so rollout and rollback are a config change, not a redeploy. For schema changes use expand/contract: add the new column/table (expand), migrate reads/writes to it, then remove the old (contract) — never a single breaking migration that requires app and DB to change atomically. This keeps deploys reversible and avoids downtime during migrations.`,
  },
  // ── Testing ────────────────────────────────────────────────────────────────
  {
    name: "test-route-level-real-deps",
    text: `Prefer integration/route-level tests that drive the real router/handler against a real (in-memory or ephemeral) database over heavily-mocked unit tests — they exercise the wiring, ownership filters, constraints, and cascades that mocks hide. Spin up the actual schema + migrations so SQL and FK behavior are real. Reserve mocks for truly external, slow, or nondeterministic dependencies (third-party APIs, clocks, randomness).`,
  },
  {
    name: "test-behavior-not-implementation",
    text: `Test observable behavior and edge cases — empty, boundary, error paths, and authorization leaks — not private implementation details, which couple tests to internals and break on every refactor without catching real bugs. Every non-trivial change should ship with a test that FAILS without it. Track and ratchet coverage upward over time; treat a lowered threshold as a regression to justify, not a convenience.`,
  },
  {
    name: "test-deterministic-fast",
    text: `Keep tests deterministic and fast: no real network, no sleeps, control time (inject a clock or use fake timers) and randomness (seed it). A flaky test is worse than no test — it trains the team to ignore red. Isolate tests so they can run in any order and in parallel (fresh DB/state per test). Fast, reliable tests get run on every change; slow, flaky suites get skipped exactly when they matter.`,
  },
];
