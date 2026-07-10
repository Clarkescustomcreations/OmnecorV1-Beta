import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DelegationService persists into `chatSessions`/`chatMessages` via `getDb()`.
 * These tests exercise the ORIGIN-side orchestration — spawn, live relay, HITL
 * forwarding, and parent notification — with a minimal chainable DB fake (the
 * persistence itself is plain Drizzle inserts, covered by the schema/route
 * suites) and an injected transport standing in for the mTLS peer.
 */

// A no-op chainable drizzle fake. `db` itself is NOT thenable (so `await
// getDb()` returns it, not an unwrapped query result); its query builders ARE
// thenable (resolve to []) so `await db.insert(...).values(...)` and
// `await db.select()...orderBy()` both work.
function fakeDb() {
  const builder: any = {
    values: () => builder,
    set: () => builder,
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => Promise.resolve([]),
    onConflictDoNothing: () => Promise.resolve([]),
    then: (res: (v: unknown[]) => void) => res([]),
  };
  return {
    insert: () => builder,
    update: () => builder,
    select: () => builder,
  };
}

vi.mock("../../../db.factory.js", () => ({
  getDb: vi.fn(async () => fakeDb()),
}));

import { DelegationService, type DelegationTransport } from "../DelegationService.js";
import type { PeerInfo } from "../../ommesh/core/DiscoveryService.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";
import type { SubAgentEventEnvelope } from "@shared/subagent";

const peer: PeerInfo = {
  name: "DadsPC",
  address: "192.168.1.201",
  port: 3001,
  fingerprint: "abc",
  capabilities: { models: [] } as unknown as PeerInfo["capabilities"],
  modelsHash: "h",
  discoveredAt: new Date(),
};

/** A scripted transport that hands the caller a driver to push envelopes. */
function scriptedTransport() {
  let onEnvelope: ((env: SubAgentEventEnvelope) => void) | null = null;
  let resolveTurn: (() => void) | null = null;
  const approve = vi.fn(async () => ({ resolved: true }));
  const cancel = vi.fn(async () => {});
  const transport: DelegationTransport = {
    streamTurn: (_peer, _req, cb) =>
      new Promise<void>((resolve) => {
        onEnvelope = cb;
        resolveTurn = resolve;
      }),
    attach: () => Promise.resolve(),
    approve,
    cancel,
  };
  let seq = 0;
  const push = (event: AgentStreamEvent, turn = 1) => onEnvelope?.({ seq: ++seq, taskId: "", turn, event });
  const resetSeq = () => { seq = 0; };
  const endTurn = () => resolveTurn?.();
  return { transport, push, resetSeq, endTurn, approve, cancel };
}

function makeService(over: Partial<{ transport: DelegationTransport; findPeer: (id: string) => PeerInfo | undefined }> = {}) {
  const asyncJob = { emit: vi.fn() };
  const svc = new DelegationService({
    transport: over.transport,
    findPeer: over.findPeer ?? ((id) => (id === "DadsPC" ? peer : undefined)),
    originNodeId: () => "origin-1",
    asyncJob: asyncJob as any,
  });
  return { svc, asyncJob };
}

describe("DelegationService — spawn", () => {
  it("throws before launch when the target peer is not discoverable", async () => {
    const { svc } = makeService({ findPeer: () => undefined });
    await expect(
      svc.delegate({ userId: 1, targetNodeId: "ghost", label: "x", task: "do it" }),
    ).rejects.toThrow(/not currently discoverable/);
  });

  it("creates a managed chat and emits a `created` lifecycle event", async () => {
    const { transport } = scriptedTransport();
    const { svc } = makeService({ transport });
    const created: unknown[] = [];
    svc.on("delegation", (e) => created.push(e));
    const res = await svc.delegate({ userId: 7, targetNodeId: "DadsPC", label: "build", task: "run build" });
    expect(res.nodeName).toBe("DadsPC");
    expect(res.taskId).toBeTruthy();
    expect(res.conversationId).toBeTruthy();
    expect(created[0]).toMatchObject({ kind: "created", nodeName: "DadsPC", conversationId: res.conversationId });
  });
});

describe("DelegationService — live relay + HITL", () => {
  it("relays events to subscribers and indexes a pending_approval block for forwarding", async () => {
    const { transport, push, approve } = scriptedTransport();
    const { svc } = makeService({ transport });
    const { conversationId } = await svc.delegate({ userId: 7, targetNodeId: "DadsPC", label: "t", task: "go" });
    // Let delegate()'s fire-and-forget runRemoteTurn wire up the transport.
    await new Promise((r) => setTimeout(r, 5));

    const received: AgentStreamEvent[] = [];
    const sub = await svc.subscribe(conversationId, 7, (ev) => received.push(ev));

    // Peer streams a command box awaiting approval.
    const pendingBlock = { id: "blk-1", type: "command" as const, command: "rm", status: "pending_approval" as const };
    push({ type: "block_update", block: pendingBlock });
    await new Promise((r) => setTimeout(r, 2));

    expect(received.some((e) => e.type === "block_update")).toBe(true);
    // The block is now known as delegated → resolveToolApproval can forward it.
    expect(svc.isDelegatedBlock("blk-1")).toBe(true);

    const ok = await svc.resolveApproval("blk-1", 7, "approve");
    expect(ok).toBe(true);
    expect(approve).toHaveBeenCalledWith(peer, expect.any(String), { id: "blk-1", decision: "approve", denyReason: undefined });

    sub.unsubscribe();
  });

  it("rejects a cross-user approval forward", async () => {
    const { transport, push } = scriptedTransport();
    const { svc } = makeService({ transport });
    await svc.delegate({ userId: 7, targetNodeId: "DadsPC", label: "t", task: "go" });
    await new Promise((r) => setTimeout(r, 5));
    push({ type: "block_update", block: { id: "blk-2", type: "command", command: "ls", status: "pending_approval" } });
    await new Promise((r) => setTimeout(r, 2));
    // A different user must not be able to resolve it.
    expect(await svc.resolveApproval("blk-2", 999, "approve")).toBe(false);
  });

  it("does not drop a follow-up turn whose peer seq restarted (registry eviction)", async () => {
    // A peer that evicted an idle task restarts `seq` at 1 for the next turn.
    // The origin must not treat those as duplicates of the previous turn.
    const { transport, push, resetSeq } = scriptedTransport();
    const { svc } = makeService({ transport });
    const { conversationId } = await svc.delegate({ userId: 7, targetNodeId: "DadsPC", label: "t", task: "go" });
    await new Promise((r) => setTimeout(r, 5));

    // Turn 1 advances the origin's high-watermark to 3, then completes.
    push({ type: "text_delta", id: "t1", delta: "a" });
    push({ type: "text_delta", id: "t1", delta: "b" });
    push({ type: "done", blocks: [], content: "first" });
    await new Promise((r) => setTimeout(r, 5));

    // A follow-up turn: subscribe, then the peer streams with seq restarted at 1.
    const received: AgentStreamEvent[] = [];
    const sub = await svc.subscribe(conversationId, 7, (ev) => received.push(ev));
    void svc.sendUserTurn(conversationId, 7, "again");
    await new Promise((r) => setTimeout(r, 5));
    resetSeq(); // peer's fresh task numbering
    push({ type: "text_delta", id: "t2", delta: "second-turn" });
    await new Promise((r) => setTimeout(r, 5));

    // The low-seq event of the new turn must reach the subscriber, not be deduped.
    expect(received.some((e) => e.type === "text_delta" && e.delta === "second-turn")).toBe(true);
    sub.unsubscribe();
  });

  it("notifies the parent (async-job path) with the condensed result on the first turn's done", async () => {
    const { transport, push } = scriptedTransport();
    const { svc, asyncJob } = makeService({ transport });
    await svc.delegate({
      userId: 7,
      targetNodeId: "DadsPC",
      label: "summarize",
      task: "go",
      parentConversationId: "parent-conv",
    });
    await new Promise((r) => setTimeout(r, 5));

    push({ type: "done", blocks: [], content: "All done — built successfully." });
    await new Promise((r) => setTimeout(r, 5));

    expect(asyncJob.emit).toHaveBeenCalledWith(
      "result",
      expect.objectContaining({
        context: expect.objectContaining({ conversationId: "parent-conv", autoContinue: true }),
        formatted: expect.stringContaining("built successfully"),
      }),
    );
  });
});
