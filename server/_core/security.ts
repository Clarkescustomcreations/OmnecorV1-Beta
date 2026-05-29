import path from "path";
import fs from "fs/promises";

/**
 * Security Utility for path validation
 */

const ALLOWED_DIRECTORIES = [
  process.env.DATA_DIR || path.join(process.cwd(), "data"),
  process.env.MODELS_DIR || path.join(process.cwd(), "models"),
  process.env.OUTPUT_DIR || path.join(process.cwd(), "exports"),
  process.env.PROJECTS_DIR || path.join(process.cwd(), "projects"), // Added projects
];

/**
 * Validates that a path is within the allowed directories and does not contain traversal sequences.
 */
export async function validatePath(userPath: string, baseDir?: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), userPath);

  if (absolutePath.includes(path.join(process.cwd(), '..'))) {
    throw new Error("Security Violation: Path traversal detected.");
  }

  // Ensure we check actual disk location (mitigates symlink injection)
  const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);

  const isAllowed = ALLOWED_DIRECTORIES.some(dir =>
    realPath.startsWith(path.resolve(dir))
  );

  if (!isAllowed) {
    throw new Error(`Security Violation: Path ${userPath} is not allowed.`);
  }

  // Double check if path exists
  try {
    await fs.access(realPath);
  } catch {
    throw new Error(`File not found: ${userPath}`);
  }

  return realPath;
}
