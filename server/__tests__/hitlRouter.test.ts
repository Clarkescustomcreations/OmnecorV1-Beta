/**
 * Route-level integration tests for `hitlRouter`.
 *
 * hitlRouter calls HITLApprovalService.getInstance() directly (not via
 * ctx.services), so the module is vi.mock'd to inject a controllable stub.
 * Covers: getPending (auth gate + returns queue), resolve (calls approveAction
 * with correct args). The router itself has no NOT_FOUND guard — it just
 * delegates to the service, so idempotency is a service-layer concern.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const mockHitlService = {
  getPendingActions: vi.fn(),
  approveAction: vi.fn(),
};

vi.mock("../phase2/services/HITLApprovalService.js", () => ({
  HITLApprovalService: {
    getInstance: () => mockHitlService,
  },
}));

import { appRouter } from "../routers.js";
import {
  createTestDb,
  seedUser,
  makeContext,
  type TestDb,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  mockHitlService.getPendingActions.mockReset();
  mockHitlService.approveAction.mockReset();
  mockHitlService.getPendingActions.mockReturnValue([]);
  mockHitlService.approveAction.mockReturnValue(undefined);
});

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers on getPending", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.hitl.getPending()).rejects.toThrow(TRPCError);
  });

  it("rejects unauthenticated callers on resolve", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.hitl.resolve({ id: "x", approved: true })).rejects.toThrow(TRPCError);
  });
});

// ─── hitl.getPending ─────────────────────────────────────────────────────────

describe("hitl.getPending", () => {
  it("returns empty actions array when queue is empty", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    mockHitlService.getPendingActions.mockReturnValue([]);
    const result = await caller.hitl.getPending();
    expect(result.actions).toEqual([]);
  });

  it("returns the pending actions from the service", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const pendingActions = [
      { id: "action-1", toolName: "issueCard", category: "financial", status: "pending" },
      { id: "action-2", toolName: "deleteModel", category: "command", status: "pending" },
    ];
    mockHitlService.getPendingActions.mockReturnValue(pendingActions);

    const result = await caller.hitl.getPending();
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].id).toBe("action-1");
    expect(result.actions[1].id).toBe("action-2");
  });

  it("any authenticated user (not just admin) can view pending actions", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    mockHitlService.getPendingActions.mockReturnValue([]);
    await expect(caller.hitl.getPending()).resolves.toBeDefined();
  });
});

// ─── hitl.resolve ────────────────────────────────────────────────────────────

describe("hitl.resolve", () => {
  it("calls approveAction with the correct id and approved=true", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const result = await caller.hitl.resolve({ id: "action-1", approved: true });
    expect(result.success).toBe(true);
    expect(mockHitlService.approveAction).toHaveBeenCalledWith("action-1", true, undefined);
  });

  it("calls approveAction with approved=false and passes the reason", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.hitl.resolve({ id: "action-2", approved: false, reason: "Too risky" });
    expect(mockHitlService.approveAction).toHaveBeenCalledWith("action-2", false, "Too risky");
  });

  it("returns success:true regardless of approval direction", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const approveResult = await caller.hitl.resolve({ id: "a1", approved: true });
    expect(approveResult.success).toBe(true);

    const rejectResult = await caller.hitl.resolve({ id: "a2", approved: false });
    expect(rejectResult.success).toBe(true);
  });

  it("any authenticated user can call resolve (non-admin route)", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.hitl.resolve({ id: "x", approved: true })).resolves.toMatchObject({ success: true });
  });
});
