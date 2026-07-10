/**
 * Route-level integration tests for `securityRouter`.
 *
 * Focuses on the HITL procedures (`getPendingHitlActions`, `resolveHitlAction`)
 * which are admin-only and consume `ctx.services.hitl`. The security file-scan
 * and encryption procedures are also lightly covered via `ctx.services.security`
 * injection to verify routing, validation, and the validatePath guard.
 *
 * `adminProcedure` gates (role === "admin" || "owner") are verified against
 * regular users (→ FORBIDDEN) and admin users (→ allowed).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

vi.mock("../core_services/services/TokenRefreshService.js", () => ({
  TokenRefreshService: {
    getInstance: () => ({ forceRefresh: vi.fn().mockResolvedValue(undefined) }),
  },
}));

vi.mock("../core_services/services/ThreatIntelService.js", () => ({
  ThreatIntelService: {
    getInstance: () => ({ getIoCFeed: vi.fn().mockReturnValue([]) }),
  },
}));

import path from "node:path";
import { appRouter } from "../routers.js";
import { PATHS } from "../_core/paths.js";
import {
  createTestDb,
  seedUser,
  makeContext,
  type TestDb,
} from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;

/** Minimal hitl service stub for injection via ctx.services. */
function makeHitlStub(pendingActions: { id: string; toolName: string }[] = []) {
  return {
    getPendingActions: vi.fn().mockReturnValue(pendingActions),
    approveAction: vi.fn(),
  };
}

/** Minimal security service stub for injection via ctx.services. */
function makeSecurityStub() {
  return {
    scanFile: vi.fn().mockResolvedValue({ isSafe: true, threats: [] }),
    scanDirectory: vi.fn().mockResolvedValue([{ isSafe: true, threats: [] }]),
    encryptFile: vi.fn().mockResolvedValue("/tmp/file.enc"),
    decryptFile: vi.fn().mockResolvedValue("/tmp/file.dec"),
    generateProjectKey: vi.fn().mockResolvedValue({ keyId: "k1", projectId: "p1", createdAt: new Date() }),
    createBackup: vi.fn().mockResolvedValue({ success: true }),
    restoreBackup: vi.fn().mockResolvedValue({ success: true }),
    listBackups: vi.fn().mockResolvedValue([]),
    runVulnerabilityScan: vi.fn().mockResolvedValue({ vulnerabilities: [] }),
  };
}

function makeCaller(
  user: Awaited<ReturnType<typeof seedUser>>,
  hitlActions: { id: string; toolName: string }[] = []
): Caller {
  const ctx = makeContext(user, db, {
    hitl: makeHitlStub(hitlActions),
    security: makeSecurityStub(),
  });
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers on getPendingHitlActions", async () => {
    const ctx = makeContext(null, db, { hitl: makeHitlStub(), security: makeSecurityStub() });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.security.getPendingHitlActions()).rejects.toThrow(TRPCError);
  });
});

// ─── getPendingHitlActions — admin gate ──────────────────────────────────────

describe("security.getPendingHitlActions", () => {
  it("throws FORBIDDEN for a regular user (role=user)", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller = makeCaller(user);
    await expect(caller.security.getPendingHitlActions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN for a viewer", async () => {
    const user = await seedUser(db, { role: "viewer" });
    const caller = makeCaller(user);
    await expect(caller.security.getPendingHitlActions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admin role and returns the pending queue", async () => {
    const user = await seedUser(db, { role: "admin" });
    const actions = [{ id: "action-1", toolName: "issueCard" }];
    const caller = makeCaller(user, actions);
    const result = await caller.security.getPendingHitlActions();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("action-1");
  });

  it("allows owner role and returns the pending queue", async () => {
    const user = await seedUser(db, { role: "owner" });
    const actions = [{ id: "action-2", toolName: "modelDelete" }];
    const caller = makeCaller(user, actions);
    const result = await caller.security.getPendingHitlActions();
    expect(result[0].id).toBe("action-2");
  });

  it("returns empty array when no actions are pending", async () => {
    const user = await seedUser(db, { role: "admin" });
    const caller = makeCaller(user, []);
    const result = await caller.security.getPendingHitlActions();
    expect(result).toEqual([]);
  });
});

// ─── resolveHitlAction — admin gate + idempotency ────────────────────────────

describe("security.resolveHitlAction", () => {
  it("throws FORBIDDEN for a regular user", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller = makeCaller(user, [{ id: "a1", toolName: "issueCard" }]);
    await expect(
      caller.security.resolveHitlAction({ id: "a1", approved: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves an existing pending action as admin", async () => {
    const user = await seedUser(db, { role: "admin" });
    const pending = [{ id: "a1", toolName: "issueCard" }];
    const caller = makeCaller(user, pending);

    const result = await caller.security.resolveHitlAction({ id: "a1", approved: true });
    expect(result.success).toBe(true);
    expect(result.id).toBe("a1");
    expect(result.approved).toBe(true);
  });

  it("resolves as rejected (approved=false)", async () => {
    const user = await seedUser(db, { role: "admin" });
    const pending = [{ id: "a2", toolName: "modelDelete" }];
    const caller = makeCaller(user, pending);

    const result = await caller.security.resolveHitlAction({
      id: "a2",
      approved: false,
      reason: "Too risky",
    });
    expect(result.approved).toBe(false);
  });

  it("throws NOT_FOUND when action id is not in the pending queue", async () => {
    const user = await seedUser(db, { role: "admin" });
    const caller = makeCaller(user, []);
    await expect(
      caller.security.resolveHitlAction({ id: "nonexistent", approved: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── forceRefresh ────────────────────────────────────────────────────────────

describe("security.forceRefresh", () => {
  it("calls TokenRefreshService and returns ok:true", async () => {
    const user = await seedUser(db);
    const caller = makeCaller(user);
    const result = await caller.security.forceRefresh({ provider: "google" });
    expect(result.ok).toBe(true);
  });
});

// ─── getIoCFeed ──────────────────────────────────────────────────────────────

describe("security.getIoCFeed", () => {
  it("returns threat intel feed (stubbed as empty)", async () => {
    const user = await seedUser(db);
    const caller = makeCaller(user);
    const result = await caller.security.getIoCFeed();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── File scanning — validatePath gate + delegation ─────────────────────────
//
// validatePath only checks containment in an allowed root (PATHS.data etc.) —
// the file need not exist — so the happy paths run against the real guard with
// no fixtures, and the traversal paths must never reach the service stub.

function callerWithSecurity(user: Awaited<ReturnType<typeof seedUser>>) {
  const security = makeSecurityStub();
  const caller = appRouter.createCaller(makeContext(user, db, { hitl: makeHitlStub(), security }));
  return { caller, security };
}

describe("security.scanFile / scanDirectory", () => {
  it("rejects a traversal path with BAD_REQUEST and never calls the scanner", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.scanFile({ filePath: "../../etc/passwd" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(security.scanFile).not.toHaveBeenCalled();
  });

  it("scans a file under an allowed root, passing the resolved absolute path", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const target = path.join(PATHS.data, "upload.bin");
    const res = await caller.security.scanFile({ filePath: target });
    expect(res).toMatchObject({ isSafe: true });
    expect(security.scanFile).toHaveBeenCalledWith(target);
  });

  it("scanDirectory aggregates totals from the per-file results", async () => {
    const user = await seedUser(db);
    const security = makeSecurityStub();
    security.scanDirectory.mockResolvedValue([
      { isSafe: true, threats: [] },
      { isSafe: false, threats: ["eicar"] },
      { isSafe: true, threats: [] },
    ]);
    const caller = appRouter.createCaller(makeContext(user, db, { hitl: makeHitlStub(), security }));
    const res = await caller.security.scanDirectory({ dirPath: PATHS.data });
    expect(res).toMatchObject({ totalFiles: 3, safeFiles: 2, threatsFound: 1 });
    expect(res.results).toHaveLength(3);
  });

  it("scanDirectory rejects a sensitive system dir with BAD_REQUEST", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.scanDirectory({ dirPath: "/etc" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(security.scanDirectory).not.toHaveBeenCalled();
  });
});

// ─── Encryption ──────────────────────────────────────────────────────────────

describe("security.encryptFile / decryptFile", () => {
  it("rejects a short passphrase via Zod before touching the path or service", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.encryptFile({ filePath: PATHS.data, passphrase: "short" })
    ).rejects.toThrow(/at least 8/i);
    expect(security.encryptFile).not.toHaveBeenCalled();
  });

  it("encrypts a file under an allowed root and returns the output path", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const target = path.join(PATHS.data, "secrets.txt");
    const res = await caller.security.encryptFile({ filePath: target, passphrase: "longenough" });
    expect(res).toMatchObject({ success: true, outputPath: "/tmp/file.enc" });
    expect(security.encryptFile).toHaveBeenCalledWith(target, "longenough");
  });

  it("encryptFile maps a traversal rejection to INTERNAL_SERVER_ERROR (its catch) without calling the service", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.encryptFile({ filePath: "../../root/.ssh/id_rsa", passphrase: "longenough" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(security.encryptFile).not.toHaveBeenCalled();
  });

  it("decryptFile rejects a traversal path with BAD_REQUEST", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.decryptFile({ encryptedPath: "../../etc/shadow.enc", passphrase: "x" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(security.decryptFile).not.toHaveBeenCalled();
  });

  it("decryptFile delegates a valid path and returns the output path", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const target = path.join(PATHS.data, "secrets.txt.enc");
    const res = await caller.security.decryptFile({ encryptedPath: target, passphrase: "pw" });
    expect(res).toMatchObject({ success: true, outputPath: "/tmp/file.dec" });
    expect(security.decryptFile).toHaveBeenCalledWith(target, "pw");
  });
});

describe("security.generateProjectKey", () => {
  it("delegates and returns only the safe key metadata", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const res = await caller.security.generateProjectKey({ projectId: "p1", passphrase: "longenough" });
    expect(res).toMatchObject({ success: true, keyId: "k1", projectId: "p1" });
    expect(security.generateProjectKey).toHaveBeenCalledWith("p1", "longenough");
  });
});

// ─── Backup & restore ────────────────────────────────────────────────────────

describe("security.createBackup / restoreBackup / listBackups", () => {
  it("createBackup validates the source dir and delegates", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const res = await caller.security.createBackup({ projectId: "p1", sourceDir: PATHS.projects, passphrase: "pw" });
    expect(res).toMatchObject({ success: true });
    expect(security.createBackup).toHaveBeenCalledWith("p1", PATHS.projects, "pw");
  });

  it("createBackup rejects a traversal source dir without calling the service", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.createBackup({ projectId: "p1", sourceDir: "../../home" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(security.createBackup).not.toHaveBeenCalled();
  });

  it("restoreBackup validates BOTH the archive and the target paths", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    // Valid archive but traversal target — must still be rejected.
    await expect(
      caller.security.restoreBackup({
        archivePath: path.join(PATHS.data, "b.zip"),
        targetDir: "../../srv",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(security.restoreBackup).not.toHaveBeenCalled();
  });

  it("restoreBackup delegates when both paths are inside allowed roots", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const archive = path.join(PATHS.data, "b.zip");
    const target = path.join(PATHS.projects, "restored");
    const res = await caller.security.restoreBackup({ archivePath: archive, targetDir: target });
    expect(res).toMatchObject({ success: true });
    expect(security.restoreBackup).toHaveBeenCalledWith(archive, target, undefined);
  });

  it("listBackups delegates by projectId", async () => {
    const user = await seedUser(db);
    const security = makeSecurityStub();
    security.listBackups.mockResolvedValue([{ archive: "b1.zip" }]);
    const caller = appRouter.createCaller(makeContext(user, db, { hitl: makeHitlStub(), security }));
    const res = await caller.security.listBackups({ projectId: "p1" });
    expect(res).toEqual([{ archive: "b1.zip" }]);
    expect(security.listBackups).toHaveBeenCalledWith("p1");
  });
});

describe("security.runVulnerabilityScan", () => {
  it("rejects a traversal target before the scanner runs", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    await expect(
      caller.security.runVulnerabilityScan({ targetPath: "../../etc" })
    ).rejects.toThrow(/Security Violation/);
    expect(security.runVulnerabilityScan).not.toHaveBeenCalled();
  });

  it("delegates a valid target with the resolved path", async () => {
    const user = await seedUser(db);
    const { caller, security } = callerWithSecurity(user);
    const target = path.join(PATHS.projects, "app");
    const res = await caller.security.runVulnerabilityScan({ targetPath: target });
    expect(res).toMatchObject({ vulnerabilities: [] });
    expect(security.runVulnerabilityScan).toHaveBeenCalledWith(target);
  });
});
