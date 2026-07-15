/**
 * @file brains/sources/coding.ts
 * @description Source content for the built-in **Coding** Brain Pack (Brains-Upgrade Phase 6).
 *
 * This is the human-curated knowledge that `pnpm brains:build:coding` runs through the
 * real authoring pipeline (`BrainAuthoringService.authorPack` → on-device embed →
 * `.obp`) to produce `brains/coding.obp`. It is intentionally kept as source (not just
 * the compiled pack) so the exemplar is reviewable, diffable, and rebuildable.
 *
 * Design: each entry is a small, self-contained, durable reference fact. Because every
 * entry is well under the 1500-char chunk size, each becomes exactly ONE corpus chunk —
 * a clean 1:1 mapping that makes top-k retrieval crisp and citations meaningful. The
 * `name` becomes the chunk's `sourcePath`, surfaced in the `[Brain: Coding · <name>]`
 * citation at inference time.
 *
 * Content is original, general-purpose software-engineering reference (no third-party
 * text copied), so it ships unencumbered as a built-in.
 */

/**
 * The always-on **charter** — high-signal, non-negotiable engineering rules prepended
 * to every prompt the brain is attached to (embedder-independent, budget-clipped). Keep
 * it short: it is spent on every single request, so it must earn its tokens.
 */
export const CODING_CHARTER = `You are augmented with a curated software-engineering brain. Follow these rules on every coding task:

1. Correctness first. Prefer a simple, obviously-correct solution over a clever one. State assumptions explicitly; if the request is ambiguous, ask before guessing.
2. Never trust input. Validate and parameterize everything that crosses a boundary (user input, network, files, env). SQL uses bound parameters — never string concatenation. HTML output is escaped by default.
3. Handle errors, don't swallow them. Catch narrowly, add context, and re-throw or return a typed error. An empty catch block is a bug. Never log secrets, tokens, or full PII.
4. Make illegal states unrepresentable. Prefer precise types/enums over booleans and stringly-typed values. Fail fast at the edge; keep the core total.
5. Concurrency: protect shared mutable state, avoid blocking the event loop, and treat every await as a possible interleaving point. Prefer immutable data and pure functions.
6. Every non-trivial change ships with a test that would fail without it. Test behavior and edge cases (empty, boundary, error paths), not implementation details.
7. Name things for what they mean, not how they work. Keep functions small and single-purpose. Delete dead code rather than commenting it out.
8. Measure before optimizing. Fix the algorithmic complexity before micro-tuning. Big-O of the data, not the loop body, dominates.
9. Cite the corpus when you use it, and prefer the corpus's specific guidance over a generic recollection. If the corpus and your prior differ, surface the difference rather than silently choosing.`;

export interface CodingSource {
  name: string;
  text: string;
}

/**
 * The curated **corpus** — retrieved top-k at inference time. One durable fact per entry.
 */
export const CODING_SOURCES: CodingSource[] = [
  // ── JavaScript / TypeScript semantics & pitfalls ─────────────────────────
  {
    name: "js-equality-triple-vs-double",
    text: `JavaScript equality: always use === and !== (strict equality), never == and != (loose equality). Loose equality performs implicit type coercion with surprising results: 0 == "" is true, 0 == "0" is true, "" == "0" is FALSE, null == undefined is true, and NaN == NaN is false. The only defensible use of == is the idiom "x == null" to test for null-or-undefined in one check. To compare against NaN, use Number.isNaN(x). To copy-check numbers safely, remember NaN is the only value not equal to itself.`,
  },
  {
    name: "js-array-sort-default-lexicographic",
    text: `JavaScript's Array.prototype.sort() with no comparator sorts elements as STRINGS by UTF-16 code unit, not numerically. So [10, 9, 1, 200].sort() yields [1, 10, 200, 9], not [1, 9, 10, 200]. Always pass a comparator for numbers: arr.sort((a, b) => a - b) for ascending. sort() also mutates the array in place and returns the same reference; use arr.slice().sort(...) or arr.toSorted(...) (ES2023) to avoid mutating the original. The comparator must return a negative, zero, or positive number and be consistent, or the result is implementation-defined.`,
  },
  {
    name: "js-parseint-radix",
    text: `Always pass the radix to parseInt: parseInt(str, 10). Without it, behavior depends on the string prefix and engine — historically "0x" was hex and a leading "0" could be octal. parseInt also stops at the first non-numeric character, so parseInt("12px", 10) is 12 and parseInt("", 10) is NaN. To convert a whole string strictly, prefer Number(str) (which returns NaN on any trailing garbage) or the unary + operator, and validate with Number.isFinite.`,
  },
  {
    name: "js-floating-point-money",
    text: `IEEE-754 doubles cannot represent most decimal fractions exactly, so 0.1 + 0.2 === 0.30000000000000004, not 0.3. Never compare floats with ===; compare with a tolerance: Math.abs(a - b) < Number.EPSILON * scale. Never store money as a float — represent it as an integer number of the smallest unit (cents), or use a decimal library. Rounding for display should happen only at the very end.`,
  },
  {
    name: "js-this-binding",
    text: `In JavaScript, 'this' is determined by how a function is CALLED, not where it is defined. A plain function called standalone has 'this' as undefined (strict mode) or the global object. Arrow functions do NOT have their own 'this'; they capture it lexically from the enclosing scope — which is why arrows are correct for callbacks that need the surrounding 'this', but wrong as object methods that rely on the caller. To fix a lost 'this' from a detached method, use .bind(obj), an arrow wrapper, or class field syntax.`,
  },
  {
    name: "js-hoisting-var-let-const",
    text: `var declarations are hoisted and function-scoped and initialized to undefined, so reading one before its line yields undefined, not an error. let and const are block-scoped and live in the "temporal dead zone" from the top of the block until their declaration — reading them early throws a ReferenceError. Prefer const by default, let when reassignment is needed, and never var in new code. const prevents rebinding the variable, not mutation of the object it points to.`,
  },
  {
    name: "ts-any-vs-unknown",
    text: `In TypeScript, 'any' disables type checking and silently propagates, defeating the type system; 'unknown' is the type-safe top type — you can hold any value but must narrow it (typeof, instanceof, a type guard) before using it. Prefer 'unknown' for values of uncertain shape (JSON.parse results, caught errors, external input) and narrow explicitly. Enable "strict": true in tsconfig, which turns on strictNullChecks, noImplicitAny, and more. Catch clauses type the error as unknown under useUnknownInCatchVariables.`,
  },
  {
    name: "ts-structural-typing",
    text: `TypeScript uses structural typing ("duck typing"): a value is assignable to a type if it has the required members, regardless of a declared class or name. This is why a plain object literal can satisfy an interface. Excess-property checks apply only to fresh object literals assigned directly, not to values passed through a variable. Use discriminated unions (a shared literal "kind" field) plus exhaustive switch with a 'never' default to make the compiler enforce that all cases are handled.`,
  },
  {
    name: "js-json-parse-reviver-and-dates",
    text: `JSON has no date type: JSON.stringify serializes a Date to an ISO 8601 string, and JSON.parse leaves it as a string — it will not become a Date again automatically. Rehydrate dates explicitly (e.g. new Date(str) on known fields, or a reviver function). JSON.stringify also drops undefined values, functions, and symbols, and throws on circular references and on BigInt. JSON.parse on untrusted input can throw; always wrap it and treat the result as 'unknown'.`,
  },

  // ── Async / concurrency ──────────────────────────────────────────────────
  {
    name: "async-await-in-loops",
    text: `A sequential 'for...of' loop with await runs iterations one at a time — correct when each step depends on the previous, but slow for independent work. For independent async tasks, kick them off together and await Promise.all(items.map(fn)) to run concurrently. Beware: Promise.all rejects as soon as ANY promise rejects (and does not cancel the others); use Promise.allSettled when you need every result regardless of individual failures. Never use forEach with async — it ignores the returned promises and does not wait.`,
  },
  {
    name: "async-floating-promises",
    text: `A "floating" promise is one whose result and rejection are never awaited or .catch()'d. An unhandled rejection can crash Node or be silently lost. Always await a promise, chain .catch(), or explicitly mark fire-and-forget with void and an attached handler. In async functions, a thrown error becomes a rejected promise; a caller that forgets to await will not see it. Enable the no-floating-promises lint rule.`,
  },
  {
    name: "async-race-conditions",
    text: `Between two awaits, other tasks run — so any invariant that held before an await may be false after it (a "check-then-act" race). Re-read state after awaiting, or guard the critical section with a mutex/lock. Common bugs: incrementing a shared counter read before an await, or a "load-if-missing" cache that fires N concurrent loads because each caller sees the cache empty. Fix the cache stampede by storing the in-flight PROMISE in the map, not just the resolved value.`,
  },
  {
    name: "async-timeout-and-abort",
    text: `Add a timeout to any I/O that can hang. In modern JS use AbortController: pass controller.signal to fetch and call controller.abort() from a setTimeout, or use AbortSignal.timeout(ms). fetch does not time out by default and will wait indefinitely. Always clear the timeout on success to avoid leaking timers. Propagate the signal down the call chain so cancellation actually cancels the underlying work rather than just abandoning it.`,
  },

  // ── Security ─────────────────────────────────────────────────────────────
  {
    name: "sec-sql-injection-parameterized",
    text: `SQL injection is prevented by parameterized queries (prepared statements / bound parameters), never by string concatenation or manual escaping. Write "SELECT * FROM users WHERE id = ?" with the value passed separately, so the driver sends data out-of-band from the SQL text and the value can never be parsed as SQL. This also applies to LIKE patterns and IN lists (bind each element). Table and column names cannot be bound as parameters — if they must be dynamic, validate them against a fixed allow-list.`,
  },
  {
    name: "sec-xss-output-encoding",
    text: `Cross-site scripting (XSS) is prevented by context-aware output encoding at the point of rendering, not by input filtering. HTML body context escapes < > & " '; HTML attribute, JavaScript, CSS, and URL contexts each need different encoding. Prefer a templating engine or framework that auto-escapes (React escapes text nodes by default). Treat dangerouslySetInnerHTML / innerHTML as dangerous: sanitize with a vetted library (e.g. DOMPurify) if you must render user HTML. A Content-Security-Policy header is defense-in-depth, not a substitute.`,
  },
  {
    name: "sec-password-hashing",
    text: `Never store passwords in plaintext or with fast/general-purpose hashes (MD5, SHA-1, SHA-256). Use a slow, salted, memory-hard password hash designed for the job: Argon2id (preferred), scrypt, or bcrypt. These generate and store a per-password random salt internally and let you tune a work factor as hardware improves. Compare using the algorithm's verify function (which is constant-time), never ===. Bcrypt silently truncates input beyond 72 bytes — pre-hash long inputs if needed.`,
  },
  {
    name: "sec-secrets-in-code",
    text: `Never hardcode secrets (API keys, DB passwords, private keys, tokens) in source or commit them to version control — history is forever, and public leaks are scraped within minutes. Load secrets from environment variables or a secrets manager. Keep .env files out of git via .gitignore and ship a .env.example with placeholder keys. If a secret is ever committed, rotate it immediately; removing it from history is not enough because it may already be cloned or cached.`,
  },
  {
    name: "sec-timing-safe-comparison",
    text: `Comparing secrets (tokens, HMAC signatures, password hashes) with a normal === or memcmp leaks information through timing, because those short-circuit at the first differing byte. Use a constant-time comparison (Node's crypto.timingSafeEqual, which requires equal-length buffers) so comparison time does not depend on how many leading bytes matched. This matters for any value an attacker can submit repeatedly to probe.`,
  },
  {
    name: "sec-jwt-pitfalls",
    text: `Validate JWTs correctly: verify the signature with the expected algorithm pinned server-side, and reject tokens whose 'alg' header you did not expect — the classic attack sets alg to "none" or swaps RS256 for HS256 to trick the server into verifying with a public key as an HMAC secret. Always check 'exp' (expiry) and, where relevant, 'iss', 'aud', and 'nbf'. A JWT is signed, not encrypted: never put secrets in the payload; anyone can base64-decode and read it. Keep tokens short-lived and use refresh tokens for longevity.`,
  },
  {
    name: "sec-path-traversal",
    text: `When building a filesystem path from user input, an attacker can inject "../" to escape the intended directory (path traversal). Never concatenate raw input into a path. Resolve the final absolute path (path.resolve) and verify it is still inside the allowed base directory before touching it; reject otherwise. Normalize first, then check with a prefix test on the resolved base. The same class of bug affects zip extraction ("zip slip") and URL/redirect targets.`,
  },
  {
    name: "sec-ssrf",
    text: `Server-Side Request Forgery (SSRF) happens when your server fetches a user-supplied URL, letting an attacker reach internal services (cloud metadata endpoints like 169.254.169.254, localhost, private RFC-1918 ranges). Defend by validating the URL against an allow-list of hosts/schemes, resolving DNS and rejecting private/loopback/link-local IPs, disabling redirects to unvetted hosts, and never reflecting the raw response. Do the IP check after DNS resolution to defeat DNS-rebinding.`,
  },

  // ── Algorithms & complexity ──────────────────────────────────────────────
  {
    name: "algo-bigo-common",
    text: `Big-O describes how work grows with input size n. Common classes, best to worst: O(1) constant (hash lookup), O(log n) logarithmic (binary search), O(n) linear (single scan), O(n log n) (efficient comparison sorts like mergesort/heapsort), O(n^2) quadratic (nested loops over the same data, naive sort), O(2^n) exponential, O(n!) factorial. Constants and lower-order terms are dropped. The algorithm's complexity on the data usually dominates any constant-factor micro-optimization.`,
  },
  {
    name: "algo-hashmap-vs-nested-loop",
    text: `Replacing a nested-loop membership test (O(n*m)) with a hash set/map (O(n+m)) is the single most common practical speedup. Example: to find items in list A that also appear in list B, build a Set from B once, then scan A checking set.has(x). Likewise, "two sum" is O(n) with a map from value→index instead of O(n^2) with two loops. Hash lookups are amortized O(1); worst case degrades with poor hashing but is rare in practice.`,
  },
  {
    name: "algo-binary-search-preconditions",
    text: `Binary search finds an element in O(log n) but REQUIRES the array to be sorted by the key you search on; on unsorted data it silently returns wrong results. Classic bugs: an off-by-one in the loop bound, and computing the midpoint as (lo + hi) / 2 which can overflow in fixed-width integer languages — use lo + (hi - lo) / 2. Decide up front whether you want the exact index, the insertion point (lower_bound), or the first/last match, because the boundary conditions differ.`,
  },
  {
    name: "algo-recursion-stack-overflow",
    text: `Deep or unbounded recursion overflows the call stack (most engines allow only a few thousand frames). Guard every recursion with a base case that is definitely reached. For deep data, convert to iteration with an explicit stack/queue, or use tail-call-friendly accumulation where the runtime supports it (most JS engines do NOT optimize tail calls). Memoize overlapping subproblems (dynamic programming) to turn exponential recursion into polynomial time.`,
  },

  // ── Data structures ──────────────────────────────────────────────────────
  {
    name: "ds-choosing-map-set",
    text: `Choose the structure by the operation you repeat most. Need fast membership or dedupe? A hash Set (O(1) add/has). Key→value lookups? A hash Map (in JS, Map preserves insertion order and allows any key type, unlike a plain object which coerces keys to strings and inherits prototype keys). Ordered range queries or min/max? A balanced tree or a heap. FIFO/LIFO? A queue/stack. Reaching for an array and scanning it (O(n)) where a Set/Map fits is a frequent, avoidable performance bug.`,
  },
  {
    name: "ds-immutability-copy-semantics",
    text: `In JavaScript, objects and arrays are passed and assigned BY REFERENCE, so mutating a "copy" mutates the original. A spread {...obj} or [...arr] makes a SHALLOW copy — nested objects are still shared. For deep copies use structuredClone(value) (built-in, handles cycles) rather than the lossy JSON.parse(JSON.stringify(...)), which drops functions, undefined, and Dates. Preferring immutable updates (return new objects instead of mutating) avoids a whole class of aliasing bugs and is required by React state.`,
  },

  // ── Errors & robustness ──────────────────────────────────────────────────
  {
    name: "err-no-empty-catch",
    text: `An empty catch block silently swallows failures and is almost always a bug — the program continues in an unknown state. At minimum log the error with context; better, handle it (retry, fall back, or translate to a domain error) or re-throw. Catch as narrowly as possible near where you can actually respond, not with one giant try around everything. Preserve the original error as the 'cause' when wrapping (new Error("msg", { cause: err })) so the stack trace is not lost.`,
  },
  {
    name: "err-result-vs-throw",
    text: `Use exceptions for truly exceptional, unexpected conditions; use typed return values (a Result/Either or a discriminated union) for expected, recoverable outcomes like validation failure or "not found". Throwing for ordinary control flow makes call sites hard to reason about and easy to get wrong. Whatever the style, be consistent within a module, and make the failure impossible to ignore — a Result the caller must destructure beats a thrown error a caller might forget to catch.`,
  },
  {
    name: "err-validate-at-boundary",
    text: `Validate and parse external data at the system boundary (HTTP handler, queue consumer, file loader) into trusted, well-typed internal values — "parse, don't validate". Once past the boundary, the core can assume the data is valid, which removes defensive checks everywhere else. Use a schema validator (e.g. Zod) that both checks and narrows the TypeScript type in one step, and return a clear 4xx with actionable messages on failure rather than letting bad data propagate.`,
  },
  {
    name: "err-idempotency-retries",
    text: `Any network call can fail or time out after the server already processed it, so retries must be safe. Make write operations idempotent — use an idempotency key the server dedupes on, or design PUT/DELETE-style operations that produce the same result when repeated. Retry only idempotent or safely-retryable operations, use exponential backoff with jitter to avoid thundering herds, and cap the attempts. Never blindly retry a non-idempotent POST (e.g. "charge card") without a dedupe key.`,
  },

  // ── SQL & databases ──────────────────────────────────────────────────────
  {
    name: "sql-index-basics",
    text: `An index makes lookups on its columns fast (turning an O(n) table scan into O(log n)) at the cost of extra storage and slower writes. Index the columns you filter (WHERE), join on, and sort by (ORDER BY). A composite index on (a, b) can serve queries on 'a' or 'a AND b' but not 'b' alone (leftmost-prefix rule). Wrapping an indexed column in a function (WHERE lower(email) = ...) usually disables the index unless you build a matching expression index. Use EXPLAIN to see whether the planner uses your index.`,
  },
  {
    name: "sql-n-plus-one",
    text: `The N+1 query problem: you run one query to fetch N rows, then one more query per row to fetch a related record — N+1 round trips, each with latency. It is the most common ORM performance bug. Fix it by fetching the related data in a single query with a JOIN, or by batching the second query with WHERE id IN (...), or by using the ORM's eager-loading / dataloader mechanism. Watch for it whenever you loop over results and touch a lazy relation inside the loop.`,
  },
  {
    name: "sql-transactions-acid",
    text: `Wrap multi-statement operations that must all-or-nothing in a transaction (BEGIN … COMMIT / ROLLBACK) so a partial failure cannot leave inconsistent data. Transactions give ACID: Atomicity, Consistency, Isolation, Durability. The isolation level trades correctness for concurrency: READ COMMITTED allows non-repeatable reads; SERIALIZABLE prevents anomalies but can force retries on serialization failures. Keep transactions short, do no slow I/O or user waits inside them, and always release/commit to avoid holding locks.`,
  },
  {
    name: "sql-null-semantics",
    text: `SQL NULL means "unknown", and comparisons with it yield NULL (not true): "x = NULL" and "x <> NULL" are never true — use "x IS NULL" / "x IS NOT NULL". NULL propagates through arithmetic (NULL + 1 is NULL) and is excluded by aggregates like SUM/AVG/COUNT(col) (but counted by COUNT(*)). A NOT IN (subquery) that contains a NULL returns no rows unexpectedly. Handle it with COALESCE(x, default) and be deliberate about nullable columns in your schema.`,
  },

  // ── Version control (git) ────────────────────────────────────────────────
  {
    name: "git-commit-hygiene",
    text: `Make small, focused commits that each represent one logical change and leave the tree building/passing. Write messages in the imperative mood ("Add retry to fetch", not "added"/"adds"), with a concise summary line under ~50 chars and a body explaining WHY when it is not obvious. Never commit generated artifacts, secrets, or large binaries. Commit related changes together and unrelated changes separately so history stays bisectable and reviewable.`,
  },
  {
    name: "git-rebase-vs-merge",
    text: `Merge preserves the true history and creates a merge commit; rebase rewrites your commits onto a new base for a linear history. The golden rule: never rebase (or force-push) commits that others have already based work on — you rewrite shared history and cause painful conflicts. Rebase your own local, unpushed feature branch to tidy it before opening a PR; merge (or squash-merge) to integrate. git pull --rebase avoids noisy merge commits when syncing your branch.`,
  },
  {
    name: "git-undo-safely",
    text: `git revert creates a new commit that undoes a previous one — safe on shared/public history. git reset moves the branch pointer and can discard commits: --soft keeps changes staged, --mixed (default) keeps them unstaged, --hard DISCARDS working-tree changes irrecoverably. Prefer revert for anything already pushed. Almost nothing is truly lost until garbage-collected: git reflog shows where HEAD has been, so you can recover a "lost" commit by resetting back to its hash.`,
  },

  // ── Testing ──────────────────────────────────────────────────────────────
  {
    name: "test-what-to-test",
    text: `Test observable BEHAVIOR through the public interface, not private implementation details — tests coupled to internals break on every refactor and give false confidence. Prioritize edge cases: empty input, a single element, boundaries (0, 1, max), duplicates, and error/exception paths, which is where bugs hide. A good test is deterministic, isolated (no shared state or ordering dependence), and fast. Each test should assert one behavior so a failure tells you exactly what broke.`,
  },
  {
    name: "test-aaa-and-mocks",
    text: `Structure a test as Arrange-Act-Assert: set up inputs, perform the one action under test, then assert on the outcome. Mock external dependencies (network, clock, filesystem, randomness) to keep tests fast and deterministic — inject a fixed clock and seed randomness. But do not over-mock: mocking the very thing you are testing, or asserting on mock call internals, tests the mock, not the code. Prefer real objects for pure logic and fakes/stubs only at true boundaries.`,
  },
  {
    name: "test-regression-first",
    text: `When fixing a bug, first write a failing test that reproduces it, then make it pass — this proves the fix works and prevents the bug from silently returning. A change that "fixes" a bug with no test that would have caught it is not done. Keep the test focused on the specific regression. This discipline turns every bug into a permanent guardrail and steadily grows a suite that documents real-world failure modes.`,
  },

  // ── APIs / HTTP / distributed ────────────────────────────────────────────
  {
    name: "http-status-codes",
    text: `Use HTTP status codes to their meaning. 2xx success (200 OK, 201 Created with a Location, 204 No Content). 3xx redirect. 4xx client error — the request is wrong and retrying unchanged will not help: 400 malformed, 401 unauthenticated, 403 authenticated-but-forbidden, 404 not found, 409 conflict, 422 validation failed, 429 rate-limited. 5xx server error — the client did nothing wrong and may retry: 500 unexpected, 503 unavailable. Never return 200 with an error body; clients and caches rely on the status.`,
  },
  {
    name: "dist-idempotency-and-exactly-once",
    text: `In distributed systems, "exactly-once delivery" is generally impossible; aim for at-least-once delivery plus idempotent processing, which yields exactly-once EFFECT. Consumers should dedupe on a message id or make the operation naturally idempotent so a redelivered message is harmless. Expect out-of-order and duplicate messages, partial failures, and clock skew. Never trust wall-clock ordering across machines; use logical clocks or a monotonic sequence where ordering matters.`,
  },
  {
    name: "dist-cap-and-timeouts",
    text: `Every remote call can be slow, fail, or partially succeed — treat the network as unreliable. Set explicit timeouts (a call with no timeout is a latent hang), add retries with exponential backoff and jitter for transient errors only, and use a circuit breaker to stop hammering a failing dependency. Prefer bulkheads (isolated resource pools) so one slow dependency cannot exhaust all threads/connections. Fail fast and degrade gracefully instead of blocking indefinitely.`,
  },

  // ── Regex, encoding, misc correctness ────────────────────────────────────
  {
    name: "regex-catastrophic-backtracking",
    text: `A poorly written regex can take exponential time on certain inputs ("catastrophic backtracking"), a denial-of-service vector (ReDoS) when the pattern runs on user input. The danger sign is nested or overlapping quantifiers on ambiguous alternations, like (a+)+ or (.*)* . Avoid them, prefer specific character classes over greedy .* , anchor patterns, and consider a linear-time regex engine (RE2) for untrusted input. Do not parse HTML or nested structures with regex; use a real parser.`,
  },
  {
    name: "text-unicode-and-encoding",
    text: `Text is not bytes. Always encode/decode with an explicit charset (UTF-8 by default) — mismatches produce mojibake. In JavaScript, string .length counts UTF-16 code units, so characters outside the Basic Multilingual Plane (many emoji) count as 2; iterate with for...of or [...str] or Intl.Segmenter to count actual characters. Normalize user text (String.prototype.normalize, usually NFC) before comparing or hashing, because visually identical strings can have different code point sequences.`,
  },
  {
    name: "time-utc-and-timezones",
    text: `Store and transmit timestamps in UTC (ISO 8601 with a 'Z' or explicit offset); convert to the user's local time zone only for display. Never do date math on local strings. Beware daylight-saving transitions (a day is not always 86400 seconds and some local times do not exist or occur twice) and leap seconds. In JS, the Date API is error-prone; use a library or the newer Temporal API. A "date without time" (a birthday) is a distinct concept from an instant — do not force it through a timezone.`,
  },
  {
    name: "code-magic-numbers-and-naming",
    text: `Replace unexplained literals ("magic numbers"/strings) with named constants that convey intent and centralize change (const MAX_RETRIES = 3). Name things by meaning, not type or mechanism (elapsedMs, not x). Booleans read best as positive assertions (isEnabled, not notDisabled). Keep functions small and single-responsibility; if you need "and" to describe what a function does, split it. Good names remove the need for most comments; reserve comments for WHY, not WHAT.`,
  },
  {
    name: "perf-measure-before-optimizing",
    text: `Optimize only what you have measured. Profile to find the actual hot path — intuition about bottlenecks is usually wrong, and most code does not matter for performance. Fix algorithmic complexity (an O(n^2) that should be O(n)) before micro-tuning, since constant-factor tweaks cannot beat a better big-O. Beware premature optimization that sacrifices clarity for gains you never needed. Establish a baseline benchmark, change one thing, and re-measure to confirm the win is real.`,
  },
  {
    name: "concurrency-event-loop-blocking",
    text: `Node.js runs JavaScript on a single thread with an event loop, so a long synchronous computation (a tight CPU loop, a huge JSON.parse, synchronous crypto over big data) blocks EVERY other request until it finishes. Keep the loop free: offload CPU-heavy work to a worker thread or a separate process, stream large payloads instead of buffering, and prefer the async (non-blocking) form of I/O APIs. A single blocking call can tank the throughput of an entire server.`,
  },
];
