/**
 * Route-level tests for `comfyRouter` with a mocked ComfyService.
 *
 * The companion `comfyRouter.test.ts` is the live end-to-end image round-trip
 * (auto-skips when ComfyUI is offline). This suite covers the router surface
 * that never needed a running ComfyUI: delegation to `ctx.services.comfy` for
 * queuePrompt/getQueue/getSystemStats/interrupt/clearQueue, and the
 * bridge-offline degradation contract — a service failure surfaces as
 * INTERNAL_SERVER_ERROR carrying the service's message, never a silent empty.
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

function makeComfyStub(overrides: Record<string, unknown> = {}) {
  return {
    queuePrompt: vi.fn().mockResolvedValue({ prompt_id: "p-1", number: 1 }),
    getQueue: vi.fn().mockResolvedValue({ queue_running: [], queue_pending: [] }),
    getSystemStats: vi.fn().mockResolvedValue({ system: { os: "posix" }, devices: [] }),
    interrupt: vi.fn().mockResolvedValue(undefined),
    clearQueue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function makeCaller(comfy = makeComfyStub()): Promise<{ caller: Caller; comfy: ReturnType<typeof makeComfyStub> }> {
  const user = await seedUser(db);
  const caller = appRouter.createCaller(makeContext(user, db, { comfy }));
  return { caller, comfy };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("auth boundary", () => {
  it("rejects unauthenticated getQueue", async () => {
    const caller = appRouter.createCaller(makeContext(null, db, { comfy: makeComfyStub() }));
    await expect(caller.comfy.getQueue()).rejects.toThrow(TRPCError);
  });
});

describe("comfy.queuePrompt", () => {
  it("delegates the workflow to ComfyService and returns its result", async () => {
    const { caller, comfy } = await makeCaller();
    const workflow = { "1": { class_type: "KSampler", inputs: {} } };
    const res = await caller.comfy.queuePrompt({ prompt: workflow });
    expect(res).toEqual({ prompt_id: "p-1", number: 1 });
    expect(comfy.queuePrompt).toHaveBeenCalledWith(workflow);
  });

  it("maps a service failure to INTERNAL_SERVER_ERROR with the message", async () => {
    const { caller } = await makeCaller(
      makeComfyStub({ queuePrompt: vi.fn().mockRejectedValue(new Error("ComfyUI unreachable")) })
    );
    await expect(caller.comfy.queuePrompt({ prompt: {} })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "ComfyUI unreachable",
    });
  });
});

describe("comfy.getQueue / getSystemStats", () => {
  it("returns the live queue from the service", async () => {
    const stub = makeComfyStub({
      getQueue: vi.fn().mockResolvedValue({ queue_running: [["a"]], queue_pending: [["b"], ["c"]] }),
    });
    const { caller } = await makeCaller(stub);
    const res = await caller.comfy.getQueue();
    expect(res.queue_running).toHaveLength(1);
    expect(res.queue_pending).toHaveLength(2);
  });

  it("getQueue surfaces a bridge-offline failure as INTERNAL_SERVER_ERROR (no masked empty)", async () => {
    const { caller } = await makeCaller(
      makeComfyStub({ getQueue: vi.fn().mockRejectedValue(new Error("fetch failed")) })
    );
    await expect(caller.comfy.getQueue()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "fetch failed",
    });
  });

  it("getSystemStats returns device stats from the service", async () => {
    const stub = makeComfyStub({
      getSystemStats: vi.fn().mockResolvedValue({ devices: [{ name: "cpu", vram_total: 0 }] }),
    });
    const { caller } = await makeCaller(stub);
    const res = await caller.comfy.getSystemStats();
    expect(res.devices[0].name).toBe("cpu");
  });

  it("getSystemStats surfaces a service failure as INTERNAL_SERVER_ERROR", async () => {
    const { caller } = await makeCaller(
      makeComfyStub({ getSystemStats: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) })
    );
    await expect(caller.comfy.getSystemStats()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("comfy.interrupt / clearQueue", () => {
  it("interrupt delegates and returns success:true", async () => {
    const { caller, comfy } = await makeCaller();
    expect(await caller.comfy.interrupt()).toEqual({ success: true });
    expect(comfy.interrupt).toHaveBeenCalledOnce();
  });

  it("interrupt surfaces a service failure as INTERNAL_SERVER_ERROR", async () => {
    const { caller } = await makeCaller(
      makeComfyStub({ interrupt: vi.fn().mockRejectedValue(new Error("offline")) })
    );
    await expect(caller.comfy.interrupt()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("clearQueue delegates and returns success:true", async () => {
    const { caller, comfy } = await makeCaller();
    expect(await caller.comfy.clearQueue()).toEqual({ success: true });
    expect(comfy.clearQueue).toHaveBeenCalledOnce();
  });

  it("clearQueue surfaces a service failure as INTERNAL_SERVER_ERROR", async () => {
    const { caller } = await makeCaller(
      makeComfyStub({ clearQueue: vi.fn().mockRejectedValue(new Error("offline")) })
    );
    await expect(caller.comfy.clearQueue()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
