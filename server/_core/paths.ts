import path from "path";
import os from "os";
import fs from "fs";

/**
 * Omnecor — Centralized Path Resolution Utility
 * 
 * Ensures all application data (logs, databases, models, keys) are stored 
 * in a user-writable directory, especially when the application is 
 * installed in a read-only location like /opt.
 */

const APP_NAME = "omnecor";

function getBaseDataDir(): string {
  // 1. Explicit environment variable override
  if (process.env.OMNECOR_DATA) {
    return process.env.OMNECOR_DATA;
  }
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }

  // 2. Platform-specific standard paths
  const home = os.homedir();
  const platform = process.platform;

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), APP_NAME);
  }
  
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }

  // 3. Default for Linux/Unix: ~/.omnecor (consistent with existing project logic)
  // We check if we can write to the current directory's 'data' folder first
  // for local development convenience.
  if (process.env.NODE_ENV !== "production") {
    const localData = path.join(process.cwd(), "data");
    try {
      if (!fs.existsSync(localData)) {
        fs.mkdirSync(localData, { recursive: true });
      }
      fs.accessSync(localData, fs.constants.W_OK);
      return localData;
    } catch {
      // Fall through to home dir
    }
  }

  return path.join(home, ".omnecor");
}

const BASE_DIR = getBaseDataDir();

/**
 * Resolves a path relative to the application's base data directory.
 * Automatically creates the directory if it doesn't exist.
 */
export function resolveDataPath(relativePath: string): string {
  const fullPath = path.join(BASE_DIR, relativePath);
  const dir = path.extname(fullPath) ? path.dirname(fullPath) : fullPath;
  
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error(`[Paths] Failed to create directory: ${dir}`, err);
    }
  }
  
  return fullPath;
}

export const PATHS = {
  base: BASE_DIR,
  data: resolveDataPath("data"),
  logs: resolveDataPath("logs"),
  models: resolveDataPath("models"),
  // Full Hugging Face base-model repos (config + tokenizer + safetensors)
  // pre-downloaded for offline/sovereign fine-tuning in the LLM Builder. A
  // sibling of the runtime GGUF dir; the GGUF index only scans for .gguf so
  // safetensors repos here never collide with the runtime catalog.
  baseModels: resolveDataPath(path.join("models", "base")),
  keystore: resolveDataPath("keystore"),
  security: resolveDataPath("security"),
  backups: resolveDataPath("backups"),
  projects: resolveDataPath("projects"),
  exports: resolveDataPath("exports"),
  certs: resolveDataPath("certs"),
  sqlite: resolveDataPath(path.join("data", "omnecor.db")),
  valetRouter: resolveDataPath(path.join("models", "valet-router")),
};

/**
 * Initializes the path structure.
 */
export function initPaths(): void {
  Object.values(PATHS).forEach(p => {
    const dir = path.extname(p) ? path.dirname(p) : p;
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error(`[Paths] Initialization failed for ${dir}:`, err);
      }
    }
  });
}
