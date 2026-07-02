/**
 * Batch I — route-level tests for `agentRouter` (crew/agent orchestration bridges).
 *
 * The RecursiveMAS / CrewAI bridges (:8011) are proxied through
 * `ctx.services.agent`, stubbed here so the router logic is exercised without a
 * Python process: plain delegation for runCrew/runLiteAgent/triggerN8n/status,
 * and — the part worth guarding — the **HITL gate on runRecursiveMAS** (a crew of
 * >3 agents requires approval; a denial is FORBIDDEN and never spawns), plus the
 * stop path routing through the process manager.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const auditHolder = vi.hoisted(() => ({ log: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: auditHolder.log }) },
}));

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(): User {
  return {
    id: 1, openId: "u1", email: "u@x.com", name: "U", loginMethod: "manus",
    passwordHash: null, role: "user", executionMode: "scrapper",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as User;
}

function mkCaller(user: User | null) {
  const agent = {
    runCrew: vi.fn(),
    runLiteAgent: vi.fn(),
    triggerN8n: vi.fn(),
    runRecursiveMAS: vi.fn(),
    getRecursiveMASStatus: vi.fn(),
  };
  const hitl = { requestApproval: vi.fn() };
  const processManager = { cancelJob: vi.fn() };
  const c: Caller = appRouter.createCaller(makeContext(user, {} as Db, { agent, hitl, processManager }));
  return { caller: c, agent, hitl, processManager };
}

beforeEach(() => auditHolder.log.mockClear());

describe("agent — auth boundary", () => {
  it("rejects unauthenticated runCrew", async () => {
    const { caller } = mkCaller(null);
    await expect(
      caller.agent.runCrew({ type: "crewai", goal: "x" })
    ).rejects.toThrow(TRPCError);
  });
});

describe("agent delegation", () => {
  it("runCrew forwards the task to the crew service", async () => {
    const { caller, agent } = mkCaller(makeUser());
    agent.runCrew.mockResolvedValue({ output: "done" });
    const res = await caller.agent.runCrew({ type: "crewai", goal: "research X" });
    expect(res).toEqual({ output: "done" });
    expect(agent.runCrew.mock.calls[0]?.[0]).toMatchObject({ type: "crewai", goal: "research X" });
  });

  it("runLiteAgent + triggerN8n delegate to their service methods", async () => {
    const { caller, agent } = mkCaller(makeUser());
    agent.runLiteAgent.mockResolvedValue({ output: "lite" });
    agent.triggerN8n.mockResolvedValue({ triggered: true });
    expect(await caller.agent.runLiteAgent({ type: "liteagent", goal: "g" })).toEqual({ output: "lite" });
    expect(await caller.agent.triggerN8n({ type: "n8n", goal: "g", workflowId: "wf1" })).toEqual({ triggered: true });
  });

  it("getRecursiveMASStatus delegates to the service", async () => {
    const { caller, agent } = mkCaller(makeUser());
    agent.getRecursiveMASStatus.mockResolvedValue({ state: "running", progress: 0.5 });
    expect(await caller.agent.getRecursiveMASStatus({ jobId: "job1" })).toMatchObject({ state: "running" });
    expect(agent.getRecursiveMASStatus).toHaveBeenCalledWith("job1");
  });
});

describe("agent.runRecursiveMAS — HITL gate for large crews", () => {
  it("runs a small crew (≤3 agents) without any HITL prompt", async () => {
    const { caller, agent, hitl } = mkCaller(makeUser());
    agent.runRecursiveMAS.mockResolvedValue("job_small");
    const res = await caller.agent.runRecursiveMAS({ goal: "g", agentIds: ["a", "b"] });
    expect(res).toEqual({ jobId: "job_small" });
    expect(hitl.requestApproval).not.toHaveBeenCalled();
    // Spawn is audited.
    expect(auditHolder.log.mock.calls.some(c => (c[0] as { eventType?: string })?.eventType === "agent_recursive_mas_spawn")).toBe(true);
  });

  it("requires HITL approval for a >3-agent crew and FORBIDs on denial (no spawn)", async () => {
    const { caller, agent, hitl } = mkCaller(makeUser());
    hitl.requestApproval.mockResolvedValue(false);
    await expect(
      caller.agent.runRecursiveMAS({ goal: "big", agentIds: ["a", "b", "c", "d"] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(hitl.requestApproval).toHaveBeenCalledOnce();
    expect(agent.runRecursiveMAS).not.toHaveBeenCalled();
  });

  it("spawns the large crew once HITL approves", async () => {
    const { caller, agent, hitl } = mkCaller(makeUser());
    hitl.requestApproval.mockResolvedValue(true);
    agent.runRecursiveMAS.mockResolvedValue("job_big");
    const res = await caller.agent.runRecursiveMAS({ goal: "big", agentIds: ["a", "b", "c", "d"], mode: "hierarchical" });
    expect(res).toEqual({ jobId: "job_big" });
    expect(agent.runRecursiveMAS).toHaveBeenCalledOnce();
  });
});

describe("agent.stopRecursiveMAS", () => {
  it("cancels the job through the process manager", async () => {
    const { caller, processManager } = mkCaller(makeUser());
    processManager.cancelJob.mockResolvedValue(undefined);
    expect(await caller.agent.stopRecursiveMAS({ jobId: "job1" })).toEqual({ stopped: true });
    expect(processManager.cancelJob).toHaveBeenCalledWith("job1");
  });
});
