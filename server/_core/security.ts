import path from "path";
import fs from "fs/promises";
import { PATHS } from "./paths.js";

/**
 * Security Utility for path validation
 */

// os.homedir() intentionally excluded — it is too broad on multi-user systems
// and would allow traversal to SSH keys, credentials, and sibling project dirs.
const ALLOWED_DIRECTORIES = [
  PATHS.data,
  PATHS.models,
  PATHS.exports,
  PATHS.projects,
];

/**
 * Validates that a path is within the allowed directories and does not contain traversal sequences.
 * 
 * @param userPath - The path provided by the user
 * @param baseDir - Optional root directory that the path MUST be within
 * @returns The resolved absolute path if valid
 * @throws Error if validation fails
 */
/**
 * Separator-aware containment check.
 *
 * A plain `startsWith` would treat `/data-evil` as being inside `/data`, allowing
 * a sibling-directory prefix bypass. A child path is only contained when it equals
 * the parent or sits beneath it across a real path separator.
 */
function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

export async function validatePath(userPath: string, baseDir?: string): Promise<string> {
  // 1. Resolve absolute path
  const absolutePath = path.resolve(process.cwd(), userPath);

  // 2. Ensure we check actual disk location (mitigates symlink injection)
  const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);

  // 3. If baseDir is provided, the path MUST be within it
  if (baseDir) {
    const resolvedBase = path.resolve(process.cwd(), baseDir);
    const realBase = await fs.realpath(resolvedBase).catch(() => resolvedBase);

    if (!isWithin(realPath, realBase)) {
      throw new Error(`Security Violation: Path ${userPath} is outside of allowed base ${baseDir}.`);
    }
  }

  // 4. Check against global allowed directories
  const isAllowed = ALLOWED_DIRECTORIES.some(dir => isWithin(realPath, path.resolve(dir)));

  if (!isAllowed) {
    throw new Error(`Security Violation: Path ${userPath} is not in an allowed directory.`);
  }

  // 5. Explicitly block sensitive system directories even if they happen to be in home (unlikely)
  const sensitiveDirs = ['/etc', '/var/log', '/root', '/boot', '/sys', '/proc'];
  if (sensitiveDirs.some(dir => isWithin(realPath, dir))) {
     throw new Error(`Security Violation: Access to system directory ${realPath} is forbidden.`);
  }

  return realPath;
}
