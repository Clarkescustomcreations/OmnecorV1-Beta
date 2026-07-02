/**
 * Route-level integration tests for `pipelineRouter`.
 *
 * Delegating router over ctx.services.pipeline + the HITL gate. Verify: auth,
 * create/list/get delegation (+ NOT_FOUND), approvePhase HITL gate (deny →
 * FORBIDDEN with no approve call, approve → delegates), and abortPipeline. All
 * services stubbed.
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

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function services(overrides: Record<string, unknown> = {}) {
  return {
    pipeline: {
      createPipeline: vi.fn().mockResolvedValue({ id: "pl-1", name: "P" }),
      getPipeline: vi.fn().mockResolvedValue({ id: "pl-1" }),
      listPipelines: vi.fn().mockResolvedValue([{ id: "pl-1" }, { id: "pl-2" }]),
      approvePhase: vi.fn().mockResolvedValue({ ok: true }),
      abortPipeline: vi.fn().mockResolvedValue({ aborted: true }),
    },
    hitl: { requestApproval: vi.fn().mockResolvedValue(true) },
    auditLog: { log: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("auth boundary", () => {
  it("rejects unauthenticated listPipelines", async () => {
    const caller = appRouter.createCaller(makeContext(null, db, services()));
    await expect(caller.pipeline.listPipelines()).rejects.toThrow(TRPCError);
  });
});

describe("pipeline.createPipeline / listPipelines / getPipeline", () => {
  it("createPipeline forwards name/goal/userId/projectId", async () => {
    const user = await seedUser(db);
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.pipeline.createPipeline({ name: "Build", goal: "ship the feature end to end", projectId: "proj-1" });
    expect(res).toEqual({ id: "pl-1", name: "P" });
    expect(svc.pipeline.createPipeline).toHaveBeenCalledWith("Build", "ship the feature end to end", user.id, "proj-1");
  });

  it("listPipelines is scoped to the user", async () => {
    const user = await seedUser(db);
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.pipeline.listPipelines();
    expect(res).toHaveLength(2);
    expect(svc.pipeline.listPipelines).toHaveBeenCalledWith(user.id);
  });

  it("getPipeline throws NOT_FOUND when the service returns null", async () => {
    const user = await seedUser(db);
    const svc = services({ pipeline: { getPipeline: vi.fn().mockResolvedValue(null) } });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    await expect(caller.pipeline.getPipeline({ pipelineId: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("pipeline.approvePhase — HITL gate", () => {
  it("FORBIDs when HITL denies the phase", async () => {
    const user = await seedUser(db);
    const svc = services({ hitl: { requestApproval: vi.fn().mockResolvedValue(false) } });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    await expect(
      caller.pipeline.approvePhase({ pipelineId: "pl-1", phase: "EXECUTE" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(svc.pipeline.approvePhase).not.toHaveBeenCalled();
  });

  it("delegates to the service once HITL approves", async () => {
    const user = await seedUser(db);
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.pipeline.approvePhase({ pipelineId: "pl-1", phase: "SHIP" });
    expect(res).toEqual({ ok: true });
    expect(svc.pipeline.approvePhase).toHaveBeenCalledWith("pl-1", "SHIP", user.id);
  });
});

describe("pipeline.abortPipeline", () => {
  it("delegates to the service", async () => {
    const user = await seedUser(db);
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.pipeline.abortPipeline({ pipelineId: "pl-1" });
    expect(res).toEqual({ aborted: true });
    expect(svc.pipeline.abortPipeline).toHaveBeenCalledWith("pl-1");
  });
});
