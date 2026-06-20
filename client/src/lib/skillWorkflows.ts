/**
 * @file client/src/lib/skillWorkflows.ts
 * @description Omnecor — built-in skill workflows
 *
 * Ports the five Claude Code skills documented in docs/ai-agents/Skills/* into
 * Omnecor runtime commands. Each workflow injects a system preamble that steers
 * Valet (the runtime AI) to run the skill conversationally. The action-oriented
 * workflows (remember, imprint) additionally call workflowRouter on the server
 * to persist/restore state; that wiring lives in the command handler.
 */

export type SkillWorkflowId =
  | "architect"
  | "review"
  | "recover"
  | "imprint"
  | "plan"
  | "remember";

export interface SkillWorkflow {
  id: SkillWorkflowId;
  /** Slash command label, e.g. "/architect". */
  command: string;
  /** One-line description for the command menus. */
  description: string;
  /** Whether the command produces a server side-effect (persist/read/diff). */
  hasServerAction: boolean;
  /** System preamble injected to steer Valet through the workflow. */
  preamble: string;
}

const ARCHITECT_PREAMBLE = `You are now running the ARCHITECT workflow — a senior engineer thinking alongside the developer before any code is written. This is a thinking session, not an interrogation.
1. Take stock of what already exists (read the conversation, context files, and any code referenced). Do not ask about anything already answered.
2. Align on language: pick 3–5 terms that could be read more than one way, state how you're interpreting each, and ask the developer to confirm or correct.
3. Surface only the decisions that would meaningfully change what gets built — one at a time. For each, share what you would do and why, then listen before moving on.
4. When every decision that changes the implementation is settled, say "Blueprint ready." and produce a concise Implementation Plan (What we're building / Language agreed / Decisions made / Assumptions / How to build it).
Wait for explicit confirmation before any implementation begins.`;

const REVIEW_PREAMBLE = `You are now running the REVIEW workflow. Building is done when code is CORRECT, not just when it runs. You report issues; you do NOT fix them.
A working-tree diff and plan excerpts have been provided as the benchmark. Review in three layers and label each PASS or ISSUES FOUND:
- Layer 1 — Plan alignment: is everything that was planned present, and nothing unplanned added?
- Layer 2 — System integrity: architecture boundaries, design tokens (no hardcoded hex / raw color classes), code standards, reuse of existing patterns.
- Layer 3 — Production readiness: error handling, edge/empty/loading states, obvious bugs.
Label every issue Critical / Important / Minor. End with a summary count. Then stop — do not fix anything until the developer asks.`;

const RECOVER_PREAMBLE = `You are now running the RECOVER workflow. Not every problem is a bug; diagnose the failure type BEFORE prescribing a response.
First ask: what did you expect, what happened instead, and how many fixes have you already tried? Then classify:
- Failure Mode 1 (a specific thing is broken): isolated, first/second attempt → Targeted fix. State the ROOT CAUSE (distinct from the symptom) before proposing a precise fix, and wait for confirmation.
- Failure Mode 2 (the session has gone wrong): multiple fixes compounding → Hard reset. Don't keep patching; extract a brief reset note and advise starting fresh.
- Failure Mode 3 (the foundation is wrong): runs but fundamentally wrong → Rethink. Name the wrong assumption vs reality, propose the correct approach, and wait for agreement before rebuilding.
Tell the developer which failure mode this is and why, before proposing the response.`;

const REMEMBER_PREAMBLE = `You are running the REMEMBER workflow. "/remember save" compresses this session to the project's memory.md; "/remember restore" reads it back. Never persist secrets (API keys, tokens, passwords, cookies, connection strings) — redact them. On restore, summarise where things stand (last built / current state / decisions in place / next up) and ask the developer to confirm before continuing.`;

const IMPRINT_PREAMBLE = `You are running the IMPRINT workflow. After a UI component is built, its visual-consistency patterns (background, border, radius, text, spacing, hover, shadow) are captured to the project's ui-registry.md so every future component matches. Confirm what was captured and flag anything that looked inconsistent.`;

const PLAN_PREAMBLE = `You are now running the PLAN workflow (Valet Router's interview wizard). You will guide the developer in setting up a new project or major feature suite.
1. Start by asking for the core goal or describing the project.
2. Ask probing questions to gather requirements until you have enough to create a standard project-docs/ suite (Project-Overview, Architecture, UI-Rules, etc).
3. Draft a build plan and confirm with the developer.`;

export const SKILL_WORKFLOWS: Record<SkillWorkflowId, SkillWorkflow> = {
  architect: {
    id: "architect",
    command: "/architect",
    description: "Think through a build like a senior engineer before coding",
    hasServerAction: false,
    preamble: ARCHITECT_PREAMBLE,
  },
  remember: {
    id: "remember",
    command: "/remember",
    description: "Save or restore session memory (use save | restore)",
    hasServerAction: true,
    preamble: REMEMBER_PREAMBLE,
  },
  review: {
    id: "review",
    command: "/review",
    description: "Three-layer review of the current changes against the plan",
    hasServerAction: true,
    preamble: REVIEW_PREAMBLE,
  },
  recover: {
    id: "recover",
    command: "/recover",
    description: "Diagnose a failure before deciding how to respond",
    hasServerAction: false,
    preamble: RECOVER_PREAMBLE,
  },
  imprint: {
    id: "imprint",
    command: "/imprint",
    description: "Capture a component's UI patterns to the registry",
    hasServerAction: true,
    preamble: IMPRINT_PREAMBLE,
  },
  plan: {
    id: "plan",
    command: "/plan",
    description: "Start guided project planning with Valet",
    hasServerAction: false,
    preamble: PLAN_PREAMBLE,
  },
};

export const SKILL_WORKFLOW_LIST: SkillWorkflow[] =
  Object.values(SKILL_WORKFLOWS);
