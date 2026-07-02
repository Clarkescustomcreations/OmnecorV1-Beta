/**
 * Route-level integration tests for `analyticsRouter`.
 *
 * Covers: getPlatformSummary (auth boundary, active-account filter, per-account
 * aggregate math), getPostAnalytics (row found / null), and updateAnalytics
 * (update-existing path, no-op when the row is absent). Real in-memory libSQL DB
 * so the reduce()/aggregate math and the active-account `where` actually run.
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
import { platformAccounts, postAnalytics } from "../../drizzle/schema.js";
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

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

async function seedAccount(
  userId: number,
  platform: string,
  isActive: number
): Promise<number> {
  const [row] = await db
    .insert(platformAccounts)
    .values({ userId, platform, accountName: `${platform}-acct`, oauthToken: "tok", isActive })
    .returning({ id: platformAccounts.id });
  return row!.id;
}

async function seedAnalytics(
  scheduledPostId: number,
  vals: Partial<typeof postAnalytics.$inferInsert>
) {
  await db.insert(postAnalytics).values({ scheduledPostId, ...vals });
}

describe("auth boundary", () => {
  it("rejects unauthenticated getPlatformSummary", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.analytics.getPlatformSummary()).rejects.toThrow(TRPCError);
  });
});

describe("analytics.getPlatformSummary", () => {
  it("aggregates impressions/likes/shares/comments/reach/clicks per active account", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    // analyticsRouter joins postAnalytics on scheduledPostId === account.id.
    const acctId = await seedAccount(user.id, "twitter", 1);
    await seedAnalytics(acctId, { impressions: 100, likes: 10, shares: 2, comments: 5, reach: 80, clicks: 7 });
    await seedAnalytics(acctId, { impressions: 50, likes: 4, shares: 1, comments: 0, reach: 40, clicks: 3 });

    const summary = await caller.analytics.getPlatformSummary();
    expect(summary).toHaveLength(1);
    const row = summary[0];
    expect(row.platform).toBe("twitter");
    expect(row.totalImpressions).toBe(150);
    expect(row.totalLikes).toBe(14);
    expect(row.totalShares).toBe(3);
    expect(row.totalComments).toBe(5);
    expect(row.totalReach).toBe(120);
    expect(row.totalClicks).toBe(10);
  });

  it("excludes inactive accounts", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await seedAccount(user.id, "active-one", 1);
    await seedAccount(user.id, "inactive-one", 0);

    const summary = await caller.analytics.getPlatformSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].platform).toBe("active-one");
  });

  it("returns zeroed totals for an account with no analytics rows", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await seedAccount(user.id, "fresh", 1);

    const summary = await caller.analytics.getPlatformSummary();
    expect(summary[0].totalImpressions).toBe(0);
    expect(summary[0].totalClicks).toBe(0);
  });
});

describe("analytics.getPostAnalytics", () => {
  it("returns the analytics row for a post id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await seedAnalytics(4242, { impressions: 999 });

    const row = await caller.analytics.getPostAnalytics({ scheduledPostId: 4242 });
    expect(row).not.toBeNull();
    expect(row!.impressions).toBe(999);
  });

  it("returns null when no analytics exist for the post", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const row = await caller.analytics.getPostAnalytics({ scheduledPostId: 7777 });
    expect(row).toBeNull();
  });
});

describe("analytics.updateAnalytics", () => {
  it("updates an existing analytics row", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await seedAnalytics(11, { impressions: 1, likes: 1 });

    const res = await caller.analytics.updateAnalytics({ scheduledPostId: 11, impressions: 500, likes: 60 });
    expect(res.success).toBe(true);

    const row = await caller.analytics.getPostAnalytics({ scheduledPostId: 11 });
    expect(row!.impressions).toBe(500);
    expect(row!.likes).toBe(60);
  });

  it("is a no-op (still success) when the post has no analytics row", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.analytics.updateAnalytics({ scheduledPostId: 999, impressions: 5 });
    expect(res.success).toBe(true);

    const row = await caller.analytics.getPostAnalytics({ scheduledPostId: 999 });
    expect(row).toBeNull();
  });
});
