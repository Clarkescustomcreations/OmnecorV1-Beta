/**
 * Batch B — Items 9, 10, 11: Access Control Tests
 *
 * 9. adminProcedure gate: auditRouter (all procedures are admin-only)
 * 10. ownerProcedure gate: inline test router (owner-only, rejects admin)
 * 11. RBAC matrix: hasPermission for all 5 roles across all resource types
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";

// ── Module mocks (hoisted before any import) ─────────────────────────────────

// auditRouter imports auditList / auditListByActor directly from db.factory.js
vi.mock("../db.factory.js", () => ({
  getDb: vi.fn(),
  auditList: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  auditListByActor: vi.fn().mockResolvedValue([]),
}));

// auditRouter.setRetention calls AuditLogService directly
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: vi.fn().mockReturnValue({
      log: vi.fn().mockResolvedValue(undefined),
      getRetentionDays: vi.fn().mockReturnValue(14),
      getStorageStats: vi.fn().mockResolvedValue({
        dbActive: true,
        entries: 0,
        oldestEntryAt: null,
        approxBytes: 0,
      }),
      setRetentionDays: vi.fn().mockResolvedValue({ purged: 0 }),
    }),
  },
}));

// trpc.ts reads getSetting for the sovereign check inside cloudProcedure
vi.mock("../phase2/services/SettingsService.js", () => ({
  getSetting: vi.fn().mockReturnValue(false),
  SettingsService: {
    getInstance: vi.fn().mockReturnValue({
      getSetting: vi.fn().mockReturnValue(null),
      setSetting: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ── Dynamic imports (after mocks) ────────────────────────────────────────────
const { auditRouter } = await import("../routers/auditRouter.js");
const { router, ownerProcedure } = await import("../_core/trpc.js");
const { hasPermission } = await import("../phase2/config/rbac.js");

// ── Inline test router using ownerProcedure (item 10) ────────────────────────
// No production router currently uses ownerProcedure, so we create a minimal
// test router here to verify the middleware rejects all non-owner roles.
const ownerOnlyRouter = router({
  sensitiveOp: ownerProcedure.query(() => ({ secret: "eyes-only" })),
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 9 — adminProcedure gate
// ─────────────────────────────────────────────────────────────────────────────

describe("adminProcedure gate — auditRouter", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    vi.clearAllMocks();
  });

  it("unauthenticated → FORBIDDEN (not UNAUTHORIZED — adminProcedure has no requireUser)", async () => {
    const caller = auditRouter.createCaller(makeContext(null, testDb.db));
    await expect(caller.getAuditLog({ limit: 10, offset: 0 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("viewer role → FORBIDDEN", async () => {
    const user = await seedUser(testDb.db, { role: "viewer" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.getAuditLog({ limit: 10, offset: 0 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("user role → FORBIDDEN", async () => {
    const user = await seedUser(testDb.db, { role: "user" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.getAuditLog({ limit: 10, offset: 0 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("device role → FORBIDDEN", async () => {
    const user = await seedUser(testDb.db, { role: "device" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.getAuditLog({ limit: 10, offset: 0 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin role → allowed; returns audit entries", async () => {
    const user = await seedUser(testDb.db, { role: "admin" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    const result = await caller.getAuditLog({ limit: 10, offset: 0 });
    expect(result).toMatchObject({ entries: [], total: 0 });
  });

  it("owner role → allowed (owner satisfies the admin gate)", async () => {
    const user = await seedUser(testDb.db, { role: "owner" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    const result = await caller.getAuditLog({ limit: 10, offset: 0 });
    expect(result).toMatchObject({ entries: [], total: 0 });
  });

  it("admin can change audit retention window", async () => {
    const user = await seedUser(testDb.db, { role: "admin" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    const result = await caller.setRetention({ retentionDays: 28 });
    expect(result.success).toBe(true);
    expect(result.retentionDays).toBe(28);
  });

  it("user cannot change retention window → FORBIDDEN", async () => {
    const user = await seedUser(testDb.db, { role: "user" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.setRetention({ retentionDays: 28 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin cannot export audit log → FORBIDDEN (exportAuditLog uses ownerProcedure)", async () => {
    const user = await seedUser(testDb.db, { role: "admin" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.exportAuditLog({ limit: 100 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner can export audit log as CSV (exportAuditLog is owner-only)", async () => {
    const user = await seedUser(testDb.db, { role: "owner" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    const result = await caller.exportAuditLog({ limit: 100 });
    // Empty DB → header row only
    expect(result.csv).toContain("id,eventType,actorId");
  });

  it("admin can read retention stats", async () => {
    const user = await seedUser(testDb.db, { role: "admin" });
    const caller = auditRouter.createCaller(makeContext(user, testDb.db));
    const result = await caller.getRetention();
    expect(result.retentionDays).toBe(14);
    expect(result.dbActive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 10 — ownerProcedure gate
// ─────────────────────────────────────────────────────────────────────────────

describe("ownerProcedure gate", () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  it("unauthenticated → FORBIDDEN", async () => {
    const caller = ownerOnlyRouter.createCaller(makeContext(null, testDb.db));
    await expect(caller.sensitiveOp())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("viewer role → FORBIDDEN", async () => {
    const user = await seedUser(testDb.db, { role: "viewer" });
    const caller = ownerOnlyRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.sensitiveOp())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("user role → FORBIDDEN", async () => {
    const user = await seedUser(testDb.db, { role: "user" });
    const caller = ownerOnlyRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.sensitiveOp())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin role → FORBIDDEN (admin does NOT satisfy ownerProcedure)", async () => {
    const user = await seedUser(testDb.db, { role: "admin" });
    const caller = ownerOnlyRouter.createCaller(makeContext(user, testDb.db));
    await expect(caller.sensitiveOp())
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner role → allowed", async () => {
    const user = await seedUser(testDb.db, { role: "owner" });
    const caller = ownerOnlyRouter.createCaller(makeContext(user, testDb.db));
    const result = await caller.sensitiveOp();
    expect(result).toEqual({ secret: "eyes-only" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 11 — RBAC matrix (hasPermission for all 5 roles)
// ─────────────────────────────────────────────────────────────────────────────

describe("RBAC matrix — hasPermission", () => {
  describe("viewer role: read-only, no mutations or admin access", () => {
    it("can read chat and dashboard", () => {
      expect(hasPermission("viewer", "chat", "read")).toBe(true);
      expect(hasPermission("viewer", "dashboard", "read")).toBe(true);
    });

    it("cannot write chat or settings", () => {
      expect(hasPermission("viewer", "chat", "write")).toBe(false);
      expect(hasPermission("viewer", "settings", "write")).toBe(false);
    });

    it("cannot access audit log, users, or system controls", () => {
      expect(hasPermission("viewer", "audit_log", "read")).toBe(false);
      expect(hasPermission("viewer", "users", "manage")).toBe(false);
      expect(hasPermission("viewer", "system", "configure")).toBe(false);
      expect(hasPermission("viewer", "execution_mode", "set_sovereign")).toBe(false);
    });
  });

  describe("user role: full chat + integrations, no admin", () => {
    it("can read and write chat, manage integrations, run agents", () => {
      expect(hasPermission("user", "chat", "read")).toBe(true);
      expect(hasPermission("user", "chat", "write")).toBe(true);
      expect(hasPermission("user", "integrations", "manage")).toBe(true);
      expect(hasPermission("user", "training", "run")).toBe(true);
      expect(hasPermission("user", "agents", "run")).toBe(true);
    });

    it("cannot write settings, access audit log, or manage users", () => {
      expect(hasPermission("user", "settings", "write")).toBe(false);
      expect(hasPermission("user", "audit_log", "read")).toBe(false);
      expect(hasPermission("user", "users", "manage")).toBe(false);
      expect(hasPermission("user", "users", "delete")).toBe(false);
    });

    it("cannot set sovereign mode (owner-only)", () => {
      expect(hasPermission("user", "execution_mode", "set_sovereign")).toBe(false);
    });
  });

  describe("admin role: audit + user management, no owner-only ops", () => {
    it("can read/write settings, manage users, configure system", () => {
      expect(hasPermission("admin", "settings", "write")).toBe(true);
      expect(hasPermission("admin", "audit_log", "read")).toBe(true);
      expect(hasPermission("admin", "users", "read")).toBe(true);
      expect(hasPermission("admin", "users", "manage")).toBe(true);
      expect(hasPermission("admin", "system", "configure")).toBe(true);
    });

    it("cannot export audit log (owner-only)", () => {
      expect(hasPermission("admin", "audit_log", "export")).toBe(false);
    });

    it("cannot delete users (owner-only)", () => {
      expect(hasPermission("admin", "users", "delete")).toBe(false);
    });

    it("cannot shut down system or set sovereign mode (owner-only)", () => {
      expect(hasPermission("admin", "system", "shutdown")).toBe(false);
      expect(hasPermission("admin", "execution_mode", "set_sovereign")).toBe(false);
    });
  });

  describe("owner role: full superset — all admin perms + owner-only", () => {
    it("inherits all admin-level permissions", () => {
      expect(hasPermission("owner", "audit_log", "read")).toBe(true);
      expect(hasPermission("owner", "users", "manage")).toBe(true);
      expect(hasPermission("owner", "system", "configure")).toBe(true);
    });

    it("can export audit log, delete users, shut down, set sovereign mode", () => {
      expect(hasPermission("owner", "audit_log", "export")).toBe(true);
      expect(hasPermission("owner", "users", "delete")).toBe(true);
      expect(hasPermission("owner", "system", "shutdown")).toBe(true);
      expect(hasPermission("owner", "execution_mode", "set_sovereign")).toBe(true);
    });
  });

  describe("device role: phone access only — no admin or write-settings", () => {
    it("can use chat and read dashboard/settings", () => {
      expect(hasPermission("device", "chat", "read")).toBe(true);
      expect(hasPermission("device", "chat", "write")).toBe(true);
      expect(hasPermission("device", "dashboard", "read")).toBe(true);
      expect(hasPermission("device", "settings", "read")).toBe(true);
    });

    it("cannot write settings or manage anything", () => {
      expect(hasPermission("device", "settings", "write")).toBe(false);
      expect(hasPermission("device", "integrations", "manage")).toBe(false);
      expect(hasPermission("device", "users", "manage")).toBe(false);
      expect(hasPermission("device", "audit_log", "read")).toBe(false);
      expect(hasPermission("device", "execution_mode", "set_sovereign")).toBe(false);
    });
  });
});
