/**
 * @file services/JobResultCondenser.ts
 * @description Omnecor — Async Job Result Condenser
 *
 * Turns the raw output of a long-running background job (build, download, train)
 * into a compact, token-efficient summary suitable for feeding back into an AI
 * agent's conversation when the job completes or fails.
 *
 * The whole point is token savings: a 50,000-line build log must never reach the
 * model verbatim. We condense it to:
 *   - the exit code + status (the single most important signal)
 *   - the last N stdout lines (where build summaries and final errors live)
 *   - regex-extracted error/warning/traceback lines from the full captured tail
 *   - an optional one-paragraph LLM summary (filled in by the caller, gated by
 *     execution mode so Sovereign mode never makes an external call)
 *
 * The core `condenseJobResult` is a pure function with no I/O so it is trivially
 * unit-testable; the optional LLM summary is layered on by the continuation hook.
 */

/** Terminal state of a job, mirrored from ProcessManagerService lifecycle. */
export type CondensedJobStatus = "completed" | "failed" | "cancelled";

/** Inputs the condenser needs — all already captured by ProcessManagerService. */
export interface CondenseJobInput {
  status: CondensedJobStatus;
  exitCode: number | null;
  durationMs: number | null;
  label: string;
  /** Last N stdout lines retained by ProcessManager raw capture. */
  stdoutTail: string[];
  /** Captured stderr buffer (already capped at ~10KB by ProcessManager). */
  stderr: string;
}

/** Knobs for how aggressively to condense. */
export interface CondenseOptions {
  /** How many trailing stdout lines to keep in the summary (default 60). */
  tailLines?: number;
  /** Max extracted error lines to keep (default 20). */
  maxErrors?: number;
}

/** The compact, agent-facing result. */
export interface CondensedJobResult {
  status: CondensedJobStatus;
  exitCode: number | null;
  durationMs: number | null;
  label: string;
  /** Trailing stdout lines (most relevant tail of the log). */
  tail: string[];
  /** Regex-extracted error/warning/traceback lines from the full capture. */
  errors: string[];
  /** Trimmed stderr tail. */
  stderr: string;
  /** Optional one-paragraph LLM summary — filled in by the continuation hook. */
  summary?: string;
}

/**
 * Lines that look like errors, failures, or stack traces. Intentionally broad —
 * a missed warning is cheaper than burying a real failure. Case-insensitive.
 */
const ERROR_PATTERN =
  /error\b|errno\b|\b(failed|failure|fatal|traceback|exception|panic|cannot|not found|no such file|undefined reference|segfault|assertion|unhandled|rejected)\b|^\s*E[A-Z]{2,}:|✗|❌/i;

/** Lines that are pure noise even if they match the error pattern. */
const NOISE_PATTERN = /\b0 errors?\b|errors?: 0\b|no errors\b/i;

/**
 * Condense a finished job's raw output into a compact, agent-facing result.
 * Pure — no I/O, no LLM. Deterministic for a given input.
 */
export function condenseJobResult(
  input: CondenseJobInput,
  options: CondenseOptions = {}
): CondensedJobResult {
  const tailLines = options.tailLines ?? 60;
  const maxErrors = options.maxErrors ?? 20;

  const stdoutTail = input.stdoutTail ?? [];
  const stderrLines = (input.stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Scan the full captured surface (stdout tail + stderr) for error-like lines.
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const line of [...stdoutTail, ...stderrLines]) {
    if (errors.length >= maxErrors) break;
    if (!ERROR_PATTERN.test(line) || NOISE_PATTERN.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    errors.push(line);
  }

  return {
    status: input.status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    label: input.label,
    tail: stdoutTail.slice(-tailLines),
    errors,
    stderr: stderrLines.slice(-tailLines).join("\n"),
    summary: undefined,
  };
}

/** Human-readable duration for the agent-facing block. */
function formatDuration(ms: number | null): string {
  if (ms == null) return "unknown duration";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/**
 * Render a condensed result as a compact text block to inject into the agent's
 * conversation as the delayed tool/job result. This is the token-budgeted
 * payload that re-prompts the model when a long job finishes.
 */
export function formatCondensedResultForAgent(result: CondensedJobResult): string {
  const ok = result.status === "completed" && (result.exitCode ?? 0) === 0;
  const header =
    `[Background job ${ok ? "completed" : result.status}] "${result.label}" ` +
    `— exit ${result.exitCode ?? "n/a"}, ${formatDuration(result.durationMs)}`;

  const parts: string[] = [header];

  if (result.summary) {
    parts.push(`\nSummary: ${result.summary}`);
  }

  if (result.errors.length > 0) {
    parts.push(
      `\nExtracted errors (${result.errors.length}):\n` +
        result.errors.map((e) => `  ${e}`).join("\n")
    );
  }

  if (result.tail.length > 0) {
    parts.push(
      `\nOutput tail (last ${result.tail.length} lines):\n` +
        "```\n" +
        result.tail.join("\n") +
        "\n```"
    );
  }

  if (result.errors.length === 0 && result.tail.length === 0 && result.stderr) {
    parts.push(`\nstderr:\n\`\`\`\n${result.stderr}\n\`\`\``);
  }

  return parts.join("\n");
}
