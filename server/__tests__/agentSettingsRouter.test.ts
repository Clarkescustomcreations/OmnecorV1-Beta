/**
 * Route-level integration tests for `agentSettingsRouter`.
 *
 * Covers: getScheduleConfig (auth boundary, platform filter, per-user
 * isolation) and updateScheduleConfig (create path, update path, JSON
 * optimalPostingTimes round-trip). All queries run against a real in-memory
 * libSQL DB so the per-user `where` filters and insert/update branches execute.
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

describe("auth boundary", () => {
  it("rejects unauthenticated getScheduleConfig", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.settings.getScheduleConfig({})).rejects.toThrow(TRPCError);
  });

  it("rejects unauthenticated updateScheduleConfig", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(
      caller.settings.updateScheduleConfig({ platform: "x" })
    ).rejects.toThrow(TRPCError);
  });
});

describe("agentSettings.updateScheduleConfig", () => {
  it("creates a new config row with defaults applied", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.settings.updateScheduleConfig({ platform: "twitter" });
    expect(res.success).toBe(true);

    const configs = await caller.settings.getScheduleConfig({ platform: "twitter" });
    expect(configs).toHaveLength(1);
    expect(configs[0].postsPerDay).toBe(1); // default
    expect(configs[0].timezone).toBe("UTC"); // default
    expect(configs[0].autoApprove).toBe(0);
  });

  it("updates an existing config in place (no duplicate row)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.settings.updateScheduleConfig({ platform: "linkedin", postsPerDay: 2 });
    await caller.settings.updateScheduleConfig({
      platform: "linkedin",
      postsPerDay: 5,
      autoApprove: 1,
      timezone: "America/New_York",
    });

    const configs = await caller.settings.getScheduleConfig({ platform: "linkedin" });
    expect(configs).toHaveLength(1);
    expect(configs[0].postsPerDay).toBe(5);
    expect(configs[0].autoApprove).toBe(1);
    expect(configs[0].timezone).toBe("America/New_York");
  });

  it("round-trips the optimalPostingTimes JSON array", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.settings.updateScheduleConfig({
      platform: "instagram",
      optimalPostingTimes: ["09:00", "17:30"],
    });

    const configs = await caller.settings.getScheduleConfig({ platform: "instagram" });
    expect(configs[0].optimalPostingTimes).toEqual(["09:00", "17:30"]);
  });
});

describe("agentSettings.getScheduleConfig", () => {
  it("returns all of the caller's configs when no platform filter is given", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.settings.updateScheduleConfig({ platform: "twitter" });
    await caller.settings.updateScheduleConfig({ platform: "linkedin" });

    const all = await caller.settings.getScheduleConfig({});
    expect(all).toHaveLength(2);
    expect(all.map(c => c.platform).sort()).toEqual(["linkedin", "twitter"]);
  });

  it("filters by platform when provided", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.settings.updateScheduleConfig({ platform: "twitter" });
    await caller.settings.updateScheduleConfig({ platform: "youtube" });

    const onlyYt = await caller.settings.getScheduleConfig({ platform: "youtube" });
    expect(onlyYt).toHaveLength(1);
    expect(onlyYt[0].platform).toBe("youtube");
  });

  it("isolates configs per user — never leaks another user's rows", async () => {
    const alice = await seedUser(db, { openId: "alice", email: "alice@example.com" });
    const bob = await seedUser(db, { openId: "bob", email: "bob@example.com" });

    const aliceCaller = appRouter.createCaller(makeContext(alice, db));
    const bobCaller = appRouter.createCaller(makeContext(bob, db));

    await aliceCaller.settings.updateScheduleConfig({ platform: "twitter", postsPerDay: 9 });

    // Bob's update for the same platform must INSERT his own row, not see Alice's.
    await bobCaller.settings.updateScheduleConfig({ platform: "twitter", postsPerDay: 1 });

    const aliceConfigs = await aliceCaller.settings.getScheduleConfig({ platform: "twitter" });
    const bobConfigs = await bobCaller.settings.getScheduleConfig({ platform: "twitter" });

    expect(aliceConfigs).toHaveLength(1);
    expect(aliceConfigs[0].postsPerDay).toBe(9);
    expect(bobConfigs).toHaveLength(1);
    expect(bobConfigs[0].postsPerDay).toBe(1);
  });
});
