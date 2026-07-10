/**
 * @file services/SubAgentHostService.ts
 * @description Peer-side host for mesh sub-agent delegation (Mesh-Delegation.md).
 *
 * When a trusted OMMESH peer POSTs a delegated turn to this node's `/subagent`
 * endpoint (MeshServer), this service runs a **full `ChatAgentRunner` tool loop
 * locally** — tools acting on THIS node's filesystem inside a scoped workspace —
 * and publishes every `AgentStreamEvent`, wrapped in a sequenced
 * `SubAgentEventEnvelope`, to whoever is attached (the open NDJSON response,
 * plus any cursor re-attach).
 *
 * Statelessness (blueprint Decision 5): no transcript is kept between turns —
 * every request carries the full history from the origin's DB. The only
 * per-task state here is:
 *  - the sandbox directory on disk (`PATHS.projects/delegation/<taskId>/`), and
 *  - a bounded in-memory envelope buffer, kept so a dropped origin stream can
 *    re-attach with `?since=<seq>` instead of killing the run.
 *
 * HITL (Decision 1, full relay): the runner is constructed with a **dedicated**
 * `ToolApprovalRegistry` instance — never the process singleton — so this
 * node's own local users can't resolve a delegated approval through the local
 * `resolveToolApproval` mutation, and block-id collisions with local chats are
 * impossible. Approvals arrive exclusively via `resolveApproval()` (the mesh
 * `POST /subagent/:id/approval` endpoint, pinned-peer gated upstream).
 *
 * start_job continuation: a delegated run may launch an async job. Its turn
 * ends (start_job semantics), and when the job completes this host publishes a
 * `block_update` envelope for the job block into the task's stream — the ORIGIN
 * (which owns the transcript) then initiates the continuation turn. The peer
 * never self-prompts, staying transcript-free.
 *
 * Trust is NOT this service's job: MeshServer's pinned-fingerprint mTLS gate
 * decides who may call these methods at all. This service enforces the local
 * *policy* layer: the kill-switch setting, the concurrency cap, workspace
 * scoping via `validatePath`, and the origin's propagated execution mode
 * (a sovereign origin can never reach a cloud provider through delegation).
 */

import path from "path";
import fsp from "fs/promises";
import { createLogger } from "../../_core/logger.js";
import { PATHS } from "../../_core/paths.js";
import { validatePath as defaultValidatePath } from "../../_core/security.js";
import { assertProviderAllowedInMode } from "../../_core/sovereign.js";
import { ChatAgentRunner, type ChatAgentRunnerDeps } from "./ChatAgentRunner.js";
import { ToolApprovalRegistry } from "./ToolApprovalRegistry.js";
import { AiProviderService } from "./AiProviderService.js";
import { AsyncJobService, type AsyncJobResultEvent } from "./AsyncJobService.js";
import { SettingsService } from "./SettingsService.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";
import type { JobBlock } from "@shared/chatBlocks";
import {
  SUBAGENT_DEFAULT_MAX_CONCURRENT,
  SUBAGENT_ENABLED_SETTING,
  SUBAGENT_FINISHED_RETENTION_MS,
  SUBAGENT_MAX_CONCURRENT_SETTING,
  SUBAGENT_REATTACH_GRACE_MS,
  type SubAgentErrorCode,
  type SubAgentEventEnvelope,
  type SubAgentApprovalRequest,
  type SubAgentRunInfo,
  type SubAgentRunStatus,
  type SubAgentTurnRequest,
} from "@shared/subagent";

const log = createLogger("SubAgentHost");

/** Hard cap on buffered envelopes per task (re-attach window). A turn is
 *  bounded by MAX_TURNS=8 model round-trips, so this is generous; if it ever
 *  trims, `attach` reports the gap instead of silently replaying a hole. */
const MAX_BUFFER = 5_000;

/** How long an idle task's registry entry (buffer + counters) is kept without
 *  any activity before eviction. The sandbox on disk survives eviction — a
 *  follow-up turn for the same taskId transparently re-creates the entry. */
const IDLE_EXPIRY_MS = 30 * 60_000;

/** `taskId` is used as a directory name — accept only uuid-shaped ids so a
 *  hostile peer can't traverse out of the delegation root. */
const TASK_ID_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/;

/** Typed failure surfaced to the mesh endpoint layer (mapped to an HTTP status
 *  + machine-readable code on the wire). */
export class SubAgentHostError extends Error {
  constructor(
    public readonly code: SubAgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubAgentHostError";
  }
}

type Subscriber = (env: SubAgentEventEnvelope) => void;

interface HostedTask {
  taskId: string;
  label: string;
  status: SubAgentRunStatus;
  turn: number;
  seq: number;
  /** Envelope ring buffer; `firstSeq` = seq of buffer[0] after trimming. */
  buffer: SubAgentEventEnvelope[];
  firstSeq: number;
  workspace: string;
  /** AbortController of the currently-streaming turn (null between turns). */
  abort: AbortController | null;
  subscribers: Set<Subscriber>;
  /** Kills a running turn when the origin stays detached past the grace window. */
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** Evicts the registry entry after idle/finished retention. */
  expireTimer: ReturnType<typeof setTimeout> | null;
  /** Async jobs (start_job) launched by this task that haven't completed yet. */
  pendingJobs: Set<string>;
}

/** Injectable collaborators (defaults are the process-wide singletons). */
export interface SubAgentHostDeps {
  aiProvider?: Pick<AiProviderService, "getLocalFallbackProvider">;
  asyncJob?: Pick<AsyncJobService, "on">;
  settings?: Pick<SettingsService, "get">;
  validatePath?: (userPath: string, baseDir?: string) => Promise<string>;
  mkdir?: (dir: string) => Promise<void>;
  /** Runner factory — tests substitute a scripted runner. The host always
   *  passes its own approval registry in `deps`. */
  createRunner?: (deps: ChatAgentRunnerDeps) => Pick<ChatAgentRunner, "run">;
}

export class SubAgentHostService {
  private static instance: SubAgentHostService | null = null;

  /** Dedicated approval broker — isolated from the process singleton (see header). */
  private readonly approvals = new ToolApprovalRegistry();
  private readonly tasks = new Map<string, HostedTask>();

  private readonly aiProvider: Pick<AiProviderService, "getLocalFallbackProvider">;
  private readonly settings: Pick<SettingsService, "get">;
  private readonly validatePath: (userPath: string, baseDir?: string) => Promise<string>;
  private readonly mkdir: (dir: string) => Promise<void>;
  private readonly createRunner: (deps: ChatAgentRunnerDeps) => Pick<ChatAgentRunner, "run">;

  constructor(deps: SubAgentHostDeps = {}) {
    this.aiProvider = deps.aiProvider ?? AiProviderService.getInstance();
    this.settings = deps.settings ?? SettingsService.getInstance();
    this.validatePath = deps.validatePath ?? defaultValidatePath;
    this.mkdir = deps.mkdir ?? (async (dir) => {
      await fsp.mkdir(dir, { recursive: true });
    });
    this.createRunner = deps.createRunner ?? ((d) => new ChatAgentRunner(d));

    // start_job continuation: when an async job launched by a delegated run
    // completes, publish the job block's terminal state into the task stream.
    // The ORIGIN then decides whether to fire a continuation turn.
    const asyncJob = deps.asyncJob ?? AsyncJobService.getInstance();
    asyncJob.on("result", (event: AsyncJobResultEvent) => {
      this.onJobResult(event);
    });
  }

  static getInstance(): SubAgentHostService {
    if (!SubAgentHostService.instance) {
      SubAgentHostService.instance = new SubAgentHostService();
    }
    return SubAgentHostService.instance;
  }

  /** Peer-side kill switch (blueprint assumption: pinning is the consent act,
   *  but the owner can turn hosting off entirely). */
  isEnabled(): boolean {
    return this.settings.get<boolean>(SUBAGENT_ENABLED_SETTING, true);
  }

  private maxConcurrent(): number {
    return this.settings.get<number>(
      SUBAGENT_MAX_CONCURRENT_SETTING,
      SUBAGENT_DEFAULT_MAX_CONCURRENT,
    );
  }

  // ---------------------------------------------------------------------------
  // Turn execution
  // ---------------------------------------------------------------------------

  /**
   * Run one delegated turn (spawn or follow-up — the request is self-contained
   * either way). `subscriber` is attached atomically before the first event so
   * the caller's NDJSON response never misses the head of the stream. Resolves
   * once the turn has ended (the terminal `done`/`error` envelope has been
   * published); rejects with `SubAgentHostError` for policy/validation failures
   * that occur before the stream starts.
   */
  async runTurn(req: SubAgentTurnRequest, subscriber?: Subscriber): Promise<SubAgentRunInfo> {
    if (!this.isEnabled()) {
      throw new SubAgentHostError("subagents_disabled", "This node does not accept delegated sub-agents.");
    }
    this.validateRequest(req);

    let task = this.tasks.get(req.taskId);
    if (task?.status === "running") {
      throw new SubAgentHostError("task_busy", `A turn is already streaming for task ${req.taskId}.`);
    }
    if (!task) {
      const running = [...this.tasks.values()].filter((t) => t.status === "running").length;
      if (running >= this.maxConcurrent()) {
        throw new SubAgentHostError(
          "concurrency_limit",
          `This node is already hosting ${running} delegated run(s) (max ${this.maxConcurrent()}).`,
        );
      }
      task = {
        taskId: req.taskId,
        label: req.label,
        status: "idle",
        turn: 0,
        seq: 0,
        buffer: [],
        firstSeq: 1,
        workspace: await this.resolveWorkspace(req),
        abort: null,
        subscribers: new Set(),
        graceTimer: null,
        expireTimer: null,
        pendingJobs: new Set(),
      };
      this.tasks.set(req.taskId, task);
    }
    this.clearExpiry(task);

    // Model resolution: explicit request, else the peer's local default.
    let providerId = req.providerId;
    let modelId = req.modelId;
    if (!providerId || !modelId) {
      const fallback = await this.aiProvider.getLocalFallbackProvider();
      if (!fallback) {
        this.scheduleExpiry(task, IDLE_EXPIRY_MS);
        throw new SubAgentHostError(
          "model_unavailable",
          "No runnable model on this node: the request named none and no local runtime/Ollama model is available.",
        );
      }
      providerId = providerId ?? fallback.providerId;
      modelId = modelId ?? fallback.modelId;
    }
    if (!providerId || !modelId) {
      // Unreachable (the fallback either filled both or threw) — narrows types.
      throw new SubAgentHostError("model_unavailable", "Provider/model resolution failed.");
    }

    // The origin user's execution mode travels with the request and is enforced
    // HERE — a sovereign origin must not reach a cloud provider via delegation.
    try {
      assertProviderAllowedInMode(providerId, req.executionMode);
    } catch (e) {
      this.scheduleExpiry(task, IDLE_EXPIRY_MS);
      throw new SubAgentHostError("provider_forbidden", (e as Error).message);
    }

    task.status = "running";
    task.turn += 1;
    task.label = req.label;
    const thisTurn = task.turn;
    const abort = new AbortController();
    task.abort = abort;
    if (subscriber) this.subscribe(task, subscriber);
    this.armGraceTimer(task);

    log.info("Delegated turn starting", {
      taskId: task.taskId,
      turn: thisTurn,
      from: req.originNodeId,
      providerId,
      modelId,
      workspace: task.workspace,
      autoApprove: !!req.autoApprove,
    });

    const runner = this.createRunner({ approvals: this.approvals });
    let sawError = false;
    try {
      for await (const event of runner.run({
        input: {
          providerId,
          modelId,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt: this.buildSystemPrompt(req, task.workspace),
          supportsNativeTools: req.supportsNativeTools,
          executionMode: req.executionMode,
          // Never re-offload a delegated run's inference to a third peer —
          // the origin pinned THIS node (same loop guard as inbound /inference).
          meshOrigin: true,
        },
        userId: undefined,
        executionMode: req.executionMode,
        conversationId: this.jobContextId(task.taskId),
        rootDirectories: [task.workspace],
        autoApprove: req.autoApprove,
        signal: abort.signal,
      })) {
        if (event.type === "error") sawError = true;
        this.trackPendingJobs(task, event);
        this.publish(task, thisTurn, event);
      }
    } catch (err) {
      // The runner itself yields `error` events for its own failures; this
      // catch is for anything thrown outside that contract. Surface it on the
      // stream so an attached origin sees a terminal event, not a dead socket.
      sawError = true;
      this.publish(task, thisTurn, { type: "error", message: (err as Error).message });
    } finally {
      task.abort = null;
      this.disarmGraceTimer(task);
      if (task.status === "running") {
        task.status = sawError ? "failed" : "idle";
      }
      this.scheduleExpiry(
        task,
        task.status === "idle" && task.pendingJobs.size === 0 ? IDLE_EXPIRY_MS : SUBAGENT_FINISHED_RETENTION_MS,
      );
      // Idle-with-pending-jobs keeps the longer window too: the origin needs
      // time to observe the job-completion envelope and continue the task.
      if (task.status === "idle" && task.pendingJobs.size > 0) {
        this.clearExpiry(task);
        this.scheduleExpiry(task, IDLE_EXPIRY_MS);
      }
      log.info("Delegated turn ended", { taskId: task.taskId, turn: thisTurn, status: task.status });
    }

    return this.info(task);
  }

  // ---------------------------------------------------------------------------
  // Attach / control
  // ---------------------------------------------------------------------------

  /**
   * Re-attach to a task's stream: replay buffered envelopes with `seq > since`,
   * then deliver live ones to `subscriber` until `detach` is called. `gap` is
   * true when trimming already dropped envelopes the cursor still needed — the
   * origin should treat the turn as broken rather than render a hole.
   */
  attach(
    taskId: string,
    since: number,
    subscriber: Subscriber,
  ): { replay: SubAgentEventEnvelope[]; gap: boolean; info: SubAgentRunInfo; detach: () => void } {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new SubAgentHostError("unknown_task", `No live or recently-finished run for task ${taskId}.`);
    }
    const gap = since + 1 < task.firstSeq;
    const replay = task.buffer.filter((env) => env.seq > since);
    this.subscribe(task, subscriber);
    return {
      replay,
      gap,
      info: this.info(task),
      detach: () => this.unsubscribe(task, subscriber),
    };
  }

  /**
   * Detach a subscriber that was registered via `runTurn` (the open NDJSON
   * response) when its socket closes — arms the grace timer exactly like an
   * `attach().detach()`. No-op when the task is already gone.
   */
  detach(taskId: string, subscriber: Subscriber): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.unsubscribe(task, subscriber);
  }

  /** Forward the origin user's HITL decision into this host's approval broker. */
  resolveApproval(taskId: string, req: SubAgentApprovalRequest): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new SubAgentHostError("unknown_task", `No live run for task ${taskId}.`);
    }
    return this.approvals.resolve(req.id, undefined, req.decision, req.denyReason);
  }

  /** Cancel a task: abort any streaming turn and mark it cancelled. */
  cancel(taskId: string, reason = "Cancelled by origin."): SubAgentRunInfo {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new SubAgentHostError("unknown_task", `No live run for task ${taskId}.`);
    }
    task.status = "cancelled";
    task.pendingJobs.clear();
    task.abort?.abort();
    this.disarmGraceTimer(task);
    this.clearExpiry(task);
    this.scheduleExpiry(task, SUBAGENT_FINISHED_RETENTION_MS);
    log.info("Delegated task cancelled", { taskId, reason });
    return this.info(task);
  }

  /** Run snapshot for control-endpoint responses. */
  getInfo(taskId: string): SubAgentRunInfo {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new SubAgentHostError("unknown_task", `No live run for task ${taskId}.`);
    }
    return this.info(task);
  }

  /** Test/introspection helper — number of registered tasks. */
  get size(): number {
    return this.tasks.size;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private validateRequest(req: SubAgentTurnRequest): void {
    if (!req || typeof req !== "object") {
      throw new SubAgentHostError("invalid_request", "Missing request body.");
    }
    if (typeof req.taskId !== "string" || !TASK_ID_RE.test(req.taskId)) {
      throw new SubAgentHostError("invalid_request", "taskId must be a uuid-shaped identifier.");
    }
    if (typeof req.label !== "string" || !req.label.trim() || req.label.length > 200) {
      throw new SubAgentHostError("invalid_request", "label is required (≤200 chars).");
    }
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new SubAgentHostError("invalid_request", "messages must be a non-empty array.");
    }
    for (const m of req.messages) {
      if (
        !m ||
        (m.role !== "system" && m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string"
      ) {
        throw new SubAgentHostError("invalid_request", "messages entries must be {role, content}.");
      }
    }
    if (typeof req.originNodeId !== "string" || !req.originNodeId) {
      throw new SubAgentHostError("invalid_request", "originNodeId is required.");
    }
  }

  /** Resolve the task's working scope: an explicit, allowlist-validated
   *  directory (Decision 3 opt-in) or the per-task sandbox. */
  private async resolveWorkspace(req: SubAgentTurnRequest): Promise<string> {
    if (req.scopePath) {
      let resolved: string;
      try {
        resolved = await this.validatePath(req.scopePath);
      } catch (e) {
        throw new SubAgentHostError("invalid_scope", (e as Error).message);
      }
      const stat = await fsp.stat(resolved).catch(() => null);
      if (!stat?.isDirectory()) {
        throw new SubAgentHostError("invalid_scope", `scopePath is not an existing directory: ${req.scopePath}`);
      }
      return resolved;
    }
    const sandbox = path.join(PATHS.projects, "delegation", req.taskId);
    await this.mkdir(sandbox);
    return sandbox;
  }

  /** Base system prompt for a delegated run (the tool protocol layers its own
   *  instructions on top, exactly like a local agentic turn). */
  private buildSystemPrompt(req: SubAgentTurnRequest, workspace: string): string {
    return [
      `You are an Omnecor sub-agent running on a mesh peer, delegated by node "${req.originNodeId}".`,
      `Task: ${req.label}`,
      `Your working directory is ${workspace} — all file paths and commands are scoped there.`,
      `Work autonomously and end with a concise summary of what you did; the summary is reported back to the delegating agent.`,
    ].join("\n");
  }

  /** The AsyncJobService context marker tying a peer-local job to its task. */
  private jobContextId(taskId: string): string {
    return `subagent:${taskId}`;
  }

  private trackPendingJobs(task: HostedTask, event: AgentStreamEvent): void {
    if (event.type !== "block_start" && event.type !== "block_update" && event.type !== "block_end") return;
    const block = event.block;
    if (block.type === "job" && block.status === "running" && block.jobId) {
      task.pendingJobs.add(block.jobId);
    }
  }

  /** Async job launched by a delegated run finished → publish its terminal
   *  block state so the (re-)attached origin can continue the task. */
  private onJobResult(event: AsyncJobResultEvent): void {
    const convId = event.context.conversationId;
    if (!convId || !convId.startsWith("subagent:")) return;
    const taskId = convId.slice("subagent:".length);
    const task = this.tasks.get(taskId);
    if (!task || !task.pendingJobs.has(event.jobId)) return;
    task.pendingJobs.delete(event.jobId);

    // Recover the job block from the buffer (latest state wins) so the origin
    // receives a well-formed block_update, not a bespoke event type.
    const prior = [...task.buffer]
      .reverse()
      .map((env) => env.event)
      .find(
        (e): e is Extract<AgentStreamEvent, { type: "block_start" | "block_update" | "block_end" }> =>
          (e.type === "block_start" || e.type === "block_update" || e.type === "block_end") &&
          e.block.type === "job" &&
          (e.block as JobBlock).jobId === event.jobId,
      );
    if (!prior) return;

    const block: JobBlock = {
      ...(prior.block as JobBlock),
      status: event.result.status === "completed" ? "completed" : event.result.status === "cancelled" ? "cancelled" : "failed",
      output: event.formatted,
    };
    this.publish(task, task.turn, { type: "block_update", block });

    if (task.status === "idle" && task.pendingJobs.size === 0) {
      // Give the origin the idle window to observe + continue.
      this.clearExpiry(task);
      this.scheduleExpiry(task, IDLE_EXPIRY_MS);
    }
  }

  private publish(task: HostedTask, turn: number, event: AgentStreamEvent): void {
    const env: SubAgentEventEnvelope = {
      seq: ++task.seq,
      taskId: task.taskId,
      turn,
      event,
    };
    task.buffer.push(env);
    if (task.buffer.length > MAX_BUFFER) {
      task.buffer.splice(0, task.buffer.length - MAX_BUFFER);
      task.firstSeq = task.buffer[0]!.seq;
    }
    for (const sub of task.subscribers) {
      try {
        sub(env);
      } catch (err) {
        log.warn("Sub-agent subscriber threw; detaching it", { taskId: task.taskId, err: (err as Error).message });
        task.subscribers.delete(sub);
      }
    }
  }

  private subscribe(task: HostedTask, subscriber: Subscriber): void {
    task.subscribers.add(subscriber);
    this.disarmGraceTimer(task);
  }

  private unsubscribe(task: HostedTask, subscriber: Subscriber): void {
    task.subscribers.delete(subscriber);
    this.armGraceTimer(task);
  }

  /** While a turn is RUNNING with nobody attached, the origin has the grace
   *  window to come back before the run is aborted (LAN blips survive; a
   *  vanished origin doesn't leak a live runner). */
  private armGraceTimer(task: HostedTask): void {
    if (task.status !== "running" || task.subscribers.size > 0 || task.graceTimer) return;
    task.graceTimer = setTimeout(() => {
      task.graceTimer = null;
      if (task.status !== "running" || task.subscribers.size > 0) return;
      log.warn("Origin never re-attached within grace window — aborting delegated run", {
        taskId: task.taskId,
        graceMs: SUBAGENT_REATTACH_GRACE_MS,
      });
      task.status = "failed";
      task.abort?.abort();
    }, SUBAGENT_REATTACH_GRACE_MS);
    if (typeof task.graceTimer.unref === "function") task.graceTimer.unref();
  }

  private disarmGraceTimer(task: HostedTask): void {
    if (task.graceTimer) {
      clearTimeout(task.graceTimer);
      task.graceTimer = null;
    }
  }

  private scheduleExpiry(task: HostedTask, ms: number): void {
    this.clearExpiry(task);
    task.expireTimer = setTimeout(() => {
      // Never evict mid-turn; the turn's finally block reschedules.
      if (task.status === "running") return;
      this.tasks.delete(task.taskId);
      log.info("Delegated task evicted from registry (sandbox retained on disk)", { taskId: task.taskId });
    }, ms);
    if (typeof task.expireTimer.unref === "function") task.expireTimer.unref();
  }

  private clearExpiry(task: HostedTask): void {
    if (task.expireTimer) {
      clearTimeout(task.expireTimer);
      task.expireTimer = null;
    }
  }

  private info(task: HostedTask): SubAgentRunInfo {
    return {
      taskId: task.taskId,
      status: task.status,
      turn: task.turn,
      lastSeq: task.seq,
    };
  }
}
