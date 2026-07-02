/**
 * Batch B — Item 12: validatePath guard
 *
 * Verifies that validatePath from server/_core/security.ts:
 * - Rejects path traversal attempts (../../etc/passwd style)
 * - Rejects absolute paths to sensitive system directories
 * - Prevents sibling-directory prefix bypass (isWithin separator check)
 * - Accepts valid paths within the allowed PATHS directories
 */
import { describe, it, expect } from "vitest";
import path from "path";

// Dynamic import so PATHS is resolved AFTER Vitest's test environment is set up
const { validatePath } = await import("../_core/security.js");
const { PATHS } = await import("../_core/paths.js");

describe("validatePath — path traversal rejection", () => {
  it("rejects relative traversal sequences (../../etc/passwd)", async () => {
    await expect(validatePath("../../etc/passwd"))
      .rejects.toThrow("Security Violation");
  });

  it("rejects deep relative traversal (../../../../../root/.ssh/id_rsa)", async () => {
    await expect(validatePath("../../../../../root/.ssh/id_rsa"))
      .rejects.toThrow("Security Violation");
  });

  it("rejects traversal with mixed separators (data/../../../etc/shadow)", async () => {
    await expect(validatePath("data/../../../etc/shadow"))
      .rejects.toThrow("Security Violation");
  });

  it("rejects absolute path directly into /etc", async () => {
    await expect(validatePath("/etc/passwd"))
      .rejects.toThrow("Security Violation");
  });

  it("rejects absolute path to /root (sensitive directory)", async () => {
    await expect(validatePath("/root/.bashrc"))
      .rejects.toThrow("Security Violation");
  });

  it("rejects absolute path to /var/log", async () => {
    await expect(validatePath("/var/log/syslog"))
      .rejects.toThrow("Security Violation");
  });

  it("rejects absolute path to /proc (kernel pseudo-filesystem)", async () => {
    await expect(validatePath("/proc/1/environ"))
      .rejects.toThrow("Security Violation");
  });
});

describe("validatePath — isWithin separator-bypass protection", () => {
  it("rejects a sibling directory that shares a prefix with an allowed dir", async () => {
    // If PATHS.data is <cwd>/data/data, then data-evil is NOT within it.
    // A naive startsWith("/data") check would pass this; the separator check catches it.
    const siblingPath = path.join(PATHS.data + "-evil", "file.txt");
    await expect(validatePath(siblingPath))
      .rejects.toThrow("Security Violation");
  });

  it("rejects a directory at the same level as PATHS.models with a similar prefix", async () => {
    const siblingPath = path.join(PATHS.models + "-malicious", "payload");
    await expect(validatePath(siblingPath))
      .rejects.toThrow("Security Violation");
  });
});

describe("validatePath — valid paths within allowed directories", () => {
  it("accepts a path directly inside PATHS.data", async () => {
    // The file does not need to exist — fs.realpath falls back to absolutePath
    // when the path doesn't resolve on disk, and the check proceeds against
    // the resolved absolute path.
    const validPath = path.join(PATHS.data, "omnecor.db");
    const result = await validatePath(validPath);
    expect(result).toBe(path.resolve(validPath));
  });

  it("accepts a nested path inside PATHS.models", async () => {
    const validPath = path.join(PATHS.models, "llama", "weights.gguf");
    const result = await validatePath(validPath);
    expect(result).toBe(path.resolve(validPath));
  });

  it("accepts a path inside PATHS.exports", async () => {
    const validPath = path.join(PATHS.exports, "dataset_2026.jsonl");
    const result = await validatePath(validPath);
    expect(result).toBe(path.resolve(validPath));
  });

  it("accepts a path inside PATHS.projects", async () => {
    const validPath = path.join(PATHS.projects, "my-project", "notes.md");
    const result = await validatePath(validPath);
    expect(result).toBe(path.resolve(validPath));
  });

  it("returns the normalized absolute path (no trailing dots or redundant separators)", async () => {
    const validPath = path.join(PATHS.data, ".", "sub", "..", "file.txt");
    const result = await validatePath(validPath);
    // path.resolve normalizes away '.' and '..' as long as the final path stays in-bounds
    expect(result).toBe(path.resolve(validPath));
    expect(result).not.toContain("/..");
    expect(result).not.toContain("/.");
  });
});

describe("validatePath — with explicit baseDir parameter", () => {
  it("rejects a path that escapes the provided baseDir even if within PATHS.data", async () => {
    // A subdirectory as baseDir means siblings of that subdirectory are rejected.
    const subDir = path.join(PATHS.data, "safe-subdir");
    const escapingPath = path.join(PATHS.data, "other-subdir", "file.txt");
    await expect(validatePath(escapingPath, subDir))
      .rejects.toThrow("Security Violation");
  });

  it("accepts a path that is within the provided baseDir", async () => {
    const baseDir = PATHS.data;
    const validPath = path.join(PATHS.data, "allowed-file.txt");
    const result = await validatePath(validPath, baseDir);
    expect(result).toBe(path.resolve(validPath));
  });
});
