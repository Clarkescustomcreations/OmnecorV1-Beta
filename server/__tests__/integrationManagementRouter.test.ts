/**
 * Route-level integration tests for `integrationManagementRouter`.
 *
 * Thin authority layer over IntegrationManagementService — verify the auth gate,
 * that each procedure forwards (integrationId, userId, db), and the error
 * mapping: a thrown service error or a `{ success:false }` result becomes
 * INTERNAL_SERVER_ERROR. Service is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));
const svc = vi.hoisted(() => ({
  listIntegrations: vi.fn(),
  checkHealth: vi.fn(),
  refreshToken: vi.fn(),
  disconnectIntegration: vi.fn(),
}));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/IntegrationManagementService.js", () => ({
  integrationManagementService: svc,
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
  it("rejects unauthenticated listAll", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.integrationManagement.listAll()).rejects.toThrow(TRPCError);
  });
});

describe("integrationManagement.listAll / checkHealth", () => {
  it("forwards the user id and returns the integration list", async () => {
    svc.listIntegrations.mockResolvedValue([{ id: "github", connected: true }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrationManagement.listAll();
    expect(res).toHaveLength(1);
    expect(svc.listIntegrations).toHaveBeenCalledWith(String(user.id), expect.anything());
  });

  it("wraps a service failure as INTERNAL_SERVER_ERROR", async () => {
    svc.listIntegrations.mockRejectedValue(new Error("db gone"));
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.integrationManagement.listAll()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("checkHealth forwards integrationId + userId", async () => {
    svc.checkHealth.mockResolvedValue({ healthy: true });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrationManagement.checkHealth({ integrationId: "slack" });
    expect(res).toEqual({ healthy: true });
    expect(svc.checkHealth).toHaveBeenCalledWith("slack", String(user.id), expect.anything());
  });
});

describe("integrationManagement.refreshToken", () => {
  it("returns the result on success", async () => {
    svc.refreshToken.mockResolvedValue({ success: true, message: "ok", tokenExpiresAt: "2030-01-01" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrationManagement.refreshToken({ integrationId: "notion" });
    expect(res.success).toBe(true);
  });

  it("maps { success:false } to INTERNAL_SERVER_ERROR", async () => {
    svc.refreshToken.mockResolvedValue({ success: false, message: "no refresh token" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrationManagement.refreshToken({ integrationId: "notion" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("integrationManagement.disconnect", () => {
  it("returns the result on success", async () => {
    svc.disconnectIntegration.mockResolvedValue({ success: true, message: "disconnected" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.integrationManagement.disconnect({ integrationId: "github" });
    expect(res.success).toBe(true);
    expect(svc.disconnectIntegration).toHaveBeenCalledWith("github", String(user.id), expect.anything());
  });

  it("maps { success:false } to INTERNAL_SERVER_ERROR", async () => {
    svc.disconnectIntegration.mockResolvedValue({ success: false, message: "not found" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.integrationManagement.disconnect({ integrationId: "ghost" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
