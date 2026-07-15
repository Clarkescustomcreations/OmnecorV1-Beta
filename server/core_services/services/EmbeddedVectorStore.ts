/**
 * @file server/core_services/services/EmbeddedVectorStore.ts
 * @description Omnecor — Embedded Vector Store (libSQL native vectors)
 *
 * The DEFAULT semantic-search backend. Stores chunk embeddings as `F32_BLOB`
 * columns in the SAME embedded libSQL/SQLite database the app already uses and
 * queries them with libSQL's native `vector_top_k` / `libsql_vector_idx`
 * (DiskANN) — so semantic retrieval needs ZERO external infrastructure (no
 * ChromaDB container, no Docker) and works fully air-gapped in Sovereign mode.
 * In networked/OMMESH mode the vectors replicate with the rest of the DB for
 * free.
 *
 * Text is embedded on-device via {@link EmbeddingService} (all-MiniLM-L6-v2,
 * 384-dim) — the same model ChromaDB uses by default, so switching backends
 * does not change embedding semantics.
 *
 * Each logical collection is its own table + companion vector index, named from
 * the collection id, mirroring ChromaDB's per-collection isolation. All
 * identifiers are sanitized to `[a-z0-9_]` before being embedded in SQL, and
 * every value is passed as a bound parameter — no SQL injection surface.
 *
 * Implements {@link IVectorStore} so it is a drop-in for VectorDBService; obtain
 * it via {@link getVectorStore}, never directly.
 */

import type { Client } from "@libsql/client";
import { getLibsqlClient } from "../../db.factory.js";
import { EmbeddingService } from "./EmbeddingService.js";
import { EMBEDDING_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
import type { IVectorStore } from "./VectorStore.js";
import type { VectorDocument, SearchResult, VectorDBStatus } from "./VectorDBService.js";

const log = createLogger("EmbeddedVectorStore");

/** Cap on results / neighbours a single query may request. */
const MAX_K = 1000;

export class EmbeddedVectorStore implements IVectorStore {
  private static instance: EmbeddedVectorStore | null = null;
  private readonly embedder: EmbeddingService;
  /** Tables we've already ensured this process, to skip redundant DDL. */
  private readonly ensured = new Set<string>();

  private constructor() {
    this.embedder = EmbeddingService.getInstance();
  }

  static getInstance(): EmbeddedVectorStore {
    if (!EmbeddedVectorStore.instance) {
      EmbeddedVectorStore.instance = new EmbeddedVectorStore();
    }
    return EmbeddedVectorStore.instance;
  }

  /** Kick off embedder load. Never throws — degrades to unavailable. */
  async init(): Promise<void> {
    await this.embedder.init();
  }

  private async client(): Promise<Client> {
    return getLibsqlClient();
  }

  /**
   * Normalize a collection id into a safe SQL identifier. Does NOT add a prefix
   * (callers pass already-namespaced names, e.g. `omnecor_<id>`); it only
   * guarantees the string is a valid, injection-safe identifier.
   */
  private ident(name: string): string {
    let s = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 63);
    if (!/^[a-z_]/.test(s)) s = `c_${s}`.slice(0, 63);
    if (!s) s = "c_default";
    return s;
  }

  private indexName(table: string): string {
    return `${table}_vec_idx`.slice(0, 63);
  }

  /** Serialize a vector for libSQL's `vector32()` constructor. */
  private toVectorArg(vec: number[]): string {
    return `[${vec.join(",")}]`;
  }

  private async ensure(collectionName: string): Promise<string> {
    const table = this.ident(collectionName);
    if (this.ensured.has(table)) return table;
    const client = await this.client();
    const dim = EMBEDDING_CONFIG.dimensions;
    await client.execute(
      `CREATE TABLE IF NOT EXISTS "${table}" (` +
        `doc_id TEXT PRIMARY KEY, ` +
        `text TEXT NOT NULL, ` +
        `metadata TEXT NOT NULL DEFAULT '{}', ` +
        `embedding F32_BLOB(${dim}) NOT NULL)`
    );
    await client.execute(
      `CREATE INDEX IF NOT EXISTS "${this.indexName(table)}" ` +
        `ON "${table}"(libsql_vector_idx(embedding))`
    );
    this.ensured.add(table);
    return table;
  }

  async getStatus(): Promise<VectorDBStatus> {
    try {
      const client = await this.client();
      const res = await client.execute(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%\\_vec\\_idx' ESCAPE '\\'`
      );
      const collections = res.rows.map(r =>
        String(r.name).replace(/_vec_idx$/, "")
      );
      const ready = this.embedder.isReady();
      return {
        isConnected: ready,
        chromaUrl: "libsql://embedded",
        collections,
        error: ready ? null : this.embedder.error ?? "embedding model not loaded",
      };
    } catch (error) {
      return {
        isConnected: false,
        chromaUrl: "libsql://embedded",
        collections: [],
        error: (error as Error).message,
      };
    }
  }

  async getOrCreateCollection(name: string): Promise<string> {
    return this.ensure(name);
  }

  /** True once the on-device embedder is loaded. */
  private async ready(): Promise<boolean> {
    if (!this.embedder.isReady()) await this.embedder.init();
    return this.embedder.isReady();
  }

  async addDocuments(collectionName: string, documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;
    if (!(await this.ready())) {
      log.warn("Skipping ingestion — embedding model not loaded", {
        collection: collectionName,
        error: this.embedder.error,
      });
      return;
    }
    const table = await this.ensure(collectionName);
    const embeddings = await this.embedder.embedBatch(documents.map(d => d.text));
    const client = await this.client();
    const stmts = documents.map((doc, i) => ({
      // INSERT OR REPLACE gives upsert semantics AND keeps the vector index
      // consistent (REPLACE deletes then inserts, firing index maintenance).
      sql:
        `INSERT OR REPLACE INTO "${table}"(doc_id, text, metadata, embedding) ` +
        `VALUES(?, ?, ?, vector32(?))`,
      args: [
        doc.id,
        doc.text,
        JSON.stringify(doc.metadata ?? {}),
        this.toVectorArg(embeddings[i]),
      ] as (string | number)[],
    }));
    await client.batch(stmts, "write");
    log.info("Documents ingested", { count: documents.length, collection: table });
  }

  async addWithEmbeddings(
    collectionName: string,
    documents: string[],
    embeddings: number[][],
    metadatas?: Record<string, unknown>[]
  ): Promise<void> {
    if (documents.length === 0) return;
    const table = await this.ensure(collectionName);
    const client = await this.client();
    const now = Date.now();
    const stmts = documents.map((text, i) => ({
      sql:
        `INSERT OR REPLACE INTO "${table}"(doc_id, text, metadata, embedding) ` +
        `VALUES(?, ?, ?, vector32(?))`,
      args: [
        `${now}_${i}`,
        text,
        JSON.stringify(metadatas?.[i] ?? {}),
        this.toVectorArg(embeddings[i]),
      ] as (string | number)[],
    }));
    await client.batch(stmts, "write");
  }

  async addDocumentsWithEmbeddings(
    collectionName: string,
    documents: Array<{
      id: string;
      text: string;
      metadata: Record<string, unknown>;
      embedding: number[];
    }>
  ): Promise<void> {
    if (documents.length === 0) return;
    const dim = EMBEDDING_CONFIG.dimensions;
    // Guard: a vector of the wrong length would either be rejected by libSQL or
    // silently mis-queried. Refuse loudly so an embedder mismatch is caught at
    // load time, never at query time.
    for (const doc of documents) {
      if (doc.embedding.length !== dim) {
        throw new Error(
          `Embedding dimension mismatch for doc '${doc.id}': expected ${dim}, got ${doc.embedding.length}`
        );
      }
    }
    const table = await this.ensure(collectionName);
    const client = await this.client();
    const stmts = documents.map(doc => ({
      sql:
        `INSERT OR REPLACE INTO "${table}"(doc_id, text, metadata, embedding) ` +
        `VALUES(?, ?, ?, vector32(?))`,
      args: [
        doc.id,
        doc.text,
        JSON.stringify(doc.metadata ?? {}),
        this.toVectorArg(doc.embedding),
      ] as (string | number)[],
    }));
    await client.batch(stmts, "write");
    log.info("Prebuilt-embedding documents ingested", {
      count: documents.length,
      collection: table,
    });
  }

  async upsertDocument(collectionName: string, document: VectorDocument): Promise<void> {
    await this.addDocuments(collectionName, [document]);
  }

  async removeDocument(collectionName: string, documentId: string): Promise<void> {
    const table = this.ident(collectionName);
    try {
      const client = await this.client();
      await client.execute({
        sql: `DELETE FROM "${table}" WHERE doc_id = ?`,
        args: [documentId],
      });
    } catch (error) {
      if (!isNoSuchTable(error)) {
        log.warn("removeDocument failed", { table, error: (error as Error).message });
      }
    }
  }

  async removeDocumentsWhere(
    collectionName: string,
    where: Record<string, string | number | boolean>
  ): Promise<void> {
    const keys = Object.keys(where);
    if (keys.length === 0) return;
    const table = this.ident(collectionName);
    // Metadata keys are internal (e.g. sourceUri, projectId) but validate
    // anyway so a json path can be safely inlined; values stay bound.
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    for (const key of keys) {
      if (!/^[A-Za-z0-9_]+$/.test(key)) {
        throw new Error(`Unsafe metadata key in filter: ${key}`);
      }
      clauses.push(`json_extract(metadata, '$.${key}') = ?`);
      const v = where[key];
      args.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
    try {
      const client = await this.client();
      await client.execute({
        sql: `DELETE FROM "${table}" WHERE ${clauses.join(" AND ")}`,
        args,
      });
    } catch (error) {
      if (!isNoSuchTable(error)) {
        log.warn("removeDocumentsWhere failed", { table, error: (error as Error).message });
      }
    }
  }

  async semanticSearch(
    collectionName: string,
    query: string,
    limit = 5
  ): Promise<SearchResult[]> {
    if (!(await this.ready())) {
      log.warn("Search unavailable — embedding model not loaded", {
        collection: collectionName,
        error: this.embedder.error,
      });
      return [];
    }
    const table = this.ident(collectionName);
    const idx = this.indexName(table);
    const k = Math.max(1, Math.min(MAX_K, Math.floor(limit)));
    const [qVec] = await this.embedder.embedBatch([query]);
    const qArg = this.toVectorArg(qVec);
    try {
      const client = await this.client();
      const res = await client.execute({
        // vector_top_k walks the ANN index for the k nearest rowids; we join
        // back to the table and compute the exact cosine distance for ordering.
        sql:
          `SELECT t.doc_id AS id, t.text AS text, t.metadata AS metadata, ` +
          `vector_distance_cos(t.embedding, vector32(?)) AS dist ` +
          `FROM vector_top_k('${idx}', vector32(?), ${k}) AS k ` +
          `JOIN "${table}" t ON t.rowid = k.id ` +
          `ORDER BY dist ASC`,
        args: [qArg, qArg],
      });
      return res.rows.map(row => ({
        id: String(row.id),
        text: row.text === null ? null : String(row.text),
        metadata: safeParse(row.metadata),
        distance: row.dist === null ? null : Number(row.dist),
      }));
    } catch (error) {
      if (isNoSuchTable(error)) return []; // collection never populated
      throw new Error(
        `[Omnecor EmbeddedVectorStore] Query failed on '${table}': ${(error as Error).message}`
      );
    }
  }

  async deleteCollection(collectionName: string): Promise<void> {
    const table = this.ident(collectionName);
    try {
      const client = await this.client();
      // Drop the index first, then the table (DiskANN shadow tables are tied
      // to the index).
      await client.execute(`DROP INDEX IF EXISTS "${this.indexName(table)}"`);
      await client.execute(`DROP TABLE IF EXISTS "${table}"`);
      this.ensured.delete(table);
      log.info("Collection deleted", { table });
    } catch (error) {
      log.warn("deleteCollection failed", { table, error: (error as Error).message });
    }
  }
}

function isNoSuchTable(error: unknown): boolean {
  return /no such table/i.test((error as Error)?.message ?? "");
}

function safeParse(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
