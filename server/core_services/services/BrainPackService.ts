/**
 * @file server/core_services/services/BrainPackService.ts
 * @description Omnecor — Brain Pack storage + loader/validator (Brains-Upgrade Phase 2).
 *
 * Owns the lifecycle of portable `.obp` Brain Packs once they reach the app:
 * import (validate → embedder-match check → persist → load corpus vectors),
 * list/get/stats, delete (cascade + drop the vector collection), export (round-
 * trip back to `.obp`), and rebuild (re-derive the vector index from the durable
 * chunk store, e.g. after a vector-backend switch).
 *
 * Durability contract (AGENTS.md "Operational Memory Never Escapes"): the corpus
 * source of truth is the `brain_chunks` table (text + metadata + prebuilt
 * embedding). The pluggable vector store holds a queryable *index* built from it,
 * so a restart, backend switch, or reinstall can always rebuild retrieval without
 * the original `.obp`.
 *
 * Embedder safety: a pack whose embedder id/dim doesn't match the running
 * embedder is imported and persisted (its charter is embedder-independent and
 * still useful) but its corpus is NOT loaded into the vector index — it would be
 * mis-queried. Such a brain is flagged `incompatible`, never silently wrong.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db.factory.js";
import { brains, brainChunks, type BrainRow } from "../../../drizzle/schema.js";
import { getVectorStore } from "./VectorStore.js";
import { ValetRouterService, type ExecutionMode } from "./ValetRouterService.js";
import { EMBEDDING_CONFIG, BRAINS_CONFIG } from "../config/index.js";
import { validatePath } from "../../_core/security.js";
import { createLogger } from "../../_core/logger.js";
import {
  unpackBrain,
  packBrain,
  decodeEmbedding,
  OBP_EXTENSION,
  type BrainPack,
} from "../brains/obpFormat.js";

const log = createLogger("BrainPackService");

/** How many chunk rows to insert per statement (keeps well under SQLite's var cap). */
const CHUNK_INSERT_BATCH = 400;

/** Common English suffixes, longest-first, for the tiny stemmer below. */
const STEM_SUFFIXES = ["ization", "ational", "ation", "ings", "ing", "ers", "er", "tion", "ies", "ed", "es", "s", "e"];

/**
 * Split text into words and light-stem each (min stem length 3) so category
 * labels and brain labels align across linguistic variants — "code"/"coding",
 * "generation"/"generate" collapse to a shared stem. Deliberately tiny (no
 * Porter dependency): alignment is only a soft bonus over corpus relevance.
 */
function tokenStems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3)
    .map(w => {
      for (const suf of STEM_SUFFIXES) {
        if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
      }
      return w;
    });
}

export interface ImportResult {
  brain: BrainRow;
  /** Whether the pack's embedder matched the running one (corpus queryable). */
  embedderMatch: boolean;
  chunksStored: number;
  /** Chunks loaded into the vector index (0 when embedder-incompatible). */
  vectorsLoaded: number;
}

/** One Valet-proposed brain for a task, ranked and explained (Phase 4). */
export interface BrainSuggestion {
  brainId: string;
  name: string;
  domain: string;
  status: BrainRow["status"];
  /** Combined 0..1 confidence this brain helps the task. */
  score: number;
  /** Best cosine similarity (0..1) of the task against this brain's corpus, or
   *  null when the brain isn't queryable (incompatible / no vectors). */
  relevance: number | null;
  /** Whether the domain/label aligned with the classified task category. */
  domainAligned: boolean;
  /** Human-readable justification shown next to the confirmable suggestion. */
  reason: string;
}

export interface BrainSuggestResult {
  /** Valet's task classification (or the static fallback when it's offline). */
  category: string;
  confidence: number;
  reasoning: string;
  /** Whether the live Valet Router answered (vs. the static fallback). */
  valetOnline: boolean;
  suggestions: BrainSuggestion[];
}

export class BrainPackService {
  private static instance: BrainPackService | null = null;

  private constructor() {}

  static getInstance(): BrainPackService {
    if (!BrainPackService.instance) BrainPackService.instance = new BrainPackService();
    return BrainPackService.instance;
  }

  /** Vector store collection name for a brain's corpus. */
  private collectionName(brainId: string): string {
    const safe = brainId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 50);
    return `brain_${safe}`;
  }

  /** Does a pack's embedder match the running on-device embedder? */
  private isEmbedderMatch(pack: BrainPack): boolean {
    return (
      pack.manifest.embedder.id === EMBEDDING_CONFIG.modelId &&
      pack.manifest.embedder.dim === EMBEDDING_CONFIG.dimensions
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Import
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Import a `.obp` from a raw buffer. Validates the pack's internal integrity,
   * decides embedder compatibility, then atomically (from the caller's view)
   * replaces any existing brain with the same id owned by this user: the old
   * vector collection is dropped and the row cascade-deleted before the new one
   * is written.
   *
   * @throws if the buffer is not a valid pack, exceeds the size cap, or the pack
   *         id already belongs to a *different* user.
   */
  async importFromBuffer(
    userId: number,
    buf: Buffer,
    opts: { builtin?: boolean } = {}
  ): Promise<ImportResult> {
    if (buf.byteLength > BRAINS_CONFIG.maxPackBytes) {
      throw new Error(
        `Brain Pack is ${buf.byteLength} bytes, exceeds the ${BRAINS_CONFIG.maxPackBytes}-byte limit`
      );
    }

    const pack = unpackBrain(buf); // validates or throws
    const brainId = pack.manifest.id;
    const db = await getDb();

    // Ownership guard: the pack id is the primary key, so refuse to clobber
    // another user's brain of the same id.
    const existing = await db
      .select({ userId: brains.userId })
      .from(brains)
      .where(eq(brains.id, brainId))
      .limit(1);
    if (existing[0] && existing[0].userId !== userId) {
      throw new Error(`Brain '${brainId}' already exists and belongs to another user`);
    }

    const collection = this.collectionName(brainId);
    const store = getVectorStore();

    // Replace any prior copy: drop its vector index, then cascade-delete the row.
    if (existing[0]) {
      await store.deleteCollection(collection).catch(err =>
        log.warn("Failed to drop old collection during re-import", {
          brainId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      await db.delete(brains).where(eq(brains.id, brainId));
    }

    const match = this.isEmbedderMatch(pack);
    const status: BrainRow["status"] = match ? "ready" : "incompatible";

    // Persist the brain row.
    await db.insert(brains).values({
      id: brainId,
      userId,
      name: pack.manifest.name,
      version: pack.manifest.version,
      domain: pack.manifest.domain,
      description: pack.manifest.description,
      charter: pack.charter,
      charterSha256: pack.manifest.charterSha256,
      embedderId: pack.manifest.embedder.id,
      embedderDim: pack.manifest.embedder.dim,
      embedderMatch: match ? 1 : 0,
      status,
      collectionName: collection,
      chunkCount: pack.chunks.length,
      provenance: pack.manifest.provenance,
      builtin: opts.builtin ? 1 : 0,
    });

    try {
      // Persist chunks (durable source of truth) in batches.
      for (let i = 0; i < pack.chunks.length; i += CHUNK_INSERT_BATCH) {
        const slice = pack.chunks.slice(i, i + CHUNK_INSERT_BATCH);
        await db.insert(brainChunks).values(
          slice.map(c => ({
            brainId,
            chunkId: c.id,
            text: c.text,
            metadata: c.metadata,
            embedding: c.embedding, // stored as base64 F32LE, as-is
          }))
        );
      }

      // Load the corpus into the vector index — only when the embedder matches.
      let vectorsLoaded = 0;
      if (match && pack.chunks.length > 0) {
        vectorsLoaded = await this.loadVectors(collection, pack);
      } else if (!match) {
        log.warn("Brain imported as incompatible — corpus not indexed", {
          brainId,
          packEmbedder: `${pack.manifest.embedder.id}/${pack.manifest.embedder.dim}`,
          running: `${EMBEDDING_CONFIG.modelId}/${EMBEDDING_CONFIG.dimensions}`,
        });
      }

      const [row] = await db.select().from(brains).where(eq(brains.id, brainId)).limit(1);
      log.info("Brain Pack imported", { brainId, match, chunks: pack.chunks.length, vectorsLoaded });
      return { brain: row, embedderMatch: match, chunksStored: pack.chunks.length, vectorsLoaded };
    } catch (err) {
      // Roll back everything so a failed import never leaves a half-loaded brain.
      await db.delete(brains).where(eq(brains.id, brainId)).catch(() => {});
      await store.deleteCollection(collection).catch(() => {});
      throw err;
    }
  }

  /** Decode a pack's chunk embeddings and bulk-load them into the vector index. */
  private async loadVectors(collection: string, pack: BrainPack): Promise<number> {
    const store = getVectorStore();
    await store.getOrCreateCollection(collection);
    const docs = pack.chunks.map(c => ({
      id: c.id,
      text: c.text,
      metadata: c.metadata,
      embedding: decodeEmbedding(c.embedding, pack.manifest.embedder.dim),
    }));
    await store.addDocumentsWithEmbeddings(collection, docs);
    return docs.length;
  }

  /**
   * Import a `.obp` from a file path. User-supplied paths are validated; paths
   * inside the trusted built-in/user brain dirs are read directly.
   */
  async importFromFile(
    userId: number,
    filePath: string,
    opts: { builtin?: boolean; trusted?: boolean } = {}
  ): Promise<ImportResult> {
    const resolved = opts.trusted ? path.resolve(filePath) : await validatePath(filePath);
    const buf = await fsp.readFile(resolved);
    return this.importFromBuffer(userId, buf, { builtin: opts.builtin });
  }

  /**
   * Import every built-in `.obp` shipped in the repo that isn't already present
   * for this user. Idempotent; safe to call on boot. Returns the ids imported.
   */
  async importBuiltins(userId: number): Promise<string[]> {
    const dir = BRAINS_CONFIG.builtinDir;
    if (!fs.existsSync(dir)) return [];
    const files = (await fsp.readdir(dir)).filter(f => f.endsWith(OBP_EXTENSION));
    const imported: string[] = [];
    for (const file of files) {
      try {
        const res = await this.importFromFile(userId, path.join(dir, file), {
          builtin: true,
          trusted: true,
        });
        imported.push(res.brain.id);
      } catch (err) {
        log.warn("Failed to import built-in brain", {
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return imported;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Read
  // ───────────────────────────────────────────────────────────────────────────

  /** List this user's brains (metadata only, no corpus). */
  async list(userId: number): Promise<BrainRow[]> {
    const db = await getDb();
    return db.select().from(brains).where(eq(brains.userId, userId));
  }

  /** Get one brain owned by this user, or null. */
  async get(userId: number, brainId: string): Promise<BrainRow | null> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(brains)
      .where(and(eq(brains.id, brainId), eq(brains.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Stats for a brain: persisted chunk count, indexed status, embedder match. */
  async stats(userId: number, brainId: string): Promise<{
    brainId: string;
    name: string;
    domain: string;
    status: BrainRow["status"];
    embedderMatch: boolean;
    chunkCount: number;
    indexedCount: number;
  } | null> {
    const db = await getDb();
    const brain = await this.get(userId, brainId);
    if (!brain) return null;
    const rows = await db
      .select({ chunkId: brainChunks.chunkId })
      .from(brainChunks)
      .where(eq(brainChunks.brainId, brainId));
    return {
      brainId,
      name: brain.name,
      domain: brain.domain,
      status: brain.status,
      embedderMatch: brain.embedderMatch === 1,
      chunkCount: brain.chunkCount,
      indexedCount: brain.embedderMatch === 1 ? rows.length : 0,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Suggest (Valet auto-routing)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Propose which of the user's brains best fit a task (Brains-Upgrade Phase 4).
   *
   * Two independent, complementary signals are combined:
   *   1. **Corpus relevance** (the strong signal) — the task is run against each
   *      *queryable* brain's vector index; the best cosine similarity says how
   *      much that brain actually knows about the task. Runs fully locally, so it
   *      works air-gapped.
   *   2. **Category alignment** (the label signal) — the Valet Router classifies
   *      the task into a category; a brain whose domain/name matches that category
   *      gets a bonus (and it's the only signal available for incompatible,
   *      charter-only brains, which have no vectors to query).
   *
   * The result is a ranked, *confirmable* suggestion set — never auto-attached.
   * If Valet is offline, semantic relevance still drives useful suggestions.
   */
  async suggest(
    userId: number,
    task: string,
    opts: { limit?: number; minScore?: number; executionMode?: ExecutionMode } = {}
  ): Promise<BrainSuggestResult> {
    const limit = Math.max(1, Math.min(10, opts.limit ?? 3));
    const minScore = opts.minScore ?? 0.3;
    const query = task.trim();

    const owned = await this.list(userId);

    // Classify the task (best-effort; falls back to a static category offline).
    const valet = ValetRouterService.getInstance();
    const valetOnline = await valet.isAvailable();
    const decision = await valet.route({
      task: query,
      taskType: "router",
      executionMode: opts.executionMode,
      availableProviders: [],
    });

    if (owned.length === 0 || !query) {
      return {
        category: decision.category,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        valetOnline,
        suggestions: [],
      };
    }

    // Category tokens (e.g. "code_generation" → ["code", "generation"]),
    // light-stemmed so linguistic variants align ("code" ↔ "coding",
    // "generation" ↔ "generate"). Short tokens are dropped to avoid noise.
    const categoryStems = new Set(tokenStems(decision.category));

    const store = getVectorStore();
    let storeReady = true;
    await store.init().catch(() => {
      storeReady = false; // degrade to label-only scoring if the index is down
    });

    const scored = await Promise.all(
      owned.map(async (brain): Promise<BrainSuggestion> => {
        // Stemmed token-set overlap between the classified category and the
        // brain's own labels (domain + name + description).
        const brainStems = new Set(
          tokenStems(`${brain.domain} ${brain.name} ${brain.description ?? ""}`)
        );
        const domainAligned = [...categoryStems].some(s => brainStems.has(s));

        // Corpus relevance — queryable brains only.
        let relevance: number | null = null;
        const queryable = brain.embedderMatch === 1 && brain.status === "ready" && brain.chunkCount > 0;
        if (queryable && storeReady) {
          try {
            const hits = await store.semanticSearch(brain.collectionName, query, 3);
            const best = hits
              .map(h => h.distance)
              .filter((d): d is number => typeof d === "number");
            if (best.length > 0) {
              // Cosine distance (0 = identical) → similarity in [0, 1].
              relevance = Math.max(0, Math.min(1, 1 - Math.min(...best)));
            } else {
              relevance = 0;
            }
          } catch (err) {
            log.warn("Brain suggest retrieval failed", {
              brainId: brain.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Combine. Relevance dominates when available; otherwise a charter-only
        // brain can still be proposed on domain alignment alone.
        const score =
          relevance !== null
            ? 0.75 * relevance + 0.25 * (domainAligned ? 1 : 0)
            : domainAligned
              ? 0.4
              : 0.12;

        const reasonParts: string[] = [];
        if (relevance !== null) reasonParts.push(`corpus relevance ${(relevance * 100).toFixed(0)}%`);
        if (domainAligned) reasonParts.push(`domain '${brain.domain}' aligns with ${decision.category}`);
        if (relevance === null && !domainAligned) reasonParts.push("charter may add general guidance");

        return {
          brainId: brain.id,
          name: brain.name,
          domain: brain.domain,
          status: brain.status,
          score,
          relevance,
          domainAligned,
          reason: reasonParts.join("; "),
        };
      })
    );

    const suggestions = scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      category: decision.category,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      valetOnline,
      suggestions,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Delete
  // ───────────────────────────────────────────────────────────────────────────

  /** Delete a brain: drop its vector collection and cascade-delete its rows. */
  async delete(userId: number, brainId: string): Promise<boolean> {
    const db = await getDb();
    const brain = await this.get(userId, brainId);
    if (!brain) return false;
    await getVectorStore()
      .deleteCollection(brain.collectionName)
      .catch(err =>
        log.warn("Failed to drop collection on delete", {
          brainId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    await db.delete(brains).where(eq(brains.id, brainId)); // cascade → brain_chunks
    log.info("Brain deleted", { brainId });
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Export / rebuild
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Re-serialize a stored brain back into a `.obp` buffer from the durable chunk
   * store — a lossless round-trip that lets a user re-export or sync a brain.
   */
  async export(userId: number, brainId: string): Promise<Buffer> {
    const db = await getDb();
    const brain = await this.get(userId, brainId);
    if (!brain) throw new Error(`Brain '${brainId}' not found`);
    const rows = await db
      .select()
      .from(brainChunks)
      .where(eq(brainChunks.brainId, brainId));
    return packBrain({
      id: brain.id,
      name: brain.name,
      version: brain.version,
      domain: brain.domain,
      description: brain.description,
      embedder: { id: brain.embedderId, dim: brain.embedderDim },
      charter: brain.charter,
      provenance: brain.provenance ?? undefined,
      createdAt: brain.createdAt.toISOString(),
      chunks: rows.map(r => ({
        id: r.chunkId,
        text: r.text,
        metadata: r.metadata ?? {},
        // Decode the stored base64 blob back to a vector for packBrain to re-encode.
        embedding: decodeEmbedding(r.embedding, brain.embedderDim),
      })),
    });
  }

  /**
   * Rebuild a brain's vector index from its durable chunk store. Re-evaluates
   * embedder compatibility against the running embedder (which may have changed)
   * and updates the brain's status accordingly. Used after a vector-backend
   * switch or when a previously-incompatible brain becomes loadable.
   */
  async rebuildIndex(userId: number, brainId: string): Promise<{ status: BrainRow["status"]; vectorsLoaded: number }> {
    const db = await getDb();
    const brain = await this.get(userId, brainId);
    if (!brain) throw new Error(`Brain '${brainId}' not found`);

    const match =
      brain.embedderId === EMBEDDING_CONFIG.modelId &&
      brain.embedderDim === EMBEDDING_CONFIG.dimensions;
    const store = getVectorStore();

    // Always start from a clean collection.
    await store.deleteCollection(brain.collectionName).catch(() => {});

    let vectorsLoaded = 0;
    if (match) {
      const rows = await db
        .select()
        .from(brainChunks)
        .where(eq(brainChunks.brainId, brainId));
      if (rows.length > 0) {
        await store.getOrCreateCollection(brain.collectionName);
        await store.addDocumentsWithEmbeddings(
          brain.collectionName,
          rows.map(r => ({
            id: r.chunkId,
            text: r.text,
            metadata: r.metadata ?? {},
            embedding: decodeEmbedding(r.embedding, brain.embedderDim),
          }))
        );
        vectorsLoaded = rows.length;
      }
    }

    const status: BrainRow["status"] = match ? "ready" : "incompatible";
    await db
      .update(brains)
      .set({ embedderMatch: match ? 1 : 0, status })
      .where(eq(brains.id, brainId));
    return { status, vectorsLoaded };
  }
}
