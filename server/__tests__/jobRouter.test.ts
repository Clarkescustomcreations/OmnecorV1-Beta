/**
 * Batch G tail — route-level tests for `jobRouter` (unified async job control).
 *
 * The router is pure orchestration over injected services (`ctx.services.*`) and
 * the `AsyncJobService` singleton — no DB. We drive the real
 * `appRouter.createCaller(ctx)` with stub services and assert the wiring:
 * NOT_FOUND / BAD_REQUEST mapping, the HITL "command" approval gate on
 * startAsync (denial → FORBIDDEN, no spawn), cwd path-traversal rejection via
 * validatePath, the type/state list filters, and the admin gate on
 * runSandboxCommand / prune.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const trackMock = vi.hoisted(() => vi.fn());
vi.mock("../phase2/services/AsyncJobService.js", () => ({
  AsyncJobService: { getInstance: () => ({ track: trackMock }) },
}));

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

let store: TestDb;
let db: Db;
let user: User;
let admin: User;

/** Build the stub service bag jobRouter reaches through ctx.services. */
function mkServices(over: Record<string, unknown> = {}) {
  return {
    processManager: {
      getJobStatus: vi.fn(),
      getAllJobs: vi.fn(() => [] as unknown[]),
      cancelJob: vi.fn(async () => true),
      spawn: vi.fn(async () => "spawned-job-id"),
      pruneHistory: vi.fn(() => 0),
    },
    hitl: { requestApprovalDetailed: vi.fn(async () => ({ approved: true, reason: null })) },
    docker: { runInSandbox: vi.fn(async () => "docker-job-id") },
    ...over,
  };
}
type Services = ReturnType<typeof mkServices>;

function callerFor(u: User | null, services: Services) {
  return appRouter.createCaller(makeContext(u, db, services));
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  user = await seedUser(db);
  admin = await seedUser(db, { openId: "admin", email: "admin@x.com", role: "admin" });
  trackMock.mockReset();
});

describe("jobs — auth boundary", () => {
  it("rejects an unauthenticated getStatus", async () => {
    const caller = callerFor(null, mkServices());
    await expect(caller.jobs.getStatus({ jobId: randomUUID() })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("jobs.getStatus", () => {
  it("returns the job status when found", async () => {
    const status = { id: "j", state: "running", type: "custom" };
    const services = mkServices();
    services.processManager.getJobStatus.mockReturnValue(status);
    const caller = callerFor(user, services);
    expect(await caller.jobs.getStatus({ jobId: randomUUID() })).toEqual(status);
  });

  it("maps an unknown job to NOT_FOUND", async () => {
    const services = mkServices();
    services.processManager.getJobStatus.mockReturnValue(undefined);
    const caller = callerFor(user, services);
    await expect(caller.jobs.getStatus({ jobId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a non-UUID job id (input validation)", async () => {
    const caller = callerFor(user, mkServices());
    await expect(caller.jobs.getStatus({ jobId: "not-a-uuid" })).rejects.toThrow();
  });
});

describe("jobs.startAsync — HITL command gate", () => {
  it("spawns a raw-capture job and tracks it after approval", async () => {
    const services = mkServices();
    services.processManager.spawn.mockResolvedValue("job-42");
    const caller = callerFor(user, services);

    const res = await caller.jobs.startAsync({
      command: "pnpm",
      args: ["build"],
      label: "prod build",
      conversationId: "conv-1",
    });
    expect(res).toEqual({ jobId: "job-42", status: "started", label: "prod build" });

    // Approval was requested for the "command" risk class with the real args.
    expect(services.hitl.requestApprovalDetailed).toHaveBeenCalledWith(
      "asyncJob.start",
      { command: "pnpm", args: ["build"], cwd: null },
      "command",
    );
    // The spawn is argument-array based (no shell string) and long-lived.
    expect(services.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ type: "custom", command: "pnpm", args: ["build"], captureMode: "raw", timeoutMs: 0 }),
    );
    expect(trackMock).toHaveBeenCalledWith(
      "job-42",
      expect.objectContaining({ userId: user.id, conversationId: "conv-1", label: "prod build" }),
    );
  });

  it("denies with FORBIDDEN (carrying the reviewer reason) and never spawns", async () => {
    const services = mkServices();
    services.hitl.requestApprovalDetailed.mockResolvedValue({ approved: false, reason: "too risky" });
    const caller = callerFor(user, services);

    await expect(
      caller.jobs.startAsync({ command: "rm", args: ["-rf", "/"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("too risky") });
    expect(services.processManager.spawn).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("rejects a path-traversal cwd via validatePath (after approval, before spawn)", async () => {
    const services = mkServices();
    const caller = callerFor(user, services);
    await expect(
      caller.jobs.startAsync({ command: "ls", args: [], cwd: "../../etc" }),
    ).rejects.toThrow();
    expect(services.processManager.spawn).not.toHaveBeenCalled();
  });
});

describe("jobs.list", () => {
  it("returns all jobs with a total and applies type/state filters", async () => {
    const jobs = [
      { id: "a", type: "blender", state: "running" },
      { id: "b", type: "custom", state: "completed" },
      { id: "c", type: "blender", state: "completed" },
    ];
    const services = mkServices();
    services.processManager.getAllJobs.mockReturnValue(jobs);
    const caller = callerFor(user, services);

    expect(await caller.jobs.list(undefined)).toEqual({ total: 3, jobs });
    expect(await caller.jobs.list({ type: "blender" })).toMatchObject({ total: 2 });
    expect(await caller.jobs.list({ state: "completed", type: "blender" })).toMatchObject({
      total: 1,
      jobs: [{ id: "c" }],
    });
  });
});

describe("jobs.cancel", () => {
  it("confirms cancellation when the process manager accepts it", async () => {
    const services = mkServices();
    services.processManager.cancelJob.mockResolvedValue(true);
    const caller = callerFor(user, services);
    const res = await caller.jobs.cancel({ jobId: randomUUID() });
    expect(res.success).toBe(true);
  });

  it("maps a non-running / unknown job to BAD_REQUEST", async () => {
    const services = mkServices();
    services.processManager.cancelJob.mockResolvedValue(false);
    const caller = callerFor(user, services);
    await expect(caller.jobs.cancel({ jobId: randomUUID() })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("jobs.runSandboxCommand — admin gate", () => {
  it("forbids a non-admin user", async () => {
    const services = mkServices();
    const caller = callerFor(user, services);
    await expect(
      caller.jobs.runSandboxCommand({ command: "echo hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(services.docker.runInSandbox).not.toHaveBeenCalled();
  });

  it("queues the command in a container for an admin", async () => {
    const services = mkServices();
    services.docker.runInSandbox.mockResolvedValue("sandbox-7");
    const caller = callerFor(admin, services);
    const res = await caller.jobs.runSandboxCommand({ command: "echo hi", image: "alpine:latest" });
    expect(res).toMatchObject({ success: true, jobId: "sandbox-7" });
    expect(services.docker.runInSandbox).toHaveBeenCalledWith("alpine:latest", ["echo", "hi"]);
  });
});

describe("jobs.prune — admin gate", () => {
  it("forbids a non-admin user", async () => {
    const caller = callerFor(user, mkServices());
    await expect(caller.jobs.prune({ keepLast: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prunes history for an admin and reports the count", async () => {
    const services = mkServices();
    services.processManager.pruneHistory.mockReturnValue(9);
    const caller = callerFor(admin, services);
    expect(await caller.jobs.prune({ keepLast: 5 })).toEqual({ success: true, prunedCount: 9 });
    expect(services.processManager.pruneHistory).toHaveBeenCalledWith(5);
  });
});
