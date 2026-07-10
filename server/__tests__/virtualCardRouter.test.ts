/**
 * Batch F — route-level tests for `virtualCardRouter` (Agentic Wallet).
 *
 * VirtualCardService (Lithic) + HITLApprovalService are mocked so no real card
 * is issued and no HITL prompt blocks; the Lithic HTTP path itself is covered
 * hermetically in virtualCardService.test.ts. Here the focus is the router
 * orchestration the service can't see:
 *   - per-user ownership + **PAN-safety** on getCard/listCards (the encrypted
 *     credential blob must never leave the server),
 *   - the Sovereign-mode gate (externalServiceProcedure) on issueCard/listTransactions,
 *   - issueCard's not-configured short-circuit, HITL approve/deny, and 1/60s rate limit.
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

// Preserve CardOperationError (the router does `instanceof` on it); override only
// the singleton.
const vcSvc = vi.hoisted(() => ({
  isConfigured: vi.fn(),
  issueCard: vi.fn(),
  listTransactions: vi.fn(),
  revealPan: vi.fn(),
}));
vi.mock("../core_services/services/VirtualCardService.js", async importActual => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, VirtualCardService: { getInstance: () => vcSvc } };
});

const hitlSvc = vi.hoisted(() => ({ requestApproval: vi.fn() }));
vi.mock("../core_services/services/HITLApprovalService.js", () => ({
  HITLApprovalService: { getInstance: () => hitlSvc },
}));

import { appRouter } from "../routers.js";
import { virtualCards, type User } from "../../drizzle/schema.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

async function seedCard(user: User, over: Partial<typeof virtualCards.$inferInsert> = {}) {
  const [row] = await db.insert(virtualCards).values({
    userId: user.id,
    token: over.token ?? `card_${Math.random().toString(36).slice(2)}`,
    memo: over.memo ?? "agent card",
    lastFour: over.lastFour ?? "4242",
    expMonth: 12,
    expYear: 2031,
    encryptedCredentials: "ENC_SECRET_BLOB",
    ivHex: "00ff",
    authTagHex: "aabb",
    spendLimitCents: over.spendLimitCents ?? 5000,
    ...over,
  }).returning();
  return row;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vcSvc.isConfigured.mockReset();
  vcSvc.issueCard.mockReset();
  vcSvc.listTransactions.mockReset();
  vcSvc.revealPan.mockReset();
  hitlSvc.requestApproval.mockReset();
});

describe("virtualCard — auth boundary", () => {
  it("rejects unauthenticated isConfigured", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.virtualCard.isConfigured()).rejects.toThrow(TRPCError);
  });
});

describe("virtualCard.isConfigured", () => {
  it("reflects the service configuration state", async () => {
    vcSvc.isConfigured.mockReturnValue(false);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.virtualCard.isConfigured()).toBe(false);
  });
});

describe("virtualCard.getCard — ownership + PAN safety", () => {
  it("returns safe metadata for the owner and never the encrypted blob", async () => {
    const user = await seedUser(db);
    const card = await seedCard(user, { token: "card_own" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.virtualCard.getCard({ cardToken: "card_own" });
    expect(res).toMatchObject({ token: "card_own", lastFour: "4242", spendLimitCents: card.spendLimitCents });
    expect(res).not.toHaveProperty("encryptedCredentials");
    expect(res).not.toHaveProperty("ivHex");
    expect(res).not.toHaveProperty("authTagHex");
  });

  it("returns NOT_FOUND for another user's card", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    await seedCard(alice, { token: "card_alice" });
    const bobCaller = appRouter.createCaller(makeContext(bob, db));
    await expect(
      bobCaller.virtualCard.getCard({ cardToken: "card_alice" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("virtualCard.listCards — safe columns + scoping", () => {
  it("lists only the caller's cards and never the encrypted credential columns", async () => {
    const alice = await seedUser(db, { openId: "a2", email: "a2@x.com" });
    const bob = await seedUser(db, { openId: "b2", email: "b2@x.com" });
    await seedCard(alice, { token: "c1" });
    await seedCard(alice, { token: "c2" });
    await seedCard(bob, { token: "c3" });

    const list = await appRouter.createCaller(makeContext(alice, db)).virtualCard.listCards({});
    expect(list).toHaveLength(2);
    for (const c of list) {
      expect(c).not.toHaveProperty("encryptedCredentials");
      expect(c).not.toHaveProperty("ivHex");
      expect(c).not.toHaveProperty("authTagHex");
    }
  });
});

describe("virtualCard.issueCard", () => {
  it("blocks a sovereign user (externalServiceProcedure) before any issuance", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.virtualCard.issueCard({ spendLimitDollars: 10 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(hitlSvc.requestApproval).not.toHaveBeenCalled();
  });

  it("short-circuits when the provider is not configured", async () => {
    vcSvc.isConfigured.mockReturnValue(false);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.virtualCard.issueCard({ spendLimitDollars: 10 });
    expect(res).toMatchObject({ configured: false, card: null });
    expect(hitlSvc.requestApproval).not.toHaveBeenCalled();
  });

  it("rejects with FORBIDDEN when HITL denies the issuance (no card issued)", async () => {
    vcSvc.isConfigured.mockReturnValue(true);
    hitlSvc.requestApproval.mockResolvedValue(false);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.virtualCard.issueCard({ spendLimitDollars: 25 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(vcSvc.issueCard).not.toHaveBeenCalled();
  });

  // Combined into one test on purpose: the router's rate-limit map is module-level
  // and keyed by userId, while the harness resets user ids to 1 per fresh DB — so
  // keeping the single successful issuance in one test avoids cross-test map
  // contamination while still covering both the approve→issue and the 1/60s limit.
  it("issues on HITL approval (cents-converted) then rate-limits the next within 60s", async () => {
    vcSvc.isConfigured.mockReturnValue(true);
    hitlSvc.requestApproval.mockResolvedValue(true);
    vcSvc.issueCard.mockResolvedValue({ token: "card_new", last4: "9999", encryptedPan: "x" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.virtualCard.issueCard({ spendLimitDollars: 12.5, memo: "ads" });
    expect(res).toMatchObject({ configured: true, card: { token: "card_new" } });
    expect(vcSvc.issueCard.mock.calls[0]?.[0]).toMatchObject({ spendLimitCents: 1250, memo: "ads" });

    await expect(
      caller.virtualCard.issueCard({ spendLimitDollars: 10 })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("virtualCard.revealCardPan", () => {
  it("blocks a sovereign user (externalServiceProcedure) before any decrypt", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.virtualCard.revealCardPan({ cardToken: "card_x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(vcSvc.revealPan).not.toHaveBeenCalled();
  });

  it("delegates to the service (token + caller's userId) and returns the decrypted PAN", async () => {
    vcSvc.revealPan.mockResolvedValue("4111111111111111");
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.virtualCard.revealCardPan({ cardToken: "card_own" });
    expect(res).toEqual({ pan: "4111111111111111" });
    expect(vcSvc.revealPan).toHaveBeenCalledWith("card_own", user.id);
  });

  it("maps a null service result (unknown card / not configured) to NOT_FOUND", async () => {
    vcSvc.revealPan.mockResolvedValue(null);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.virtualCard.revealCardPan({ cardToken: "card_ghost" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("virtualCard.listTransactions", () => {
  it("blocks a sovereign user (externalServiceProcedure)", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.virtualCard.listTransactions({ cardToken: "card_x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("delegates to the service and returns the mapped transactions", async () => {
    vcSvc.listTransactions.mockResolvedValue([
      { token: "txn_1", amount: 500, currency: "USD", status: "SETTLED", merchantDescriptor: "OPENAI", created: "2026-06-30" },
    ]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.virtualCard.listTransactions({ cardToken: "card_x" });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ token: "txn_1", amount: 500, merchantDescriptor: "OPENAI" });
    expect(vcSvc.listTransactions).toHaveBeenCalledWith("card_x", user.id);
  });
});
