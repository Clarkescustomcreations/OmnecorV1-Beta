/**
 * Agentic capability benchmark for a small local model under Omnecor.
 *
 * Replaces the old "equals a 70B" hand-wave with two things that can actually be
 * proven and reproduced:
 *
 *   Part A — Long-horizon reliability. A single run that must chain many
 *     SEQUENTIAL, non-precomputable tool steps (each step draws a fresh random
 *     number, so the model cannot know the values ahead of time and cannot batch
 *     them). We count the real tool steps via the harness's `onEvent` stream and
 *     verify the model's final total against the numbers actually drawn.
 *
 *   Part B — Capability lift (controlled A/B). For each task there is an
 *     INDEPENDENTLY computed ground truth (Node crypto / BigInt / a sieve) that
 *     is never shown to the model. We run the SAME task twice: once BARE (the raw
 *     model, no tools) and once EMPOWERED (the real `LocalSubAgentWorker` harness
 *     with the sandbox tool). A 7B model cannot compute a SHA-256 digest or an
 *     exact 30! in-weights, so bare answers are expected to be wrong; the
 *     empowered model computes them exactly.
 *
 * This makes a falsifiable, reproducible claim ("N-step agentic runs complete;
 * empowered beats bare on verifiable tasks") instead of an unmeasured comparison.
 *
 * Run:  OLLAMA_BASE_URL=http://<host>:11434 npx tsx server/scripts/benchmark-agentic.ts
 */
import { config } from "dotenv";
config();
import crypto from "crypto";
import fs from "fs/promises";
import { AiProviderService } from "../core_services/services/AiProviderService.js";
import { LocalSubAgentWorker, type SubAgentEvent } from "../core_services/services/LocalSubAgentWorker.js";
import { BrainPackService } from "../core_services/services/BrainPackService.js";
import { injectBrainContext } from "../_core/brainContext.js";
import { getDb } from "../db.factory.js";
import { brains } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";

// Provider under test. Default is Omnecor's OWN llama-server runtime (`llamacpp`,
// LocalLlmRuntimeService) — NOT Ollama. Ollama is chat-focused and drops native
// tool calls on the streaming path (see the sub-agent shim in AiProviderService),
// and the whole point of §1 is that Omnecor owns its runtime. Set BENCH_PROVIDER=
// ollama only to A/B the serving backend itself.
const PROVIDER = (process.env.BENCH_PROVIDER || "llamacpp") as "llamacpp" | "ollama";
const OLLAMA = process.env.OLLAMA_BASE_URL || "http://192.168.1.201:11434";
if (PROVIDER === "ollama") { process.env.OLLAMA_BASE_URL = OLLAMA; process.env.ollamaUrl = OLLAMA; }
const MODEL = process.env.BENCH_MODEL || (PROVIDER === "ollama" ? "qwen2.5-coder:7b" : "local-runtime");
const BASE_URL = PROVIDER === "ollama" ? OLLAMA : undefined; // llamacpp resolves its own local endpoint

// ── Independently computed ground truth (never shown to the model) ────────────
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
function primesBelow(n: number): number {
  const sieve = new Uint8Array(n);
  let count = 0;
  for (let i = 2; i < n; i++) {
    if (!sieve[i]) { count++; for (let j = i * i; j < n; j += i) sieve[j] = 1; }
  }
  return count;
}
function factorial(n: bigint): bigint { let r = 1n; for (let i = 2n; i <= n; i++) r *= i; return r; }
/** The n-th prime (2 is the 1st). Sieve to a safe bound for n ≤ 100000. */
function nthPrime(n: number): number {
  const limit = 1_400_000; // π(1.4M) > 100000
  const sieve = new Uint8Array(limit);
  let count = 0;
  for (let i = 2; i < limit; i++) {
    if (!sieve[i]) { if (++count === n) return i; for (let j = i * i; j < limit; j += i) sieve[j] = 1; }
  }
  return -1;
}
const pow2 = (e: number): bigint => 2n ** BigInt(e);

// ── Harder ground truth: tasks that need CORRECT multi-step logic (the model
//    can write buggy code and fail — that's the point of the "hard" tier) ─────
function collatzSteps(n: number): number { let x = n, s = 0; while (x !== 1) { x = x % 2 === 0 ? x / 2 : 3 * x + 1; s++; } return s; }
function longestCollatzStart(limit: number): number {
  let best = -1, bestN = 1;
  for (let i = 1; i < limit; i++) { let x = i, s = 0; while (x !== 1) { x = x % 2 === 0 ? x / 2 : 3 * x + 1; s++; } if (s > best) { best = s; bestN = i; } }
  return bestN;
}
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}
/** f(1)=1, f(2)=2, f(n)=f(n-1)+2·f(n-2) — exact (BigInt). */
function customRec(n: number): bigint { let a = 1n, b = 2n; if (n === 1) return 1n; if (n === 2) return 2n; for (let i = 3; i <= n; i++) { const c = b + 2n * a; a = b; b = c; } return b; }
function distinctSubstrings(s: string): number { const set = new Set<string>(); for (let i = 0; i < s.length; i++) for (let j = i + 1; j <= s.length; j++) set.add(s.slice(i, j)); return set.size; }

// ── Answer extraction ─────────────────────────────────────────────────────────
function answerLine(text: string): string | null {
  const m = [...text.matchAll(/ANSWER:\s*(.+)/gi)];
  return m.length ? m[m.length - 1][1].trim() : null;
}
const norm = (s: string) => s.replace(/[`"'*\s,_]/g, "").toLowerCase();
function containsHex(text: string, hex: string): boolean {
  return text.toLowerCase().includes(hex.toLowerCase());
}

// ── Model callers ─────────────────────────────────────────────────────────────
async function bare(question: string): Promise<string> {
  return AiProviderService.getInstance().chat({
    providerId: PROVIDER, modelId: MODEL, baseUrl: BASE_URL,
    systemPrompt:
      "You are a helpful assistant. You have NO tools and NO code execution available — answer from your own knowledge only. " +
      "Give your single best answer and end with a line exactly like 'ANSWER: <value>'.",
    messages: [{ role: "user", content: question }],
    temperature: 0.2, maxTokens: 1500, routingMode: "sub_agent_internal" as any,
  });
}

// ── Brain Pack(s) for the "empowered + brain" arm (§8) ────────────────────────
// BENCH_BRAIN selects which brain(s) to attach: "generalist" (default), "coding",
// "generalist,coding" (Team of Experts merge), or "off". Matched by id/domain/name.
const BRAIN_SEL = (process.env.BENCH_BRAIN ?? "generalist").toLowerCase();
const BRAIN_USER = 1;
let brainIds: string[] = [];
let brainLabel = "brain";

async function setupBrain(): Promise<void> {
  if (BRAIN_SEL === "off") { console.log("Brain: disabled (BENCH_BRAIN=off)"); return; }
  try {
    await BrainPackService.getInstance().importBuiltins(BRAIN_USER); // idempotent
    const db = await getDb();
    const rows = await db.select().from(brains).where(eq(brains.userId, BRAIN_USER));
    const names: string[] = [];
    for (const w of BRAIN_SEL.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = rows.find((r) => r.id.toLowerCase().includes(w) || (r.domain ?? "").toLowerCase().includes(w) || (r.name ?? "").toLowerCase().includes(w));
      if (m && !brainIds.includes(m.id)) { brainIds.push(m.id); names.push(m.name); }
    }
    brainLabel = names.join(" + ") || "brain";
    console.log(brainIds.length ? `Brain(s): ${brainLabel} — [${brainIds.join(", ")}]` : `Brain: no pack matched "${BRAIN_SEL}" — running tools-only.`);
  } catch (e) { console.log("Brain: setup failed —", (e as Error).message); }
}

/** The selected brain(s)' charter + goal-relevant retrieval, as a system prompt. */
async function brainPrompt(goal: string): Promise<string | undefined> {
  if (!brainIds.length) return undefined;
  try {
    const r = await injectBrainContext({
      brainIds, userId: BRAIN_USER,
      messages: [{ role: "user", content: goal }], systemPrompt: "",
    });
    return r.systemPrompt || undefined;
  } catch { return undefined; }
}

async function empowered(goal: string, opts: { brain: boolean; maxSteps?: number }): Promise<{ out: string; events: SubAgentEvent[]; brain: boolean }> {
  const systemPrompt = opts.brain ? await brainPrompt(goal) : undefined;
  const events: SubAgentEvent[] = [];
  const out = await LocalSubAgentWorker.getInstance().executeTask({
    providerId: PROVIDER, modelId: MODEL, baseUrl: BASE_URL,
    goal, systemPrompt, maxRetries: 8, maxSteps: opts.maxSteps ?? 40, onEvent: (e) => events.push(e),
  });
  return { out, events, brain: !!systemPrompt };
}

interface AbTask { name: string; question: string; goal: string; truth: string; check: (ans: string | null, full: string, truth: string) => boolean }

// Repetition knobs for a statistical baseline (not a one-off). Each Part B
// example runs REPEAT times per run, across RUNS runs → RUNS*REPEAT samples per
// example. Part A runs once per run (RUNS samples per arm).
const RUNS = Math.max(1, Number(process.env.BENCH_RUNS || "1"));
const REPEAT = Math.max(1, Number(process.env.BENCH_REPEAT || "1"));
const ROUNDS = 15;

const goalA =
  `Build a running total across EXACTLY ${ROUNDS} sequential rounds using the sandbox.\n` +
  `- Round 1: run  python3 -c "import random; print(0 + random.randint(1,9))"  and note the printed number.\n` +
  `- Each later round: run  python3 -c "import random; print(PREV + random.randint(1,9))"  replacing PREV\n` +
  `  with the number printed by the PREVIOUS round.\n` +
  `- Exactly ONE execute_sandbox call per round, ${ROUNDS} rounds total. The draws are random so you cannot\n` +
  `  precompute or batch them — you must thread the previous result into the next call.\n` +
  `- After round ${ROUNDS}, report the final printed number as 'ANSWER: <number>'.`;

const mandate = "You MUST use the execute_sandbox tool with python3 to compute the answer by running code. " +
  "Do NOT answer from memory or estimate — a value you did not compute by running code is unacceptable. " +
  "Output the tool call as JSON to run python3, read its printed output, then report it.\n\n";

const coreTasks: AbTask[] = [
  {
    name: "SHA-256 digest",
    question: "What is the SHA-256 hex digest of the exact ASCII string: Omnecor-Local-Model-Empowerment ? Give the 64-character lowercase hex.",
    goal: "Compute the SHA-256 hex digest of the exact ASCII string: Omnecor-Local-Model-Empowerment . Use the execute_sandbox tool with python3 (hashlib) to compute it exactly — do not guess. End with 'ANSWER: <64-char lowercase hex>'.",
    truth: sha256("Omnecor-Local-Model-Empowerment"),
    check: (ans, full, truth) => containsHex(full, truth) || (ans != null && norm(ans) === norm(truth)),
  },
  {
    name: "Prime count < 200000",
    question: "Exactly how many prime numbers are strictly less than 200000? Give the exact integer.",
    goal: "Compute exactly how many prime numbers are strictly less than 200000. Use the execute_sandbox tool with python3 to compute it exactly — do not estimate. End with 'ANSWER: <integer>'.",
    truth: String(primesBelow(200000)),
    check: (ans, _full, truth) => ans != null && norm(ans) === norm(truth),
  },
  {
    name: "30! (exact)",
    question: "What is 30 factorial (30!) as an exact integer? Give all digits.",
    goal: "Compute 30 factorial (30!) as an exact integer. Use the execute_sandbox tool with python3 to compute it exactly — do not approximate. End with 'ANSWER: <exact integer>'.",
    truth: factorial(30n).toString(),
    check: (ans, full, truth) => (ans != null && norm(ans).includes(truth)) || full.replace(/[\s,_]/g, "").includes(truth),
  },
  {
    name: "SHA-256 of 30!",
    question: "Compute 30! as an exact integer, then give the SHA-256 hex digest of that integer's decimal-string form.",
    goal: "First compute 30! exactly, then compute the SHA-256 hex digest of that integer's decimal string. Use the execute_sandbox tool with python3 for both — do not guess. End with 'ANSWER: <64-char lowercase hex>'.",
    truth: sha256(factorial(30n).toString()),
    check: (ans, full, truth) => containsHex(full, truth) || (ans != null && norm(ans) === norm(truth)),
  },
  {
    name: "100000th prime",
    question: "What is the 100000th prime number? (2 is the 1st prime.) Give the exact integer.",
    goal: "Compute the 100000th prime number (2 is the 1st prime). Use the execute_sandbox tool with python3 to compute it exactly — do not guess. End with 'ANSWER: <integer>'.",
    truth: String(nthPrime(100000)),
    check: (ans, _full, truth) => ans != null && norm(ans) === norm(truth),
  },
  {
    name: "2^1000 (exact)",
    question: "What is 2 to the power 1000 (2^1000) as an exact integer? Give all digits.",
    goal: "Compute 2 to the power 1000 (2^1000) as an exact integer. Use the execute_sandbox tool with python3 to compute it exactly — do not approximate. End with 'ANSWER: <exact integer>'.",
    truth: pow2(1000).toString(),
    check: (ans, full, truth) => (ans != null && norm(ans).includes(truth)) || full.replace(/[\s,_]/g, "").includes(truth),
  },
];

// HARD tier — same format, but the empowered model must write CORRECT
// multi-step logic (a stdlib one-liner won't do it), so it can genuinely fail
// and populate the failure log. Ground truth still computed independently here.
const hardTasks: AbTask[] = [
  {
    name: "Collatz steps @27",
    question: "For the Collatz sequence starting at 27 (even→n/2, odd→3n+1), how many steps to reach 1? Exact integer.",
    goal: "Compute how many steps the Collatz sequence starting at 27 takes to reach 1 (each step: n→n/2 if even, n→3n+1 if odd; count steps until n==1). Write and run python3 via execute_sandbox — do not guess. End with 'ANSWER: <integer>'.",
    truth: String(collatzSteps(27)),
    check: (ans, _f, truth) => ans != null && norm(ans) === norm(truth),
  },
  {
    name: "Longest Collatz <100000",
    question: "Which starting number under 100000 produces the longest Collatz sequence (steps to reach 1)? Give that starting number.",
    goal: "Find the starting number under 100000 that produces the longest Collatz sequence (steps to reach 1). Write and run python3 via execute_sandbox to compute it exactly — do not guess. End with 'ANSWER: <starting number>'.",
    truth: String(longestCollatzStart(100000)),
    check: (ans, _f, truth) => ans != null && norm(ans) === norm(truth),
  },
  {
    name: "Levenshtein",
    question: "What is the Levenshtein edit distance between 'kitten' and 'sitting'? Exact integer.",
    goal: "Compute the Levenshtein edit distance between 'kitten' and 'sitting' by writing and running a correct dynamic-programming implementation in python3 via execute_sandbox (no external library). End with 'ANSWER: <integer>'.",
    truth: String(levenshtein("kitten", "sitting")),
    check: (ans, _f, truth) => ans != null && norm(ans) === norm(truth),
  },
  {
    name: "Recurrence f(60)",
    question: "Define f(1)=1, f(2)=2, and f(n)=f(n-1)+2*f(n-2). What is f(60) as an exact integer?",
    goal: "With f(1)=1, f(2)=2, f(n)=f(n-1)+2*f(n-2), compute f(60) exactly. Write and run python3 via execute_sandbox (mind the base cases and use exact integers) — do not guess. End with 'ANSWER: <exact integer>'.",
    truth: customRec(60).toString(),
    check: (ans, full, truth) => (ans != null && norm(ans).includes(truth)) || full.replace(/[\s,_]/g, "").includes(truth),
  },
  {
    name: "Distinct substrings",
    question: "How many DISTINCT non-empty substrings does the string 'mississippi' have? Exact integer.",
    goal: "Count the number of DISTINCT non-empty substrings of the string 'mississippi'. Write and run python3 via execute_sandbox to compute it exactly (enumerate and dedupe) — do not guess. End with 'ANSWER: <integer>'.",
    truth: String(distinctSubstrings("mississippi")),
    check: (ans, _f, truth) => ans != null && norm(ans) === norm(truth),
  },
];

const TIER = (process.env.BENCH_TIER || "core").toLowerCase();
const tasks: AbTask[] = TIER === "hard" ? hardTasks : coreTasks;

interface LhResult { brain: boolean; steps: number; threadedOk: boolean; answerMatches: boolean; loopFailures: number; pass: boolean }
async function longHorizon(brain: boolean): Promise<LhResult> {
  const a = await empowered(goalA, { brain, maxSteps: 40 });
  const toolCalls = a.events.filter((e) => e.type === "tool_call");
  const seq: number[] = [];
  for (const e of a.events) {
    if (e.type === "tool_result") {
      const nums = (e.result.match(/-?\d+/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
      if (nums.length === 1) seq.push(nums[0]);
    }
  }
  const deltas = seq.slice(1).map((v, i) => v - seq[i]);
  const threadedOk = seq.length >= 2 && deltas.every((d) => d >= 1 && d <= 9);
  const finalVal = seq.length ? seq[seq.length - 1] : null;
  const reportedA = answerLine(a.out);
  const answerMatches = reportedA != null && finalVal != null && Number(norm(reportedA)) === finalVal;
  const loopFailures = a.events.filter((e) => e.type === "harness_error").length;
  const pass = toolCalls.length >= ROUNDS && threadedOk && answerMatches;
  return { brain, steps: toolCalls.length, threadedOk, answerMatches, loopFailures, pass };
}

// ── Failure recording (so we can see EXACTLY what still fails, to improve the
//    empowerment) ────────────────────────────────────────────────────────────
interface FailureRecord {
  run: number; task: string; arm: "bare" | "empowered" | "empowered+brain";
  category: string; expected: string; got: string | null; toolSteps: number;
  toolErrors: string[]; parseErrors: number; harnessErrors: number; maxStepsHit: boolean;
  finalSnippet: string;
}
const failures: FailureRecord[] = [];

/** Classify WHY an empowered run failed, from its trajectory — the actionable signal. */
function classifyEmp(events: SubAgentEvent[], out: string) {
  const toolSteps = events.filter((e) => e.type === "tool_call").length;
  const toolErrors = events.filter((e): e is Extract<SubAgentEvent, { type: "tool_error" }> => e.type === "tool_error").map((e) => e.error);
  const parseErrors = events.filter((e) => e.type === "parse_error").length;
  const harnessErrors = events.filter((e) => e.type === "harness_error").length;
  const maxStepsHit = /step ceiling/.test(out);
  let category: string;
  if (toolSteps === 0) category = "no_tool_use";          // never called the sandbox — answered from weights
  else if (maxStepsHit) category = "maxsteps_exceeded";   // looped without finishing
  else if (harnessErrors) category = "harness_error";     // provider/harness threw
  else if (answerLine(out) == null) category = "no_answer_line"; // ran tools but never reported ANSWER
  else category = "wrong_value";                          // reported an answer, but it's wrong (misread/miscompute)
  return { category, toolSteps, toolErrors, parseErrors, harnessErrors, maxStepsHit };
}

async function bareArm(t: AbTask): Promise<boolean> {
  try { const o = await bare(t.question); return t.check(answerLine(o), o, t.truth); }
  catch { return false; }
}
async function empArm(t: AbTask, brain: boolean): Promise<{ ok: boolean; steps: number; events: SubAgentEvent[]; out: string }> {
  try {
    const e = await empowered(mandate + t.goal, { brain, maxSteps: 20 });
    return { ok: t.check(answerLine(e.out), e.out, t.truth), steps: e.events.filter((x) => x.type === "tool_call").length, events: e.events, out: e.out };
  } catch (err) { return { ok: false, steps: 0, events: [], out: `THREW: ${(err as Error).message}` }; }
}
function recordEmpFailure(run: number, t: AbTask, arm: "empowered" | "empowered+brain", r: { events: SubAgentEvent[]; out: string; steps: number }) {
  const c = classifyEmp(r.events, r.out);
  failures.push({
    run, task: t.name, arm, category: c.category, expected: t.truth.slice(0, 80), got: answerLine(r.out),
    toolSteps: c.toolSteps, toolErrors: c.toolErrors.slice(0, 3), parseErrors: c.parseErrors, harnessErrors: c.harnessErrors,
    maxStepsHit: c.maxStepsHit, finalSnippet: r.out.replace(/\s+/g, " ").slice(-200),
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

async function main() {
  const samplesPerExample = RUNS * REPEAT;
  console.log("==================================================================");
  console.log(`  Omnecor Agentic Benchmark — statistical baseline`);
  console.log(`  provider: ${PROVIDER}${PROVIDER === "ollama" ? ` @ ${OLLAMA}` : " (Omnecor's own llama-server runtime)"}`);
  console.log(`  model   : ${MODEL}`);
  console.log(`  tier    : ${TIER}  (${tasks.length} Part-B tasks)`);
  console.log(`  plan    : ${RUNS} runs × ${REPEAT} repeats = ${samplesPerExample} samples/example; ${tasks.length} Part-B tasks × 3 arms; Part A ${RUNS} samples/arm`);
  console.log(`  date    : ${new Date().toISOString()}`);
  console.log("==================================================================\n");
  await setupBrain();

  // Accumulators
  const lhNo: LhResult[] = [], lhBr: LhResult[] = [];
  const acc = tasks.map((t) => ({ name: t.name, bare: 0, emp: 0, empBrain: 0, empSteps: [] as number[], empBrainSteps: [] as number[] }));

  for (let run = 1; run <= RUNS; run++) {
    console.log(`\n═══════════════ RUN ${run} / ${RUNS} ═══════════════`);
    const an = await longHorizon(false); lhNo.push(an);
    const ab = await longHorizon(true); lhBr.push(ab);
    console.log(`  Part A: empowered ${an.steps} steps (${an.loopFailures} loop-fail, ${an.threadedOk && an.answerMatches ? "verified" : "unverified"}) · +brain ${ab.steps} steps (${ab.loopFailures} loop-fail, ${ab.threadedOk && ab.answerMatches ? "verified" : "unverified"})`);
    for (let rep = 1; rep <= REPEAT; rep++) {
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (await bareArm(t)) acc[i].bare++;
        const e = await empArm(t, false); if (e.ok) acc[i].emp++; else recordEmpFailure(run, t, "empowered", e); acc[i].empSteps.push(e.steps);
        const eb = await empArm(t, true); if (eb.ok) acc[i].empBrain++; else recordEmpFailure(run, t, "empowered+brain", eb); acc[i].empBrainSteps.push(eb.steps);
      }
      const done = run * REPEAT - (REPEAT - rep);
      console.log(`  Part B repeat ${rep}/${REPEAT} done (${done}/${samplesPerExample} samples/example)`);
    }
  }

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const N = samplesPerExample;
  const totalB = N * tasks.length;
  const bareTot = acc.reduce((s, a) => s + a.bare, 0);
  const empTot = acc.reduce((s, a) => s + a.emp, 0);
  const empBrainTot = acc.reduce((s, a) => s + a.empBrain, 0);
  console.log("\n==================================================================");
  console.log(`  AGGREGATE — ${RUNS} runs × ${REPEAT} repeats (${N} samples/example)`);
  console.log("==================================================================");
  console.log(`  PART A (long-horizon reliability, ${RUNS} samples/arm):`);
  const lhLine = (rows: LhResult[]) => `steps mean=${r1(mean(rows.map((r) => r.steps)))} min=${Math.min(...rows.map((r) => r.steps))} max=${Math.max(...rows.map((r) => r.steps))} · loop-failures total=${rows.reduce((s, r) => s + r.loopFailures, 0)} · state+answer verified ${rows.filter((r) => r.threadedOk && r.answerMatches).length}/${rows.length}`;
  console.log(`     empowered       : ${lhLine(lhNo)}`);
  console.log(`     empowered+brain : ${lhLine(lhBr)}`);
  console.log(`  PART B (capability lift, ${N} samples/example):`);
  console.log(`     per task            bare      empowered   +brain      (emp mean steps)`);
  for (const a of acc) {
    console.log(`     ${a.name.padEnd(20)}${String(a.bare + "/" + N).padEnd(10)}${String(a.emp + "/" + N).padEnd(12)}${String(a.empBrain + "/" + N).padEnd(12)}(${r1(mean(a.empSteps))})`);
  }
  console.log(`     ${"TOTAL".padEnd(20)}${String(bareTot + "/" + totalB).padEnd(10)}${String(empTot + "/" + totalB).padEnd(12)}${String(empBrainTot + "/" + totalB).padEnd(12)}`);
  console.log(`     → bare ${r1((100 * bareTot) / totalB)}%  ·  empowered ${r1((100 * empTot) / totalB)}%  ·  empowered+brain ${r1((100 * empBrainTot) / totalB)}%`);

  // ── Failure analysis — what the EMPOWERED model still gets wrong (actionable) ─
  console.log(`\n  EMPOWERED FAILURE ANALYSIS (arms 2 & 3 — bare failures are the expected baseline):`);
  const bareFails = totalB - bareTot;
  console.log(`     bare failures (expected, = the gap Omnecor closes): ${bareFails}/${totalB}`);
  if (failures.length === 0) {
    console.log(`     empowered failures: NONE — every empowered attempt across all runs was correct.`);
  } else {
    const byCat = new Map<string, number>();
    for (const f of failures) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
    console.log(`     empowered failures: ${failures.length} — by cause:`);
    for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) console.log(`        ${cat.padEnd(20)} ${n}`);
    console.log(`     by task:`);
    for (const t of tasks) {
      const fs2 = failures.filter((f) => f.task === t.name);
      if (fs2.length) console.log(`        ${t.name.padEnd(20)} ${fs2.length} fail — ${[...new Set(fs2.map((f) => f.category))].join(", ")}`);
    }
    console.log(`     first examples:`);
    for (const f of failures.slice(0, 6)) {
      console.log(`        [${f.arm}] ${f.task} · ${f.category} · steps=${f.toolSteps} · got=${(f.got ?? "—").slice(0, 40)}${f.toolErrors.length ? ` · toolErr="${f.toolErrors[0].slice(0, 70)}"` : ""}`);
    }
  }
  // Full failure log to disk for offline analysis / harness improvement.
  const failPath = `benchmark-failures-${MODEL.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}.json`;
  try {
    await fs.writeFile(failPath, JSON.stringify({ model: MODEL, provider: PROVIDER, date: new Date().toISOString(), runs: RUNS, repeat: REPEAT, samplesPerExample: N, failures }, null, 2));
    console.log(`\n  Full failure log → ${failPath}`);
  } catch (e) { console.log(`  (could not write failure log: ${(e as Error).message})`); }
  console.log("");
  console.log(JSON.stringify({
    model: MODEL, provider: PROVIDER, date: new Date().toISOString(),
    runs: RUNS, repeat: REPEAT, samplesPerExample: N,
    partA: {
      empowered: { meanSteps: r1(mean(lhNo.map((r) => r.steps))), loopFailures: lhNo.reduce((s, r) => s + r.loopFailures, 0), verified: lhNo.filter((r) => r.threadedOk && r.answerMatches).length, samples: lhNo.length },
      empoweredBrain: { meanSteps: r1(mean(lhBr.map((r) => r.steps))), loopFailures: lhBr.reduce((s, r) => s + r.loopFailures, 0), verified: lhBr.filter((r) => r.threadedOk && r.answerMatches).length, samples: lhBr.length },
    },
    partB: {
      totalPerArm: totalB,
      bareCorrect: bareTot, empoweredCorrect: empTot, empoweredBrainCorrect: empBrainTot,
      perTask: acc.map((a) => ({ task: a.name, bare: a.bare, emp: a.emp, empBrain: a.empBrain, empMeanSteps: r1(mean(a.empSteps)) })),
    },
  }, null, 2));
  console.log("==================================================================");
}

// Imported singletons (DB pool, OMMESH MeshNode, LocalLlmRuntime, embedding
// engine) hold open handles that keep Node's event loop alive, so the process
// would hang forever after printing results. Exit explicitly on both paths.
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("Benchmark failed:", e); process.exit(1); });
