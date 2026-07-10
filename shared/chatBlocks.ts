/**
 * Agentic chat block contract — the single source of truth for how an assistant
 * turn is represented across the web UI, the server tool loop, and the Android APK.
 *
 * Historically an assistant reply was one growing markdown string. For the agentic
 * chat upgrade (see `Chats-Agentic-Upgrade.md`) a reply becomes an *ordered array*
 * of typed blocks so the UI can render a flush-left prose stream interleaved with
 * collapsible reasoning, and click-to-expand status boxes for the commands the AI
 * runs, the files it edits, the long jobs it starts, and the MCP tools it calls.
 *
 * Design rules:
 *  - Every block carries a stable `id` so a stream can update a block **in place**
 *    (one box per action — status/output/diff mutate on the same block, there are
 *    no separate call+result blocks).
 *  - `content` on `ChatMessage` remains the flattened text (for persistence, copy,
 *    export, and non-agentic providers). `blocks` is the render source of truth.
 *  - Status vocabularies mirror the real services they map to: tool statuses model
 *    the HITL approval lifecycle; job statuses mirror `AsyncJobService` DB states.
 */

// ---------------------------------------------------------------------------
// Status vocabularies
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a HITL-gated tool action (command / edit / mcp).
 *  - `pending`          — created, not yet dispatched
 *  - `pending_approval` — awaiting the user's HITL decision
 *  - `running`          — approved and executing
 *  - `success`          — finished, exit ok
 *  - `error`            — finished, failed / non-zero exit
 *  - `denied`           — the user rejected the HITL request
 */
export type ToolBlockStatus =
  | "pending"
  | "pending_approval"
  | "running"
  | "success"
  | "error"
  | "denied";

/** Terminal + non-terminal tool statuses that mean "the box shows a red dot". */
export const TOOL_FAILURE_STATUSES: readonly ToolBlockStatus[] = ["error", "denied"];

/**
 * Lifecycle of a long-running background job. Mirrors `AsyncJobService` DB status
 * values (`pending` / `running` / `completed` / `failed`) plus `cancelled` from
 * `CondensedJobStatus`, so a job block can be driven directly from those events.
 *
 * A job is also HITL-gated at start, so the vocabulary additionally carries
 * `pending_approval` (awaiting the user's decision to launch it) and `denied`
 * (the user rejected the launch) — the same single block flows from proposal
 * through approval into the async run, with no throwaway command box beforehand.
 */
export type JobBlockStatus =
  | "pending"
  | "pending_approval"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "denied";

/** Discriminator values for the block union. */
export type AssistantBlockType =
  | "text"
  | "thinking"
  | "command"
  | "edit"
  | "job"
  | "mcp"
  | "subagent";

// ---------------------------------------------------------------------------
// Diff shape (edit blocks)
// ---------------------------------------------------------------------------

/**
 * Before/after snapshot for a file edit, rendered side-by-side in the edit box
 * overlay. `before`/`after` are the full file contents (or the affected region)
 * so the UI can compute or display a diff without a round-trip. Edits are applied
 * to disk only on HITL approval.
 */
export interface FileDiff {
  /** File contents before the edit (empty string for a newly-created file). */
  before: string;
  /** File contents after the edit. */
  after: string;
  /** Syntax-highlight hint (e.g. "ts", "tsx", "py"). Derived from the path. */
  language?: string;
  /** Line counts, when computed server-side. Purely for the box summary. */
  additions?: number;
  deletions?: number;
}

// ---------------------------------------------------------------------------
// Block union
// ---------------------------------------------------------------------------

/** Fields shared by every block. */
interface BaseBlock {
  /** Stable id — the stream updates a block in place by matching this. */
  id: string;
}

/** Plain markdown prose streamed flush-left in the AI stream (no bubble). */
export interface TextBlock extends BaseBlock {
  type: "text";
  text: string;
}

/**
 * The model's real reasoning, shown in a collapsible (default-closed) section.
 * `done` marks when the reasoning stream has closed. When a provider streams no
 * reasoning, no `thinking` block is emitted and the UI shows the decorative
 * loading-quote animation instead.
 */
export interface ThinkingBlock extends BaseBlock {
  type: "thinking";
  text: string;
  done: boolean;
}

/** A shell command the AI ran (or proposed) — via ProcessManager, HITL-gated. */
export interface CommandBlock extends BaseBlock {
  type: "command";
  /** The executable (never shell-interpolated — spawned with `args`). */
  command: string;
  args?: string[];
  /** Working directory — scoped to the active neural map's root directories. */
  cwd?: string;
  status: ToolBlockStatus;
  exitCode?: number;
  /** Combined stdout/stderr, shown in the expandable box overlay. */
  output?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** A file edit the AI applied (or proposed) — search/replace, HITL-gated. */
export interface EditBlock extends BaseBlock {
  type: "edit";
  /** Repo-relative or map-scoped path (validated via `validatePath` server-side). */
  path: string;
  status: ToolBlockStatus;
  /** Before/after for the side-by-side diff overlay; absent until computed. */
  diff?: FileDiff;
}

/** A long-running background job (build / download / process). */
export interface JobBlock extends BaseBlock {
  type: "job";
  /**
   * `AsyncJobService` job id — the box subscribes to this for live status.
   * Empty until the job is approved and spawned (the block exists earlier for
   * the `pending_approval` HITL step, before an id is assigned).
   */
  jobId: string;
  /** Human label for the box (e.g. "pnpm build", "download llama-3-8b"). */
  label: string;
  /** The executable to run (shown in the approval box; spawned with `args`). */
  command?: string;
  args?: string[];
  /** Working directory — scoped to the active neural map's root directories. */
  cwd?: string;
  status: JobBlockStatus;
  kind?: "build" | "download" | "process" | "other";
  /** 0–100 when the job reports progress; omitted when indeterminate. */
  progress?: number;
  /** Condensed result/tail output surfaced once the job pings completion. */
  output?: string;
}

/** An MCP tool / skill invocation. */
export interface McpBlock extends BaseBlock {
  type: "mcp";
  /** MCP server id, when the tool is namespaced to one. */
  server?: string;
  tool: string;
  /** Display title for the box; falls back to `tool`. */
  title?: string;
  status: ToolBlockStatus;
  args?: unknown;
  result?: string;
}

/**
 * A task delegated to a full sub-agent on an OMMESH peer (see `Mesh-Delegation.md`).
 * Rendered in the *parent* chat as a status chip; the run itself streams into its
 * own managed conversation (tap-through via `conversationId`). Lifecycle reuses
 * `JobBlockStatus` because the parent-side semantics are start_job-like: the
 * spawn is HITL-gated (`pending_approval` / `denied`), the turn ends when the
 * delegation launches (`running`), and the condensed result lands on completion.
 */
export interface SubAgentBlock extends BaseBlock {
  type: "subagent";
  /** Delegation task id — correlates the block, the managed conversation, and
   *  the peer-side run (also the peer's sandbox directory name). */
  taskId: string;
  /** Target mesh node id (stable identity) + its human-readable name. */
  nodeId: string;
  nodeName?: string;
  /** Short human label for the delegated task (shown on the chip). */
  label: string;
  /** Origin conversation id of the managed chat — set once created; the chip's
   *  tap-through target. */
  conversationId?: string;
  status: JobBlockStatus;
  /** Explicit peer directory requested at spawn — shown in the approval box so
   *  scope is granted knowingly. Absent = the per-task sandbox. */
  scopePath?: string;
  /** Model backing the sub-agent, when the spawn named one. */
  modelId?: string;
  /** Condensed final summary once the delegated run's first turn completes —
   *  the same text that re-prompts the parent model. */
  output?: string;
}

/** The ordered, in-place-updatable representation of an assistant turn. */
export type AssistantBlock =
  | TextBlock
  | ThinkingBlock
  | CommandBlock
  | EditBlock
  | JobBlock
  | McpBlock
  | SubAgentBlock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True for the block types rendered as a click-to-expand status box. */
export function isToolBlock(
  block: AssistantBlock
): block is CommandBlock | EditBlock | JobBlock | McpBlock | SubAgentBlock {
  return (
    block.type === "command" ||
    block.type === "edit" ||
    block.type === "job" ||
    block.type === "mcp" ||
    block.type === "subagent"
  );
}

/**
 * Map any block's status to the box status-dot color intent.
 *  - `success`  → green
 *  - `error`    → red
 *  - `running`  → busy/amber (in-flight)
 *  - `idle`     → neutral (pending / awaiting approval)
 */
export type BlockDotIntent = "success" | "error" | "running" | "idle";

export function blockDotIntent(block: AssistantBlock): BlockDotIntent {
  if (block.type === "text" || block.type === "thinking") return "idle";
  if (block.type === "job" || block.type === "subagent") {
    switch (block.status) {
      case "completed":
        return "success";
      case "failed":
      case "cancelled":
      case "denied":
        return "error";
      case "running":
        return "running";
      default:
        // pending | pending_approval — neutral until it launches.
        return "idle";
    }
  }
  // command | edit | mcp — ToolBlockStatus
  switch (block.status) {
    case "success":
      return "success";
    case "error":
    case "denied":
      return "error";
    case "running":
      return "running";
    default:
      return "idle";
  }
}

/**
 * Flatten a block array to the plain-text `content` string kept on `ChatMessage`
 * for persistence, copy, export, and non-agentic providers. Reasoning and tool
 * boxes are summarized so the text form is faithful but readable — the `blocks`
 * array remains the authoritative render source.
 */
export function flattenBlocksToText(blocks: AssistantBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        break;
      case "thinking":
        // Reasoning is not part of the answer text; omit from the flattened form.
        break;
      case "command": {
        const cmd = [block.command, ...(block.args ?? [])].join(" ");
        parts.push(`\n\`\`\`sh\n$ ${cmd}\n${block.output ?? ""}\n\`\`\``);
        break;
      }
      case "edit":
        parts.push(`\n_[edit: ${block.path} — ${block.status}]_`);
        break;
      case "job":
        parts.push(`\n_[job: ${block.label} — ${block.status}]_`);
        break;
      case "mcp":
        parts.push(`\n_[tool: ${block.title ?? block.tool} — ${block.status}]_`);
        break;
      case "subagent":
        parts.push(
          `\n_[sub-agent @ ${block.nodeName ?? block.nodeId}: ${block.label} — ${block.status}]_`
        );
        break;
    }
  }
  return parts.join("").trim();
}
