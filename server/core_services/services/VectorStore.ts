/**
 * @file server/core_services/services/VectorStore.ts
 * @description Omnecor — Vector store abstraction + backend selector.
 *
 * Omnecor has two interchangeable semantic-search backends behind one
 * interface, so every writer AND reader shares a single backend (no split-brain
 * between a writer on one store and a reader on another):
 *
 *   - EmbeddedVectorStore (DEFAULT) — libSQL native vectors in the same
 *     embedded DB. Zero external infra; works air-gapped in Sovereign mode.
 *   - VectorDBService — ChromaDB (optional scale-up; requires the container).
 *
 * Selection is explicit via OMNECOR_VECTOR_BACKEND (`embedded` | `chroma`),
 * defaulting to `embedded`. Consumers must obtain the store through
 * {@link getVectorStore} rather than importing a concrete class, so the whole
 * app stays on one backend.
 */

import type {
  VectorDocument,
  SearchResult,
  VectorDBStatus,
} from "./VectorDBService.js";
import { VectorDBService } from "./VectorDBService.js";
import { EmbeddedVectorStore } from "./EmbeddedVectorStore.js";

export type { VectorDocument, SearchResult, VectorDBStatus };

/**
 * The semantic-search surface shared by every backend. Matches the historical
 * VectorDBService API so existing callers work unchanged regardless of backend.
 */
export interface IVectorStore {
  /** Connect / load. Safe to call repeatedly; never throws (degrades). */
  init(): Promise<void>;
  /** Health + collection listing for UI indicators. */
  getStatus(): Promise<VectorDBStatus>;
  /** Ensure a collection exists (idempotent). */
  getOrCreateCollection(name: string): Promise<unknown>;
  /** Ingest documents (text is embedded by the backend). */
  addDocuments(collectionName: string, documents: VectorDocument[]): Promise<void>;
  /** Ingest documents with caller-supplied embeddings. */
  addWithEmbeddings(
    collectionName: string,
    documents: string[],
    embeddings: number[][],
    metadatas?: Record<string, unknown>[]
  ): Promise<void>;
  /**
   * Insert-or-replace documents that carry BOTH a stable id AND a prebuilt
   * embedding — the primitive Brain Packs use to load their precomputed corpus
   * without re-embedding. Distinct from {@link addWithEmbeddings} (which mints
   * throwaway ids) because stable ids make re-import idempotent and enable
   * targeted deletes.
   */
  addDocumentsWithEmbeddings(
    collectionName: string,
    documents: Array<{
      id: string;
      text: string;
      metadata: Record<string, unknown>;
      embedding: number[];
    }>
  ): Promise<void>;
  /** Insert-or-update a single document. */
  upsertDocument(collectionName: string, document: VectorDocument): Promise<void>;
  /** Remove a single document by id. */
  removeDocument(collectionName: string, documentId: string): Promise<void>;
  /** Remove every document matching a metadata equality filter. */
  removeDocumentsWhere(
    collectionName: string,
    where: Record<string, string | number | boolean>
  ): Promise<void>;
  /** Semantic similarity search (closest first). */
  semanticSearch(
    collectionName: string,
    query: string,
    limit?: number
  ): Promise<SearchResult[]>;
  /** Delete an entire collection. */
  deleteCollection(collectionName: string): Promise<void>;
}

export type VectorBackend = "embedded" | "chroma";

/** Resolve the configured backend. Defaults to the embedded (zero-infra) store. */
export function resolveVectorBackend(): VectorBackend {
  const raw = (process.env.OMNECOR_VECTOR_BACKEND || "embedded").toLowerCase();
  return raw === "chroma" ? "chroma" : "embedded";
}

let _store: IVectorStore | null = null;
let _backend: VectorBackend | null = null;

/**
 * The process-wide vector store singleton for the selected backend. Every
 * consumer (RAG, knowledge base, brains, file watcher) must go through this.
 */
export function getVectorStore(): IVectorStore {
  const backend = resolveVectorBackend();
  if (_store && _backend === backend) return _store;
  _backend = backend;
  _store =
    backend === "chroma"
      ? VectorDBService.getInstance()
      : EmbeddedVectorStore.getInstance();
  return _store;
}

/** Test-only: reset the memoized singleton so a test can switch backends. */
export function __resetVectorStoreForTests(): void {
  _store = null;
  _backend = null;
}
