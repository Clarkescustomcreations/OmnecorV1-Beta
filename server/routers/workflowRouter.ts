/**
 * @file server/routers/workflowRouter.ts
 * @description Omnecor — Skill Workflow Router
 *
 * Server-side support for the five built-in agent workflows ported from the
 * Claude Code skills (architect / remember / review / recover / imprint) into
 * Omnecor's runtime command menu. The conversational workflows (architect,
 * recover, and the reasoning half of review) run client-side as Valet
 * system-preambles; this router provides the pieces that need server authority:
 *
 *  - reviewContext  — the current git diff + plan excerpt to ground a review
 *  - rememberSave   — compress the session via Valet and persist memory.md
 *  - rememberRestore— read back the saved memory + project context files
 *  - imprint        — extract UI patterns from a component and append to the
 *                     project's ui-registry.md
 *
 * Persistence is scoped to the active project under PATHS.projects and every
 * user-supplied path is run through validatePath. Commands are passed to git as
 * a discrete argument array (execFile, never a shell string).
 */

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { router, protectedProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { validatePath } from "../_core/security.js";
import { redactSensitive } from "../_core/redaction.js";
import { PATHS } from "../_core/paths.js";
import { AiProviderService } from "../core_services/services/AiProviderService.js";

const execFileAsync = promisify(execFile);

const MAX_DIFF_CHARS = 16000;
const MAX_TRANSCRIPT_CHARS = 24000;

/** Project ids are used as a directory segment — restrict to a safe slug. */
const projectIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid project id")
  .default("default");

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "function"]),
  content: z.string(),
});

/** Resolve and validate a per-project artifact path (memory.md / ui-registry.md). */
async function projectArtifactPath(
  projectId: string,
  fileName: string
): Promise<string> {
  const dir = path.join(PATHS.projects, projectId);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, fileName);
  // Enforce containment within the projects root even after symlink resolution.
  await validatePath(dir, PATHS.projects);
  return target;
}

// ── Remember: save instructions (ported from the remember skill) ──────────────
const REMEMBER_SAVE_SYSTEM = `You are compressing a development session into a hand-off memory note for a future session that starts with zero context. Capture only what a developer would genuinely need to continue: what was built (specific files/features), decisions made (and why), problems solved, current state (what works/partial/broken), the next concrete step, and open questions. Do not include a transcript or anything inferable from the codebase. NEVER include secrets, API keys, tokens, passwords, cookies, or connection strings — redact them as [REDACTED]. Output Markdown with these exact sections: "# Memory", "## What was built", "## Decisions made", "## Problems solved", "## Current state", "## Next session starts with", "## Open questions".`;

export const workflowRouter = router({
  /**
   * /review — return the working-tree diff and plan excerpts so Valet can run
   * the three-layer review (plan alignment / system integrity / production
   * readiness) against a concrete benchmark.
   */
  reviewContext: protectedProcedure
    .input(z.object({}).optional())
    .query(async () => {
      const cwd = process.cwd();
      let diffStat = "";
      let diff = "";
      let isRepo = true;
      try {
        const stat = await execFileAsync("git", ["diff", "--stat"], { cwd });
        diffStat = stat.stdout.trim();
        const full = await execFileAsync("git", ["diff"], {
          cwd,
          maxBuffer: 1024 * 1024 * 8,
        });
        diff = full.stdout.slice(0, MAX_DIFF_CHARS);
      } catch {
        isRepo = false;
      }

      // Plan excerpts ground the review benchmark. These are fixed app files,
      // not user-supplied paths.
      const planExcerpts: Record<string, string> = {};
      for (const rel of [
        "Context/Progress-Tracker.md",
        "Context/Build-Plan.md",
      ]) {
        try {
          const text = await fs.readFile(path.join(cwd, rel), "utf8");
          planExcerpts[rel] = text.slice(0, 4000);
        } catch {
          /* optional — skip if absent */
        }
      }

      return {
        isRepo,
        hasChanges: diffStat.length > 0,
        diffStat,
        diff,
        truncated: diff.length >= MAX_DIFF_CHARS,
        planExcerpts,
      };
    }),

  /**
   * /remember save — compress the session through Valet, redact secrets, and
   * persist to the project's memory.md.
   */
  rememberSave: protectedProcedure
    .input(
      z.object({
        projectId: projectIdSchema,
        providerId: z.string(),
        modelId: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        messages: z.array(messageSchema).min(1),
        /** Model-Fabric Phase 5/6 — honor the session's mesh-peer pin (see
         *  aiRouter's chatInputSchema for the full rationale) so a save
         *  summarization doesn't silently run somewhere other than the peer
         *  the user selected for this chat. */
        targetNodeId: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const transcript = input.messages
        .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join("\n\n")
        .slice(0, MAX_TRANSCRIPT_CHARS);

      let content: string;
      try {
        content = await AiProviderService.getInstance().chat({
          providerId: input.providerId,
          modelId: input.modelId,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          systemPrompt: REMEMBER_SAVE_SYSTEM,
          messages: [{ role: "user", content: transcript }],
          targetNodeId: input.targetNodeId,
        });
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Memory generation failed: ${(err as Error).message}`,
        });
      }

      // Defence in depth: redact anything secret-looking the model may have echoed.
      const redacted = redactSensitive(content).trim();
      const target = await projectArtifactPath(input.projectId, "memory.md");
      try {
        await fs.writeFile(target, `${redacted}\n`, "utf8");
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to write memory.md: ${(err as Error).message}`,
        });
      }

      return { saved: true, path: target, content: redacted };
    }),

  /**
   * /remember restore — read back the saved memory and key project context files.
   */
  rememberRestore: protectedProcedure
    .input(z.object({ projectId: projectIdSchema }))
    .query(async ({ input }) => {
      const target = await projectArtifactPath(input.projectId, "memory.md");
      let memory: string | null = null;
      try {
        memory = await fs.readFile(target, "utf8");
      } catch {
        memory = null;
      }
      return { hasMemory: memory != null, memory, path: target };
    }),

  /**
   * /imprint — extract the visual-consistency patterns from a component file and
   * append an entry to the project's ui-registry.md.
   */
  imprint: protectedProcedure
    .input(
      z.object({
        projectId: projectIdSchema,
        filePath: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      // User-supplied path: must resolve inside the projects root.
      const safePath = await validatePath(input.filePath, PATHS.projects);
      const source = await fs.readFile(safePath, "utf8");

      const entry = buildImprintEntry(path.basename(safePath), source);
      const registry = await projectArtifactPath(
        input.projectId,
        "ui-registry.md"
      );
      let existing = "";
      try {
        existing = await fs.readFile(registry, "utf8");
      } catch {
        existing = "# UI Registry\n\nVisual patterns captured via /imprint.\n";
      }
      try {
        await fs.writeFile(
          registry,
          `${existing.trimEnd()}\n\n${entry}\n`,
          "utf8"
        );
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to write ui-registry.md: ${(err as Error).message}`,
        });
      }

      return { path: registry, entry };
    }),
});

/**
 * Pull the consistency-relevant Tailwind classes out of a component's className
 * attributes and render a registry entry. Deterministic — no model call needed.
 */
function buildImprintEntry(fileName: string, source: string): string {
  const classes = new Set<string>();
  const classRe = /className\s*=\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(source)) !== null) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }

  const pick = (re: RegExp): string => {
    const hits = [...classes].filter((c) => re.test(c));
    return hits.length ? hits.join(" ") : "—";
  };

  const rows: [string, string][] = [
    ["Background", pick(/^(bg-|dark:bg-)/)],
    ["Border", pick(/^(border($|-)|dark:border-)/)],
    ["Border radius", pick(/^rounded(-|$)/)],
    ["Text", pick(/^(text-|font-)/)],
    ["Spacing", pick(/^(p-|px-|py-|pt-|pb-|pl-|pr-|gap-|space-)/)],
    ["Hover", pick(/^hover:/)],
    ["Shadow", pick(/^shadow(-|$)/)],
  ];

  const date = new Date().toISOString().slice(0, 10);
  const table = rows
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");

  return [
    `### ${fileName}`,
    ``,
    `Captured: ${date}`,
    ``,
    `| Property | Class |`,
    `| --- | --- |`,
    table,
  ].join("\n");
}
