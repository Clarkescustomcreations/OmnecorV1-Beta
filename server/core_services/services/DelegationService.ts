/**
 * @file services/DelegationService.ts
 * @description Origin-side of mesh sub-agent delegation (Mesh-Delegation.md).
 *
 * The counterpart to the peer's `SubAgentHostService`. When the parent chat's
 * agent calls `delegate_task`, this service:
 *
 *  1. creates the **managed chat** — a normal `chatSessions` row tagged with
 *     `metadata.delegation = {taskId, nodeId, nodeName, parentConversationId,
 *     scopePath}` (Decision 4: the origin owns the transcript; the peer keeps
 *     none);
 *  2. opens the streaming `POST /subagent` to the pinned peer over mTLS and
 *     consumes its NDJSON `SubAgentEventEnvelope` lines;
 *  3. re-publishes each `AgentStreamEvent` to live tRPC subscribers (the
 *     managed chat's render stream on web/APK) and buffers the current turn's
 *     events so a late subscriber can replay an in-progress turn;
 *  4. relays HITL: `pending_approval` blocks are indexed blockId → task so the
 *     ordinary `resolveToolApproval` mutation can forward the decision to the
 *     peer's approval broker (Decision 1: full relay);
 *  5. persists each finished turn into `chatMessages` (assistant `content`
 *     from the `done` event's flatten — same post-reload fidelity as local
 *     agentic chats);
 *  6. on the FIRST turn's completion, emits a synthetic `AsyncJobService`
 *     "result" (jobId = taskId) so the parent conversation is re-prompted with
 *     the condensed summary through the existing async-job → WS path
 *     (Decision 6: start_job semantics);
 *  7. rides out stream drops with the cursor re-attach (`GET
 *     /subagent/:id/stream?since=N`) inside the peer's grace window, and keeps
 *     a watch stream open while a peer-side async job (`start_job`) is pending
 *     so its completion envelope can trigger an automatic continuation turn.
 *
 * Follow-up user turns (Decision 5, between-turn chat) load the full
 * transcript from the DB and POST it to the same peer + taskId — the peer is
 * stateless between turns, so an origin restart (or peer registry eviction)
 * heals automatically on the next turn.
 */

import https from "https";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { createLogger } from "../../_core/logger.js";
import { getDb } from "../../db.factory.js";
import { chatSessions, chatMessages } from "../../../drizzle/schema.js";
import { meshNode } from "../../ommesh/core/MeshNode.js";
import { securityManager } from "../../ommesh/core/SecurityManager.js";
import { MESH_PORT } from "../../ommesh/core/MeshServer.js";
import type { PeerInfo } from "../../ommesh/core/DiscoveryService.js";
import { AsyncJobService } from "./AsyncJobService.js";
import type { CondensedJobResult } from "./JobResultCondenser.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";
import type { JobBlock } from "@shared/chatBlocks";
import {
  SUBAGENT_REATTACH_GRACE_MS,
  type SubAgentEventEnvelope,
  type SubAgentMessage,
  type SubAgentTurnRequest,
} from "@shared/subagent";

const log = createLogger("Delegation");

/** Delay between re-attach attempts after a dropped stream. */
const REATTACH_RETRY_MS = 3_000;

/** The shape stored in `chatSessions.metadata.delegation`. */
export interface DelegationMetadata {
  taskId: string;
  nodeId: string;
  nodeName: string;
  parentConversationId?: string;
  scopePath?: string;
}

/** Origin-side status of a delegated task. */
export type DelegationStatus = "running" | "idle" | "failed" | "cancelled";

export interface DelegateParams {
  userId: number | undefined;
  executionMode?: string;
  /** Peer node id (its advertised identity name — same key `targetNodeId` uses). */
  targetNodeId: string;
  /** Short human label (chip text + managed chat title). */
  label: string;
  /** The delegated instruction — the managed chat's first user message. */
  task: string;
  scopePath?: string;
  providerId?: string;
  modelId?: string;
  supportsNativeTools?: boolean;
  autoApprove?: boolean;
  parentConversationId?: string;
}

interface DelegatedTask {
  taskId: string;
  conversationId: string;
  userId: number | undefined;
  label: string;
  nodeId: string;
  scopePath?: string;
  providerId?: string;
  modelId?: string;
  supportsNativeTools?: boolean;
  executionMode?: string;
  autoApprove?: boolean;
  parentConversationId?: string;
  status: DelegationStatus;
  lastSeq: number;
  /** Events of the CURRENT turn only — replayed to late subscribers so an
   *  in-progress turn renders; cleared at turn end (finished turns live in
   *  `chatMessages`). */
  turnEvents: AgentStreamEvent[];
  subscribers: Set<(ev: AgentStreamEvent) => void>;
  /** blockIds currently awaiting HITL on the peer. */
  pendingApprovals: Set<string>;
  /** Peer-side async jobs (start_job) whose completion we're watching for. */
  watchedJobs: Set<string>;
  /** Whether the parent chat has already received its async result. */
  parentNotified: boolean;
  /** Aborts the active outbound stream (turn or watch). */
  streamAbort: AbortController | null;
}

/**
 * Outbound transport to a peer's `/subagent` endpoints — injectable so tests
 * drive the service with a scripted peer instead of real mTLS sockets.
 */
export interface DelegationTransport {
  /** POST /subagent — resolves when the NDJSON stream ends. */
  streamTurn(
    peer: PeerInfo,
    req: SubAgentTurnRequest,
    onEnvelope: (env: SubAgentEventEnvelope) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /** GET /subagent/:id/stream?since=N — resolves when the stream ends.
   *  `onAttach` delivers the first-line header. */
  attach(
    peer: PeerInfo,
    taskId: string,
    since: number,
    onEnvelope: (env: SubAgentEventEnvelope) => void,
    onAttach: (header: { gap: boolean }) => void,
    signal: AbortSignal,
  ): Promise<void>;
  /** POST /subagent/:id/approval */
  approve(
    peer: PeerInfo,
    taskId: string,
    body: { id: string; decision: "approve" | "deny"; denyReason?: string },
  ): Promise<{ resolved: boolean }>;
  /** POST /subagent/:id/cancel */
  cancel(peer: PeerInfo, taskId: string, reason?: string): Promise<void>;
}

/** Real transport: strict-mTLS HTTPS with the peer's fingerprint pinned —
 *  identical trust posture to `MeshNode.routeToRemote`. */
class MtlsDelegationTransport implements DelegationTransport {
  streamTurn(
    peer: PeerInfo,
    req: SubAgentTurnRequest,
    onEnvelope: (env: SubAgentEventEnvelope) => void,
    signal: AbortSignal,
  ): Promise<void> {
    return this.streamRequest(peer, "POST", "/subagent", JSON.stringify(req), (line) => {
      onEnvelope(JSON.parse(line) as SubAgentEventEnvelope);
    }, signal);
  }

  attach(
    peer: PeerInfo,
    taskId: string,
    since: number,
    onEnvelope: (env: SubAgentEventEnvelope) => void,
    onAttach: (header: { gap: boolean }) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let first = true;
    return this.streamRequest(
      peer,
      "GET",
      `/subagent/${encodeURIComponent(taskId)}/stream?since=${since}`,
      undefined,
      (line) => {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (first && parsed.attach !== undefined) {
          first = false;
          onAttach({ gap: !!parsed.gap });
          return;
        }
        first = false;
        onEnvelope(parsed as unknown as SubAgentEventEnvelope);
      },
      signal,
    );
  }

  async approve(
    peer: PeerInfo,
    taskId: string,
    body: { id: string; decision: "approve" | "deny"; denyReason?: string },
  ): Promise<{ resolved: boolean }> {
    const text = await this.jsonRequest(peer, "POST", `/subagent/${encodeURIComponent(taskId)}/approval`, JSON.stringify(body));
    return JSON.parse(text) as { resolved: boolean };
  }

  async cancel(peer: PeerInfo, taskId: string, reason?: string): Promise<void> {
    await this.jsonRequest(peer, "POST", `/subagent/${encodeURIComponent(taskId)}/cancel`, JSON.stringify({ reason }));
  }

  /** One-shot JSON request; rejects on non-2xx. */
  private jsonRequest(peer: PeerInfo, method: string, path: string, body?: string): Promise<string> {
    const tlsOptions = securityManager.getClientTlsOptions(peer.fingerprint || undefined);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: peer.address,
          port: peer.port || MESH_PORT,
          path,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          },
          ...tlsOptions,
          timeout: 30_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(text);
            else reject(new Error(`peer returned ${res.statusCode}: ${text.slice(0, 300)}`));
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("peer request timed out")));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  /** Long-lived NDJSON request. Delivers each non-empty line; resolves on a
   *  clean end, rejects on transport errors or a non-2xx status. */
  private streamRequest(
    peer: PeerInfo,
    method: string,
    path: string,
    body: string | undefined,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const tlsOptions = securityManager.getClientTlsOptions(peer.fingerprint || undefined);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: peer.address,
          port: peer.port || MESH_PORT,
          path,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          },
          ...tlsOptions,
          // No socket timeout: a delegated turn legitimately idles while the
          // peer's model thinks or a HITL approval waits on the user. The
          // peer's keepalive blank lines keep middleboxes from reaping it,
          // and `signal` handles deliberate teardown.
        },
        (res) => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () =>
              reject(new Error(`peer returned ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 300)}`)),
            );
            return;
          }
          let buffer = "";
          res.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            let idx: number;
            while ((idx = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (!line) continue; // keepalive blank line
              try {
                onLine(line);
              } catch (err) {
                log.warn("Bad NDJSON line from peer", { err: (err as Error).message });
              }
            }
          });
          res.on("end", () => resolve());
          res.on("error", reject);
        },
      );
      const onAbort = () => req.destroy(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

/** Injectable collaborators (defaults: real transport + live mesh + singletons). */
export interface DelegationServiceDeps {
  transport?: DelegationTransport;
  findPeer?: (nodeId: string) => PeerInfo | undefined;
  originNodeId?: () => string;
  asyncJob?: Pick<AsyncJobService, "emit">;
}

export class DelegationService extends EventEmitter {
  private static instance: DelegationService | null = null;

  private readonly tasks = new Map<string, DelegatedTask>(); // by taskId
  private readonly byConversation = new Map<string, string>(); // conversationId → taskId
  private readonly blockToTask = new Map<string, string>(); // pending approval blockId → taskId

  private readonly transport: DelegationTransport;
  private readonly findPeer: (nodeId: string) => PeerInfo | undefined;
  private readonly originNodeId: () => string;
  private readonly asyncJob: Pick<AsyncJobService, "emit">;

  constructor(deps: DelegationServiceDeps = {}) {
    super();
    this.transport = deps.transport ?? new MtlsDelegationTransport();
    this.findPeer =
      deps.findPeer ??
      ((nodeId) => {
        try {
          return meshNode.getDiscovery().getPeers().find((p) => p.name === nodeId);
        } catch {
          return undefined;
        }
      });
    this.originNodeId =
      deps.originNodeId ??
      (() => {
        try {
          return meshNode.getIdentity().id;
        } catch {
          return "origin";
        }
      });
    this.asyncJob = deps.asyncJob ?? AsyncJobService.getInstance();
  }

  static getInstance(): DelegationService {
    if (!DelegationService.instance) {
      DelegationService.instance = new DelegationService();
    }
    return DelegationService.instance;
  }

  // ---------------------------------------------------------------------------
  // Spawn (delegate_task)
  // ---------------------------------------------------------------------------

  /**
   * Spawn a delegated run: create the managed chat, persist the instruction,
   * and launch the first turn (not awaited — start_job semantics; the parent's
   * turn ends now and the async result re-prompts it later). Throws before
   * launch when the peer is unknown, so the tool can surface a clean error.
   */
  async delegate(params: DelegateParams): Promise<{ taskId: string; conversationId: string; nodeName: string }> {
    const peer = this.findPeer(params.targetNodeId);
    if (!peer) {
      throw new Error(
        `Mesh peer "${params.targetNodeId}" is not currently discoverable. Available peers: ${this.peerNames() || "(none)"}.`,
      );
    }

    const taskId = uuidv4();
    const conversationId = uuidv4();
    const metadata: { delegation: DelegationMetadata } = {
      delegation: {
        taskId,
        nodeId: params.targetNodeId,
        nodeName: peer.name,
        parentConversationId: params.parentConversationId,
        scopePath: params.scopePath,
      },
    };

    const db = await getDb();
    await db.insert(chatSessions).values({
      id: conversationId,
      userId: params.userId ?? null,
      title: `⇄ ${peer.name} — ${params.label}`.slice(0, 500),
      providerId: params.providerId ?? "ommesh",
      modelId: params.modelId ?? "peer-default",
      metadata,
    });
    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: conversationId,
      role: "user",
      content: params.task,
    });

    const task: DelegatedTask = {
      taskId,
      conversationId,
      userId: params.userId,
      label: params.label,
      nodeId: params.targetNodeId,
      scopePath: params.scopePath,
      providerId: params.providerId,
      modelId: params.modelId,
      supportsNativeTools: params.supportsNativeTools,
      executionMode: params.executionMode,
      autoApprove: params.autoApprove,
      parentConversationId: params.parentConversationId,
      status: "running",
      lastSeq: 0,
      turnEvents: [],
      subscribers: new Set(),
      pendingApprovals: new Set(),
      watchedJobs: new Set(),
      parentNotified: false,
      streamAbort: null,
    };
    this.register(task);

    this.emit("delegation", {
      kind: "created",
      userId: task.userId,
      conversationId,
      taskId,
      nodeName: peer.name,
      label: params.label,
    });

    // Fire-and-forget: the runTurn loop owns status transitions from here.
    void this.runRemoteTurn(task, [{ role: "user", content: params.task }]);

    return { taskId, conversationId, nodeName: peer.name };
  }

  // ---------------------------------------------------------------------------
  // Follow-up turns (between-turn chat)
  // ---------------------------------------------------------------------------

  /** Send a user follow-up into the managed chat: persist it, rebuild the full
   *  transcript from the DB, and run the next turn on the same peer + task.
   *  `executionMode` comes from the caller's live user context so a rebuilt
   *  task (post-restart) never loses the sovereign gate on the peer. */
  async sendUserTurn(
    conversationId: string,
    userId: number | undefined,
    content: string,
    executionMode?: string,
  ): Promise<void> {
    const task = await this.taskForConversation(conversationId, userId);
    if (executionMode !== undefined) task.executionMode = executionMode;
    if (task.status === "running") {
      throw new TRPCError({ code: "CONFLICT", message: "The sub-agent is mid-turn; wait for it to finish." });
    }

    const db = await getDb();
    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: conversationId,
      role: "user",
      content,
    });

    const messages = await this.loadTranscript(conversationId);
    task.status = "running";
    task.parentNotified = true; // only the FIRST turn reports back to the parent
    void this.runRemoteTurn(task, messages);
  }

  // ---------------------------------------------------------------------------
  // HITL relay + cancel + subscription
  // ---------------------------------------------------------------------------

  /** True when this block id belongs to a delegated run (routing hint for the
   *  shared `resolveToolApproval` mutation). */
  isDelegatedBlock(blockId: string): boolean {
    return this.blockToTask.has(blockId);
  }

  /** Forward a HITL decision to the peer hosting the block's run. Ownership is
   *  enforced here (the peer's broker has no origin user context). */
  async resolveApproval(
    blockId: string,
    userId: number | undefined,
    decision: "approve" | "deny",
    denyReason?: string,
  ): Promise<boolean> {
    const taskId = this.blockToTask.get(blockId);
    if (!taskId) return false;
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.userId !== userId) {
      log.warn("Rejected cross-user delegated approval", { blockId, byUser: userId, ownedBy: task.userId });
      return false;
    }
    const peer = this.findPeer(task.nodeId);
    if (!peer) return false;
    try {
      const { resolved } = await this.transport.approve(peer, taskId, { id: blockId, decision, denyReason });
      if (resolved) {
        this.blockToTask.delete(blockId);
        task.pendingApprovals.delete(blockId);
      }
      return resolved;
    } catch (err) {
      log.warn("Approval relay to peer failed", { taskId, blockId, err: (err as Error).message });
      return false;
    }
  }

  /** Cancel a delegated run (from the chip or the managed chat). */
  async cancel(conversationId: string, userId: number | undefined): Promise<void> {
    const task = await this.taskForConversation(conversationId, userId);
    const peer = this.findPeer(task.nodeId);
    if (peer) {
      await this.transport.cancel(peer, task.taskId, "Cancelled by user.").catch((err) => {
        log.warn("Peer cancel failed (marking cancelled locally anyway)", { taskId: task.taskId, err: (err as Error).message });
      });
    }
    this.finishTask(task, "cancelled", "Cancelled by user.");
  }

  /**
   * Subscribe the managed chat's live stream. Replays the current in-progress
   * turn's events first (finished turns are already in `chatMessages`).
   */
  async subscribe(
    conversationId: string,
    userId: number | undefined,
    cb: (ev: AgentStreamEvent) => void,
  ): Promise<{ replay: AgentStreamEvent[]; status: DelegationStatus; unsubscribe: () => void }> {
    const task = await this.taskForConversation(conversationId, userId);
    task.subscribers.add(cb);
    return {
      replay: [...task.turnEvents],
      status: task.status,
      unsubscribe: () => task.subscribers.delete(cb),
    };
  }

  /** Origin-side status snapshot (for the router / clients). */
  async status(conversationId: string, userId: number | undefined): Promise<{ status: DelegationStatus; taskId: string; nodeId: string }> {
    const task = await this.taskForConversation(conversationId, userId);
    return { status: task.status, taskId: task.taskId, nodeId: task.nodeId };
  }

  // ---------------------------------------------------------------------------
  // Turn execution + stream survival
  // ---------------------------------------------------------------------------

  private async runRemoteTurn(task: DelegatedTask, messages: SubAgentMessage[]): Promise<void> {
    const peer = this.findPeer(task.nodeId);
    if (!peer) {
      this.failTurn(task, `Mesh peer "${task.nodeId}" is no longer discoverable.`);
      return;
    }

    task.turnEvents = [];
    // Reset the dedup high-watermark at every turn start. `seq` is monotonic per
    // task ON THE PEER only while that task lives in the peer's registry; a peer
    // that evicted an idle task (but kept the sandbox) restarts `seq` at 1 for
    // the next turn. Without this reset, an origin still holding the previous
    // turn's high `lastSeq` would drop the entire fresh turn as "duplicates".
    // Safe for re-attach: a new turn opens a fresh stream (no replay to dedup),
    // and mid-turn re-attach reads `lastSeq` after it has adopted this turn's
    // real seq values.
    task.lastSeq = 0;
    const abort = new AbortController();
    task.streamAbort = abort;

    const req: SubAgentTurnRequest = {
      taskId: task.taskId,
      label: task.label,
      messages,
      scopePath: task.scopePath,
      providerId: task.providerId,
      modelId: task.modelId,
      supportsNativeTools: task.supportsNativeTools,
      executionMode: task.executionMode,
      autoApprove: task.autoApprove,
      originNodeId: this.originNodeId(),
    };

    try {
      await this.transport.streamTurn(peer, req, (env) => this.handleEnvelope(task, env), abort.signal);
      // Clean stream end. If no terminal event arrived (peer crashed mid-write
      // without an error envelope), try to re-attach before giving up.
      if (task.status === "running") {
        await this.reattachUntilTerminal(task);
      }
    } catch (err) {
      if (task.status === "running" && !abort.signal.aborted) {
        log.warn("Delegated turn stream dropped — attempting re-attach", {
          taskId: task.taskId,
          err: (err as Error).message,
        });
        await this.reattachUntilTerminal(task);
      }
    } finally {
      if (task.streamAbort === abort) task.streamAbort = null;
      // A peer-side start_job ended this turn with jobs still pending — keep a
      // watch stream open so the completion envelope can continue the task.
      if (task.status === "idle" && task.watchedJobs.size > 0) {
        void this.watchForJobCompletions(task);
      }
    }
  }

  /** Re-attach with the cursor until a terminal event lands or the peer's
   *  grace window is clearly gone. */
  private async reattachUntilTerminal(task: DelegatedTask): Promise<void> {
    const deadline = Date.now() + SUBAGENT_REATTACH_GRACE_MS;
    while (task.status === "running" && Date.now() < deadline) {
      const peer = this.findPeer(task.nodeId);
      if (peer) {
        const abort = new AbortController();
        task.streamAbort = abort;
        try {
          let gapped = false;
          await this.transport.attach(
            peer,
            task.taskId,
            task.lastSeq,
            (env) => this.handleEnvelope(task, env),
            ({ gap }) => {
              gapped = gap;
            },
            abort.signal,
          );
          if (gapped) {
            this.failTurn(task, "The peer's replay buffer no longer covers the missed events.");
            return;
          }
          if (task.status !== "running") return; // terminal event arrived during replay/live
        } catch {
          // fall through to retry
        } finally {
          if (task.streamAbort === abort) task.streamAbort = null;
        }
      }
      if (task.status !== "running") return;
      await new Promise((r) => setTimeout(r, REATTACH_RETRY_MS));
    }
    if (task.status === "running") {
      this.failTurn(task, "Lost the connection to the peer and could not re-attach in time.");
    }
  }

  /** Keep a lightweight attach stream open while peer-side async jobs are
   *  pending, so their completion envelopes trigger continuation turns. */
  private async watchForJobCompletions(task: DelegatedTask): Promise<void> {
    while (task.status === "idle" && task.watchedJobs.size > 0) {
      const peer = this.findPeer(task.nodeId);
      if (!peer) {
        await new Promise((r) => setTimeout(r, REATTACH_RETRY_MS));
        continue;
      }
      const abort = new AbortController();
      task.streamAbort = abort;
      try {
        await this.transport.attach(
          peer,
          task.taskId,
          task.lastSeq,
          (env) => this.handleEnvelope(task, env),
          () => {},
          abort.signal,
        );
      } catch {
        // dropped — retry below
      } finally {
        if (task.streamAbort === abort) task.streamAbort = null;
      }
      if (abort.signal.aborted) return; // deliberate teardown (cancel / new turn)
      await new Promise((r) => setTimeout(r, REATTACH_RETRY_MS));
    }
  }

  // ---------------------------------------------------------------------------
  // Envelope handling
  // ---------------------------------------------------------------------------

  private handleEnvelope(task: DelegatedTask, env: SubAgentEventEnvelope): void {
    if (env.seq > 0) {
      if (env.seq <= task.lastSeq) return; // duplicate from replay overlap
      task.lastSeq = env.seq;
    }
    const ev = env.event;

    // HITL index + watched-jobs bookkeeping. (text/thinking blocks carry no
    // status — the `in` guard narrows to the tool-box members of the union.)
    if (ev.type === "block_start" || ev.type === "block_update" || ev.type === "block_end") {
      const block = ev.block;
      if ("status" in block && block.status === "pending_approval") {
        task.pendingApprovals.add(block.id);
        this.blockToTask.set(block.id, task.taskId);
      } else if (task.pendingApprovals.has(block.id)) {
        task.pendingApprovals.delete(block.id);
        this.blockToTask.delete(block.id);
      }
      if (block.type === "job" && (block as JobBlock).jobId) {
        const job = block as JobBlock;
        if (job.status === "running") {
          task.watchedJobs.add(job.jobId);
        } else if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          const wasWatched = task.watchedJobs.delete(job.jobId);
          // A watched job completing BETWEEN turns (idle) is the continuation
          // trigger: append its condensed result and run the next turn.
          if (wasWatched && task.status === "idle") {
            void this.continueAfterJob(task, job);
          }
        }
      }
    }

    task.turnEvents.push(ev);
    for (const sub of task.subscribers) {
      try {
        sub(ev);
      } catch {
        task.subscribers.delete(sub);
      }
    }

    if (ev.type === "done") {
      void this.onTurnDone(task, ev.content);
    } else if (ev.type === "error") {
      this.failTurn(task, ev.message);
    }
  }

  private async onTurnDone(task: DelegatedTask, content: string): Promise<void> {
    task.status = "idle";
    task.turnEvents = [];
    try {
      const db = await getDb();
      await db.insert(chatMessages).values({
        id: uuidv4(),
        sessionId: task.conversationId,
        role: "assistant",
        content,
      });
      await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, task.conversationId));
    } catch (err) {
      log.error("Failed to persist delegated turn", { taskId: task.taskId, err: (err as Error).message });
    }
    if (!task.parentNotified) {
      task.parentNotified = true;
      this.notifyParent(task, "completed", content);
    }
    this.emit("delegation", {
      kind: "turn-done",
      userId: task.userId,
      conversationId: task.conversationId,
      taskId: task.taskId,
    });
  }

  /** Peer-side async job finished between turns → automatic continuation turn
   *  (the origin-side mirror of the local idle re-prompt). */
  private async continueAfterJob(task: DelegatedTask, job: JobBlock): Promise<void> {
    try {
      const summary = `Background job "${job.label}" finished with status ${job.status}.\n\n${job.output ?? ""}`.trim();
      const db = await getDb();
      await db.insert(chatMessages).values({
        id: uuidv4(),
        sessionId: task.conversationId,
        role: "user",
        content: `Job Result:\n${summary}`,
      });
      const messages = await this.loadTranscript(task.conversationId);
      task.status = "running";
      task.streamAbort?.abort(); // close the watch stream; the turn stream replaces it
      void this.runRemoteTurn(task, messages);
    } catch (err) {
      log.error("Failed to continue delegated task after job completion", {
        taskId: task.taskId,
        err: (err as Error).message,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Terminal handling + parent notification
  // ---------------------------------------------------------------------------

  private failTurn(task: DelegatedTask, message: string): void {
    this.finishTask(task, "failed", message);
  }

  private finishTask(task: DelegatedTask, status: "failed" | "cancelled", message: string): void {
    if (task.status === status) return;
    task.status = status;
    task.streamAbort?.abort();
    task.streamAbort = null;
    // Surface the terminal state to live watchers as a stream event.
    const ev: AgentStreamEvent = { type: "error", message };
    task.turnEvents = [];
    for (const sub of task.subscribers) {
      try {
        sub(ev);
      } catch {
        task.subscribers.delete(sub);
      }
    }
    for (const blockId of task.pendingApprovals) this.blockToTask.delete(blockId);
    task.pendingApprovals.clear();
    task.watchedJobs.clear();
    // Persist a trace of the failure in the managed chat.
    void getDb()
      .then((db) =>
        db.insert(chatMessages).values({
          id: uuidv4(),
          sessionId: task.conversationId,
          role: "system",
          content: status === "cancelled" ? `⏹ ${message}` : `⚠ Sub-agent ${status}: ${message}`,
        }),
      )
      .catch((err) => log.warn("Failed to persist delegation terminal message", { err: (err as Error).message }));
    if (!task.parentNotified) {
      task.parentNotified = true;
      this.notifyParent(task, status, message);
    }
    this.emit("delegation", {
      kind: status,
      userId: task.userId,
      conversationId: task.conversationId,
      taskId: task.taskId,
    });
  }

  /**
   * Decision 6: the parent chat learns the outcome through the existing
   * async-job → WS → idle-re-prompt path. jobId = taskId, so clients correlate
   * the parent's `subagent` block exactly like a `job` block.
   */
  private notifyParent(task: DelegatedTask, status: "completed" | "failed" | "cancelled", detail: string): void {
    const result: CondensedJobResult = {
      status,
      exitCode: null,
      durationMs: null,
      label: `Sub-agent @ ${task.nodeId}: ${task.label}`,
      tail: [],
      errors: [],
      stderr: "",
      summary: detail || undefined,
    };
    const formatted = [
      `Delegated sub-agent task "${task.label}" on mesh node "${task.nodeId}" ${status}.`,
      "",
      detail ? `Result:\n${detail}` : "(no summary was produced)",
      "",
      `The full run is in managed chat ${task.conversationId}.`,
    ].join("\n");
    this.asyncJob.emit("result", {
      jobId: task.taskId,
      context: {
        userId: task.userId,
        conversationId: task.parentConversationId ?? null,
        label: result.label,
        autoContinue: true,
      },
      result,
      formatted,
    });
  }

  // ---------------------------------------------------------------------------
  // Registry + transcripts
  // ---------------------------------------------------------------------------

  private register(task: DelegatedTask): void {
    this.tasks.set(task.taskId, task);
    this.byConversation.set(task.conversationId, task.taskId);
  }

  /** Find a task by managed-chat id, rebuilding from session metadata after a
   *  server restart (the peer is stateless between turns, so this heals). */
  private async taskForConversation(conversationId: string, userId: number | undefined): Promise<DelegatedTask> {
    const existingId = this.byConversation.get(conversationId);
    if (existingId) {
      const task = this.tasks.get(existingId);
      if (task) {
        if (task.userId !== userId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Managed chat not found" });
        }
        return task;
      }
    }

    const db = await getDb();
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        userId === undefined
          ? eq(chatSessions.id, conversationId)
          : and(eq(chatSessions.id, conversationId), eq(chatSessions.userId, userId)),
      )
      .limit(1);
    const delegation = (session?.metadata as { delegation?: DelegationMetadata } | null)?.delegation;
    if (!session || !delegation) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Managed chat not found" });
    }

    const task: DelegatedTask = {
      taskId: delegation.taskId,
      conversationId,
      userId,
      label: session.title.replace(/^⇄ [^—]+ — /, ""),
      nodeId: delegation.nodeId,
      scopePath: delegation.scopePath,
      providerId: session.providerId === "ommesh" ? undefined : session.providerId,
      modelId: session.modelId === "peer-default" ? undefined : session.modelId,
      parentConversationId: delegation.parentConversationId,
      status: "idle",
      lastSeq: 0,
      turnEvents: [],
      subscribers: new Set(),
      pendingApprovals: new Set(),
      watchedJobs: new Set(),
      parentNotified: true, // a rebuilt task never re-reports to the parent
      streamAbort: null,
      supportsNativeTools: undefined,
      executionMode: undefined,
      autoApprove: undefined,
    };
    this.register(task);
    return task;
  }

  /** Full managed-chat transcript, oldest first, LLM-visible roles only. */
  private async loadTranscript(conversationId: string): Promise<SubAgentMessage[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, conversationId))
      .orderBy(asc(chatMessages.createdAt));
    return rows
      .filter((r) => r.role === "system" || r.role === "user" || r.role === "assistant")
      .map((r) => ({ role: r.role as SubAgentMessage["role"], content: r.content }));
  }

  private peerNames(): string {
    try {
      return meshNode
        .getDiscovery()
        .getPeers()
        .map((p) => p.name)
        .join(", ");
    } catch {
      return "";
    }
  }
}
