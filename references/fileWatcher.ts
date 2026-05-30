/**
 * @file fileWatcher.ts
 * @description Omnecor — Robust File System Watcher
 *
 * Wraps chokidar in a strongly-typed EventEmitter so the rest of the
 * application can subscribe to file-system events without caring about
 * the underlying watcher internals.
 *
 * Features:
 *  - Typed event map via declaration merging on EventEmitter
 *  - Per-path debouncing (300 ms default) so rapid editor saves are
 *    collapsed into a single event
 *  - Graceful shutdown via `close()`
 */

import chokidar, { FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload emitted with every file-system event. */
export interface FileEvent {
  /** Absolute, normalised path that triggered the event. */
  filePath: string;
  /** ISO-8601 timestamp of when the (debounced) event was emitted. */
  timestamp: string;
}

/**
 * Strongly-typed event map for `FileSystemWatcher`.
 * Override EventEmitter's loose `string | symbol` signature so callers
 * get full IntelliSense on `.on()` / `.emit()`.
 */
export interface FileSystemWatcherEvents {
  /** A new file has appeared under the watched root. */
  add: (event: FileEvent) => void;
  /** An existing file's content has changed. */
  change: (event: FileEvent) => void;
  /** A file has been removed. */
  unlink: (event: FileEvent) => void;
  /** A directory has been removed. */
  unlinkDir: (event: FileEvent) => void;
  /** Chokidar is ready after the initial scan. */
  ready: () => void;
  /** A watcher-level error occurred. */
  error: (err: Error) => void;
}

// Augment EventEmitter so TypeScript enforces correct listener signatures.
export declare interface FileSystemWatcher {
  on<K extends keyof FileSystemWatcherEvents>(
    event: K,
    listener: FileSystemWatcherEvents[K]
  ): this;
  emit<K extends keyof FileSystemWatcherEvents>(
    event: K,
    ...args: Parameters<FileSystemWatcherEvents[K]>
  ): boolean;
  off<K extends keyof FileSystemWatcherEvents>(
    event: K,
    listener: FileSystemWatcherEvents[K]
  ): this;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FileSystemWatcherOptions {
  /**
   * Milliseconds to wait after the last event on a given path before
   * emitting.  Defaults to 300 ms.
   */
  debounceMs?: number;
  /**
   * Glob patterns to ignore.  Defaults to `node_modules` and hidden files.
   */
  ignored?: string | RegExp | Array<string | RegExp>;
  /**
   * Whether to watch subdirectories recursively.  Defaults to `true`.
   */
  recursive?: boolean;
}

const DEFAULT_OPTIONS: Required<FileSystemWatcherOptions> = {
  debounceMs: 300,
  ignored: /(^|[/\\])\..|(node_modules)/,
  recursive: true,
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * A Beta-V1, typed file system watcher for Omnecor.
 *
 * @example
 * ```ts
 * const watcher = new FileSystemWatcher('/workspace/project');
 *
 * watcher.on('change', ({ filePath, timestamp }) => {
 *   console.log(`[${timestamp}] changed: ${filePath}`);
 * });
 *
 * watcher.on('ready', () => console.log('Initial scan complete.'));
 *
 * // Later — e.g. on SIGTERM:
 * await watcher.close();
 * ```
 */
export class FileSystemWatcher extends EventEmitter {
  /** Absolute path of the directory being watched. */
  private readonly rootDir: string;

  /** Resolved configuration for this instance. */
  private readonly options: Required<FileSystemWatcherOptions>;

  /** The underlying chokidar FSWatcher instance. */
  private watcher: FSWatcher | null = null;

  /**
   * Debounce timers keyed by the *event key* (`"<eventName>:<filePath>"`).
   * Using separate keys per event type prevents a `change` and an `unlink`
   * on the same path from cancelling each other.
   */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();

  /** Whether `close()` has already been called. */
  private closed = false;

  constructor(rootDir: string, options: FileSystemWatcherOptions = {}) {
    super();

    this.rootDir = path.resolve(rootDir);
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.initWatcher();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Initialise and wire up the chokidar watcher. */
  private initWatcher(): void {
    this.watcher = chokidar.watch(this.rootDir, {
      ignored: this.options.ignored,
      persistent: true,
      ignoreInitial: false, // emit 'add' for existing files on start
      followSymlinks: false,
      depth: this.options.recursive ? undefined : 0,
      awaitWriteFinish: {
        // Let chokidar stabilise large writes before we even start our
        // debounce timer, reducing double-fire on slow file systems.
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // --- forwarded events ---------------------------------------------------
    this.watcher.on("add", p => this.debounce("add", p));
    this.watcher.on("change", p => this.debounce("change", p));
    this.watcher.on("unlink", p => this.debounce("unlink", p));
    this.watcher.on("unlinkDir", p => this.debounce("unlinkDir", p));

    // --- pass-through events ------------------------------------------------
    this.watcher.on("ready", () => this.emit("ready"));
    this.watcher.on("error", err =>
      this.emit("error", err instanceof Error ? err : new Error(String(err)))
    );
  }

  /**
   * Debounce an event for the given path.
   *
   * If the same `(event, filePath)` pair fires again within `debounceMs`,
   * the previous timer is cleared and a new one is started — so only the
   * *final* event in a burst is emitted.
   *
   * @param eventName - One of the four watched chokidar events.
   * @param rawPath   - Raw path string provided by chokidar.
   */
  private debounce(
    eventName: keyof Omit<FileSystemWatcherEvents, "ready" | "error">,
    rawPath: string
  ): void {
    const filePath = path.resolve(rawPath);
    const timerKey = `${eventName}:${filePath}`;

    // Clear any in-flight timer for this (event, path) pair.
    const existing = this.debounceTimers.get(timerKey);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    // Schedule the actual emit.
    const timer = setTimeout(() => {
      this.debounceTimers.delete(timerKey);

      const payload: FileEvent = {
        filePath,
        timestamp: new Date().toISOString(),
      };

      // TypeScript needs a cast here because the overloaded `emit` signature
      // is declared via interface merging and TS can't narrow through the
      // dynamic key at call-site.
      (this.emit as (e: string, p: FileEvent) => boolean)(eventName, payload);
    }, this.options.debounceMs);

    this.debounceTimers.set(timerKey, timer);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Gracefully stop watching the file system.
   *
   * - Cancels all pending debounce timers so no events fire after close.
   * - Closes the chokidar watcher and awaits its promise.
   * - Removes all EventEmitter listeners.
   * - Safe to call multiple times (subsequent calls are no-ops).
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Cancel every pending debounce timer.
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Stop chokidar.
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Drop all listeners so the instance can be GC'd.
    this.removeAllListeners();
  }

  /** Returns `true` if the watcher has been closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** The absolute root directory this instance is watching. */
  get root(): string {
    return this.rootDir;
  }
}
