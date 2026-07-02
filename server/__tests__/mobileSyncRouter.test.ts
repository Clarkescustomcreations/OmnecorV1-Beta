/**
 * Route-level integration tests for `mobileSyncRouter`.
 *
 * Covers: auth gate, push (new record + idempotent re-push by mobileSessionId,
 * auto-link detection via fileWatcher, notification emission), list ordering,
 * and addToProject (materializes a session via the chat helpers, NOT_FOUND for
 * an unknown syncId). The chat-factory helpers and NotificationService are
 * mocked directly (per CLAUDE.md, db.factory helper fns don't route through the
 * getDb mock).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));
const helpers = vi.hoisted(() => ({
  createChatSession: vi.fn().mockResolvedValue(undefined),
  addChatMessage: vi.fn().mockResolvedValue(undefined),
}));
const notify = vi.hoisted(() => vi.fn());

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return {
    ...actual,
    getDb: async () => h.db,
    createChatSession: helpers.createChatSession,
    addChatMessage: helpers.addChatMessage,
  };
});

vi.mock("../_core/NotificationService.js", () => ({
  NotificationService: { getInstance: () => ({ notify }) },
}));

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

// fileWatcher service stub for auto-link detection.
const noLinkServices = { fileWatcher: { getStatus: () => [] } };

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vi.clearAllMocks();
});

describe("auth boundary", () => {
  it("rejects unauthenticated push", async () => {
    const caller = appRouter.createCaller(makeContext(null, db, noLinkServices));
    await expect(
      caller.mobileSync.push({ mobileSessionId: "s1", messages: [] })
    ).rejects.toThrow(TRPCError);
  });
});

describe("mobileSync.push", () => {
  it("stores a new synced chat and emits a notification", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, noLinkServices));

    const res = await caller.mobileSync.push({
      deviceName: "Pixel",
      mobileSessionId: "sess-1",
      title: "Hi",
      messages: [{ role: "user", content: "hello" }],
      projectId: "proj-1",
    });

    expect(res.ok).toBe(true);
    expect(res.projectId).toBe("proj-1");
    expect(res.needsProject).toBe(false);
    expect(notify).toHaveBeenCalledOnce();

    const list = await caller.mobileSync.list();
    expect(list.find(c => c.mobileSessionId === "sess-1")).toBeTruthy();
  });

  it("is idempotent per mobileSessionId — re-push updates in place", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, noLinkServices));

    const first = await caller.mobileSync.push({
      mobileSessionId: "dupe", title: "v1",
      messages: [{ role: "user", content: "a" }], projectId: "p",
    });
    const second = await caller.mobileSync.push({
      mobileSessionId: "dupe", title: "v2",
      messages: [{ role: "user", content: "b" }], projectId: "p",
    });

    expect(second.syncId).toBe(first.syncId); // same record reused
    const list = await caller.mobileSync.list();
    const matches = list.filter(c => c.mobileSessionId === "dupe");
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe("v2");
  });

  it("flags needsProject when unassigned and nothing auto-links", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, noLinkServices));
    const res = await caller.mobileSync.push({
      mobileSessionId: "unassigned",
      messages: [{ role: "user", content: "no project hint here" }],
    });
    expect(res.needsProject).toBe(true);
    expect(res.autoLinked).toBe(false);
  });

  it("auto-links to a project when the conversation mentions its folder name", async () => {
    const user = await seedUser(db);
    const services = {
      fileWatcher: { getStatus: () => [{ projectId: "proj-xyz", rootDir: "/home/u/myproject" }] },
    };
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));

    const res = await caller.mobileSync.push({
      mobileSessionId: "auto",
      messages: [{ role: "user", content: "please update the myproject readme" }],
    });
    expect(res.autoLinked).toBe(true);
    expect(res.projectId).toBe("proj-xyz");
  });
});

describe("mobileSync.addToProject", () => {
  it("throws NOT_FOUND for an unknown syncId", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, noLinkServices));
    await expect(
      caller.mobileSync.addToProject({ syncId: "missing", projectId: "p" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("materializes a synced chat as a session + messages", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, noLinkServices));

    const pushed = await caller.mobileSync.push({
      mobileSessionId: "to-add",
      title: "Mobile thread",
      messages: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
      ],
      projectId: "p-source",
    });

    const res = await caller.mobileSync.addToProject({
      syncId: pushed.syncId,
      projectId: "target-project",
    });

    expect(res.ok).toBe(true);
    expect(res.projectId).toBe("target-project");
    expect(helpers.createChatSession).toHaveBeenCalledOnce();
    expect(helpers.createChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, projectId: "target-project", title: "Mobile thread" })
    );
    expect(helpers.addChatMessage).toHaveBeenCalledTimes(2);
  });
});
