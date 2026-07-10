/**
 * Client-side folding of the agentic chat wire stream into an ordered
 * `AssistantBlock[]` — the mobile port of `client/src/lib/agentStream.ts`.
 *
 * The desktop server (`ChatAgentRunner`) emits a sequence of `AgentStreamEvent`s;
 * the Chat screen keeps one `AssistantBlock[]` per in-flight assistant message and
 * applies each event with `applyAgentEvent`. This is a pure, immutable reducer
 * (new array + new block objects, never mutation) so React Native sees a fresh
 * reference every event and the logic is unit-testable without a renderer.
 *
 * This is a deliberate vendored copy of the web reducer (not a cross-import into
 * `client/src/`): the mobile app stays self-contained — the same philosophy as
 * `app-router.ts`. The contract types come from the shared source of truth via
 * `@/lib/_core/agent-blocks`, so the block shapes can never drift.
 */
import type {
  AssistantBlock,
  JobBlock,
  JobBlockStatus,
  TextBlock,
  ThinkingBlock,
  AgentStreamEvent,
} from "@/lib/_core/agent-blocks";

/** Replace the block with `next.id`, or append it if it isn't present yet. */
function upsert(blocks: AssistantBlock[], next: AssistantBlock): AssistantBlock[] {
  const idx = blocks.findIndex((b) => b.id === next.id);
  if (idx === -1) return [...blocks, next];
  const copy = blocks.slice();
  copy[idx] = next;
  return copy;
}

/**
 * Apply one wire event to the current block array, returning a new array.
 * `done` and `error` are lifecycle signals the caller handles (persist /
 * surface); they carry no incremental block mutation.
 */
export function applyAgentEvent(
  blocks: AssistantBlock[],
  ev: AgentStreamEvent,
): AssistantBlock[] {
  switch (ev.type) {
    case "text_delta": {
      const existing = blocks.find((b) => b.id === ev.id && b.type === "text") as
        | TextBlock
        | undefined;
      const next: TextBlock = {
        id: ev.id,
        type: "text",
        text: (existing?.text ?? "") + ev.delta,
      };
      return upsert(blocks, next);
    }
    case "thinking_delta": {
      const existing = blocks.find(
        (b) => b.id === ev.id && b.type === "thinking",
      ) as ThinkingBlock | undefined;
      const next: ThinkingBlock = {
        id: ev.id,
        type: "thinking",
        text: (existing?.text ?? "") + ev.delta,
        done: ev.done ?? existing?.done ?? false,
      };
      return upsert(blocks, next);
    }
    case "block_start":
    case "block_update":
    case "block_end":
      // All three upsert by id — the block payload is the authoritative state.
      return upsert(blocks, ev.block);
    case "done":
      // The server's `done.blocks` is the canonical final ordering; adopt it so
      // any block the client never saw a start for is still present.
      return ev.blocks;
    case "error":
      return blocks;
    default:
      return blocks;
  }
}

/** True once the stream has produced its terminal event. */
export function isTerminalEvent(ev: AgentStreamEvent): boolean {
  return ev.type === "done" || ev.type === "error";
}

/**
 * Drive a job block to a terminal state when the async-job completion ping
 * arrives over the WebSocket (correlated by `jobId`, not block id). Returns the
 * array unchanged when no matching job block is present.
 *
 * Delegated sub-agent chips ride the same path: the origin notifies the parent
 * with `jobId = taskId` (Mesh-Delegation Decision 6), so a `subagent` block is
 * matched by its `taskId` and driven to the same terminal vocabulary.
 */
export function applyJobCompletion(
  blocks: AssistantBlock[],
  jobId: string,
  status: Extract<JobBlockStatus, "completed" | "failed" | "cancelled">,
  output?: string,
): AssistantBlock[] {
  const idx = blocks.findIndex(
    (b) => (b.type === "job" && b.jobId === jobId) || (b.type === "subagent" && b.taskId === jobId),
  );
  if (idx === -1) return blocks;
  const current = blocks[idx];
  const next = { ...current, status, ...(output ? { output } : {}) } as AssistantBlock;
  const copy = blocks.slice();
  copy[idx] = next;
  return copy;
}
