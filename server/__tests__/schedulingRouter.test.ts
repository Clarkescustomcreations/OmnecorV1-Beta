/**
 * Route-level integration tests for `schedulingRouter`.
 *
 * Covers the DB-backed CRUD (schedule/reschedule/cancel/createDirect/list with
 * projectId filter + ordering) and the publish paths with `publishExecutor`
 * mocked: publishNow aggregates outcomes (published/rescheduled/failed) and
 * retryPost enforces ownership (NOT_FOUND / FORBIDDEN) before publishing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));
const publish = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/publishExecutor.js", () => ({
  publishScheduledPostIds: (...args: unknown[]) => publish.fn(...args),
}));

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { scheduledPosts, platformAccounts, neuralMaps, curatedPosts } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

async function seedAccount(userId: number): Promise<number> {
  const [a] = await db
    .insert(platformAccounts)
    .values({ userId, platform: "twitter", accountName: "acct", oauthToken: "t", isActive: 1 })
    .returning({ id: platformAccounts.id });
  return a!.id;
}

async function seedScheduled(platformAccountId: number, scheduledAt: Date, status = "scheduled"): Promise<number> {
  const [p] = await db
    .insert(scheduledPosts)
    .values({ curatedPostId: 1, platformAccountId, scheduledAt, status: status as "scheduled" })
    .returning({ id: scheduledPosts.id });
  return p!.id;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  publish.fn.mockReset();
});

describe("auth boundary", () => {
  it("rejects unauthenticated listScheduledPosts", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.scheduling.listScheduledPosts({})).rejects.toThrow(TRPCError);
  });
});

describe("scheduling.schedulePost / listScheduledPosts", () => {
  it("schedules a post and lists it back", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);

    const res = await caller.scheduling.schedulePost({
      curatedPostId: 7,
      platformAccountId: acct,
      scheduledAt: new Date("2030-01-01T10:00:00Z"),
    });
    expect(res.success).toBe(true);

    const list = await caller.scheduling.listScheduledPosts({});
    expect(list).toHaveLength(1);
    expect(list[0].curatedPostId).toBe(7);
    expect(list[0].status).toBe("scheduled");
  });

  it("orders newest-scheduled first and respects the limit", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);

    await seedScheduled(acct, new Date("2030-01-01T00:00:00Z"));
    await seedScheduled(acct, new Date("2030-03-01T00:00:00Z"));
    await seedScheduled(acct, new Date("2030-02-01T00:00:00Z"));

    const all = await caller.scheduling.listScheduledPosts({});
    expect(all[0].scheduledAt!.getTime()).toBeGreaterThan(all[1].scheduledAt!.getTime());

    const limited = await caller.scheduling.listScheduledPosts({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("filters by projectId", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);

    await db.insert(neuralMaps).values({
      id: "map-sched", userId: user.id, name: "M", rootDirectories: [], settings: {},
    });
    await db.insert(scheduledPosts).values({
      projectId: "map-sched", curatedPostId: 1, platformAccountId: acct,
      scheduledAt: new Date("2030-01-01T00:00:00Z"), status: "scheduled",
    });
    await seedScheduled(acct, new Date("2030-01-02T00:00:00Z")); // no project

    const scoped = await caller.scheduling.listScheduledPosts({ projectId: "map-sched" });
    expect(scoped).toHaveLength(1);
  });
});

describe("scheduling.reschedule / cancel / createDirect", () => {
  it("reschedulePost updates scheduledAt", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);
    const id = await seedScheduled(acct, new Date("2030-01-01T00:00:00Z"));

    await caller.scheduling.reschedulePost({ scheduledPostId: id, newScheduledAt: new Date("2031-06-06T00:00:00Z") });
    const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
    expect(row.scheduledAt!.getUTCFullYear()).toBe(2031);
  });

  it("cancelPost sets status to cancelled", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);
    const id = await seedScheduled(acct, new Date("2030-01-01T00:00:00Z"));

    await caller.scheduling.cancelPost({ scheduledPostId: id });
    const [row] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
    expect(row.status).toBe("cancelled");
  });

  it("createDirectPost inserts an approved curated post + a scheduled row", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);

    const res = await caller.scheduling.createDirectPost({
      platformAccountId: acct, content: "hello world", scheduledAt: new Date("2030-05-05T00:00:00Z"),
    });
    expect(res.success).toBe(true);

    const curated = await db.select().from(curatedPosts);
    expect(curated).toHaveLength(1);
    expect(curated[0].platform).toBe("direct");
    expect(curated[0].status).toBe("approved");
    const scheduled = await db.select().from(scheduledPosts);
    expect(scheduled).toHaveLength(1);
  });
});

describe("scheduling.publishNow", () => {
  it("aggregates outcomes into published / rescheduled / failed counts", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);
    const ids = [
      await seedScheduled(acct, new Date("2030-01-01T00:00:00Z")),
      await seedScheduled(acct, new Date("2030-01-02T00:00:00Z")),
      await seedScheduled(acct, new Date("2030-01-03T00:00:00Z")),
    ];
    publish.fn.mockResolvedValue([
      { ok: true },
      { ok: false, rateLimited: true, retryAt: new Date() },
      { ok: false, rateLimited: false },
    ]);

    const res = await caller.scheduling.publishNow({ postIds: ids });
    expect(res.publishedCount).toBe(1);
    expect(res.rescheduledCount).toBe(1);
    expect(res.failedCount).toBe(1);
    expect(res.success).toBe(false); // a hard failure present
    expect(publish.fn).toHaveBeenCalledWith(ids);
  });

  it("reports success when nothing hard-fails", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const acct = await seedAccount(user.id);
    const ids = [
      await seedScheduled(acct, new Date("2030-01-01T00:00:00Z")),
      await seedScheduled(acct, new Date("2030-01-02T00:00:00Z")),
    ];
    publish.fn.mockResolvedValue([{ ok: true }, { ok: true }]);
    const res = await caller.scheduling.publishNow({ postIds: ids });
    expect(res.success).toBe(true);
    expect(res.publishedCount).toBe(2);
  });

  it("throws FORBIDDEN when any post belongs to another user (no publish attempted)", async () => {
    const owner = await seedUser(db, { openId: "pn-owner", email: "pnowner@x.com" });
    const intruder = await seedUser(db, { openId: "pn-intruder", email: "pnintruder@x.com" });
    const ownerAcct = await seedAccount(owner.id);
    const intruderAcct = await seedAccount(intruder.id);
    const ownerPost = await seedScheduled(ownerAcct, new Date("2030-01-01T00:00:00Z"));
    const intruderPost = await seedScheduled(intruderAcct, new Date("2030-01-02T00:00:00Z"));

    const caller: Caller = appRouter.createCaller(makeContext(intruder, db));
    // Intruder mixes their own post with the owner's — must be rejected wholesale.
    await expect(
      caller.scheduling.publishNow({ postIds: [intruderPost, ownerPost] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(publish.fn).not.toHaveBeenCalled();
  });
});

describe("scheduling.retryPost — ownership", () => {
  it("throws NOT_FOUND for an unknown post", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.scheduling.retryPost({ scheduledPostId: 9999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when the post belongs to another user", async () => {
    const owner = await seedUser(db, { openId: "owner", email: "o@x.com" });
    const intruder = await seedUser(db, { openId: "intruder", email: "i@x.com" });
    const acct = await seedAccount(owner.id);
    const id = await seedScheduled(acct, new Date("2030-01-01T00:00:00Z"), "failed");

    const caller: Caller = appRouter.createCaller(makeContext(intruder, db));
    await expect(caller.scheduling.retryPost({ scheduledPostId: id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(publish.fn).not.toHaveBeenCalled();
  });

  it("resets + republishes the owner's failed post", async () => {
    const user = await seedUser(db);
    const acct = await seedAccount(user.id);
    const id = await seedScheduled(acct, new Date("2030-01-01T00:00:00Z"), "failed");
    publish.fn.mockResolvedValue([{ ok: true }]);

    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.scheduling.retryPost({ scheduledPostId: id });
    expect(res.success).toBe(true);
    expect(res.status).toBe("published");
    expect(publish.fn).toHaveBeenCalledWith([id]);
  });
});
