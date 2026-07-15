/**
 * @file server/scripts/evalCodingBrain.ts
 * @description Brains-Upgrade Phase 6 — measurable proof that the built-in Coding
 * brain improves a local 3–7B coding model's answers.
 *
 * Clean A/B: for each coding question we send the SAME model the SAME system
 * prompt at temperature 0, changing exactly ONE variable — whether the Coding
 * brain's charter + top-k retrieved corpus is injected. Answers are graded by
 * objective fact-coverage (each expected fact = a group of accepted synonyms;
 * any match counts the fact covered). We report per-question and aggregate
 * coverage for BASELINE vs BRAIN, plus the delta.
 *
 * Retrieval mirrors production exactly: the question is embedded on-device with
 * the same all-MiniLM-L6-v2 the vector store uses, and top-k is cosine over the
 * pack's PREBUILT embeddings (the L2-normalized vectors are the same ones
 * EmbeddedVectorStore ranks with vector_distance_cos). The injected block is
 * assembled just like server/_core/brainContext.ts (charter always-on + cited
 * corpus).
 *
 * Model channel is a raw OpenAI-compatible chat endpoint so the model gets our
 * controlled system prompt with NO agent/guardrail layer on top — the one
 * variable under test stays isolated. Point it at Omnecor's own llama-server or
 * any OpenAI-compatible runtime via env:
 *
 *   OMNECOR_EVAL_BASE_URL  (default http://192.168.1.201:11434)   # + /v1/chat/completions
 *   OMNECOR_EVAL_MODEL     (default qwen2.5-coder:7b)
 *   OMNECOR_EVAL_API_KEY   (optional; for authed runtimes)
 *   OMNECOR_EVAL_TOPK      (default 4)
 *
 *   pnpm brains:eval:coding
 */

import { config } from "dotenv";
config();

import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { unpackBrain, chunkEmbedding, type BrainChunk } from "../core_services/brains/obpFormat.js";
import { EmbeddingService } from "../core_services/services/EmbeddingService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OBP_PATH = path.resolve(__dirname, "../../brains/coding.obp");

const BASE_URL = (process.env.OMNECOR_EVAL_BASE_URL || "http://192.168.1.201:11434").replace(/\/$/, "");
const MODEL = process.env.OMNECOR_EVAL_MODEL || "qwen2.5-coder:7b";
const API_KEY = process.env.OMNECOR_EVAL_API_KEY || "";
const TOPK = parseInt(process.env.OMNECOR_EVAL_TOPK || "4", 10);

/** The base system prompt — IDENTICAL in both conditions. */
const BASE_SYSTEM =
  "You are a concise, accurate coding assistant. Answer the question directly in " +
  "3–5 sentences. Be specific and technically precise; prefer concrete rules and " +
  "examples over generalities.";

interface EvalCase {
  q: string;
  /** Each entry is a group of accepted substrings; ANY match = that fact covered. */
  facts: string[][];
}

// Questions target specific, non-obvious corpus facts a 7B model may only
// partially recall. Fact groups are lowercase; matching is case-insensitive.
const CASES: EvalCase[] = [
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
];

interface ScoredChunk {
  chunk: BrainChunk;
  name: string;
  score: number;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function grade(answer: string, facts: string[][]): number {
  const lower = answer.toLowerCase();
  let hit = 0;
  for (const group of facts) if (group.some(t => lower.includes(t.toLowerCase()))) hit++;
  return hit / facts.length;
}

async function callModel(system: string, user: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 320,
    }),
  });
  if (!res.ok) throw new Error(`Model call failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const buf = await fsp.readFile(OBP_PATH);
  const pack = unpackBrain(buf);
  const chunks = pack.chunks.map(c => ({
    chunk: c,
    name: String((c.metadata as Record<string, unknown>).sourcePath ?? c.id),
    embedding: chunkEmbedding(pack, c),
  }));

  console.log("==========================================================");
  console.log("🧪 Coding Brain — measurable A/B eval");
  console.log(`   model   : ${MODEL}  @ ${BASE_URL}`);
  console.log(`   brain   : ${pack.manifest.id} v${pack.manifest.version} (${chunks.length} chunks, top-k ${TOPK})`);
  console.log(`   cases   : ${CASES.length}`);
  console.log("==========================================================\n");

  const embedder = EmbeddingService.getInstance();
  await embedder.init();
  if (!embedder.isReady()) throw new Error("Embedder not ready — cannot embed queries");

  let baseTotal = 0;
  let brainTotal = 0;
  let citedCount = 0;
  const rows: Array<{ q: string; base: number; brain: number; top: string }> = [];

  for (const c of CASES) {
    // ── Retrieve top-k exactly like production (cosine over prebuilt vectors) ──
    const [qvec] = await embedder.embedBatch([c.q]);
    const ranked: ScoredChunk[] = chunks
      .map(x => ({ chunk: x.chunk, name: x.name, score: dot(qvec, x.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOPK);

    const citations = ranked
      .map(r => `[Brain: Coding · ${r.name}]\n${r.chunk.text}`)
      .join("\n\n");
    const brainSystem =
      `${BASE_SYSTEM}\n\n${pack.charter}\n\n` +
      `Reference knowledge retrieved from your Coding brain (cite as shown):\n\n${citations}`;

    // ── A/B model calls (identical model, temp, user question) ──
    const baseAns = await callModel(BASE_SYSTEM, c.q);
    const brainAns = await callModel(brainSystem, c.q);

    const baseScore = grade(baseAns, c.facts);
    const brainScore = grade(brainAns, c.facts);
    baseTotal += baseScore;
    brainTotal += brainScore;
    if (/\[Brain:/i.test(brainAns)) citedCount++;
    rows.push({ q: c.q, base: baseScore, brain: brainScore, top: ranked[0].name });

    console.log(`Q: ${c.q}`);
    console.log(`   top-retrieved: ${ranked.map(r => r.name).join(", ")}`);
    console.log(`   baseline  ${(baseScore * 100).toFixed(0)}%   brain  ${(brainScore * 100).toFixed(0)}%   Δ ${((brainScore - baseScore) * 100).toFixed(0)}pt`);
    console.log("");
  }

  const n = CASES.length;
  const baseMean = (baseTotal / n) * 100;
  const brainMean = (brainTotal / n) * 100;
  const improved = rows.filter(r => r.brain > r.base).length;
  const regressed = rows.filter(r => r.brain < r.base).length;

  console.log("==========================================================");
  console.log("📊 RESULTS");
  console.log(`   baseline mean fact-coverage : ${baseMean.toFixed(1)}%`);
  console.log(`   brain    mean fact-coverage : ${brainMean.toFixed(1)}%`);
  console.log(`   absolute improvement        : ${(brainMean - baseMean).toFixed(1)} pt`);
  console.log(`   relative improvement        : ${baseMean > 0 ? (((brainMean - baseMean) / baseMean) * 100).toFixed(1) : "∞"}%`);
  console.log(`   questions improved/regressed: ${improved} / ${regressed} (of ${n})`);
  console.log(`   answers citing the brain    : ${citedCount} / ${n}`);
  console.log("==========================================================");

  if (brainMean <= baseMean) {
    console.error("\n❌ No measurable improvement — investigate retrieval or corpus.");
    process.exit(2);
  }
  console.log("\n✅ The Coding brain measurably improved the local model's answers.");
}

main().catch(err => {
  console.error("❌ Eval failed:", err);
  process.exit(1);
});
