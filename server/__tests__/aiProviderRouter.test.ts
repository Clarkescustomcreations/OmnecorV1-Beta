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
vi.mock("../phase2/services/AiProviderService.js", () => ({
  AiProviderService: { getInstance: () => aiSvc },
}));

// discoverProviderModels is a cloudProcedure → audit middleware runs; stub it.
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(executionMode: User["executionMode"] = "scrapper"): User {
  return {
    id: 1,
    openId: "owner-1",
    email: "u@example.com",
    name: "U",
    loginMethod: "manus",
    passwordHash: null,
    role: "user",
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
