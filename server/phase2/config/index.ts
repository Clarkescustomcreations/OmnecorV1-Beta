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
  /** Health check timeout in ms */
  healthCheckTimeoutMs: 5000,
} as const;

// ---------------------------------------------------------------------------
// VectorDB (ChromaDB)
// ---------------------------------------------------------------------------

export const VECTOR_DB_CONFIG = {
  /** ChromaDB server URL */
  chromaUrl: process.env.CHROMADB_URL || "http://localhost:8000",
  /** Default collection for project context */
  defaultCollection: "omnecor_context",
  /** Maximum documents per batch ingestion */
  maxBatchSize: 100,
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
  /** Path to the Valet dataset builder script */
  valetDatasetBuilder: path.resolve(
    __dirname,
    "../../python_bridges/valet_dataset_builder.py"
  ),
  /** Python executable (can be overridden for venvs) */
  pythonBin: process.env.PYTHON_BIN || "python3",
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
    path.resolve(process.env.HOME || "/home/user", ".omnecor/lora_outputs"),
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
    path.resolve(process.env.HOME || "/home/user", ".omnecor/backups"),
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
