/**
 * Route-level integration tests for `modelManagementRouter`.
 *
 * The router is a thin authority layer over `ModelManagementService` (a
 * singleton). We mock the service and assert: the auth gate, that each
 * procedure forwards to the right service method, the NOT_FOUND mapping on
 * unregister/setActive, and that `getRunningModels` degrades to an empty list
 * when Ollama is offline (the real offline path — no mock).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const svc = vi.hoisted(() => ({
  listModels: vi.fn(),
  listModelsByProvider: vi.fn(),
  getModel: vi.fn(),
  registerModel: vi.fn(),
  unregisterModel: vi.fn(),
  setActiveModel: vi.fn(),
  syncFromOllama: vi.fn(),
  markModelUsed: vi.fn(),
  getStats: vi.fn(),
}));
const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/ModelManagementService.js", () => ({
  ModelManagementService: { getInstance: () => svc },
}));

vi.mock("../core_services/services/AuditLogService.js", () => ({
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

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vi.clearAllMocks();
});

describe("auth boundary", () => {
  it("rejects unauthenticated list", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.modelManagement.list()).rejects.toThrow(TRPCError);
  });
});

describe("modelManagement.list / listByProvider / get", () => {
  it("returns the service's model list", async () => {
    svc.listModels.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.list();
    expect(res.models).toHaveLength(2);
    expect(svc.listModels).toHaveBeenCalledOnce();
  });

  it("forwards the provider filter to listModelsByProvider", async () => {
    svc.listModelsByProvider.mockResolvedValue([{ id: "ollama-1" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.listByProvider({ provider: "ollama" });
    expect(res.models).toHaveLength(1);
    expect(svc.listModelsByProvider).toHaveBeenCalledWith("ollama");
  });

  it("returns a single model by id", async () => {
    svc.getModel.mockResolvedValue({ id: "abc", name: "Test" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.get({ id: "abc" });
    expect(res.model).toEqual({ id: "abc", name: "Test" });
  });

  it("wraps a service failure as INTERNAL_SERVER_ERROR", async () => {
    svc.listModels.mockRejectedValue(new Error("boom"));
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.modelManagement.list()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("modelManagement.register", () => {
  it("registers a model (no filePath → no validatePath) and returns it", async () => {
    svc.registerModel.mockImplementation(async (m: unknown) => m);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.modelManagement.register({
      id: "qwen-0.5b",
      name: "Qwen 0.5B",
      provider: "ollama",
      version: "1.0",
    });
    expect(res.model.id).toBe("qwen-0.5b");
    expect(svc.registerModel).toHaveBeenCalledOnce();
  });
});

describe("modelManagement.unregister / setActive NOT_FOUND mapping", () => {
  it("maps unregister=false to NOT_FOUND", async () => {
    svc.unregisterModel.mockResolvedValue(false);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.modelManagement.unregister({ id: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns success when unregister succeeds", async () => {
    svc.unregisterModel.mockResolvedValue(true);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.unregister({ id: "m1" });
    expect(res).toEqual({ unregistered: true, id: "m1" });
  });

  it("maps setActive null to NOT_FOUND", async () => {
    svc.setActiveModel.mockResolvedValue(null);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.modelManagement.setActive({ id: "ghost" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the activated model on success", async () => {
    svc.setActiveModel.mockResolvedValue({ name: "Llama", provider: "ollama" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.setActive({ id: "m1" });
    expect(res.model.name).toBe("Llama");
    expect(res.message).toContain("ollama");
  });
});

describe("modelManagement.syncFromOllama / stats", () => {
  it("forwards synced models and reports the count", async () => {
    svc.syncFromOllama.mockResolvedValue(undefined);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.syncFromOllama({
      models: [{ name: "llama3.2", size: 100 }, { name: "qwen", size: 50 }],
    });
    expect(res).toMatchObject({ synced: true, count: 2 });
    expect(svc.syncFromOllama).toHaveBeenCalledOnce();
  });

  it("returns registry stats", async () => {
    svc.getStats.mockResolvedValue({ total: 7 });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelManagement.stats();
    expect(res.stats).toEqual({ total: 7 });
  });
});

describe("modelManagement.getRunningModels (offline degradation)", () => {
  it("returns an empty list when Ollama is unreachable", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    // No Ollama on the default URL during tests → fetch rejects → { models: [] }.
    const res = await caller.modelManagement.getRunningModels();
    expect(res).toEqual({ models: [] });
  });
});
