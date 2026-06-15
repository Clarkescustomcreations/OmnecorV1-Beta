/**
 * @file services/FileSystemWatcherService.ts
 * @description Omnecor — File System Watcher Service (Integrated)
 *
 * This service wraps the raw FileSystemWatcher (chokidar-based) and integrates it
 * with the Omnecor backend infrastructure:
 *
 *  - Manages multiple watchers (one per project directory)
 *  - Broadcasts file events to connected WebSocket clients for Neural Node-Tree updates
 *  - Integrates with VectorDBService for automatic document re-indexing on file changes
 *  - Provides a clean API for the tRPC router layer
 *
 * Architecture Notes:
 *  - Singleton pattern ensures only one service instance manages all watchers
 *  - Each project gets its own watcher instance, isolated by project ID
 *  - Events are debounced at the watcher level (300ms default) to prevent
 *    rapid editor saves from flooding the WebSocket channel
 */

import chokidar, { FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import path from "path";
import fs from "fs/promises";
import { WATCHER_CONFIG } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
const log = createLogger("FileSystemWatcher");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload emitted with every file-system event. */
export interface FileEvent {
  /** Unique project identifier this event belongs to */
  projectId: string;
  /** Absolute, normalised path that triggered the event */
  filePath: string;
  /** Path relative to the project root (for UI display) */
  relativePath: string;
  /** Event type: add, change, unlink, unlinkDir */
  eventType: "add" | "change" | "unlink" | "unlinkDir";
  /** ISO-8601 timestamp of when the (debounced) event was emitted */
  timestamp: string;
  /** File size in bytes (null for unlink events) */
  size: number | null;
  /** File extension (e.g., ".ts", ".py") */
  extension: string;
}

/** Configuration for a project watcher instance */
export interface WatcherRegistration {
  projectId: string;
  rootDir: string;
  debounceMs?: number;
  ignored?: Array<string | RegExp>;
}

/** Status of a registered watcher */
export interface WatcherStatus {
  projectId: string;
  rootDir: string;
  isActive: boolean;
  fileCount: number;
  lastEventAt: string | null;
}

// ---------------------------------------------------------------------------
// Internal Watcher Instance
// ---------------------------------------------------------------------------

interface ManagedWatcher {
  projectId: string;
  rootDir: string;
  watcher: FSWatcher;
  fileCount: number;
  lastEventAt: string | null;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  isReady: boolean;
}

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

/**
 * FileSystemWatcherService — Manages per-project file watchers and emits
 * structured events for downstream consumption (WebSocket, VectorDB, etc.)
 *
 * @example
 * ```ts
 * const service = FileSystemWatcherService.getInstance();
 * service.on("fileEvent", (event) => {
 *   // Broadcast to WebSocket clients
 *   wsServer.broadcast(JSON.stringify(event));
 * });
 *
 * await service.registerProject({
 *   projectId: "proj_abc123",
 *   rootDir: "/home/user/projects/my-app",
 * });
 * ```
 */
export class FileSystemWatcherService extends EventEmitter {
  private static instance: FileSystemWatcherService | null = null;
  private watchers: Map<string, ManagedWatcher> = new Map();
  private debounceMs: number;

  private constructor() {
    super();
    this.debounceMs = WATCHER_CONFIG.debounceMs;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): FileSystemWatcherService {
    if (!FileSystemWatcherService.instance) {
      FileSystemWatcherService.instance = new FileSystemWatcherService();
    }
    return FileSystemWatcherService.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Register and start watching a project directory.
   * If a watcher for this projectId already exists, it will be closed and replaced.
   *
   * @param registration - Configuration for the new watcher
   * @throws Error if the directory does not exist or is not accessible
   */
  async registerProject(registration: WatcherRegistration): Promise<void> {
    const { projectId, rootDir, debounceMs, ignored } = registration;
    const resolvedRoot = path.resolve(rootDir);

    // Validate directory exists
    try {
      const stat = await fs.stat(resolvedRoot);
      if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedRoot}`);
      }
    } catch (err) {
      throw new Error(
        `[Omnecor FileWatcher] Cannot watch "${resolvedRoot}": ${(err as Error).message}`
      );
    }

    // Close existing watcher for this project if present
    if (this.watchers.has(projectId)) {
      await this.unregisterProject(projectId);
    }

    // Create the chokidar watcher
    const watcher = chokidar.watch(resolvedRoot, {
      ignored: (ignored || WATCHER_CONFIG.ignored) as (string | RegExp)[],
      persistent: true,
      ignoreInitial: false,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    const managed: ManagedWatcher = {
      projectId,
      rootDir: resolvedRoot,
      watcher,
      fileCount: 0,
      lastEventAt: null,
      debounceTimers: new Map(),
      isReady: false,
    };

    // Wire up chokidar events with debouncing
    watcher.on("add", p => this.handleEvent(managed, "add", p));
    watcher.on("change", p => this.handleEvent(managed, "change", p));
    watcher.on("unlink", p => this.handleEvent(managed, "unlink", p));
    watcher.on("unlinkDir", p => this.handleEvent(managed, "unlinkDir", p));

    watcher.on("ready", () => {
      managed.isReady = true;
      this.emit("watcherReady", { projectId, rootDir: resolvedRoot });
      log.info("Watcher registered", { projectId, root: resolvedRoot, files: managed.fileCount });
    });

    watcher.on("error", err => {
      console.error(
        `[Omnecor FileWatcher] Error on project="${projectId}":`,
        err
      );
      this.emit("watcherError", { projectId, error: err });
    });

    this.watchers.set(projectId, managed);
    log.info("Watcher update", { projectId, root: resolvedRoot });
  }

  /**
   * Stop watching a project and clean up all resources.
   *
   * @param projectId - The project to stop watching
   */
  async unregisterProject(projectId: string): Promise<void> {
    const managed = this.watchers.get(projectId);
    if (!managed) return;

    // Cancel all pending debounce timers
    for (const timer of managed.debounceTimers.values()) {
      clearTimeout(timer);
    }
    managed.debounceTimers.clear();

    // Close chokidar
    await managed.watcher.close();
    this.watchers.delete(projectId);

    log.info("Watcher unregistered", { projectId });
  }

  /**
   * Get the status of all registered watchers.
   */
  getStatus(): WatcherStatus[] {
    const statuses: WatcherStatus[] = [];
    for (const [projectId, managed] of this.watchers) {
      statuses.push({
        projectId,
        rootDir: managed.rootDir,
        isActive: managed.isReady,
        fileCount: managed.fileCount,
        lastEventAt: managed.lastEventAt,
      });
    }
    return statuses;
  }

  /**
   * Get the file tree snapshot for a specific project.
   * Returns all currently tracked files as relative paths.
   */
  async getFileTree(projectId: string): Promise<string[]> {
    const managed = this.watchers.get(projectId);
    if (!managed) {
      throw new Error(
        `[Omnecor FileWatcher] No watcher registered for project "${projectId}"`
      );
    }

    // chokidar exposes getWatched() which returns { dir: [files] }
    const watched = managed.watcher.getWatched();
    const files: string[] = [];

    for (const [dir, entries] of Object.entries(watched)) {
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relativePath = path.relative(managed.rootDir, fullPath);
        files.push(relativePath);
      }
    }

    return files.sort();
  }

  /**
   * Gracefully shut down all watchers. Call on process exit.
   */
  async shutdown(): Promise<void> {
    const projectIds = Array.from(this.watchers.keys());
    await Promise.all(projectIds.map(id => this.unregisterProject(id)));
    this.removeAllListeners();
    log.info("All watchers shut down");
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Debounce and emit a structured FileEvent.
   * Uses per-(event, path) debouncing so rapid saves collapse into one event.
   */
  private handleEvent(
    managed: ManagedWatcher,
    eventType: FileEvent["eventType"],
    rawPath: string
  ): void {
    const filePath = path.resolve(rawPath);
    const timerKey = `${eventType}:${filePath}`;

    // Track file count
    if (eventType === "add") managed.fileCount++;
    if (eventType === "unlink")
      managed.fileCount = Math.max(0, managed.fileCount - 1);

    // Clear existing debounce timer for this (event, path) pair
    const existing = managed.debounceTimers.get(timerKey);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    // Schedule the actual emit
    const timer = setTimeout(async () => {
      managed.debounceTimers.delete(timerKey);

      let size: number | null = null;
      if (eventType !== "unlink" && eventType !== "unlinkDir") {
        try {
          const stat = await fs.stat(filePath);
          size = stat.size;
        } catch {
          // File may have been deleted between event and stat
          size = null;
        }
      }

      const event: FileEvent = {
        projectId: managed.projectId,
        filePath,
        relativePath: path.relative(managed.rootDir, filePath),
        eventType,
        timestamp: new Date().toISOString(),
        size,
        extension: path.extname(filePath),
      };

      managed.lastEventAt = event.timestamp;

      // Emit the structured event for downstream consumers
      this.emit("fileEvent", event);
    }, this.debounceMs);

    managed.debounceTimers.set(timerKey, timer);
  }
}
