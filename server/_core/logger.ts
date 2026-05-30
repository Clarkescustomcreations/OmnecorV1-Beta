type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

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
}

export function createLogger(namespace: string) {
  return {
    debug: (msg: string, data?: unknown) => log("debug", namespace, msg, data),
    info:  (msg: string, data?: unknown) => log("info",  namespace, msg, data),
    warn:  (msg: string, data?: unknown) => log("warn",  namespace, msg, data),
    error: (msg: string, data?: unknown) => log("error", namespace, msg, data),
  };
}
