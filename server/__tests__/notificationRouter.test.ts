/**
 * Route-level integration tests for `notificationRouter`.
 *
 * NotificationService is a pure in-memory singleton — no DB dependency. Tests
 * exercise the real singleton so the list/markRead/clear round-trips are
 * verified end-to-end. The singleton is reset directly via
 * `NotificationService.getInstance().clear()` (not through the procedure stack)
 * so isolation does not depend on the tRPC middleware succeeding. Each test
 * file runs in its own Vitest worker, so there is no cross-file bleed.
 *
 * No DB mock is needed; AuditLogService is stubbed because `protectedProcedure`
 * calls it on every invocation.
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

import { appRouter } from "../routers.js";
import { NotificationService } from "../_core/NotificationService.js";
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
let user: Awaited<ReturnType<typeof seedUser>>;
let caller: Caller;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  user = await seedUser(db);
  caller = appRouter.createCaller(makeContext(user, db));
  // Reset the singleton directly so isolation doesn't depend on the procedure stack
  NotificationService.getInstance().clear();
});

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers on list", async () => {
    const anonCaller = appRouter.createCaller(makeContext(null, db));
    await expect(anonCaller.notifications.list()).rejects.toThrow(TRPCError);
  });
});

// ─── notifications.list ──────────────────────────────────────────────────────

describe("notifications.list", () => {
  it("returns empty list and zero unread count when no notifications", async () => {
    const result = await caller.notifications.list();
    expect(result.notifications).toEqual([]);
    expect(result.unread).toBe(0);
  });

  it("returns created notifications newest-first", async () => {
    await caller.notifications.create({ kind: "system", title: "First", body: "Body 1" });
    await caller.notifications.create({ kind: "chat", title: "Second", body: "Body 2" });

    const result = await caller.notifications.list();
    expect(result.notifications).toHaveLength(2);
    expect(result.notifications[0].title).toBe("Second");
    expect(result.notifications[1].title).toBe("First");
  });

  it("all new notifications start as unread", async () => {
    await caller.notifications.create({ kind: "task", title: "Task done", body: "Completed." });
    const result = await caller.notifications.list();
    expect(result.notifications[0].read).toBe(false);
    expect(result.unread).toBe(1);
  });
});

// ─── notifications.unreadCount ───────────────────────────────────────────────

describe("notifications.unreadCount", () => {
  it("returns 0 when no notifications", async () => {
    const result = await caller.notifications.unreadCount();
    expect(result.unread).toBe(0);
  });

  it("increments with each new notification", async () => {
    await caller.notifications.create({ kind: "hitl", title: "Approval needed", body: "Review action." });
    await caller.notifications.create({ kind: "wallet", title: "Spend alert", body: "75% used." });

    const result = await caller.notifications.unreadCount();
    expect(result.unread).toBe(2);
  });
});

// ─── notifications.markRead ──────────────────────────────────────────────────

describe("notifications.markRead", () => {
  it("marks a single notification read and decrements unread count", async () => {
    const created = await caller.notifications.create({ kind: "agent", title: "Agent reply", body: "Hello." });
    const id = created.notification.id;

    const markResult = await caller.notifications.markRead({ id });
    expect(markResult.success).toBe(true);

    const { unread } = await caller.notifications.unreadCount();
    expect(unread).toBe(0);

    const { notifications } = await caller.notifications.list();
    expect(notifications[0].read).toBe(true);
  });

  it("returns false for an unknown notification id", async () => {
    const result = await caller.notifications.markRead({ id: "does-not-exist" });
    expect(result.success).toBe(false);
  });

  it("does not change unread count when marking an already-read notification", async () => {
    const created = await caller.notifications.create({ kind: "system", title: "Done", body: "ok" });
    const id = created.notification.id;

    await caller.notifications.markRead({ id });
    await caller.notifications.markRead({ id });

    const { unread } = await caller.notifications.unreadCount();
    expect(unread).toBe(0);
  });
});

// ─── notifications.markAllRead ───────────────────────────────────────────────

describe("notifications.markAllRead", () => {
  it("marks all notifications read and returns the flip count", async () => {
    await caller.notifications.create({ kind: "chat", title: "A", body: "." });
    await caller.notifications.create({ kind: "chat", title: "B", body: "." });
    await caller.notifications.create({ kind: "chat", title: "C", body: "." });

    const result = await caller.notifications.markAllRead();
    expect(result.success).toBe(true);
    expect(result.flipped).toBe(3);

    const { unread } = await caller.notifications.unreadCount();
    expect(unread).toBe(0);
  });

  it("returns flipped=0 when all notifications are already read", async () => {
    await caller.notifications.create({ kind: "system", title: "X", body: "." });
    await caller.notifications.markAllRead();
    const second = await caller.notifications.markAllRead();
    expect(second.flipped).toBe(0);
  });
});

// ─── notifications.clear ─────────────────────────────────────────────────────

describe("notifications.clear", () => {
  it("removes all notifications and resets the count to zero", async () => {
    await caller.notifications.create({ kind: "task", title: "Task", body: "Done." });
    await caller.notifications.create({ kind: "hitl", title: "HITL", body: "Review." });

    await caller.notifications.clear();

    const { notifications, unread } = await caller.notifications.list();
    expect(notifications).toHaveLength(0);
    expect(unread).toBe(0);
  });
});

// ─── notifications.create ────────────────────────────────────────────────────

describe("notifications.create", () => {
  it("stores the notification with the correct fields", async () => {
    const result = await caller.notifications.create({
      kind: "wallet",
      title: "Budget alert",
      body: "You have reached 80% of your budget.",
      href: "/wallet",
      data: { projectId: "proj-123" },
    });

    expect(result.notification.kind).toBe("wallet");
    expect(result.notification.title).toBe("Budget alert");
    expect(result.notification.body).toBe("You have reached 80% of your budget.");
    expect(result.notification.href).toBe("/wallet");
    expect(result.notification.read).toBe(false);
    expect(result.notification.id).toBeTypeOf("string");
    expect(result.notification.createdAt).toBeTypeOf("string");
  });

  it("rejects title longer than 200 characters (Zod input validation)", async () => {
    const longTitle = "T".repeat(201);
    await expect(
      caller.notifications.create({ kind: "system", title: longTitle, body: "ok" })
    ).rejects.toThrow(TRPCError);
  });

  it("rejects body longer than 2000 characters (Zod input validation)", async () => {
    const longBody = "B".repeat(2001);
    await expect(
      caller.notifications.create({ kind: "system", title: "Test", body: longBody })
    ).rejects.toThrow(TRPCError);
  });

  it("accepts title and body exactly at the max length limits", async () => {
    const maxTitle = "T".repeat(200);
    const maxBody = "B".repeat(2000);
    const result = await caller.notifications.create({ kind: "system", title: maxTitle, body: maxBody });
    expect(result.notification.title).toHaveLength(200);
    expect(result.notification.body).toHaveLength(2000);
  });
});
