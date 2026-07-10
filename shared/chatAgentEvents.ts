/**
 * Agentic chat stream — the wire event contract between the server tool loop
 * (`ChatAgentRunner`) and the web/APK render layer.
 *
 * Where `shared/chatBlocks.ts` defines the *shape* of an assistant turn (the
 * ordered `AssistantBlock[]`), this file defines the *stream* that builds one:
 * a sequence of typed events the client folds into that block array in order.
 *
 * The vocabulary mirrors the plan: prose arrives as `text_delta`, real model
 * reasoning as `thinking_delta`, and every tool box (command / edit / job / mcp)
 * is announced with `block_start`, mutated in place with `block_update`, and
 * finalised with `block_end`. A tool box awaiting a Human-in-the-Loop decision
 * is surfaced as a `block_update` whose block `status` is `pending_approval`;
 * the client resolves it by calling the `resolveToolApproval` mutation with the
 * block's own `id` (the id doubles as the approval key — one box, one action).
 */

import type { AssistantBlock } from "./chatBlocks";

/**
 * A single event in the agentic assistant stream. The client maintains an
 * ordered `AssistantBlock[]` and applies each event by matching block `id`.
 */
export type AgentStreamEvent =
  /** Append prose to the (lazily created) text block identified by `id`. */
  | { type: "text_delta"; id: string; delta: string }
  /** Append real model reasoning to the thinking block identified by `id`. */
  | { type: "thinking_delta"; id: string; delta: string; done?: boolean }
  /** A new non-text block (command / edit / job / mcp box) has appeared. */
  | { type: "block_start"; block: AssistantBlock }
  /** Replace the block with this `id` — status change, output, diff, approval. */
  | { type: "block_update"; block: AssistantBlock }
  /** Final state of the block with this `id`; no further updates will follow. */
  | { type: "block_end"; block: AssistantBlock }
  /**
   * The turn is complete. `blocks` is the full ordered array (render source of
   * truth); `content` is the flattened text kept on `ChatMessage.content` for
   * persistence / copy / export / non-agentic providers.
   */
  | { type: "done"; blocks: AssistantBlock[]; content: string; totalTokens?: number }
  /** The run failed; `message` is a human-readable reason. */
  | { type: "error"; message: string };

/** A reviewer's Human-in-the-Loop decision on a pending tool box. */
export interface ToolApprovalDecision {
  /** The awaiting block's `id` — doubles as the approval key. */
  id: string;
  decision: "approve" | "deny";
  /** Optional reason surfaced back to the agent when denied. */
  denyReason?: string;
}

/** The block types that can enter `pending_approval` and be resolved by HITL.
 * `job` is included: a `start_job` box is gated at launch exactly like a command
 * (its `pending_approval` status carries the `JobBlockStatus` union). `subagent`
 * is included: spawning a delegated run on a mesh peer is gated exactly like a
 * job launch (see `Mesh-Delegation.md`). */
export type ApprovableBlockType = "command" | "edit" | "job" | "subagent";
