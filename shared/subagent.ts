/**
 * Mesh sub-agent delegation — the wire contract between an origin node and the
 * OMMESH peer that hosts a delegated `ChatAgentRunner` run (see `Mesh-Delegation.md`).
 *
 * Transport (blueprint Decision 2): everything rides the existing strict-mTLS
 * `:3001` mesh listener, behind the same pinned-fingerprint trust gate as
 * `/inference`:
 *
 *  - `POST /subagent`                    — spawn a run, or send a follow-up turn
 *    for an existing `taskId`. The response is held open and streams
 *    newline-delimited JSON: one `SubAgentEventEnvelope` per line, until the
 *    turn ends (`done` / `error`).
 *  - `GET  /subagent/:id/stream?since=N` — re-attach after a dropped stream;
 *    replays buffered envelopes with `seq > N`, then continues live.
 *  - `POST /subagent/:id/approval`       — forward the user's HITL decision to
 *    the peer's `ToolApprovalRegistry`.
 *  - `POST /subagent/:id/cancel`         — abort the run (AbortSignal on the
 *    peer-side runner) and tear down its buffered log.
 *
 * Statelessness (Decision 5): the peer keeps **no transcript** between turns —
 * every `POST /subagent` carries the full message history from the origin's DB.
 * The only per-task state on the peer is the sandbox directory on disk and, for
 * the duration of a run, the in-memory envelope buffer that makes cursor
 * re-attach possible.
 */

import type { AgentStreamEvent } from "./chatAgentEvents";

// ---------------------------------------------------------------------------
// Requests (origin → peer)
// ---------------------------------------------------------------------------

/** A transcript message, as replayed to the peer each turn (origin-owned). */
export interface SubAgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Body of `POST /subagent` — both the initial spawn and every follow-up turn.
 * The peer treats each request as a self-contained turn: it re-creates the
 * runner from `messages`, scoped to the task's workspace.
 */
export interface SubAgentTurnRequest {
  /**
   * Stable delegation id (uuid, minted by the origin at spawn). Reused across
   * follow-up turns — it keys the peer's sandbox directory and run registry.
   */
  taskId: string;
  /** Short human label for the task (sandbox-agnostic; used in peer logs). */
  label: string;
  /**
   * Full conversation history, oldest first. The last `user` message is the
   * instruction for this turn. The peer never persists this.
   */
  messages: SubAgentMessage[];
  /**
   * Explicit peer directory to operate in (blueprint Decision 3). Absent →
   * the per-task sandbox `~/.omnecor/delegation/<taskId>/`. Always re-validated
   * peer-side with `validatePath`; never trusted as-is.
   */
  scopePath?: string;
  /** Model choice from the peer's advertised catalog. Absent → the peer's
   *  local-runtime default (its own `pickLocalFallbackProvider` logic). */
  providerId?: string;
  modelId?: string;
  /** Curated native-tools flag for the chosen model (never probed). */
  supportsNativeTools?: boolean;
  /**
   * The origin user's execution mode — the peer enforces it for this run, so a
   * sovereign origin can never reach a cloud provider through delegation.
   */
  executionMode?: string;
  /** Propagated "auto-approve within scope" toggle — skips the HITL relay. */
  autoApprove?: boolean;
  /** Origin node id — logging + so the peer can name its counterparty. */
  originNodeId: string;
}

/** The user's HITL decision, forwarded to `POST /subagent/:id/approval`.
 *  `id` is the awaiting block's id (the approval key, same as local chat). */
export interface SubAgentApprovalRequest {
  id: string;
  decision: "approve" | "deny";
  denyReason?: string;
}

// ---------------------------------------------------------------------------
// Stream (peer → origin)
// ---------------------------------------------------------------------------

/**
 * One NDJSON line of the sub-agent stream. `seq` is monotonic per *task* (not
 * per turn) so a re-attach cursor is unambiguous across turn boundaries.
 */
export interface SubAgentEventEnvelope {
  seq: number;
  taskId: string;
  /** 1-based turn counter — increments on every `POST /subagent` for the task,
   *  and on peer-initiated continuation turns (async job completions). */
  turn: number;
  event: AgentStreamEvent;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/**
 * Peer-side status of a delegated task.
 *  - `running`   — a turn is currently streaming
 *  - `idle`      — between turns; awaiting a follow-up or expiry
 *  - `completed` — final turn ended cleanly and the task was closed
 *  - `failed`    — a turn errored, or the origin never re-attached in time
 *  - `cancelled` — the origin (user) cancelled the run
 */
export type SubAgentRunStatus =
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled";

/** Snapshot returned by control endpoints (approval / cancel) and errors. */
export interface SubAgentRunInfo {
  taskId: string;
  status: SubAgentRunStatus;
  turn: number;
  /** Highest envelope `seq` emitted so far — the re-attach cursor's ceiling. */
  lastSeq: number;
}

/** Machine-readable error codes returned by the `/subagent` endpoints. */
export type SubAgentErrorCode =
  /** The peer's kill-switch setting has inbound sub-agents disabled. */
  | "subagents_disabled"
  /** The peer is already hosting its maximum number of concurrent runs. */
  | "concurrency_limit"
  /** No live or recently-finished run for this taskId. */
  | "unknown_task"
  /** A turn is already streaming for this taskId (one turn at a time). */
  | "task_busy"
  /** `scopePath` failed peer-side validation. */
  | "invalid_scope"
  /** The requested provider/model is not runnable on the peer. */
  | "model_unavailable"
  /** The origin's execution mode forbids the requested provider (e.g. a
   *  sovereign origin naming a cloud provider). */
  | "provider_forbidden"
  /** Malformed request body. */
  | "invalid_request";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How long the peer keeps a run alive (and its envelope buffer replayable)
 * after the origin's stream drops, before aborting the run and marking it
 * `failed` (blueprint lifecycle assumption: LAN Wi-Fi blips must survive;
 * an origin that's really gone must not leak a live runner).
 */
export const SUBAGENT_REATTACH_GRACE_MS = 60_000;

/**
 * How long a finished (completed/failed/cancelled) task's envelope buffer is
 * kept for late re-attach/read-back before being dropped from the registry.
 */
export const SUBAGENT_FINISHED_RETENTION_MS = 5 * 60_000;

/** Default cap on concurrent delegated runs a peer will host. */
export const SUBAGENT_DEFAULT_MAX_CONCURRENT = 2;

/** Settings key for the peer-side kill switch (default: enabled). */
export const SUBAGENT_ENABLED_SETTING = "ommesh.subagents.enabled";

/** Settings key overriding the concurrent-run cap. */
export const SUBAGENT_MAX_CONCURRENT_SETTING = "ommesh.subagents.maxConcurrent";
