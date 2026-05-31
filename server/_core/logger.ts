import fs from "fs";
import path from "path";
import os from "os";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ─── Immutable Audit Log (Standards: Operational §Observability) ─────────────
// Append-only file stream. "Unalterable" here means write-only O_APPEND mode —
// the OS kernel guarantees each write is atomic and sequential, preventing
// in-place modification of earlier entries.
const AUDIT_LOG_DIR = path.join(os.homedir(), ".omnecor", "logs");
const AUDIT_LOG_PATH = path.join(AUDIT_LOG_DIR, "audit.log");
let _auditStream: fs.WriteStream | null = null;

function getAuditStream(): fs.WriteStream | null {
  if (_auditStream) return _auditStream;
  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true, mode: 0o700 });
    _auditStream = fs.createWriteStream(AUDIT_LOG_PATH, { flags: "a", mode: 0o600 });
    _auditStream.on("error", () => { _auditStream = null; });
    return _auditStream;
  } catch {
    return null;
  }
}

function writeAuditEntry(level: LogLevel, namespace: string, message: string, data?: unknown): void {
  const stream = getAuditStream();
  if (!stream) return;
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      ns: namespace,
      msg: message,
      ...(data !== undefined ? { data } : {}),
    });
    stream.write(entry + "\n");
  } catch {
    // Never throw from inside the logger
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function getConfiguredLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LEVELS) return envLevel as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function log(level: LogLevel, namespace: string, message: string, data?: unknown): void {
  const configuredLevel = getConfiguredLevel();
  if (LEVELS[level] < LEVELS[configuredLevel]) return;

  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${namespace}]`;

  if (data !== undefined) {
    if (level === "error") console.error(prefix, message, data);
    else if (level === "warn") console.warn(prefix, message, data);
    else console.log(prefix, message, data);
  } else {
    if (level === "error") console.error(prefix, message);
    else if (level === "warn") console.warn(prefix, message);
    else console.log(prefix, message);
  }

  // Persist to append-only audit log: all warn/error entries always; info/debug
  // only when running in production to avoid log bloat during development.
  if (LEVELS[level] >= LEVELS["warn"] || process.env.NODE_ENV === "production") {
    writeAuditEntry(level, namespace, message, data);
  }
}

export function createLogger(namespace: string) {
  return {
    debug: (msg: string, data?: unknown) => log("debug", namespace, msg, data),
    info:  (msg: string, data?: unknown) => log("info",  namespace, msg, data),
    warn:  (msg: string, data?: unknown) => log("warn",  namespace, msg, data),
    error: (msg: string, data?: unknown) => log("error", namespace, msg, data),
  };
}

/** Flush and close the audit log stream gracefully on shutdown. */
export function closeAuditLog(): Promise<void> {
  return new Promise(resolve => {
    if (!_auditStream) { resolve(); return; }
    _auditStream.end(resolve);
    _auditStream = null;
  });
}
