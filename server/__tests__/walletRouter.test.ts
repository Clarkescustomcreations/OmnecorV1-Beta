/**
 * Route-level integration tests for `walletRouter`.
 *
 * Covers: getBudget (missing / present), setBudget (create + update path),
 * getSpendLog (project filter vs __global__), getSpendSummary (aggregate
 * math per provider), and resetSpend. All queries execute against a real
 * in-memory libSQL DB.
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
import { spendLog } from "../../drizzle/schema.js";
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

async function seedSpendEntry(
  dbInst: Db,
  projectId: string,
  provider: string,
  costMicrocents: number
) {
  await dbInst.insert(spendLog).values({
    id: randomUUID(),
    projectId,
    provider,
    modelId: "gpt-4o",
    promptTokens: 100,
    completionTokens: 50,
    estimatedCostMicrocents: costMicrocents,
  });
}

// ─── Auth boundary ────────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("rejects unauthenticated callers", async () => {
    const ctx = makeContext(null, db);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.wallet.getBudget({ projectId: "proj-1" })).rejects.toThrow(TRPCError);
  });
});

// ─── wallet.getBudget ────────────────────────────────────────────────────────

describe("wallet.getBudget", () => {
  it("returns null when no budget is set for the project", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.wallet.getBudget({ projectId: "unknown-project" });
    expect(result).toBeNull();
  });

  it("returns null for __global__", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.wallet.getBudget({ projectId: "__global__" });
    expect(result).toBeNull();
  });

  it("returns the budget row after it is set", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.wallet.setBudget({ projectId: "proj-alpha", limitCents: 5000, mode: "hard" });
    const budget = await caller.wallet.getBudget({ projectId: "proj-alpha" });

    expect(budget).not.toBeNull();
    expect(budget!.limitCents).toBe(5000);
    expect(budget!.mode).toBe("hard");
    expect(budget!.projectId).toBe("proj-alpha");
  });
});

// ─── wallet.setBudget ────────────────────────────────────────────────────────

describe("wallet.setBudget", () => {
  it("creates a new budget row", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const result = await caller.wallet.setBudget({
      projectId: "proj-beta",
      limitCents: 10000,
      alertThreshold: 75,
      mode: "soft",
    });
    expect(result.success).toBe(true);

    const budget = await caller.wallet.getBudget({ projectId: "proj-beta" });
    expect(budget!.alertThreshold).toBe(75);
  });

  it("updates an existing budget row (upsert)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await caller.wallet.setBudget({ projectId: "proj-gamma", limitCents: 1000, mode: "soft" });
    await caller.wallet.setBudget({ projectId: "proj-gamma", limitCents: 9999, mode: "hard" });

    const budget = await caller.wallet.getBudget({ projectId: "proj-gamma" });
    expect(budget!.limitCents).toBe(9999);
    expect(budget!.mode).toBe("hard");
  });
});

// ─── wallet.getSpendLog ──────────────────────────────────────────────────────

describe("wallet.getSpendLog", () => {
  it("returns entries for a specific project only", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await seedSpendEntry(db, "project-A", "openai", 500);
    await seedSpendEntry(db, "project-B", "anthropic", 300);

    const log = await caller.wallet.getSpendLog({ projectId: "project-A" });
    expect(log).toHaveLength(1);
    expect(log[0].projectId).toBe("project-A");
    expect(log[0].provider).toBe("openai");
  });

  it("returns all entries when projectId is __global__", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await seedSpendEntry(db, "project-A", "openai", 100);
    await seedSpendEntry(db, "project-B", "anthropic", 200);
    await seedSpendEntry(db, "project-C", "gemini", 300);

    const log = await caller.wallet.getSpendLog({ projectId: "__global__" });
    expect(log.length).toBe(3);
  });

  it("respects the limit parameter", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    for (let i = 0; i < 5; i++) {
      await seedSpendEntry(db, "proj-lim", "openai", 100);
    }

    const log = await caller.wallet.getSpendLog({ projectId: "proj-lim", limit: 3 });
    expect(log).toHaveLength(3);
  });

  it("returns empty array when no entries exist for the project", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const log = await caller.wallet.getSpendLog({ projectId: "empty-project" });
    expect(log).toEqual([]);
  });
});

// ─── wallet.getSpendSummary ──────────────────────────────────────────────────

describe("wallet.getSpendSummary", () => {
  it("aggregates costs per provider for a project", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const pid = "sum-project";

    await seedSpendEntry(db, pid, "openai", 1000);
    await seedSpendEntry(db, pid, "openai", 2000);
    await seedSpendEntry(db, pid, "anthropic", 500);

    const summary = await caller.wallet.getSpendSummary({ projectId: pid });
    expect(summary.totalMicrocents).toBe(3500);

    const openaiRow = summary.byProvider.find(r => r.provider === "openai");
    expect(openaiRow!.totalMicrocents).toBe(3000);

    const anthropicRow = summary.byProvider.find(r => r.provider === "anthropic");
    expect(anthropicRow!.totalMicrocents).toBe(500);
  });

  it("returns zero totals when no spend entries exist", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const summary = await caller.wallet.getSpendSummary({ projectId: "no-spend" });
    expect(summary.totalMicrocents).toBe(0);
    expect(summary.byProvider).toEqual([]);
  });

  it("includes all projects when projectId is __global__", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    await seedSpendEntry(db, "proj-x", "openai", 300);
    await seedSpendEntry(db, "proj-y", "anthropic", 700);

    const summary = await caller.wallet.getSpendSummary({ projectId: "__global__" });
    expect(summary.totalMicrocents).toBe(1000);
  });
});

// ─── wallet.resetSpend ───────────────────────────────────────────────────────

describe("wallet.resetSpend", () => {
  it("deletes all spend entries for the specified project", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const pid = "reset-project";

    await seedSpendEntry(db, pid, "openai", 100);
    await seedSpendEntry(db, pid, "openai", 200);
    await seedSpendEntry(db, "other-project", "openai", 300);

    await caller.wallet.resetSpend({ projectId: pid, confirm: true });

    const log = await caller.wallet.getSpendLog({ projectId: pid });
    expect(log).toHaveLength(0);

    const otherLog = await caller.wallet.getSpendLog({ projectId: "other-project" });
    expect(otherLog).toHaveLength(1);
  });
});
