/**
 * @file server/scripts/buildBrains.ts
 * @description Build the built-in "Team of Experts" Brain Packs
 * (Brains-Upgrade Phase 6) from their reviewable TS sources.
 *
 * Runs each curated charter + corpus (brains/sources/<slug>.ts, registered in
 * brains/sources/index.ts) through the REAL authoring pipeline
 * ({@link BrainAuthoringService.authorPack}: chunk → on-device embed
 * (all-MiniLM-L6-v2) → pack) and writes the portable `.obp` to the in-repo
 * built-in directory (brains/<slug>.obp). No DB, no cloud, no distillation —
 * a fully local, air-gappable build. Deterministic given source + embedder.
 *
 *   pnpm brains:build:all           # build every registered brain
 *   pnpm brains:build:all coding    # build only the given slug(s)
 *
 * Rebuild whenever a brains/sources/*.ts changes.
 */

import { config } from "dotenv";
config();

import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { BrainAuthoringService, type BrainSource } from "../core_services/services/BrainAuthoringService.js";
import { BRAIN_MODULES } from "../../brains/sources/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../brains");

const LICENSE = "CC0-1.0 (original content, public domain dedication)";

async function main() {
  const only = process.argv.slice(2).map(s => s.trim()).filter(Boolean);
  const modules = only.length ? BRAIN_MODULES.filter(m => only.includes(m.slug)) : BRAIN_MODULES;

  if (!modules.length) {
    console.error(`No matching brains for: ${only.join(", ")}. Known slugs: ${BRAIN_MODULES.map(m => m.slug).join(", ")}`);
    process.exit(1);
  }

  await fsp.mkdir(OUT_DIR, { recursive: true });
  const authoring = BrainAuthoringService.getInstance();
  const summary: Array<{ slug: string; chunks: number; kib: string }> = [];

  for (const m of modules) {
    const sources: BrainSource[] = m.sources.map(s => ({ name: s.name, text: s.text }));
    console.log("\n==========================================");
    console.log(`🧠 Building built-in brain: ${m.name} (${m.slug})`);
    console.log(`   charter: ${m.charter.length} chars   sources: ${sources.length} curated facts`);
    console.log("   embedding on-device (all-MiniLM-L6-v2)…");

    const t0 = Date.now();
    const authored = await authoring.authorPack({
      id: m.id,
      name: m.name,
      version: "1.0.0",
      domain: m.domain,
      description: m.description,
      charter: m.charter,
      sources,
      includeRawChunks: true,
      license: LICENSE,
      notes:
        "Built-in Team-of-Experts brain authored through the Omnecor Brain authoring " +
        `pipeline (Brains-Upgrade Phase 6). Source of truth: brains/sources/${m.slug}.ts.`,
    });

    const outPath = path.join(OUT_DIR, `${m.slug}.obp`);
    await fsp.writeFile(outPath, authored.buf);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const kib = (authored.buf.byteLength / 1024).toFixed(1);
    console.log(`✅ ${m.slug}: ${authored.totalChunks} chunks, ${kib} KiB, ${dt}s → ${outPath}`);
    summary.push({ slug: m.slug, chunks: authored.totalChunks, kib });
  }

  console.log("\n==========================================");
  console.log("🏁 Build complete");
  for (const s of summary) console.log(`   ${s.slug.padEnd(22)} ${String(s.chunks).padStart(3)} chunks   ${s.kib} KiB`);
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Brain build failed:", err);
  process.exit(1);
});
