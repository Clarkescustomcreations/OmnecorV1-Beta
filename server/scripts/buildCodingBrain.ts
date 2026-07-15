/**
 * @file server/scripts/buildCodingBrain.ts
 * @description Build the built-in **Coding** Brain Pack (Brains-Upgrade Phase 6).
 *
 * Runs the curated coding charter + corpus (brains/sources/coding.ts) through the
 * REAL authoring pipeline — {@link BrainAuthoringService.authorPack}: chunk →
 * on-device embed (all-MiniLM-L6-v2) → pack — and writes the resulting portable
 * `.obp` to the in-repo built-in directory (brains/coding.obp). No DB, no cloud,
 * no distillation: a fully local, air-gappable build of a shippable exemplar.
 *
 *   pnpm brains:build:coding
 *
 * Rebuild whenever brains/sources/coding.ts changes. The pack is deterministic
 * given the source + embedder, so re-running produces an equivalent pack.
 */

import { config } from "dotenv";
config();

import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { BrainAuthoringService, type BrainSource } from "../core_services/services/BrainAuthoringService.js";
import { CODING_CHARTER, CODING_SOURCES } from "../../brains/sources/coding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, "../../brains/coding.obp");

async function main() {
  const sources: BrainSource[] = CODING_SOURCES.map(s => ({ name: s.name, text: s.text }));

  console.log("==========================================");
  console.log("🧠 Building built-in Coding Brain Pack");
  console.log(`   charter: ${CODING_CHARTER.length} chars`);
  console.log(`   sources: ${sources.length} curated entries`);
  console.log("   embedding on-device (all-MiniLM-L6-v2)…");
  console.log("==========================================");

  const t0 = Date.now();
  const authored = await BrainAuthoringService.getInstance().authorPack({
    id: "omnecor-coding",
    name: "Coding",
    version: "1.0.0",
    domain: "coding",
    description:
      "Curated, durable software-engineering reference: language pitfalls, async/" +
      "concurrency, security, algorithms & complexity, SQL, git, testing, and API design.",
    charter: CODING_CHARTER,
    sources,
    includeRawChunks: true,
    license: "CC0-1.0 (original content, public domain dedication)",
    notes:
      "Built-in exemplar authored through the Omnecor Brain authoring pipeline " +
      "(Brains-Upgrade Phase 6). Source of truth: brains/sources/coding.ts.",
  });

  await fsp.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fsp.writeFile(OUT_PATH, authored.buf);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n✅ Coding brain built");
  console.log(`   chunks embedded : ${authored.totalChunks} (raw ${authored.rawChunks}, distilled ${authored.distilledChunks})`);
  console.log(`   provenance      : ${authored.provenanceSource}`);
  console.log(`   pack size       : ${(authored.buf.byteLength / 1024).toFixed(1)} KiB`);
  console.log(`   written to      : ${OUT_PATH}`);
  console.log(`   build time      : ${dt}s`);
}

main().catch(err => {
  console.error("❌ Coding brain build failed:", err);
  process.exit(1);
});
