/**
 * Route-level test for `aiProvider.catalog` (Model-Fabric Phase 3/4).
 *
 * This is the actual boundary a service-only test can't reach: whether a
 * Sovereign/air-gapped user's request reaches `ModelCatalogService` with
 * `isSovereign: true`. The service unconditionally trusts whatever the
 * router passes it (see ModelCatalogService.test.ts for its own gating
 * logic) — this suite is what would have caught the router forgetting to
 * compute and pass that flag at all, which is exactly what happened before
 * this test existed: `catalog` was a bare `protectedProcedure` with no
 * Sovereign check, silently letting ModelCatalogService.getCatalog() run
 * `collectCloud()` (a live call to any configured cloud provider) for an
 * air-gapped user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const auditHolder = vi.hoisted(() => ({ log: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: { getInstance: () => ({ log: auditHolder.log }) },
}));

const runtimeHolder = vi.hoisted(() => ({ ensureModelLoaded: vi.fn().mockResolvedValue(true) }));
vi.mock("../core_services/services/LocalLlmRuntimeService.js", () => ({
  LocalLlmRuntimeService: { getInstance: () => runtimeHolder },
}));

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(executionMode: User["executionMode"]): User {
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

function caller(user: User | null): { caller: Caller; getCatalog: ReturnType<typeof vi.fn> } {
  const getCatalog = vi.fn().mockResolvedValue([]);
  const services = { modelCatalog: { getCatalog } };
  return {
    caller: appRouter.createCaller(makeContext(user, {} as Db, services)),
    getCatalog,
  };
}

beforeEach(() => {
  auditHolder.log.mockClear();
  runtimeHolder.ensureModelLoaded.mockClear().mockResolvedValue(true);
});

describe("aiProvider.catalog — Sovereign-mode gate", () => {
  it("passes isSovereign:true for a sovereign user", async () => {
    const { caller: c, getCatalog } = caller(makeUser("sovereign"));
    await c.aiProvider.catalog();
    expect(getCatalog).toHaveBeenCalledWith({ isSovereign: true });
  });

  it("passes isSovereign:false for a non-sovereign (scrapper) user", async () => {
    const { caller: c, getCatalog } = caller(makeUser("scrapper"));
    await c.aiProvider.catalog();
    expect(getCatalog).toHaveBeenCalledWith({ isSovereign: false });
  });

  it("passes isSovereign:false for a big_spender user", async () => {
    const { caller: c, getCatalog } = caller(makeUser("big_spender"));
    await c.aiProvider.catalog();
    expect(getCatalog).toHaveBeenCalledWith({ isSovereign: false });
  });
});

describe("aiProvider.loadLocalModel — Phase 8 hot-swap trigger", () => {
  it("kicks off the load and returns immediately (non-blocking)", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    const res = await c.aiProvider.loadLocalModel({ modelId: "deepseek-r1:14b" });
    expect(runtimeHolder.ensureModelLoaded).toHaveBeenCalledWith("deepseek-r1:14b");
    // Returns a "started" ack, not a load result — the picker observes
    // completion via the catalog's `loaded` flag, not this request.
    expect(res).toEqual({ started: true, modelId: "deepseek-r1:14b" });
  });

  it("does not reject even when the background load fails (fire-and-forget)", async () => {
    runtimeHolder.ensureModelLoaded.mockRejectedValue(new Error("no VRAM"));
    const { caller: c } = caller(makeUser("scrapper"));
    // The mutation must not surface the background failure to the caller.
    await expect(c.aiProvider.loadLocalModel({ modelId: "huge:latest" })).resolves.toEqual({
      started: true,
      modelId: "huge:latest",
    });
  });

  it("rejects an empty modelId (schema min(1))", async () => {
    const { caller: c } = caller(makeUser("scrapper"));
    await expect(c.aiProvider.loadLocalModel({ modelId: "" })).rejects.toThrow();
  });
});
