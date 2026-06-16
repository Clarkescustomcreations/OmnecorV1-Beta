import { describe, it, expect } from "vitest";
import {
  condenseJobResult,
  formatCondensedResultForAgent,
  type CondenseJobInput,
} from "../phase2/services/JobResultCondenser.js";

const base: CondenseJobInput = {
  status: "completed",
  exitCode: 0,
  durationMs: 4200,
  label: "pnpm build",
  stdoutTail: [],
  stderr: "",
};

describe("condenseJobResult", () => {
  it("keeps only the last `tailLines` stdout lines", () => {
    const stdoutTail = Array.from({ length: 200 }, (_, i) => `line-${i}`);
    const result = condenseJobResult({ ...base, stdoutTail }, { tailLines: 10 });
    expect(result.tail).toHaveLength(10);
    expect(result.tail[0]).toBe("line-190");
    expect(result.tail.at(-1)).toBe("line-199");
  });

  it("extracts error/traceback lines from stdout and stderr", () => {
    const result = condenseJobResult({
      ...base,
      status: "failed",
      exitCode: 1,
      stdoutTail: ["Compiling module A", "ERROR: cannot find module 'foo'"],
      stderr: "Traceback (most recent call last):\n  ValueError: bad input",
    });
    expect(result.errors).toContain("ERROR: cannot find module 'foo'");
    expect(result.errors.some((e) => e.includes("Traceback"))).toBe(true);
    expect(result.errors.some((e) => e.includes("ValueError"))).toBe(true);
  });

  it("does not flag clean summary lines like '0 errors' as errors", () => {
    const result = condenseJobResult({
      ...base,
      stdoutTail: ["Build finished: 0 errors, 0 warnings", "All good."],
    });
    expect(result.errors).toHaveLength(0);
  });

  it("dedupes repeated error lines and caps at maxErrors", () => {
    const stdoutTail = Array.from({ length: 50 }, () => "ERROR: flaky thing");
    const result = condenseJobResult({ ...base, stdoutTail }, { maxErrors: 5 });
    // Deduped to a single unique line despite 50 occurrences.
    expect(result.errors).toEqual(["ERROR: flaky thing"]);
  });

  it("is pure — no summary unless the caller adds one", () => {
    const result = condenseJobResult(base);
    expect(result.summary).toBeUndefined();
  });
});

describe("formatCondensedResultForAgent", () => {
  it("renders a success header with exit code and duration", () => {
    const text = formatCondensedResultForAgent(condenseJobResult(base));
    expect(text).toContain("[Background job completed]");
    expect(text).toContain("pnpm build");
    expect(text).toContain("exit 0");
  });

  it("renders a failure header and surfaces extracted errors", () => {
    const result = condenseJobResult({
      ...base,
      status: "failed",
      exitCode: 2,
      stdoutTail: ["ERROR: build broke"],
    });
    const text = formatCondensedResultForAgent(result);
    expect(text).toContain("[Background job failed]");
    expect(text).toContain("exit 2");
    expect(text).toContain("ERROR: build broke");
  });

  it("includes an LLM summary when present", () => {
    const result = condenseJobResult(base);
    result.summary = "Build succeeded with no warnings.";
    const text = formatCondensedResultForAgent(result);
    expect(text).toContain("Summary: Build succeeded with no warnings.");
  });
});
