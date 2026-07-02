/**
 * Batch C — Item 5: HITLApprovalService
 *
 * Tests the in-memory queue lifecycle:
 *   getPendingActions(): empty queue initially
 *   requestApprovalDetailed() + approveAction(id, true): resolves {approved:true}
 *   requestApprovalDetailed() + approveAction(id, false, reason): resolves {approved:false, reason}
 *   approveAction() for unknown id: no-op, does not throw
 *   isHitlGateEnabled() when category gate is disabled: auto-approve without suspending
 *   emit "actionPending" event when a new action is queued
 *
 * DB interactions inside HITLApprovalService are fire-and-forget (they use
 * .catch() to swallow errors) so a no-op stub is correct here — these tests
 * exercise the in-memory queue/resolver logic, not the persistence layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB stub — hydrateFromDb + all subsequent writes are no-ops ────────────────

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// getSetting — default returns true (gate enabled); individual tests override
const mockGetSetting = vi.fn().mockReturnValue(true);
vi.mock("../phase2/services/SettingsService.js", () => ({
  SettingsService: { getInstance: vi.fn() },
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

import {
  HITLApprovalService,
  isHitlGateEnabled,
} from "../phase2/services/HITLApprovalService.js";

// ── DB stub factory ───────────────────────────────────────────────────────────

function makeDbStub() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ where });
  const values = vi.fn().mockResolvedValue([]);
  return {
    update: vi.fn().mockReturnValue({ set }),
    select: vi.fn().mockReturnValue({ from }),
    insert: vi.fn().mockReturnValue({ values }),
    delete: vi.fn().mockReturnValue({ where }),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  h.db = makeDbStub();
  mockGetSetting.mockReturnValue(true); // gate enabled by default
  // Reset singleton so each test gets a fresh HITLApprovalService instance
  (HITLApprovalService as any).instance = null;
});

// ── getPendingActions ─────────────────────────────────────────────────────────

describe("HITLApprovalService.getPendingActions", () => {
  it("returns an empty array when no actions have been queued", () => {
    const svc = HITLApprovalService.getInstance();
    expect(svc.getPendingActions()).toEqual([]);
  });
});

// ── requestApprovalDetailed + approveAction ───────────────────────────────────

describe("HITLApprovalService — approval lifecycle", () => {
  it("resolves {approved:true} when the action is approved", async () => {
    const svc = HITLApprovalService.getInstance();

    const pendingPromise = svc.requestApprovalDetailed("issueCard", { amount: 100 });
    const [action] = svc.getPendingActions();
    expect(action).toBeDefined();
    expect(action!.toolName).toBe("issueCard");

    svc.approveAction(action!.id, true);
    const result = await pendingPromise;

    expect(result.approved).toBe(true);
    expect(result.reason).toBeUndefined();
    // Action is removed from the pending queue after resolution
    expect(svc.getPendingActions()).toHaveLength(0);
  });

  it("resolves {approved:false, reason} when the action is rejected", async () => {
    const svc = HITLApprovalService.getInstance();

    const pendingPromise = svc.requestApprovalDetailed("deleteModel", { model: "gpt-4" });
    const [action] = svc.getPendingActions();

    svc.approveAction(action!.id, false, "Too risky at this budget level");
    const result = await pendingPromise;

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Too risky at this budget level");
    expect(svc.getPendingActions()).toHaveLength(0);
  });

  it("multiple pending actions are each resolved independently", async () => {
    const svc = HITLApprovalService.getInstance();

    const p1 = svc.requestApprovalDetailed("toolA", {});
    const p2 = svc.requestApprovalDetailed("toolB", {});

    const pending = svc.getPendingActions();
    expect(pending).toHaveLength(2);

    const idA = pending.find(a => a.toolName === "toolA")!.id;
    const idB = pending.find(a => a.toolName === "toolB")!.id;

    svc.approveAction(idA, true);
    svc.approveAction(idB, false, "denied");

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.approved).toBe(true);
    expect(r2.approved).toBe(false);
    expect(r2.reason).toBe("denied");
  });

  it("emits 'actionPending' event when a new action is queued", () => {
    const svc = HITLApprovalService.getInstance();
    const handler = vi.fn();
    svc.on("actionPending", handler);

    void svc.requestApprovalDetailed("writeFile", { path: "/etc/hosts" });
    svc.removeListener("actionPending", handler);

    expect(handler).toHaveBeenCalledOnce();
    const action = handler.mock.calls[0]![0];
    expect(action.toolName).toBe("writeFile");
    expect(action.status).toBe("pending");
  });

  it("approveAction with unknown id is a no-op (does not throw)", () => {
    const svc = HITLApprovalService.getInstance();
    expect(() => svc.approveAction("ghost-id-that-never-existed", true)).not.toThrow();
  });
});

// ── requestApproval (boolean wrapper) ────────────────────────────────────────

describe("HITLApprovalService.requestApproval — boolean form", () => {
  it("resolves true when approved", async () => {
    const svc = HITLApprovalService.getInstance();
    const promise = svc.requestApproval("simpleOp", {});
    const [action] = svc.getPendingActions();
    svc.approveAction(action!.id, true);
    expect(await promise).toBe(true);
  });

  it("resolves false when rejected", async () => {
    const svc = HITLApprovalService.getInstance();
    const promise = svc.requestApproval("simpleOp", {});
    const [action] = svc.getPendingActions();
    svc.approveAction(action!.id, false);
    expect(await promise).toBe(false);
  });
});

// ── isHitlGateEnabled + auto-approve ─────────────────────────────────────────

describe("isHitlGateEnabled and auto-approve behaviour", () => {
  it("returns true (gate enabled) when getSetting returns true", () => {
    mockGetSetting.mockReturnValue(true);
    expect(isHitlGateEnabled("command")).toBe(true);
  });

  it("returns false (gate disabled) when getSetting returns false", () => {
    mockGetSetting.mockReturnValue(false);
    expect(isHitlGateEnabled("financial")).toBe(false);
  });

  it("auto-approves immediately (no suspension) when category gate is disabled", async () => {
    mockGetSetting.mockReturnValue(false); // gate off
    const svc = HITLApprovalService.getInstance();

    const result = await svc.requestApprovalDetailed("terminalCommand", { cmd: "ls" }, "command");

    // Auto-approved: no pending actions in queue
    expect(result.approved).toBe(true);
    expect(svc.getPendingActions()).toHaveLength(0);
  });
});
