/**
 * @file config/index.ts
 * @description Omnecor — Centralized Configuration Module
 *
 * All environment variables and default settings are resolved here.
 * Downstream services import from this module rather than reading
 * process.env directly, ensuring a single source of truth and
 * enabling easy testing via dependency injection.
 */

import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Server Configuration
// ---------------------------------------------------------------------------

export const SERVER_CONFIG = {
  /** Express HTTP port */
  port: parseInt(
    process.env.OMNECOR_PORT || process.env.PORT || "3000",
    10
  ),
  /** WebSocket port — shares the HTTP server port via upgrade */
  wsPort: parseInt(process.env.OMNECOR_WS_PORT || "3000", 10),
  /** Host binding address */
  host: process.env.OMNECOR_HOST || "0.0.0.0",
  /** CORS allowed origins */
  corsOrigins: (
    process.env.OMNECOR_CORS_ORIGINS || "http://localhost:5173"
  )
    .split(",")
    .map(o => o.trim())
    .filter(Boolean),
} as const;

// ---------------------------------------------------------------------------
// Python Microservices
// ---------------------------------------------------------------------------

export const VOICE_CONFIG = {
  /** Whisper transcription server base URL */
  whisperUrl: process.env.WHISPER_SERVER_URL || "http://localhost:8001",
  /** TTS synthesis server base URL */
  ttsUrl: process.env.TTS_SERVER_URL || "http://localhost:8002",
  /** RVC voice conversion server base URL */
  rvcUrl: process.env.RVC_SERVER_URL || "http://localhost:8003",
  /** Voice Box cloning server base URL */
  voiceboxUrl: process.env.VOICEBOX_SERVER_URL || "http://localhost:8004",
  /** Health check timeout in ms */
  healthCheckTimeoutMs: 5000,
} as const;

// ---------------------------------------------------------------------------
// VectorDB (ChromaDB)
// ---------------------------------------------------------------------------

export const VECTOR_DB_CONFIG = {
  /** ChromaDB server URL. Accepts CHROMADB_URL (canonical) or the legacy
   *  CHROMA_URL alias for back-compat with existing deployments. */
  chromaUrl: process.env.CHROMADB_URL || process.env.CHROMA_URL || "http://localhost:8000",
  /** Default collection for project context */
  defaultCollection: "omnecor_context",
  /** Maximum documents per batch ingestion */
  maxBatchSize: 100,
} as const;

// ---------------------------------------------------------------------------
// Embedding Model (local, ONNX — powers the embedded vector store)
// ---------------------------------------------------------------------------

/**
 * Local sentence-embedding model used by the EmbeddedVectorStore (libSQL
 * native vectors) and any code needing on-device embeddings. Defaults to
 * all-MiniLM-L6-v2 (384-dim, mean-pooled) — the SAME model ChromaDB uses by
 * default, so the embedded backend stays vector-compatible with the Chroma
 * path. Runs fully offline once the model is cached; the model is fetched once
 * (verified by SHA-256) into the cache dir when first needed and online, or
 * pre-seeded by the packager / OMNECOR_EMBED_MODEL_DIR for air-gapped installs.
 */
export const EMBEDDING_CONFIG = {
  /** Model identifier (informational + cache subdir name). */
  modelId: "all-MiniLM-L6-v2",
  /** Embedding dimensionality produced by the model. */
  dimensions: 384,
  /** Max input tokens (sentence-transformers all-MiniLM default seq length). */
  maxSeqLength: 256,
  /** Directory holding the model + tokenizer. Env override wins; else cache. */
  modelDir:
    process.env.OMNECOR_EMBED_MODEL_DIR ||
    path.resolve(
      process.env.HOME || os.homedir(),
      ".omnecor/models/all-MiniLM-L6-v2"
    ),
  /** Relative path (within modelDir) to the ONNX weights. */
  onnxRelPath: "onnx/model_quantized.onnx",
  /** Relative path (within modelDir) to the WordPiece vocab. */
  vocabRelPath: "vocab.txt",
  /** Pinned download source (HuggingFace) used only when the cache is empty. */
  downloadBaseUrl:
    process.env.OMNECOR_EMBED_MODEL_URL ||
    "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main",
  /** SHA-256 of the quantized ONNX weights — integrity gate on download. */
  onnxSha256:
    "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
  /** Disable the auto-download (air-gapped installs that pre-seed the dir). */
  offlineOnly: process.env.OMNECOR_EMBED_OFFLINE === "true",
} as const;

// ---------------------------------------------------------------------------
// Brain Packs (portable external "brains" for local models)
// ---------------------------------------------------------------------------

/**
 * Storage locations + limits for `.obp` Brain Packs. Built-ins ship in-repo
 * (`brains/` at the repo root); user-imported packs are cached under
 * `~/.omnecor/brains`. Both are self-contained and load with zero external
 * infra, honoring the air-gapped Sovereign promise.
 */
export const BRAINS_CONFIG = {
  /** In-repo directory holding built-in `.obp` packs shipped with Omnecor. */
  builtinDir:
    process.env.OMNECOR_BRAINS_BUILTIN_DIR ||
    path.resolve(__dirname, "../../../brains"),
  /** Cache directory for user-imported packs (also where exports default). */
  userDir:
    process.env.OMNECOR_BRAINS_DIR ||
    path.resolve(process.env.HOME || os.homedir(), ".omnecor/brains"),
  /** Hard cap on a single `.obp` upload/import (bytes) — 256 MB. */
  maxPackBytes: parseInt(process.env.OMNECOR_BRAINS_MAX_BYTES || String(256 * 1024 * 1024), 10),
} as const;

// ---------------------------------------------------------------------------
// File System Watcher
// ---------------------------------------------------------------------------

export const WATCHER_CONFIG = {
  /** Default debounce interval in ms for file events */
  debounceMs: parseInt(process.env.WATCHER_DEBOUNCE_MS || "300", 10),
  /** Glob patterns to ignore */
  ignored: [
    /(^|[/\\])\../, // hidden files/dirs
    /node_modules/, // node_modules
    /\.git/, // git internals
    /__pycache__/, // Python cache
    /\.pyc$/, // compiled Python
    /dist\//, // build output
  ],
} as const;

// ---------------------------------------------------------------------------
// Python Scripts Paths
// ---------------------------------------------------------------------------

export const PYTHON_SCRIPTS = {
  /** Path to the LoRA fine-tuning script */
  loraTraining: path.resolve(
    __dirname,
    "../python_scripts/localLLMfine-tuning.py"
  ),
  /** Path to the Valet Router build pipeline orchestrator */
  valetPipeline: path.resolve(
    __dirname,
    "../../python_bridges/valet_pipeline.py"
  ),
  /** Path to the Blender headless executor bridge */
  blenderBridge: path.resolve(
    __dirname,
    "../../python_bridges/blender_bridge.py"
  ),
  /** Path to the ESP flash tool wrapper */
  espFlash: path.resolve(__dirname, "../../python_bridges/esptool_bridge.py"),
  /** Path to the Blueprint Studio FEA bridge (Gmsh + TET4 linear statics) */
  feaBridge: path.resolve(__dirname, "../../python_bridges/fea_bridge.py"),
  /** Path to the Valet dataset builder script */
  valetDatasetBuilder: path.resolve(
    __dirname,
    "../../python_bridges/valet_dataset_builder.py"
  ),
  /** Python executable (can be overridden for venvs). Windows installs expose
   *  `python`, not `python3`. */
  pythonBin:
    process.env.PYTHON_BIN ||
    (process.platform === "win32" ? "python" : "python3"),
  /** Blender executable path */
  blenderBin: process.env.BLENDER_BIN || "blender",
} as const;

// ---------------------------------------------------------------------------
// Training Configuration
// ---------------------------------------------------------------------------

export const TRAINING_CONFIG = {
  /** Default output directory for LoRA adapters */
  defaultOutputDir:
    process.env.LORA_OUTPUT_DIR ||
    path.resolve(process.env.HOME || os.homedir(), ".omnecor/lora_outputs"),
  /** Maximum concurrent training jobs */
  maxConcurrentJobs: parseInt(process.env.MAX_TRAINING_JOBS || "1", 10),
} as const;

// ---------------------------------------------------------------------------
// Security Configuration
// ---------------------------------------------------------------------------

export const SECURITY_CONFIG = {
  /** Encryption algorithm for local file encryption */
  algorithm: "aes-256-gcm",
  /** Key derivation iterations */
  pbkdf2Iterations: 100000,
  /** Maximum file size for security scanning (bytes) */
  maxScanFileSize: 50 * 1024 * 1024, // 50 MB
  /** Backup directory */
  backupDir:
    process.env.OMNECOR_BACKUP_DIR ||
    path.resolve(process.env.HOME || os.homedir(), ".omnecor/backups"),
} as const;

// ---------------------------------------------------------------------------
// Loop Detector Configuration
// ---------------------------------------------------------------------------

export const LOOP_DETECTOR_CONFIG = {
  /** Number of consecutive identical hashes that trigger a loop signal */
  loopThreshold: parseInt(process.env.LOOP_THRESHOLD || "3", 10),
  /** Maximum history entries to retain */
  maxHistorySize: parseInt(process.env.LOOP_HISTORY_SIZE || "100", 10),
} as const;
