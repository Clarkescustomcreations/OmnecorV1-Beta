/**
 * @file server/scripts/evalBrain.ts
 * @description Brains-Upgrade Phase 6 — generalized, measurable A/B proof that a
 * built-in brain improves a local 3–7B model's answers. Runs the SAME Phase-6
 * methodology as evalCodingBrain.ts across ANY (or all) registered brains.
 *
 * Clean A/B: for each question we send the SAME model the SAME base system
 * prompt at temperature 0, changing exactly ONE variable — whether the brain's
 * charter + top-k retrieved corpus is injected. Answers are graded by objective
 * fact-coverage (each expected fact = a group of accepted synonyms; ANY match
 * counts the fact covered). We report per-question and aggregate coverage for
 * BASELINE vs BRAIN, plus the delta.
 *
 * Retrieval mirrors production exactly: the question is embedded on-device with
 * the same all-MiniLM-L6-v2 the vector store uses, and top-k is cosine over the
 * pack's PREBUILT embeddings. The injected block is assembled like
 * server/_core/brainContext.ts (charter always-on + cited corpus).
 *
 *   pnpm brains:eval:all               # eval every registered brain
 *   pnpm brains:eval:all pcb-engineer  # eval only the given slug(s)
 *
 * Env:
 *   OMNECOR_EVAL_BASE_URL  (default http://192.168.1.201:11434)   # + /v1/chat/completions
 *   OMNECOR_EVAL_MODEL     (override the per-brain default model)
 *   OMNECOR_EVAL_API_KEY   (optional; for authed runtimes)
 *   OMNECOR_EVAL_TOPK      (default 4)
 */

import { config } from "dotenv";
config();

import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { unpackBrain, chunkEmbedding, type BrainChunk } from "../core_services/brains/obpFormat.js";
import { EmbeddingService } from "../core_services/services/EmbeddingService.js";
import { EVAL_SPECS, getEvalSpec } from "../../brains/eval/index.js";
import type { EvalCase, EvalSpec } from "../../brains/eval/_types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAINS_DIR = path.resolve(__dirname, "../../brains");

const BASE_URL = (process.env.OMNECOR_EVAL_BASE_URL || "http://192.168.1.201:11434").replace(/\/$/, "");
const MODEL_OVERRIDE = process.env.OMNECOR_EVAL_MODEL || "";
const API_KEY = process.env.OMNECOR_EVAL_API_KEY || "";
const TOPK = parseInt(process.env.OMNECOR_EVAL_TOPK || "4", 10);

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
  return facts.length ? hit / facts.length : 0;
}

async function callModel(model: string, system: string, user: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 340,
    }),
  });
  if (!res.ok) throw new Error(`Model call failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

interface BrainResult {
  slug: string;
  name: string;
  model: string;
  baseMean: number;
  brainMean: number;
  improved: number;
  regressed: number;
  n: number;
  cited: number;
  top1: number;
}

async function evalBrain(spec: EvalSpec, embedder: EmbeddingService): Promise<BrainResult> {
  const model = MODEL_OVERRIDE || spec.model;
  const obpPath = path.join(BRAINS_DIR, `${spec.slug}.obp`);
  const buf = await fsp.readFile(obpPath);
  const pack = unpackBrain(buf);
  const chunks = pack.chunks.map(c => ({
    chunk: c,
    name: String((c.metadata as Record<string, unknown>).sourcePath ?? c.id),
    embedding: chunkEmbedding(pack, c),
  }));

  console.log("\n==========================================================");
  console.log(`🧪 ${spec.name} brain — A/B eval`);
  console.log(`   model : ${model}  @ ${BASE_URL}`);
  console.log(`   brain : ${pack.manifest.id} v${pack.manifest.version} (${chunks.length} chunks, top-k ${TOPK})`);
  console.log(`   cases : ${spec.cases.length}`);
  console.log("==========================================================");

  let baseTotal = 0;
  let brainTotal = 0;
  let citedCount = 0;
  let top1Count = 0;
  const rows: Array<{ base: number; brain: number }> = [];

  for (const c of spec.cases) {
    const [qvec] = await embedder.embedBatch([c.q]);
    const ranked: ScoredChunk[] = chunks
      .map(x => ({ chunk: x.chunk, name: x.name, score: dot(qvec, x.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOPK);

    const citations = ranked
      .map(r => `[Brain: ${spec.name} · ${r.name}]\n${r.chunk.text}`)
      .join("\n\n");
    const brainSystem =
      `${spec.baseSystem}\n\n${pack.charter}\n\n` +
      `Reference knowledge retrieved from your ${spec.name} brain (cite as shown):\n\n${citations}`;

    const baseAns = await callModel(model, spec.baseSystem, c.q);
    const brainAns = await callModel(model, brainSystem, c.q);

    const baseScore = grade(baseAns, c.facts);
    const brainScore = grade(brainAns, c.facts);
    baseTotal += baseScore;
    brainTotal += brainScore;
    if (/\[Brain:/i.test(brainAns)) citedCount++;
    if (spec.cases.length) {
      // "top1" = the retrieved #1 chunk actually covers at least one expected fact.
      const topText = ranked[0]?.chunk.text.toLowerCase() ?? "";
      if (c.facts.some(g => g.some(t => topText.includes(t.toLowerCase())))) top1Count++;
    }
    rows.push({ base: baseScore, brain: brainScore });

    console.log(`Q: ${c.q}`);
    console.log(`   top: ${ranked.map(r => r.name).join(", ")}`);
    console.log(`   baseline ${(baseScore * 100).toFixed(0)}%   brain ${(brainScore * 100).toFixed(0)}%   Δ ${((brainScore - baseScore) * 100).toFixed(0)}pt`);
  }

  const n = spec.cases.length;
  const baseMean = (baseTotal / n) * 100;
  const brainMean = (brainTotal / n) * 100;
  const improved = rows.filter(r => r.brain > r.base).length;
  const regressed = rows.filter(r => r.brain < r.base).length;

  console.log("----------------------------------------------------------");
  console.log(`📊 ${spec.name}: baseline ${baseMean.toFixed(1)}%  →  brain ${brainMean.toFixed(1)}%  (Δ ${(brainMean - baseMean).toFixed(1)}pt, ${improved}↑/${regressed}↓, cited ${citedCount}/${n}, retrieval-top1 ${top1Count}/${n})`);

  return { slug: spec.slug, name: spec.name, model, baseMean, brainMean, improved, regressed, n, cited: citedCount, top1: top1Count };
}

async function main() {
  const only = process.argv.slice(2).map(s => s.trim()).filter(Boolean);
  const specs = only.length
    ? only.map(s => getEvalSpec(s)).filter((s): s is EvalSpec => !!s)
    : EVAL_SPECS;

  if (!specs.length) {
    console.error(`No matching eval specs for: ${only.join(", ")}. Known: ${EVAL_SPECS.map(s => s.slug).join(", ")}`);
    process.exit(1);
  }

  const embedder = EmbeddingService.getInstance();
  await embedder.init();
  if (!embedder.isReady()) throw new Error("Embedder not ready — cannot embed queries");

  const results: BrainResult[] = [];
  for (const spec of specs) {
    try {
      results.push(await evalBrain(spec, embedder));
    } catch (err) {
      console.error(`❌ ${spec.slug} eval failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Scoreboard ────────────────────────────────────────────────────────────
  console.log("\n==========================================================");
  console.log("🏁 SCOREBOARD — baseline → brain (Δ)   [model]");
  console.log("==========================================================");
  let wins = 0;
  for (const r of results) {
    const delta = r.brainMean - r.baseMean;
    if (delta > 0) wins++;
    const flag = delta > 0 ? "✅" : delta < 0 ? "❌" : "➖";
    console.log(
      `${flag} ${r.name.padEnd(24)} ${r.baseMean.toFixed(1).padStart(5)}% → ${r.brainMean.toFixed(1).padStart(5)}%  ` +
        `(${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pt, ${r.improved}↑/${r.regressed}↓)  [${r.model}]`
    );
  }
  console.log("==========================================================");
  console.log(`   ${wins}/${results.length} brains posted a measurable improvement.`);

  if (wins < results.length) {
    console.error("\n⚠️  Not every brain improved — investigate the flagged corpora/questions.");
    process.exit(2);
  }
  console.log("\n✅ Every evaluated brain measurably improved the local model's answers.");
}

main().catch(err => {
  console.error("❌ Eval failed:", err);
  process.exit(1);
});
