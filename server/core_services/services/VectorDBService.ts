/**
 * @file services/VectorDBService.ts
 * @description Omnecor — VectorDB Service (ChromaDB Integration)
 *
 * Provides semantic search and document ingestion capabilities for the
 * Omnecor backend. Wraps the ChromaDB client in a singleton service with:
 *
 *  - Graceful offline handling (ChromaDB container may not always be running)
 *  - Per-project collection management (isolated "brains" per project)
 *  - Batch ingestion with automatic chunking for large document sets
 *  - Semantic similarity search with configurable result limits
 *  - Integration hooks for the FileSystemWatcher (auto-index on file changes)
 *
 * Architecture Notes:
 *  - ChromaDB runs as a Docker sidecar container on port 8000
 *  - The service uses ChromaDB's built-in embedding function (all-MiniLM-L6-v2)
 *  - Collections are named using the pattern: omnecor_{projectId}
 *  - Documents are stored with metadata including file path, timestamp, and type
 */

import { VECTOR_DB_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
import type { IVectorStore } from "./VectorStore.js";
const log = createLogger("VectorDB");

// ---------------------------------------------------------------------------
// Collection naming — the single source of truth shared by every writer AND
// reader of the vector store. ChromaDB collection names must be 3-63 chars,
// start/end alphanumeric, and contain only [a-zA-Z0-9._-]. Historically the
// local file watcher wrote a RAW `omnecor_{projectId}` name while the reader
// (MemoryArchitectService) queried a SANITIZED one — so a map keyed by a
// hyphenated UUID was written to one collection and read from another, leaving
// RAG silently empty. Everyone now derives the name here so writes and reads
// always land in the same place.
// ---------------------------------------------------------------------------

/**
 * Deterministic ChromaDB collection name for a logical project / map id.
 * Lower-cases, replaces every non-alphanumeric run with a single underscore,
 * and caps length so the `omnecor_` prefix keeps the total ≤ 63 chars.
 */
export function sanitizeCollectionName(projectId: string): string {
  const sanitized = projectId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 50);
  return `omnecor_${sanitized}`;
}

// ---------------------------------------------------------------------------
// Types (ChromaDB client types — defined here to avoid hard dependency at import)
// ---------------------------------------------------------------------------

/**
 * Document to be ingested into the vector store.
 */
export interface VectorDocument {
  /** Unique document identifier (typically file path hash or UUID) */
  id: string;
  /** The text content to be embedded and stored */
  text: string;
  /** Metadata attached to the document for filtering */
  metadata: Record<string, string | number | boolean>;
}

/**
 * Result from a semantic search query.
 */
export interface SearchResult {
  /** Document ID */
  id: string;
  /** The stored text content */
  text: string | null;
  /** Document metadata */
  metadata: Record<string, any> | null;
  /** Cosine distance from the query (lower = more similar) */
  distance: number | null;
}

/**
 * Status of the VectorDB connection.
 */
export interface VectorDBStatus {
  isConnected: boolean;
  chromaUrl: string;
  collections: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

/**
 * VectorDBService — Singleton service for ChromaDB operations.
 *
 * Handles graceful degradation when ChromaDB is unavailable (the application
 * continues to function, but semantic search returns empty results).
 *
 * @example
 * ```ts
 * const vectorDB = VectorDBService.getInstance();
 * await vectorDB.init();
 *
 * // Ingest documents
 * await vectorDB.addDocuments("omnecor_proj123", [
 *   { id: "doc1", text: "Hello world", metadata: { path: "/src/main.ts" } }
 * ]);
 *
 * // Search
 * const results = await vectorDB.semanticSearch("omnecor_proj123", "greeting function", 5);
 * ```
 */
export class VectorDBService implements IVectorStore {
  private static instance: VectorDBService | null = null;
  private client: any = null; // ChromaClient — dynamically imported
  private isInitialized: boolean = false;
  private initError: string | null = null;
  private readonly chromaUrl: string;

  private constructor() {
    this.chromaUrl = VECTOR_DB_CONFIG.chromaUrl;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): VectorDBService {
    if (!VectorDBService.instance) {
      VectorDBService.instance = new VectorDBService();
    }
    return VectorDBService.instance;
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Initialize the connection to the local ChromaDB instance.
   * Performs a heartbeat check to verify the container is running.
   *
   * This method is safe to call multiple times — subsequent calls are no-ops
   * if already initialized. If ChromaDB is unavailable, the service enters
   * a degraded state (isInitialized = false) but does NOT throw.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Dynamic import to avoid hard failure if chromadb package is missing
      const { ChromaClient } = await import("chromadb");
      this.client = new ChromaClient({ path: this.chromaUrl });

      // Heartbeat check — verifies the Docker container is responsive
      await this.client.heartbeat();

      this.isInitialized = true;
      this.initError = null;
      log.info("Connected to ChromaDB", { chromaUrl: this.chromaUrl });
    } catch (error) {
      this.isInitialized = false;
      this.client = null;
      this.initError = (error as Error).message;
      console.warn(
        `[Omnecor VectorDB] ChromaDB unavailable at ${this.chromaUrl}: ${this.initError}. ` +
          `Semantic search will be disabled until ChromaDB is started.`
      );
      // Do NOT throw — allow the application to start in degraded mode
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get the current connection status.
   */
  public async getStatus(): Promise<VectorDBStatus> {
    if (!this.isInitialized || !this.client) {
      return {
        isConnected: false,
        chromaUrl: this.chromaUrl,
        collections: [],
        error: this.initError,
      };
    }

    try {
      const collections = await this.client.listCollections();
      return {
        isConnected: true,
        chromaUrl: this.chromaUrl,
        collections: collections.map((c: any) => c.name || c),
        error: null,
      };
    } catch (error) {
      return {
        isConnected: false,
        chromaUrl: this.chromaUrl,
        collections: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get or create a collection by name.
   * Collection names follow the pattern: omnecor_{projectId}
   */
  public async getOrCreateCollection(name: string): Promise<any> {
    this.ensureInitialized();
    try {
      return await this.client.getOrCreateCollection({ name });
    } catch (error) {
      throw new Error(
        `[Omnecor VectorDB] Failed to get/create collection '${name}': ${(error as Error).message}`
      );
    }
  }

  /**
   * Add documents to a specified collection.
   * Handles batching automatically for large document sets.
   *
   * @param collectionName - Target collection name
   * @param documents      - Array of documents to ingest
   */
  public async addDocuments(
    collectionName: string,
    documents: VectorDocument[]
  ): Promise<void> {
    if (!this.isInitialized) {
      console.warn(
        "[Omnecor VectorDB] Skipping ingestion — ChromaDB not connected."
      );
      return;
    }

    if (documents.length === 0) return;

    const collection = await this.getOrCreateCollection(collectionName);
    const batchSize = VECTOR_DB_CONFIG.maxBatchSize;

    // Process in batches to avoid overwhelming ChromaDB
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const ids: string[] = [];
      const metadatas: Record<string, any>[] = [];
      const documentsText: string[] = [];

      for (const doc of batch) {
        ids.push(doc.id);
        metadatas.push(doc.metadata);
        documentsText.push(doc.text);
      }

      try {
        await collection.add({ ids, metadatas, documents: documentsText });
      } catch (error) {
        throw new Error(
          `[Omnecor VectorDB] Batch ingestion failed for '${collectionName}' ` +
            `(batch ${Math.floor(i / batchSize) + 1}): ${(error as Error).message}`
        );
      }
    }

    log.info("Documents ingested", { count: documents.length, collection: collectionName });
  }

  public async addWithEmbeddings(
    collectionName: string,
    documents: string[],
    embeddings: number[][],
    metadatas?: Record<string, unknown>[],
  ): Promise<void> {
    if (!this.isInitialized) return;
    const collection = await this.getOrCreateCollection(collectionName);
    const ids = documents.map((_, i) => `${Date.now()}_${i}`);
    await collection.add({
      ids,
      documents,
      embeddings,
      metadatas: (metadatas ?? documents.map(() => ({}))) as Record<string, any>[],
    });
  }

  /**
   * Insert-or-replace documents carrying stable ids AND prebuilt embeddings —
   * the primitive Brain Packs use to load a precomputed corpus without
   * re-embedding. Uses `upsert` so re-import with the same ids is idempotent.
   */
  public async addDocumentsWithEmbeddings(
    collectionName: string,
    documents: Array<{
      id: string;
      text: string;
      metadata: Record<string, unknown>;
      embedding: number[];
    }>,
  ): Promise<void> {
    if (!this.isInitialized) return;
    if (documents.length === 0) return;
    const collection = await this.getOrCreateCollection(collectionName);
    const batchSize = VECTOR_DB_CONFIG.maxBatchSize;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      await collection.upsert({
        ids: batch.map(d => d.id),
        documents: batch.map(d => d.text),
        embeddings: batch.map(d => d.embedding),
        metadatas: batch.map(d => d.metadata) as Record<string, any>[],
      });
    }
  }

  /**
   * Update a single document in the collection (upsert semantics).
   * Used when a file changes and needs re-indexing.
   */
  public async upsertDocument(
    collectionName: string,
    document: VectorDocument
  ): Promise<void> {
    if (!this.isInitialized) return;

    const collection = await this.getOrCreateCollection(collectionName);

    try {
      await collection.upsert({
        ids: [document.id],
        metadatas: [document.metadata],
        documents: [document.text],
      });
    } catch (error) {
      throw new Error(
        `[Omnecor VectorDB] Upsert failed for doc '${document.id}' in '${collectionName}': ${(error as Error).message}`
      );
    }
  }

  /**
   * Remove a document from the collection (e.g., when a file is deleted).
   */
  public async removeDocument(
    collectionName: string,
    documentId: string
  ): Promise<void> {
    if (!this.isInitialized) return;

    const collection = await this.getOrCreateCollection(collectionName);

    try {
      await collection.delete({ ids: [documentId] });
    } catch (error) {
      console.warn(
        `[Omnecor VectorDB] Failed to remove doc '${documentId}' from '${collectionName}': ${(error as Error).message}`
      );
    }
  }

  /**
   * Remove every document in a collection matching a metadata filter.
   * Used to reconcile a single remote source on re-index (delete the source's
   * stale chunks, then re-add) so deletions and renames propagate instead of
   * accumulating orphaned vectors.
   *
   * @param collectionName - Target collection name
   * @param where          - ChromaDB metadata equality filter, e.g. { sourceUri }
   */
  public async removeDocumentsWhere(
    collectionName: string,
    where: Record<string, string | number | boolean>
  ): Promise<void> {
    if (!this.isInitialized) return;
    if (Object.keys(where).length === 0) return;

    const collection = await this.getOrCreateCollection(collectionName);

    try {
      await collection.delete({ where });
    } catch (error) {
      console.warn(
        `[Omnecor VectorDB] Failed to remove documents from '${collectionName}' ` +
          `where ${JSON.stringify(where)}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Perform a semantic similarity search across the target collection.
   *
   * @param collectionName - Collection to search
   * @param query          - Natural language query string
   * @param limit          - Maximum number of results (default: 5)
   * @returns Array of search results sorted by relevance (closest first)
   */
  public async semanticSearch(
    collectionName: string,
    query: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    if (!this.isInitialized) {
      console.warn(
        "[Omnecor VectorDB] Search unavailable — ChromaDB not connected."
      );
      return [];
    }

    const collection = await this.getOrCreateCollection(collectionName);

    try {
      const results = await collection.query({
        queryTexts: [query],
        nResults: limit,
      });

      // Transform Chroma's parallel arrays into structured objects
      const formatted: SearchResult[] = [];

      if (results.ids && results.ids[0]) {
        for (let i = 0; i < results.ids[0].length; i++) {
          formatted.push({
            id: results.ids[0][i],
            text: results.documents?.[0]?.[i] ?? null,
            metadata: results.metadatas?.[0]?.[i] ?? null,
            distance: results.distances?.[0]?.[i] ?? null,
          });
        }
      }

      return formatted;
    } catch (error) {
      throw new Error(
        `[Omnecor VectorDB] Query failed on '${collectionName}': ${(error as Error).message}`
      );
    }
  }

  /**
   * Delete an entire collection (e.g., when a project is removed).
   */
  public async deleteCollection(collectionName: string): Promise<void> {
    if (!this.isInitialized) return;

    try {
      await this.client.deleteCollection({ name: collectionName });
      log.info("Collection deleted", { collectionName });
    } catch (error) {
      console.warn(
        `[Omnecor VectorDB] Failed to delete collection '${collectionName}': ${(error as Error).message}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** Guard: throws if not initialized */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.client) {
      throw new Error(
        "[Omnecor VectorDB] Service not initialized. " +
          "Ensure ChromaDB is running and call init() before operations."
      );
    }
  }
}
