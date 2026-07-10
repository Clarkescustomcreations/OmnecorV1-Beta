/**
 * @file services/HashTrackerService.ts
 * @description Omnecor — Action Hash Tracker & AI Loop Detector Service
 *
 * Integrates the LoopDetector into the Omnecor backend as a managed service.
 * Provides per-agent loop detection so that multiple concurrent AI agents
 * can each have their own independent loop history.
 *
 * Architecture Notes:
 *  - Singleton service manages multiple LoopDetector instances (one per agent session)
 *  - Exposes a clean API for the tRPC router to check/record agent actions
 *  - Emits events when loops are detected for monitoring/alerting
 *  - Supports session cleanup for completed agent runs
 */

import { createHash } from "crypto";
import { EventEmitter } from "events";
import { LOOP_DETECTOR_CONFIG } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single entry in the LoopDetector history ring-buffer */
export interface HistoryEntry {
  /** The SHA-256 hex digest of the action snapshot */
  hash: string;
  /** ISO-8601 timestamp of when this action was recorded */
  recordedAt: string;
}

/** Snapshot of a detector's current state — useful for logging/persistence */
export interface LoopDetectorSnapshot {
  /** Ordered history from oldest to newest */
  history: HistoryEntry[];
  /** Maximum number of entries the ring-buffer holds */
  maxHistorySize: number;
  /** How many consecutive identical hashes trigger a loop signal */
  loopThreshold: number;
}

/** Result of a loop check operation */
export interface LoopCheckResult {
  /** Whether a loop was detected */
  isLoop: boolean;
  /** The hash that was checked */
  hash: string;
  /** Agent session ID */
  sessionId: string;
  /** Current history size for this session */
  historySize: number;
}

/** Event payload when a loop is detected */
export interface LoopDetectedEvent {
  sessionId: string;
  hash: string;
  consecutiveCount: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Hash Generation Utility
// ---------------------------------------------------------------------------

/**
 * Recursively sorts object keys for deterministic JSON serialization.
 * Arrays preserve order; only plain-object keys are sorted.
 */
function deterministicReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    );
  }
  return value;
}

/**
 * Generates a deterministic SHA-256 hash from the complete action snapshot.
 *
 * The hash encodes:
 *  - `toolName`  — which tool the AI is invoking
 *  - `args`      — the exact arguments being passed
 *  - `state`     — the agent's current observable state
 *
 * Key ordering is normalised so { a: 1, b: 2 } and { b: 2, a: 1 } hash identically.
 *
 * @param toolName - Name of the AI tool/action being executed
 * @param args     - Arguments object passed to the tool
 * @param state    - Current agent/world state at the time of invocation
 * @returns        Lowercase hex SHA-256 digest (64 characters)
 */
export function generateActionHash(
  toolName: string,
  args: object,
  state: object
): string {
  const snapshot = { toolName, args, state };
  const canonical = JSON.stringify(snapshot, deterministicReplacer);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// LoopDetector (Per-Session Instance)
// ---------------------------------------------------------------------------

class LoopDetector {
  private readonly loopThreshold: number;
  private readonly maxHistorySize: number;
  private history: HistoryEntry[] = [];

  constructor(loopThreshold: number, maxHistorySize: number) {
    if (loopThreshold < 2) {
      throw new RangeError("loopThreshold must be >= 2");
    }
    if (maxHistorySize < loopThreshold) {
      throw new RangeError("maxHistorySize must be >= loopThreshold");
    }
    this.loopThreshold = loopThreshold;
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Check if adding `hash` would create a loop (N consecutive identical hashes).
   * Does NOT mutate history.
   */
  checkLoop(hash: string): boolean {
    if (this.history.length < this.loopThreshold - 1) {
      return false;
    }
    const tail = this.history.slice(-(this.loopThreshold - 1));
    return tail.every(entry => entry.hash === hash);
  }

  /** Append hash to the rolling history (FIFO ring-buffer) */
  record(hash: string): void {
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift();
    }
    this.history.push({ hash, recordedAt: new Date().toISOString() });
  }

  /**
   * Combined check-and-record. Returns true if loop detected (hash NOT recorded).
   * Returns false if no loop (hash IS recorded).
   */
  checkAndRecord(hash: string): boolean {
    if (this.checkLoop(hash)) {
      return true;
    }
    this.record(hash);
    return false;
  }

  /** Read-only snapshot of current state */
  snapshot(): LoopDetectorSnapshot {
    return {
      history: this.history.map(e => ({ ...e })),
      maxHistorySize: this.maxHistorySize,
      loopThreshold: this.loopThreshold,
    };
  }

  get size(): number {
    return this.history.length;
  }

  reset(): void {
    this.history = [];
  }

  get latestHash(): string | null {
    return this.history.length > 0
      ? this.history[this.history.length - 1].hash
      : null;
  }
}

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

/**
 * HashTrackerService — Manages per-agent-session loop detectors.
 *
 * @example
 * ```ts
 * const tracker = HashTrackerService.getInstance();
 *
 * const hash = tracker.hashAction("writeFile", { path: "/tmp/x" }, { step: 3 });
 * const result = tracker.checkAndRecord("session_abc", hash);
 *
 * if (result.isLoop) {
 *   // Halt the agent — it's stuck
 * }
 * ```
 */
export class HashTrackerService extends EventEmitter {
  private static instance: HashTrackerService | null = null;
  private detectors: Map<string, LoopDetector> = new Map();
  private readonly loopThreshold: number;
  private readonly maxHistorySize: number;

  private constructor() {
    super();
    this.loopThreshold = LOOP_DETECTOR_CONFIG.loopThreshold;
    this.maxHistorySize = LOOP_DETECTOR_CONFIG.maxHistorySize;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): HashTrackerService {
    if (!HashTrackerService.instance) {
      HashTrackerService.instance = new HashTrackerService();
    }
    return HashTrackerService.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate a deterministic hash for an agent action.
   */
  hashAction(toolName: string, args: object, state: object): string {
    return generateActionHash(toolName, args, state);
  }

  /**
   * Check if the given hash would create a loop for the specified session,
   * and record it if no loop is detected.
   *
   * @param sessionId - Unique agent session identifier
   * @param hash      - SHA-256 action hash
   * @returns LoopCheckResult with loop detection status
   */
  checkAndRecord(sessionId: string, hash: string): LoopCheckResult {
    const detector = this.getOrCreateDetector(sessionId);
    const isLoop = detector.checkAndRecord(hash);

    if (isLoop) {
      const event: LoopDetectedEvent = {
        sessionId,
        hash,
        consecutiveCount: this.loopThreshold,
        timestamp: new Date().toISOString(),
      };
      this.emit("loopDetected", event);
      console.warn(
        `[Omnecor LoopDetector] Loop detected: session="${sessionId}" hash="${hash.slice(0, 12)}…"`
      );
    }

    return {
      isLoop,
      hash,
      sessionId,
      historySize: detector.size,
    };
  }

  /**
   * Get the snapshot of a specific session's detector state.
   */
  getSessionSnapshot(sessionId: string): LoopDetectorSnapshot | null {
    const detector = this.detectors.get(sessionId);
    return detector ? detector.snapshot() : null;
  }

  /**
   * Reset a session's loop detector (e.g., after handling a loop or starting fresh).
   */
  resetSession(sessionId: string): void {
    const detector = this.detectors.get(sessionId);
    if (detector) {
      detector.reset();
    }
  }

  /**
   * Remove a session's detector entirely (cleanup after agent run completes).
   */
  removeSession(sessionId: string): void {
    this.detectors.delete(sessionId);
  }

  /**
   * List all active session IDs.
   */
  getActiveSessions(): string[] {
    return Array.from(this.detectors.keys());
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private getOrCreateDetector(sessionId: string): LoopDetector {
    let detector = this.detectors.get(sessionId);
    if (!detector) {
      detector = new LoopDetector(this.loopThreshold, this.maxHistorySize);
      this.detectors.set(sessionId, detector);
    }
    return detector;
  }
}
