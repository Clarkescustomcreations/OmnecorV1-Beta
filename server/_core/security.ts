import path from "path";
import fs from "fs/promises";
import os from "os";

/**
 * Security Utility for path validation
 */

const ALLOWED_DIRECTORIES = [
  process.env.DATA_DIR || path.join(process.cwd(), "data"),
  process.env.MODELS_DIR || path.join(process.cwd(), "models"),
  process.env.OUTPUT_DIR || path.join(process.cwd(), "exports"),
  process.env.PROJECTS_DIR || path.join(process.cwd(), "projects"),
  os.homedir(), // Allow access within user's home directory for local workstation use
];

/**
 * Validates that a path is within the allowed directories and does not contain traversal sequences.
 * 
 * @param userPath - The path provided by the user
 * @param baseDir - Optional root directory that the path MUST be within
 * @returns The resolved absolute path if valid
 * @throws Error if validation fails
 */
export async function validatePath(userPath: string, baseDir?: string): Promise<string> {
  // 1. Resolve absolute path
  const absolutePath = path.resolve(process.cwd(), userPath);

  // 2. Ensure we check actual disk location (mitigates symlink injection)
  const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);

  // 3. If baseDir is provided, the path MUST be within it
  if (baseDir) {
    const resolvedBase = path.resolve(process.cwd(), baseDir);
    const realBase = await fs.realpath(resolvedBase).catch(() => resolvedBase);
    
    if (!realPath.startsWith(realBase)) {
      throw new Error(`Security Violation: Path ${userPath} is outside of allowed base ${baseDir}.`);
    }
  }

  // 4. Check against global allowed directories
  const isAllowed = ALLOWED_DIRECTORIES.some(dir => {
    const resolvedAllowed = path.resolve(dir);
    return realPath.startsWith(resolvedAllowed);
  });

  if (!isAllowed) {
    throw new Error(`Security Violation: Path ${userPath} is not in an allowed directory.`);
  }

  // 5. Explicitly block sensitive system directories even if they happen to be in home (unlikely)
  const sensitiveDirs = ['/etc', '/var/log', '/root', '/boot', '/sys', '/proc'];
  if (sensitiveDirs.some(dir => realPath.startsWith(dir))) {
     throw new Error(`Security Violation: Access to system directory ${realPath} is forbidden.`);
  }

  return realPath;
}
