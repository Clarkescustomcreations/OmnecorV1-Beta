/**
 * @file server/core_services/services/BrainAuthoringService.ts
 * @description Omnecor — Brain Pack authoring / distillation pipeline (Brains-Upgrade Phase 5).
 *
 * Composes the existing ingestion primitives into an end-to-end **build a brain**
 * flow:
 *
 *   sources (pasted text + scraped URLs)
 *     → sanitize untrusted web content
 *     → chunk
 *     → OPTIONAL cloud/local-model synthetic Q&A distillation
 *     → on-device embed (all-MiniLM-L6-v2)
 *     → assemble charter + corpus into a `.obp`
 *     → write to the user brains dir + import (live, queryable)
 *
 * Sovereign posture: the *distillation* step is the only part that can touch a
 * cloud model, so it is gated per-provider via {@link assertProviderAllowedInMode}
 * — an air-gapped user can still author a brain with raw ingestion or a local
 * model, and the resulting pack is 100% local at query time (embeddings are
 * prebuilt on-device and bundled). Provenance is recorded in the manifest.
 */

import fsp from "fs/promises";
import path from "path";
import { ScraperService } from "./ScraperService.js";
import { EmbeddingService } from "./EmbeddingService.js";
import { AiProviderService } from "./AiProviderService.js";
import { PromptSanitizer } from "./PromptSanitizer.js";
import { BrainPackService, type ImportResult } from "./BrainPackService.js";
import { assertProviderAllowedInMode } from "../../_core/sovereign.js";
import { EMBEDDING_CONFIG, BRAINS_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
import { packBrain, type PackChunkInput, type Provenance } from "../brains/obpFormat.js";

const log = createLogger("BrainAuthoring");

// ── Bounds — keep a single build finite (cloud spend, on-device embed time). ──
/** Max source docs per build. */
const MAX_SOURCES = 60;
/** Max characters consumed from any one source (guards a runaway scrape). */
const MAX_SOURCE_CHARS = 500_000;
/** Max total corpus chunks (raw + distilled) in a single pack. */
const MAX_TOTAL_CHUNKS = 4_000;
/** Chunk sizing — mirrors MemoryArchitectService's document chunker. */
const CHUNK_SIZE = 1_500;
const CHUNK_OVERLAP = 200;
/** How many texts to embed per onnxruntime batch (bounds peak memory). */
const EMBED_BATCH = 64;

export interface BrainSource {
  /** Raw pasted text (author-provided; trusted). */
  text?: string;
  /** URL to scrape (untrusted; sanitized before use). */
  url?: string;
  /** Human label recorded in chunk metadata + provenance. */
  name?: string;
}

export interface DistillOptions {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  /** Synthetic Q&A examples to request per source chunk (1–5). */
  maxExamplesPerChunk?: number;
  /** Cap on how many chunks are sent to the model (bounds cloud spend). */
  maxChunks?: number;
  temperature?: number;
}

export interface BuildBrainSpec {
  id: string;
  name: string;
  version?: string;
  domain: string;
  description?: string;
  /** Always-on skills/rules text (prompt-prepended). */
  charter: string;
  sources: BrainSource[];
  /** When set, generate synthetic Q&A from each chunk via a model. */
  distill?: DistillOptions;
  /** Keep the raw source chunks in the corpus (default true). */
  includeRawChunks?: boolean;
  license?: string;
  notes?: string;
}

export interface BuildBrainResult {
  brainId: string;
  /** Where the `.obp` was written on disk. */
  filePath: string;
  bytes: number;
  rawChunks: number;
  distilledChunks: number;
  totalChunks: number;
  embedderMatch: boolean;
  distillProvider?: string;
  /** URLs that failed to scrape (build continues without them). */
  scrapeFailures: string[];
  import: ImportResult;
}

/** The output of {@link BrainAuthoringService.authorPack} — a portable `.obp`
 *  buffer plus build stats, with no persistence/import side effects. */
export interface AuthoredPack {
  buf: Buffer;
  rawChunks: number;
  distilledChunks: number;
  totalChunks: number;
  /** Provenance source classification recorded in the manifest. */
  provenanceSource: Provenance["source"];
  /** URLs that failed to scrape (build continues without them). */
  scrapeFailures: string[];
}

interface SourceDoc {
  name: string;
  uri: string;
  text: string;
}

interface StagedChunk {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

/** Local copy of MemoryArchitect's boundary-aware chunker (kept dep-free here). */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return text.trim() ? [text] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastNewline = slice.lastIndexOf("\n");
      const lastPeriod = slice.lastIndexOf(". ");
      if (lastNewline > CHUNK_SIZE * 0.5) end = start + lastNewline + 1;
      else if (lastPeriod > CHUNK_SIZE * 0.5) end = start + lastPeriod + 2;
    }
    chunks.push(text.slice(start, Math.min(end, text.length)));
    start = end - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }
  return chunks;
}

/** Strip a fenced code block + parse a JSON array of objects (tolerant). */
function parseJsonArray(text: string): Array<Record<string, unknown>> {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "").trim();
  }
  const parsed = JSON.parse(cleaned);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

export class BrainAuthoringService {
  private static instance: BrainAuthoringService | null = null;

  static getInstance(): BrainAuthoringService {
    if (!BrainAuthoringService.instance) BrainAuthoringService.instance = new BrainAuthoringService();
    return BrainAuthoringService.instance;
  }

  /**
   * Author a `.obp` Brain Pack buffer from sources — gather → sanitize → chunk →
   * (optional) distill → on-device embed → pack — with **no persistence or import
   * side effects**. `executionMode` gates the (optional) distillation model;
   * everything else is local. Used both by {@link build} (which then writes +
   * imports the pack live) and by the built-in pack build script (which writes
   * the buffer straight into the in-repo `brains/` directory).
   */
  async authorPack(spec: BuildBrainSpec, executionMode?: string): Promise<AuthoredPack> {
    if (!spec.id?.trim() || !spec.name?.trim() || !spec.domain?.trim()) {
      throw new Error("Brain build requires id, name, and domain");
    }
    if (!spec.charter?.trim() && (!spec.sources || spec.sources.length === 0)) {
      throw new Error("Brain build requires a charter and/or at least one source");
    }
    const allSources = spec.sources ?? [];
    if (allSources.length > MAX_SOURCES) {
      log.warn("Source list exceeds cap; extra sources ignored", {
        provided: allSources.length,
        cap: MAX_SOURCES,
      });
    }
    const sources = allSources.slice(0, MAX_SOURCES);

    // Fail fast on a Sovereign violation BEFORE any scraping/embedding work.
    if (spec.distill) assertProviderAllowedInMode(spec.distill.providerId, executionMode);

    // ── 1. Gather + sanitize source docs ──────────────────────────────────
    const docs: SourceDoc[] = [];
    const scrapeFailures: string[] = [];
    const sanitizer = PromptSanitizer.getInstance();
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src.url) {
        const res = await ScraperService.getInstance().scrape(src.url);
        if (!res.success || !(res.markdown ?? res.content)) {
          scrapeFailures.push(src.url);
          continue;
        }
        // Web content is untrusted → sanitize before it becomes corpus/distiller input.
        const clean = sanitizer.sanitize(res.markdown ?? res.content).clean.trim();
        if (clean) {
          docs.push({
            name: src.name || res.title || src.url,
            uri: src.url,
            text: clean.slice(0, MAX_SOURCE_CHARS),
          });
        }
      } else if (src.text?.trim()) {
        docs.push({
          name: src.name || `source-${i + 1}`,
          uri: src.name || `text:${i + 1}`,
          text: src.text.slice(0, MAX_SOURCE_CHARS),
        });
      }
    }

    // ── 2. Chunk ──────────────────────────────────────────────────────────
    const includeRaw = spec.includeRawChunks !== false;
    const rawChunks: StagedChunk[] = [];
    const docChunks: Array<{ doc: SourceDoc; chunks: string[] }> = [];
    for (let d = 0; d < docs.length; d++) {
      const doc = docs[d];
      const parts = chunkText(doc.text);
      docChunks.push({ doc, chunks: parts });
      if (includeRaw) {
        for (let c = 0; c < parts.length; c++) {
          rawChunks.push({
            id: `s${d}_r${c}`,
            text: parts[c],
            metadata: { kind: "reference", sourcePath: doc.name, sourceUri: doc.uri, chunkIndex: c },
          });
        }
      }
    }

    // ── 3. Optional distillation (synthetic Q&A) ──────────────────────────
    const distilledChunks: StagedChunk[] = [];
    if (spec.distill) {
      const maxExamples = Math.max(1, Math.min(5, spec.distill.maxExamplesPerChunk ?? 3));
      const maxChunks = Math.max(1, Math.min(500, spec.distill.maxChunks ?? 40));
      let processed = 0;
      let qaSeq = 0;
      outer: for (let d = 0; d < docChunks.length; d++) {
        const { doc, chunks } = docChunks[d];
        for (let c = 0; c < chunks.length; c++) {
          if (processed >= maxChunks) break outer;
          processed++;
          const examples = await this.distillChunk(spec.distill, chunks[c], maxExamples, executionMode);
          for (const ex of examples) {
            const body = ex.input
              ? `Q: ${ex.instruction}\nContext: ${ex.input}\nA: ${ex.output}`
              : `Q: ${ex.instruction}\nA: ${ex.output}`;
            distilledChunks.push({
              id: `s${d}_q${qaSeq++}`,
              text: body,
              metadata: {
                kind: "distilled",
                sourcePath: doc.name,
                sourceUri: doc.uri,
                model: spec.distill.modelId,
              },
            });
          }
        }
      }
    }

    // ── 4. Assemble + embed ───────────────────────────────────────────────
    let staged = [...rawChunks, ...distilledChunks];
    if (staged.length > MAX_TOTAL_CHUNKS) {
      log.warn("Corpus exceeds cap; truncating", { built: staged.length, cap: MAX_TOTAL_CHUNKS });
      staged = staged.slice(0, MAX_TOTAL_CHUNKS);
    }

    const embedder = EmbeddingService.getInstance();
    await embedder.init();
    const packChunks: PackChunkInput[] = [];
    for (let i = 0; i < staged.length; i += EMBED_BATCH) {
      const batch = staged.slice(i, i + EMBED_BATCH);
      const vectors = await embedder.embedBatch(batch.map(s => s.text));
      for (let j = 0; j < batch.length; j++) {
        packChunks.push({
          id: batch[j].id,
          text: batch[j].text,
          metadata: batch[j].metadata,
          embedding: vectors[j],
        });
      }
    }

    // ── 5. Provenance + pack ──────────────────────────────────────────────
    const source: Provenance["source"] =
      distilledChunks.length > 0 && rawChunks.length > 0
        ? "mixed"
        : distilledChunks.length > 0
          ? "distilled"
          : "ingested";
    const buf = packBrain({
      id: spec.id,
      name: spec.name,
      version: spec.version ?? "1.0.0",
      domain: spec.domain,
      description: spec.description,
      embedder: { id: EMBEDDING_CONFIG.modelId, dim: embedder.dimensions },
      charter: spec.charter ?? "",
      chunks: packChunks,
      provenance: {
        source,
        builtBy: "omnecor",
        model: spec.distill?.modelId,
        license: spec.license,
        sources: docs.map(d => d.uri),
        notes: spec.notes,
      },
    });

    return {
      buf,
      rawChunks: rawChunks.length,
      distilledChunks: distilledChunks.length,
      totalChunks: packChunks.length,
      provenanceSource: source,
      scrapeFailures,
    };
  }

  /**
   * Build a `.obp` Brain Pack from sources, embed it on-device, write it to the
   * user brains dir, and import it live. Thin wrapper over {@link authorPack} that
   * adds the persistence + live-import side effects. `executionMode` gates the
   * (optional) distillation model — everything else is local.
   */
  async build(
    userId: number,
    spec: BuildBrainSpec,
    executionMode?: string
  ): Promise<BuildBrainResult> {
    const authored = await this.authorPack(spec, executionMode);

    // ── Persist to disk + import live ─────────────────────────────────────
    await fsp.mkdir(BRAINS_CONFIG.userDir, { recursive: true });
    const safeName = spec.id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "brain";
    const filePath = path.join(BRAINS_CONFIG.userDir, `${safeName}.obp`);
    await fsp.writeFile(filePath, authored.buf);

    const imported = await BrainPackService.getInstance().importFromBuffer(userId, authored.buf);

    log.info("Brain built", {
      brainId: spec.id,
      raw: authored.rawChunks,
      distilled: authored.distilledChunks,
      embedderMatch: imported.embedderMatch,
    });

    return {
      brainId: spec.id,
      filePath,
      bytes: authored.buf.byteLength,
      rawChunks: authored.rawChunks,
      distilledChunks: authored.distilledChunks,
      totalChunks: authored.totalChunks,
      embedderMatch: imported.embedderMatch,
      distillProvider: spec.distill?.providerId,
      scrapeFailures: authored.scrapeFailures,
      import: imported,
    };
  }

  /**
   * Distill one chunk into up to `maxExamples` synthetic instruction examples.
   * Tolerant: a model or parse failure yields no examples (build continues)
   * rather than aborting the whole pack.
   */
  private async distillChunk(
    distill: DistillOptions,
    chunk: string,
    maxExamples: number,
    executionMode?: string
  ): Promise<Array<{ instruction: string; input: string | null; output: string }>> {
    const systemPrompt = `You are an expert knowledge engineer building a curated reference "brain" for a small local AI model. From the provided source text, extract up to ${maxExamples} high-quality, self-contained instruction examples that capture its durable knowledge.

Output ONLY a valid JSON array of objects — no prose, no markdown fences. Each object must have exactly:
- "instruction": a clear question or task a user might ask.
- "input": optional supporting context (use "" when not needed).
- "output": a complete, accurate answer grounded ONLY in the source text.

If the text contains no useful knowledge, output [].`;

    try {
      const raw = await AiProviderService.getInstance().chat({
        providerId: distill.providerId,
        modelId: distill.modelId,
        apiKey: distill.apiKey,
        baseUrl: distill.baseUrl,
        systemPrompt,
        messages: [{ role: "user", content: `Source text:\n${chunk}\n\nJSON output:` }],
        maxTokens: 1200,
        temperature: distill.temperature ?? 0.2,
        executionMode,
      });
      const out: Array<{ instruction: string; input: string | null; output: string }> = [];
      for (const ex of parseJsonArray(raw)) {
        const instruction = typeof ex.instruction === "string" ? ex.instruction.trim() : "";
        const output = typeof ex.output === "string" ? ex.output.trim() : "";
        if (!instruction || !output) continue;
        const input = typeof ex.input === "string" && ex.input.trim() ? ex.input.trim() : null;
        out.push({ instruction, input, output });
        if (out.length >= maxExamples) break;
      }
      return out;
    } catch (err) {
      log.warn("Chunk distillation failed (skipping chunk)", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
