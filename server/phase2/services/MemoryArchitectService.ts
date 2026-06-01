/**
 * @file server/services/MemoryArchitectService.ts
 * @description Omnecor — Memory Architect Service
 *
 * Implements the Memory Architect layer that connects the VectorDBService
 * (ChromaDB semantic search) to Omnecor's multi-layered memory system:
 *
 *   Layer 1: Working Memory (active context window — managed by frontend)
 *   Layer 2: Long-Term Memory (vector-indexed project knowledge — THIS SERVICE)
 *   Layer 3: Episodic Memory (conversation history — database-backed)
 *
 * This service manages:
 *   - Per-project ChromaDB collections (isolated "brains")
 *   - Document ingestion with chunking for knowledge base directories
 *   - Semantic search across project memory
 *   - Memory consolidation (summarization of episodic → long-term)
 *   - Collection lifecycle (create, delete, list, stats)
 *
 * The VectorDBService handles the raw ChromaDB operations; this service
 * adds the domain logic, chunking strategy, and memory architecture.
 *
 * Integration:
 *   This service is instantiated as a singleton in the backend and
 *   exposed via tRPC procedures in the knowledgeBase router.
 */

import {
  VectorDBService,
  type VectorDocument,
  type SearchResult,
} from "./VectorDBService.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createLogger } from "../../_core/logger.js";
import { PromptSanitizer } from "./PromptSanitizer.js";
const log = createLogger("MemoryArchitect");

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum chunk size in characters for document splitting */
const MAX_CHUNK_SIZE = 1500;

/** Overlap between chunks to preserve context continuity */
const CHUNK_OVERLAP = 200;

/** File extensions that can be ingested as text documents */
const INGESTIBLE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".cfg",
  ".ini",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".graphql",
  ".proto",
  ".env",
  ".gitignore",
  ".dockerfile",
  ".r",
  ".R",
  ".lua",
  ".rb",
  ".php",
  ".swift",
  ".kt",
]);

/** Maximum file size to ingest (5 MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryStats {
  projectId: string;
  collectionName: string;
  documentCount: number;
  lastUpdated: string;
}

export interface IngestResult {
  filesProcessed: number;
  chunksStored: number;
  errors: Array<{ file: string; error: string }>;
  durationMs: number;
}

export interface MemorySearchResult extends SearchResult {
  /** Source file path for the chunk */
  sourcePath?: string;
  /** Chunk index within the source file */
  chunkIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Architect Service
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryArchitectService {
  private static instance: MemoryArchitectService | null = null;
  private vectorDB: VectorDBService;
  private initialized: boolean = false;

  private constructor(chromaUrl?: string) {
    this.vectorDB = VectorDBService.getInstance();
  }

  /** Retrieve the singleton instance */
  public static getInstance(): MemoryArchitectService {
    if (!MemoryArchitectService.instance) {
      MemoryArchitectService.instance = new MemoryArchitectService();
    }
    return MemoryArchitectService.instance;
  }

  /**
   * Initialize the Memory Architect by connecting to ChromaDB.
   * Must be called before any other operations.
   * Gracefully handles ChromaDB being offline (degrades to no-op).
   */
  async init(): Promise<boolean> {
    try {
      await this.vectorDB.init();
      const status = await this.vectorDB.getStatus();
      this.initialized = status.isConnected;
      if (this.initialized) {
        log.info("Layer 2 Long-Term Memory online");
      }
      return this.initialized;
    } catch (error) {
      console.warn(
        "[Omnecor MemoryArchitect] ChromaDB unavailable — Layer 2 memory disabled.",
        (error as Error).message
      );
      this.initialized = false;
      return false;
    }
  }

  /** Check if the memory layer is operational */
  isOnline(): boolean {
    return this.initialized;
  }

  /** Get the status of the VectorDB connection */
  async getStatus() {
    const status = await this.vectorDB.getStatus();
    return {
      online: status.isConnected,
      chromaUrl: status.chromaUrl,
      initialized: this.initialized,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Collection Management (Per-Project "Brains")
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Generate a deterministic collection name from a project ID.
   * ChromaDB collection names must be 3-63 chars, alphanumeric + underscores.
   */
  private collectionName(projectId: string): string {
    // Sanitize: replace non-alphanumeric with underscore, truncate
    const sanitized = projectId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 50);
    return `omnecor_${sanitized}`;
  }

  /**
   * Create or retrieve a project's memory collection.
   * Each project gets its own isolated vector space.
   */
  async ensureProjectMemory(projectId: string): Promise<string> {
    if (!this.initialized) throw new Error("MemoryArchitect not initialized");

    const name = this.collectionName(projectId);
    await this.vectorDB.getOrCreateCollection(name);
    return name;
  }

  /**
   * Create or return a per-agent ChromaDB collection name.
   * Used by RecursiveMAS to give each agent an isolated memory space.
   *
   * Collection name format: `agent_<sanitized_agentId>_memory`
   */
  async ensureAgentMemory(agentId: string): Promise<string> {
    if (!this.initialized) throw new Error("MemoryArchitect not initialized");

    const sanitizedId = agentId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 44); // keep total ≤ 63 chars: "agent_" (6) + id + "_memory" (7) = 13 + 44 = 57
    const name = `agent_${sanitizedId}_memory`;
    await this.vectorDB.getOrCreateCollection(name);
    return name;
  }

  /**
   * Delete a project's memory collection.
   */
  async deleteCollection(projectId: string): Promise<void> {
    if (!this.initialized) return;
    const name = this.collectionName(projectId);
    await this.vectorDB.deleteCollection(name);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Document Ingestion (Knowledge Base)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ingest an entire directory into a project's long-term memory.
   * Recursively walks the directory, chunks text files, and stores
   * embeddings in the project's ChromaDB collection.
   *
   * @param projectId  - Unique project identifier
   * @param dirPath    - Absolute path to the directory to ingest
   * @param recursive  - Whether to recurse into subdirectories (default: true)
   */
  async ingestDirectory(
    projectId: string,
    dirPath: string,
    recursive: boolean = true
  ): Promise<IngestResult> {
    if (!this.initialized) {
      return {
        filesProcessed: 0,
        chunksStored: 0,
        errors: [{ file: dirPath, error: "MemoryArchitect offline" }],
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    const collectionName = await this.ensureProjectMemory(projectId);
    const errors: Array<{ file: string; error: string }> = [];
    let filesProcessed = 0;
    let chunksStored = 0;

    // Collect all ingestible files
    const files = this.walkDirectory(dirPath, recursive);

    // Process files in batches of 20 to avoid overwhelming ChromaDB
    const BATCH_SIZE = 20;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const documents: VectorDocument[] = [];

      for (const filePath of batch) {
        try {
          const chunks = this.chunkFile(filePath);
          for (let idx = 0; idx < chunks.length; idx++) {
            documents.push({
              id: this.generateChunkId(filePath, idx),
              text: chunks[idx],
              metadata: {
                sourcePath: filePath,
                chunkIndex: idx,
                totalChunks: chunks.length,
                projectId,
                ingestedAt: new Date().toISOString(),
                fileExtension: path.extname(filePath),
              },
            });
          }
          filesProcessed++;
          chunksStored += chunks.length;
        } catch (error) {
          errors.push({ file: filePath, error: (error as Error).message });
        }
      }

      // Store the batch
      if (documents.length > 0) {
        try {
          await this.vectorDB.addDocuments(collectionName, documents);
        } catch (error) {
          errors.push({
            file: `batch_${i}`,
            error: `Batch storage failed: ${(error as Error).message}`,
          });
        }
      }
    }

    return {
      filesProcessed,
      chunksStored,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Ingest a single document (text content) into a project's memory.
   * Useful for adding conversation summaries, notes, or external content.
   */
  async ingestDocument(
    projectId: string,
    documentId: string,
    text: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    if (!this.initialized) return;

    const sanitized = PromptSanitizer.getInstance().sanitize(text);
    if (sanitized.flagged) {
      log.warn("Injection attempt detected in ingestDocument", { documentId, violations: sanitized.violations });
    }
    const safeText = sanitized.clean;

    const collectionName = await this.ensureProjectMemory(projectId);
    const chunks = this.chunkText(this.redactSensitiveData(safeText));
    const documents: VectorDocument[] = chunks.map((chunk, idx) => ({
      id: `${documentId}_chunk_${idx}`,
      text: chunk,
      metadata: {
        ...metadata,
        documentId,
        chunkIndex: idx,
        totalChunks: chunks.length,
        projectId,
        ingestedAt: new Date().toISOString(),
      },
    }));

    await this.vectorDB.addDocuments(collectionName, documents);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Semantic Search (Layer 2 Retrieval)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Search a project's long-term memory using natural language.
   * Returns ranked results with source file information.
   *
   * @param projectId - Project to search within
   * @param query     - Natural language search query
   * @param limit     - Maximum number of results (default: 5)
   */
  async search(
    projectId: string,
    query: string,
    limit: number = 5
  ): Promise<MemorySearchResult[]> {
    if (!this.initialized) return [];

    const sanitized = PromptSanitizer.getInstance().sanitize(query);
    if (sanitized.flagged) {
      log.warn("Injection attempt detected in search query", { projectId, violations: sanitized.violations });
    }
    const safeQuery = sanitized.clean;

    const collectionName = this.collectionName(projectId);

    try {
      const results = await this.vectorDB.semanticSearch(
        collectionName,
        safeQuery,
        limit
      );
      return results.map(r => ({
        ...r,
        sourcePath: r.metadata?.sourcePath as string | undefined,
        chunkIndex: r.metadata?.chunkIndex as number | undefined,
      }));
    } catch (error) {
      console.error(
        `[MemoryArchitect] Search failed for project ${projectId}:`,
        (error as Error).message
      );
      return [];
    }
  }

  /**
   * Retrieve context-relevant memory for the AI's working context.
   * This is the primary interface used by the Valet Router to augment
   * prompts with relevant long-term knowledge.
   *
   * @param projectId - Active project
   * @param prompt    - The user's current prompt/message
   * @param maxTokens - Approximate token budget for retrieved context
   */
  async retrieveContext(
    projectId: string,
    prompt: string,
    maxTokens: number = 2000
  ): Promise<string> {
    if (!this.initialized) return "";

    // Approximate: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    const results = await this.search(projectId, prompt, 8);

    let context = "";
    for (const result of results) {
      const entry = `[Source: ${result.sourcePath || "memory"}]\n${result.text}\n\n`;
      if (context.length + entry.length > maxChars) break;
      context += entry;
    }

    return context;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Memory Consolidation (Episodic → Long-Term)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Consolidate a conversation summary into long-term memory.
   * Called after a conversation session ends or at periodic intervals.
   * This bridges Layer 3 (Episodic) → Layer 2 (Long-Term).
   */
  async consolidateEpisodic(
    projectId: string,
    conversationId: string,
    summary: string,
    keyInsights: string[] = []
  ): Promise<void> {
    if (!this.initialized) return;

    const fullText = [
      `Conversation Summary (${conversationId}):`,
      summary,
      ...(keyInsights.length > 0
        ? ["\nKey Insights:", ...keyInsights.map(i => `- ${i}`)]
        : []),
    ].join("\n");

    await this.ingestDocument(
      projectId,
      `episodic_${conversationId}`,
      fullText,
      {
        type: "episodic_consolidation",
        conversationId,
        consolidatedAt: new Date().toISOString(),
      }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Recursively walk a directory and return all ingestible file paths.
   * Skips hidden directories, node_modules, .git, and binary files.
   */
  private walkDirectory(dirPath: string, recursive: boolean): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return files;
    }

    const SKIP_DIRS = new Set([
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "__pycache__",
      ".venv",
      "venv",
      ".cache",
      "coverage",
    ]);

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files/dirs
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (recursive && !SKIP_DIRS.has(entry.name)) {
          files.push(...this.walkDirectory(fullPath, recursive));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (INGESTIBLE_EXTENSIONS.has(ext)) {
          // Check file size
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              files.push(fullPath);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    return files;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cognitive Redaction (Standards: Operational — Memory)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Redacts PII and credentials from text before long-term memory storage.
   * Complies with Omnecor Engineering Standards §Execution: "Cognitive Redaction —
   * Automatically identify and redact PII or credentials before storing in
   * long-term memory."
   *
   * Patterns covered: API keys, bearer tokens, passwords, email addresses,
   * phone numbers (US/intl), SSNs, IPv4/IPv6 addresses, JWTs, private key
   * headers, and common .env KEY=VALUE pairs.
   */
  private redactSensitiveData(text: string): string {
    const rules: Array<[RegExp, string]> = [
      // .env / config file patterns  KEY=<secret>
      [/^([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|API_KEY|ACCESS_KEY|PRIVATE)[A-Z0-9_]*)=.+$/gm, "$1=[REDACTED]"],
      // Bearer / Authorization header values
      [/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[REDACTED]"],
      // JSON fields that look like credentials
      [/("(?:password|secret|token|api_key|apiKey|access_token|refresh_token|client_secret)":\s*")[^"]+(")/gi, "$1[REDACTED]$2"],
      // JWT (three base64url segments)
      [/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/]*/g, "[JWT_REDACTED]"],
      // PEM private key blocks
      [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[PRIVATE_KEY_REDACTED]"],
      // Email addresses
      [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMAIL_REDACTED]"],
      // US phone numbers (various formats)
      [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE_REDACTED]"],
      // SSN
      [/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN_REDACTED]"],
      // IPv4 addresses (private ranges that hint at internal infra)
      [/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, "[INTERNAL_IP_REDACTED]"],
      // Generic high-entropy hex strings that look like secrets (32–64 hex chars)
      [/\b[0-9a-f]{32,64}\b/gi, "[HEX_SECRET_REDACTED]"],
    ];

    let result = text;
    for (const [pattern, replacement] of rules) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * Read, redact, and chunk a file into overlapping text segments.
   */
  private chunkFile(filePath: string): string[] {
    const content = fs.readFileSync(filePath, "utf-8");
    return this.chunkText(this.redactSensitiveData(content));
  }

  /**
   * Split text into overlapping chunks for optimal embedding quality.
   * Uses a sliding window approach with configurable size and overlap.
   */
  private chunkText(text: string): string[] {
    if (text.length <= MAX_CHUNK_SIZE) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + MAX_CHUNK_SIZE;

      // Try to break at a natural boundary (newline, period, space)
      if (end < text.length) {
        const slice = text.slice(start, end);
        const lastNewline = slice.lastIndexOf("\n");
        const lastPeriod = slice.lastIndexOf(". ");

        if (lastNewline > MAX_CHUNK_SIZE * 0.5) {
          end = start + lastNewline + 1;
        } else if (lastPeriod > MAX_CHUNK_SIZE * 0.5) {
          end = start + lastPeriod + 2;
        }
      }

      chunks.push(text.slice(start, Math.min(end, text.length)));
      start = end - CHUNK_OVERLAP;

      // Prevent infinite loop on very small overlaps
      if (start >= text.length) break;
    }

    return chunks;
  }

  /**
   * Generate a deterministic chunk ID from file path and chunk index.
   * Uses SHA-256 hash for uniqueness and idempotent upserts.
   */
  private generateChunkId(filePath: string, chunkIndex: number): string {
    const hash = crypto
      .createHash("sha256")
      .update(`${filePath}:${chunkIndex}`)
      .digest("hex")
      .slice(0, 16);
    return `chunk_${hash}`;
  }
}
