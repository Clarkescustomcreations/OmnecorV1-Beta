/**
 * Route-level integration tests for `cloudComputeRouter`.
 *
 * With no provider API key set (the test env), the router falls back to
 * LOCAL-ONLY session tracking — so the full billing state machine is verifiable
 * with zero credentials: listProviders (configured=false), estimateCost math +
 * BAD_REQUEST unknown plan, startSession local-only + idempotent replay,
 * stopSession (NOT_FOUND / already-stopped / cost→spendLog), getActiveSessions
 * + history (per-user), and subscription CRUD. Real in-memory libSQL DB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";

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
import { cloudComputeSessions, spendLog } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  // Ensure no provider keys leak in from the real environment.
  delete process.env.VASTAI_API_KEY;
  delete process.env.RUNPOD_API_KEY;
  delete process.env.LAMBDA_API_KEY;
});

describe("auth boundary", () => {
  it("rejects unauthenticated listProviders", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.cloudCompute.listProviders()).rejects.toThrow(TRPCError);
  });
});

describe("cloudCompute.listProviders / estimateCost", () => {
  it("lists the catalog with configured=false when no keys are set", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const providers = await caller.cloudCompute.listProviders();
    expect(providers.map(p => p.id).sort()).toEqual(["lambda", "runpod", "vastai"]);
    expect(providers.every(p => p.configured === false)).toBe(true);
  });

  it("computes hourly cost from the plan rate", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    // vastai rtx3090 = 35 cents/hr → 2 hrs = 70 cents = $0.70
    const est = await caller.cloudCompute.estimateCost({
      provider: "vastai", planId: "rtx3090", billingUnit: "hour", durationHours: 2,
    });
    expect(est.totalCents).toBe(70);
    expect(est.totalDollars).toBeCloseTo(0.7, 5);
    expect(est.ratePerHourCents).toBe(35);
  });

  it("rejects an unknown plan id", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.cloudCompute.estimateCost({ provider: "vastai", planId: "nope", durationHours: 1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("cloudCompute.startSession (local-only tracking)", () => {
  it("tracks a session locally and warns the key is unset", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.cloudCompute.startSession({
      provider: "runpod", planId: "rtx4090", projectId: "proj-1",
    });
    expect(res.provisionedByApi).toBe(false);
    expect(res.providerNote).toContain("RUNPOD_API_KEY");

    const active = await caller.cloudCompute.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("running");
  });

  it("returns the same session on an idempotent replay", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const first = await caller.cloudCompute.startSession({
      provider: "vastai", planId: "rtx3090", projectId: "p", idempotencyKey: "abc",
    });
    const second = await caller.cloudCompute.startSession({
      provider: "vastai", planId: "rtx3090", projectId: "p", idempotencyKey: "abc",
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.idempotentReplay).toBe(true);

    const active = await caller.cloudCompute.getActiveSessions();
    expect(active).toHaveLength(1); // no duplicate instance
  });

  it("rejects an unknown plan", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.cloudCompute.startSession({ provider: "vastai", planId: "ghost", projectId: "p" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("cloudCompute.stopSession", () => {
  it("throws NOT_FOUND for an unknown session", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.cloudCompute.stopSession({ sessionId: randomUUID() })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("computes elapsed cost and writes it to the wallet spend log", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    // Seed a running session started 2 hours ago (rate 100 microcents/... actually
    // ratePerUnitMicrocents = 60 cents/hr → 600000 microcents/hr).
    const sid = randomUUID();
    await db.insert(cloudComputeSessions).values({
      id: sid, userId: user.id, projectId: "proj-bill", provider: "lambda",
      externalSessionId: null, planId: "gpu_1x_a10", instanceLabel: "A10",
      billingUnit: "hour", ratePerUnitMicrocents: 600_000, status: "running",
      startedAt: new Date(Date.now() - 2 * 3_600_000),
    });

    const res = await caller.cloudCompute.stopSession({ sessionId: sid });
    expect(res.elapsedMinutes).toBeGreaterThanOrEqual(119);
    expect(res.totalCostDollars).toBeCloseTo(1.2, 1); // ~2h × $0.60/h

    const [row] = await db.select().from(cloudComputeSessions).where(eq(cloudComputeSessions.id, sid));
    expect(row.status).toBe("stopped");

    const spend = await db.select().from(spendLog);
    expect(spend).toHaveLength(1);
    expect(spend[0].provider).toBe("cloud_compute:lambda");
  });

  it("rejects stopping an already-stopped session", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const sid = randomUUID();
    await db.insert(cloudComputeSessions).values({
      id: sid, userId: user.id, projectId: "p", provider: "vastai",
      planId: "rtx3090", instanceLabel: "x", billingUnit: "hour",
      ratePerUnitMicrocents: 350_000, status: "stopped",
      startedAt: new Date(), stoppedAt: new Date(),
    });
    await expect(caller.cloudCompute.stopSession({ sessionId: sid })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("cannot stop another user's session (NOT_FOUND via ownership filter)", async () => {
    const owner = await seedUser(db, { openId: "o", email: "o@x.com" });
    const intruder = await seedUser(db, { openId: "i", email: "i@x.com" });
    const sid = randomUUID();
    await db.insert(cloudComputeSessions).values({
      id: sid, userId: owner.id, projectId: "p", provider: "vastai",
      planId: "rtx3090", instanceLabel: "x", billingUnit: "hour",
      ratePerUnitMicrocents: 350_000, status: "running", startedAt: new Date(),
    });
    const caller: Caller = appRouter.createCaller(makeContext(intruder, db));
    await expect(caller.cloudCompute.stopSession({ sessionId: sid })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cloudCompute subscriptions + history", () => {
  it("creates, lists and cancels a subscription (per-user)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.cloudCompute.setSubscription({ provider: "runpod", planName: "Pro", monthlyCents: 5000 });
    let subs = await caller.cloudCompute.getSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].planName).toBe("Pro");

    await caller.cloudCompute.cancelSubscription({ subscriptionId: subs[0].id });
    subs = await caller.cloudCompute.getSubscriptions();
    expect(subs).toHaveLength(0); // isActive=0 filtered out
  });

  it("getSessionHistory returns only the caller's sessions", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    await appRouter.createCaller(makeContext(alice, db)).cloudCompute.startSession({
      provider: "vastai", planId: "rtx3090", projectId: "p",
    });
    const bobHistory = await appRouter.createCaller(makeContext(bob, db)).cloudCompute.getSessionHistory({});
    expect(bobHistory).toHaveLength(0);
  });
});
