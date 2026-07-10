/**
 * Unit tests for the security-relevant pure helpers behind
 * `aiProvider.runCodeSnippet`: which map roots are usable filesystem targets,
 * how a caller-supplied filename is sanitized (no path traversal), and how a
 * fenced-code language maps to an interpreter. The spawn/track/fs side-effects
 * are exercised live; these lock the branching that keeps writes safe.
 */
import { describe, it, expect } from "vitest";
import path from "path";
import {
  isUsableFsRoot,
  resolveInterpreter,
  sanitizeFilename,
} from "../routers/aiProviderRouter.js";

describe("isUsableFsRoot", () => {
  it("accepts real absolute filesystem paths", () => {
    expect(isUsableFsRoot("/home/user/project")).toBe(true);
  });
  it("rejects decorative pseudo-roots (github://, integration://)", () => {
    expect(isUsableFsRoot("github:/Owner/Repo")).toBe(false);
    expect(isUsableFsRoot("integration://drive/folder")).toBe(false);
  });
  it("rejects relative paths", () => {
    expect(isUsableFsRoot("project/src")).toBe(false);
    expect(isUsableFsRoot("")).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips path traversal and directory components to a bare basename", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("/abs/evil.py")).toBe("evil.py");
    expect(sanitizeFilename("weird name!.py")).toBe("weird_name_.py");
  });
  it("never yields a leading-dot / hidden or empty name", () => {
    expect(sanitizeFilename(".bashrc")).toBe("bashrc");
    expect(sanitizeFilename("...")).toBeNull();
    expect(sanitizeFilename(undefined)).toBeNull();
  });
  it("keeps a result that is always a bare basename", () => {
    const out = sanitizeFilename("a/b/c.py");
    expect(out).not.toBeNull();
    expect(path.basename(out!)).toBe(out);
  });
});

describe("resolveInterpreter", () => {
  it("maps runnable languages to an interpreter + extension", () => {
    expect(resolveInterpreter("py")?.ext).toBe("py");
    expect(resolveInterpreter("python")?.command).toMatch(/python/);
    expect(resolveInterpreter("js")).toMatchObject({ command: "node", ext: "js" });
    expect(resolveInterpreter("typescript")).toMatchObject({ command: "tsx", ext: "ts" });
    expect(resolveInterpreter("SH")).toMatchObject({ command: "bash", ext: "sh" });
  });
  it("returns null for non-runnable / markup languages", () => {
    expect(resolveInterpreter("html")).toBeNull();
    expect(resolveInterpreter("markdown")).toBeNull();
    expect(resolveInterpreter("")).toBeNull();
  });
});
