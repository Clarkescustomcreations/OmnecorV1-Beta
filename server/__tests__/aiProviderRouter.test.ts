/**
 * Route-level tests for `aiProviderRouter`.
 *
 * Covers the public provider-discovery procedures (getProviders,
 * discoverOllamaModels, checkHealth — all delegate to the AI provider service),
 * and the Sovereign-mode gate + Zod enum contract on the one cloudProcedure
 * (discoverProviderModels). The `chatStream` subscription is not driven here —
 * createCaller cannot drive a tRPC subscription; its per-provider Sovereign gate
 * shares the `assertProviderAllowedInMode` guard already covered in
 * aiRouter.test.ts / sovereignGating.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// AiProviderService singleton — checkHealth delegates to it directly.
const aiSvc = vi.hoisted(() => ({ checkHealth: vi.fn() }));
vi.mock("../core_services/services/AiProviderService.js", () => ({
  AiProviderService: { getInstance: () => aiSvc },
}));

// ChatAgentRunner — only mocked so the one test that actually drives the
// agentChatStream observable (below) doesn't run the real tool loop; every
// other agentChatStream test in this file never subscribes, so `new
// ChatAgentRunner()` is never even constructed for them (observable bodies
// don't run until `.subscribe()` is called).
const runnerRunMock = vi.hoisted(() => vi.fn());
vi.mock("../core_services/services/ChatAgentRunner.js", () => ({
  // A class whose constructor returns the shared mock — `vi.fn(() => ...)`
  // can't be `new`ed (arrow functions have no [[Construct]]).
  ChatAgentRunner: class {
    run = runnerRunMock;
  },
}));

// discoverProviderModels is a cloudProcedure → audit middleware runs; stub it.
vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import { ToolApprovalRegistry } from "../core_services/services/ToolApprovalRegistry.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(
  executionMode: User["executionMode"] = "scrapper",
  role: User["role"] = "user",
): User {
  return {
    id: 1,
    openId: "owner-1",
    email: "u@example.com",
    name: "U",
    loginMethod: "manus",
    passwordHash: null,
    role,
    executionMode,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as User;
}

function mkCaller(user: User | null) {
  const aiProvider = {
    listProviders: vi.fn().mockResolvedValue([{ id: "openai", name: "OpenAI" }]),
    discoverOllamaModels: vi.fn().mockResolvedValue([{ name: "llama3" }]),
    discoverProviderModels: vi.fn().mockResolvedValue([{ id: "gpt-4o" }]),
  };
  const c: Caller = appRouter.createCaller(makeContext(user, {} as Db, { aiProvider }));
  return { caller: c, aiProvider };
}

beforeEach(() => {
  aiSvc.checkHealth.mockReset();
});

describe("aiProvider.getProviders (public)", () => {
  it("delegates to the provider service with no extra providers", async () => {
    const { caller, aiProvider } = mkCaller(null);
    const res = await caller.aiProvider.getProviders();
    expect(res).toEqual([{ id: "openai", name: "OpenAI" }]);
    expect(aiProvider.listProviders).toHaveBeenCalledWith([]);
  });
});

describe("aiProvider.discoverOllamaModels (public)", () => {
  it("returns the locally discovered models", async () => {
    const { caller, aiProvider } = mkCaller(null);
    expect(await caller.aiProvider.discoverOllamaModels()).toEqual([{ name: "llama3" }]);
    expect(aiProvider.discoverOllamaModels).toHaveBeenCalledOnce();
  });
});

describe("aiProvider.checkHealth (public)", () => {
  it("delegates to the AiProviderService singleton", async () => {
    aiSvc.checkHealth.mockResolvedValue({ healthy: true, latencyMs: 12 });
    const { caller } = mkCaller(null);
    const res = await caller.aiProvider.checkHealth({ providerId: "ollama", modelId: "llama3" });
    expect(res).toEqual({ healthy: true, latencyMs: 12 });
    expect(aiSvc.checkHealth).toHaveBeenCalledWith({ providerId: "ollama", modelId: "llama3" });
  });
});

describe("aiProvider.discoverProviderModels (cloudProcedure)", () => {
  it("blocks a sovereign user (FORBIDDEN) and never calls the service", async () => {
    const { caller, aiProvider } = mkCaller(makeUser("sovereign"));
    await expect(
      caller.aiProvider.discoverProviderModels({ providerId: "openai" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(aiProvider.discoverProviderModels).not.toHaveBeenCalled();
  });

  it("discovers models for a non-sovereign user", async () => {
    const { caller, aiProvider } = mkCaller(makeUser("scrapper"));
    const res = await caller.aiProvider.discoverProviderModels({ providerId: "openai" });
    expect(res).toEqual([{ id: "gpt-4o" }]);
    expect(aiProvider.discoverProviderModels).toHaveBeenCalledWith("openai");
  });

  it("rejects an unknown provider id (Zod enum)", async () => {
    const { caller } = mkCaller(makeUser("scrapper"));
    await expect(
      // @ts-expect-error — exercising the runtime enum guard with an invalid id
      caller.aiProvider.discoverProviderModels({ providerId: "not-a-provider" })
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("aiProvider.agentChatStream (subscription, per-provider sovereign gate)", () => {
  it("blocks a sovereign user targeting a cloud provider (FORBIDDEN)", async () => {
    const { caller } = mkCaller(makeUser("sovereign"));
    // The gate runs synchronously in the subscription resolver — before the
    // observable is constructed — so the call rejects immediately.
    await expect(
      caller.aiProvider.agentChatStream({
        providerId: "anthropic",
        modelId: "claude-sonnet-5",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a local provider for a sovereign user (gate passes)", async () => {
    const { caller } = mkCaller(makeUser("sovereign"));
    // ollama is local — the gate must not throw. We don't drive the observable
    // (that would hit the real model); reaching a returned observable is enough.
    const sub = await caller.aiProvider.agentChatStream({
      providerId: "ollama",
      modelId: "llama3.2:latest",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sub).toBeDefined();
  });

  it("forwards targetNodeId through to ChatAgentRunner's input (Model-Fabric Phase 5 mesh-peer pin)", async () => {
    // The router rebuilds `input` field-by-field for ChatAgentRunner (unlike
    // chatStream, which forwards the whole Zod-parsed object) — exactly the
    // shape of bug that let `isSovereign` go missing from a different
    // procedure in this file's history. This drives the observable for real
    // to prove `targetNodeId` specifically survives that reconstruction,
    // rather than trusting a read of the source.
    runnerRunMock.mockImplementation(async function* () {
      yield { type: "done", content: "ok" };
    });
    const { caller } = mkCaller(makeUser("scrapper"));
    const sub = await caller.aiProvider.agentChatStream({
      providerId: "ollama",
      modelId: "qwen2.5:7b",
      messages: [{ role: "user", content: "hi" }],
      targetNodeId: "dads-pc",
    });

    await new Promise<void>((resolve) => {
      sub.subscribe({
        next: (ev: { type: string }) => { if (ev.type === "done") resolve(); },
        error: () => resolve(),
        complete: () => resolve(),
      });
    });

    expect(runnerRunMock).toHaveBeenCalledOnce();
    const params = runnerRunMock.mock.calls[0]![0] as { input: { targetNodeId?: string } };
    expect(params.input.targetNodeId).toBe("dads-pc");
  });

  it("targetNodeId is undefined when the caller doesn't pin a peer", async () => {
    runnerRunMock.mockClear();
    runnerRunMock.mockImplementation(async function* () {
      yield { type: "done", content: "ok" };
    });
    const { caller } = mkCaller(makeUser("scrapper"));
    const sub = await caller.aiProvider.agentChatStream({
      providerId: "ollama",
      modelId: "qwen2.5:7b",
      messages: [{ role: "user", content: "hi" }],
    });

    await new Promise<void>((resolve) => {
      sub.subscribe({
        next: (ev: { type: string }) => { if (ev.type === "done") resolve(); },
        error: () => resolve(),
        complete: () => resolve(),
      });
    });

    const params = runnerRunMock.mock.calls[0]![0] as { input: { targetNodeId?: string } };
    expect(params.input.targetNodeId).toBeUndefined();
  });
});

describe("agents:run capability gate (agentChatStream + runCodeSnippet)", () => {
  // The read-only `viewer` role lacks the `agents:run` permission, so it must
  // never reach the tool-executing paths — the gate rejects before the
  // provider/sovereign checks or interpreter resolution run. `user`/`admin`/
  // `owner` and paired `device` sessions hold `agents:run` and pass through.
  it("rejects a viewer from agentChatStream (FORBIDDEN) even for a local provider", async () => {
    const { caller } = mkCaller(makeUser("scrapper", "viewer"));
    await expect(
      caller.aiProvider.agentChatStream({
        providerId: "ollama", // local — so only the permission gate can throw
        modelId: "llama3.2:latest",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a viewer from runCodeSnippet (FORBIDDEN) before interpreter resolution", async () => {
    const { caller } = mkCaller(makeUser("scrapper", "viewer"));
    await expect(
      caller.aiProvider.runCodeSnippet({ language: "bash", code: "echo hi" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a paired device pass the gate on agentChatStream (local provider)", async () => {
    const { caller } = mkCaller(makeUser("scrapper", "device"));
    const sub = await caller.aiProvider.agentChatStream({
      providerId: "ollama",
      modelId: "llama3.2:latest",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sub).toBeDefined(); // reached the resolver → gate passed
  });

  it("lets a paired device past the runCodeSnippet gate (BAD_REQUEST, not FORBIDDEN)", async () => {
    const { caller } = mkCaller(makeUser("scrapper", "device"));
    // `html` isn't runnable → the handler throws BAD_REQUEST. Reaching that
    // point proves the permission gate let the device through (it never spawns).
    await expect(
      caller.aiProvider.runCodeSnippet({ language: "html", code: "<h1>hi</h1>" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("aiProvider.resolveToolApproval (mutation, HITL)", () => {
  it("resolves the caller's own pending approval and settles the runner's promise", async () => {
    const reg = ToolApprovalRegistry.getInstance();
    const { caller } = mkCaller(makeUser("scrapper")); // user id 1
    const pending = reg.waitFor("blk-route-1", 1);

    const res = await caller.aiProvider.resolveToolApproval({ id: "blk-route-1", decision: "approve" });
    expect(res).toEqual({ resolved: true });
    await expect(pending).resolves.toMatchObject({ approved: true });
  });

  it("reports resolved:false for an unknown id", async () => {
    const { caller } = mkCaller(makeUser("scrapper"));
    const res = await caller.aiProvider.resolveToolApproval({ id: "does-not-exist", decision: "deny" });
    expect(res).toEqual({ resolved: false });
  });

  it("will not resolve another user's pending approval", async () => {
    const reg = ToolApprovalRegistry.getInstance();
    const { caller } = mkCaller(makeUser("scrapper")); // caller id 1
    const pending = reg.waitFor("blk-route-2", 999); // owned by a different user

    const res = await caller.aiProvider.resolveToolApproval({ id: "blk-route-2", decision: "approve" });
    expect(res).toEqual({ resolved: false });
    // Clean up the still-pending entry so it doesn't leak across tests.
    reg.cancel("blk-route-2");
    await expect(pending).resolves.toMatchObject({ approved: false });
  });
});
