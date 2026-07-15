/**
 * @file server/core_services/brains/obpFormat.ts
 * @description Omnecor — `.obp` Brain Pack container format (Phase 2).
 *
 * A Brain Pack is a self-contained, portable, model-agnostic knowledge+skill
 * bundle a small local model attaches at inference time. This module defines the
 * on-the-wire `.obp` container and the pure (DB-free, IO-free) pack/unpack +
 * validation logic. Storage (Drizzle tables) and the vector index live in
 * {@link ../services/BrainPackService}.
 *
 * Container layout: an `.obp` file is a **gzip-compressed UTF-8 JSON document**
 * with three parts:
 *   - `manifest` — id, version, domain, embedder id+dim, provenance, charter
 *     hash, chunk count. Everything a receiver needs to decide compatibility
 *     BEFORE trusting the corpus.
 *   - `charter`  — the small always-on skill/rules text (prompt-prepended).
 *   - `chunks`   — the retrieved corpus: stable id + text + metadata + a
 *     **prebuilt** embedding (base64 little-endian Float32), so a pack loads
 *     without re-embedding and works air-gapped.
 *
 * gzip (Node's built-in zlib) keeps the pack a single portable file with zero
 * new dependencies, compresses the repetitive float text well, and is trivially
 * verifiable. Embeddings are stored as base64 F32LE for an exact, compact,
 * round-trippable representation.
 *
 * Integrity is self-describing: unpack re-derives the charter SHA-256 and chunk
 * count and rejects any pack whose manifest disagrees, and rejects any chunk
 * whose embedding length ≠ the manifest's declared dimension. Embedder *match*
 * against the running model is a higher-level concern (see BrainPackService) —
 * this module only guarantees the pack is internally consistent.
 */

import zlib from "zlib";
import crypto from "crypto";
import { z } from "zod";

/** Current `.obp` container format version. Bump on breaking layout changes. */
export const OBP_FORMAT_VERSION = 1;

/** Canonical file extension for a Brain Pack. */
export const OBP_EXTENSION = ".obp";

// ─────────────────────────────────────────────────────────────────────────────
// Embedding (de)serialization — base64 little-endian Float32.
// ─────────────────────────────────────────────────────────────────────────────

/** Encode an embedding vector to a compact base64 little-endian Float32 string. */
export function encodeEmbedding(vec: number[]): string {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString("base64");
}

/**
 * Decode a base64 F32LE embedding back to a number[]. Throws if the byte length
 * isn't a whole number of floats, or (when `expectedDim` is given) if the
 * decoded length disagrees — a corrupt or dimension-mismatched vector must fail
 * loudly, never be silently truncated or mis-queried.
 */
export function decodeEmbedding(b64: string, expectedDim?: number): number[] {
  const buf = Buffer.from(b64, "base64");
  if (buf.byteLength % 4 !== 0) {
    throw new Error(`Invalid embedding blob: ${buf.byteLength} bytes is not a multiple of 4`);
  }
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const out = Array.from(f32);
  if (expectedDim !== undefined && out.length !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: blob decodes to ${out.length}, expected ${expectedDim}`
    );
  }
  return out;
}

/** Stable SHA-256 of the charter text — pins the always-on guidance to the manifest. */
export function computeCharterHash(charter: string): string {
  return crypto.createHash("sha256").update(charter, "utf-8").digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Where a pack (or a chunk's knowledge) came from — recorded for auditability. */
export const provenanceSchema = z
  .object({
    /** How the corpus was produced. */
    source: z
      .enum(["curated", "distilled", "ingested", "imported", "mixed"])
      .default("curated"),
    /** Who/what built it (tool, user, node). */
    builtBy: z.string().default("omnecor"),
    /** ISO timestamp of the build. */
    builtAt: z.string().default(() => new Date().toISOString()),
    /** Cloud model used for distillation, if any (informational). */
    model: z.string().optional(),
    /** License of the bundled content. */
    license: z.string().optional(),
    /** Source URIs the corpus was derived from. */
    sources: z.array(z.string()).optional(),
    /** Free-form notes. */
    notes: z.string().optional(),
  })
  .passthrough();

export type Provenance = z.infer<typeof provenanceSchema>;

/** The embedder a pack's vectors were produced with — the compatibility key. */
export const embedderRefSchema = z.object({
  /** Model identifier, e.g. "all-MiniLM-L6-v2". */
  id: z.string().min(1),
  /** Embedding dimensionality, e.g. 384. */
  dim: z.number().int().positive(),
});

export type EmbedderRef = z.infer<typeof embedderRefSchema>;

export const manifestSchema = z.object({
  /** Container format version. */
  formatVersion: z.literal(OBP_FORMAT_VERSION),
  /** Stable pack id (slug or UUID). Re-import with the same id replaces. */
  id: z.string().min(1).max(128),
  /** Human-readable name. */
  name: z.string().min(1).max(200),
  /** Pack content version (author-assigned, e.g. "1.0.0"). */
  version: z.string().min(1).max(64),
  /** Domain tag used for Valet routing (e.g. "coding", "legal"). */
  domain: z.string().min(1).max(64),
  /** Short description. */
  description: z.string().max(2000).default(""),
  /** The embedder the corpus vectors were built with. */
  embedder: embedderRefSchema,
  /** SHA-256 of the charter text (integrity + tamper check). */
  charterSha256: z.string().length(64),
  /** Number of corpus chunks (must equal chunks.length on unpack). */
  chunkCount: z.number().int().nonnegative(),
  /** ISO timestamp the pack was created. */
  createdAt: z.string().default(() => new Date().toISOString()),
  /** Provenance record. */
  provenance: provenanceSchema,
});

export type BrainManifest = z.infer<typeof manifestSchema>;

export const chunkSchema = z.object({
  /** Stable id within the pack — used as the vector store doc_id (idempotent). */
  id: z.string().min(1).max(200),
  /** The chunk text. */
  text: z.string(),
  /** Arbitrary metadata (source path, section, etc.). */
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** Prebuilt embedding, base64 little-endian Float32. */
  embedding: z.string().min(1),
});

export type BrainChunk = z.infer<typeof chunkSchema>;

export const brainPackSchema = z.object({
  manifest: manifestSchema,
  charter: z.string(),
  chunks: z.array(chunkSchema),
});

export type BrainPack = z.infer<typeof brainPackSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pack / unpack
// ─────────────────────────────────────────────────────────────────────────────

/** Chunk input for {@link packBrain} — embeddings are raw vectors, encoded here. */
export interface PackChunkInput {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  embedding: number[];
}

/** Everything needed to build a `.obp`. Hash + count + formatVersion are derived. */
export interface PackBrainInput {
  id: string;
  name: string;
  version: string;
  domain: string;
  description?: string;
  embedder: EmbedderRef;
  charter: string;
  chunks: PackChunkInput[];
  provenance?: Partial<Provenance>;
  createdAt?: string;
}

/**
 * Build a validated `.obp` buffer from raw inputs. Derives the charter hash and
 * chunk count, encodes embeddings, validates every chunk's dimension against the
 * declared embedder, and gzips the result. Throws on any inconsistency.
 */
export function packBrain(input: PackBrainInput): Buffer {
  const charter = input.charter ?? "";
  const chunks: BrainChunk[] = input.chunks.map(c => {
    if (c.embedding.length !== input.embedder.dim) {
      throw new Error(
        `Chunk '${c.id}' embedding has ${c.embedding.length} dims, ` +
          `expected ${input.embedder.dim} (embedder '${input.embedder.id}')`
      );
    }
    return {
      id: c.id,
      text: c.text,
      metadata: c.metadata ?? {},
      embedding: encodeEmbedding(c.embedding),
    };
  });

  const manifest: BrainManifest = manifestSchema.parse({
    formatVersion: OBP_FORMAT_VERSION,
    id: input.id,
    name: input.name,
    version: input.version,
    domain: input.domain,
    description: input.description ?? "",
    embedder: input.embedder,
    charterSha256: computeCharterHash(charter),
    chunkCount: chunks.length,
    createdAt: input.createdAt ?? new Date().toISOString(),
    provenance: provenanceSchema.parse(input.provenance ?? {}),
  });

  const pack: BrainPack = { manifest, charter, chunks };
  const json = JSON.stringify(pack);
  return zlib.gzipSync(Buffer.from(json, "utf-8"));
}

/**
 * Parse + validate a `.obp` buffer into a {@link BrainPack}. Verifies the gzip
 * decodes, the JSON matches the schema, the charter hash and chunk count agree
 * with the manifest, and every chunk embedding decodes to the declared
 * dimension. Any failure throws — a malformed pack is never partially imported.
 */
export function unpackBrain(buf: Buffer): BrainPack {
  let json: string;
  try {
    json = zlib.gunzipSync(buf).toString("utf-8");
  } catch (err) {
    throw new Error(
      `Not a valid .obp file (gzip decode failed): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Corrupt .obp file (JSON parse failed): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsed = brainPackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid Brain Pack: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const pack = parsed.data;

  // Cross-field integrity (schema can't express these).
  const expectHash = computeCharterHash(pack.charter);
  if (expectHash !== pack.manifest.charterSha256) {
    throw new Error(
      `Charter hash mismatch: manifest says ${pack.manifest.charterSha256}, computed ${expectHash} (tampered or corrupt pack)`
    );
  }
  if (pack.chunks.length !== pack.manifest.chunkCount) {
    throw new Error(
      `Chunk count mismatch: manifest says ${pack.manifest.chunkCount}, pack has ${pack.chunks.length}`
    );
  }
  // Validate each embedding decodes to the declared dimension.
  for (const chunk of pack.chunks) {
    decodeEmbedding(chunk.embedding, pack.manifest.embedder.dim);
  }

  return pack;
}

/** Decode a pack chunk's embedding to a number[] at the manifest dimension. */
export function chunkEmbedding(pack: BrainPack, chunk: BrainChunk): number[] {
  return decodeEmbedding(chunk.embedding, pack.manifest.embedder.dim);
}
