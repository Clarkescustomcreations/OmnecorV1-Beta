/**
 * Route-level integration tests for `honchoRouter`.
 *
 * Covers: the per-user openId ownership guard (FORBIDDEN when input.openId
 * mismatches the session user), delegation to honchoService for
 * addMessage/addFact/getFacts (+ default limit), and the sovereign block
 * (externalServiceProcedure). honchoService is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
const svc = vi.hoisted(() => ({
  addMessage: vi.fn().mockResolvedValue(undefined),
  addFact: vi.fn().mockResolvedValue(undefined),
  getFacts: vi.fn().mockResolvedValue([{ content: "fact-1" }]),
}));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/HonchoService.js", () => ({ honchoService: svc }));

vi.mock("../core_services/services/AuditLogService.js", () => ({
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

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vi.clearAllMocks();
});

describe("honcho openId ownership guard", () => {
  it("FORBIDs addMessage when input.openId mismatches the session user", async () => {
    const user = await seedUser(db, { openId: "real-open-id", executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.honcho.addMessage({ openId: "someone-else", sessionId: "s", role: "user", content: "hi" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(svc.addMessage).not.toHaveBeenCalled();
  });

  it("FORBIDs getFacts on a mismatched openId", async () => {
    const user = await seedUser(db, { openId: "owner", executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.honcho.getFacts({ openId: "intruder" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("honcho delegation (own openId)", () => {
  it("addMessage forwards to honchoService", async () => {
    const user = await seedUser(db, { openId: "me", executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.honcho.addMessage({ openId: "me", sessionId: "s1", role: "ai", content: "hello" });
    expect(res).toEqual({ ok: true });
    expect(svc.addMessage).toHaveBeenCalledWith("me", "s1", "ai", "hello");
  });

  it("addFact forwards to honchoService", async () => {
    const user = await seedUser(db, { openId: "me", executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.honcho.addFact({ openId: "me", content: "I prefer dark mode" });
    expect(res).toEqual({ ok: true });
    expect(svc.addFact).toHaveBeenCalledWith("me", "I prefer dark mode");
  });

  it("getFacts returns facts with the default limit of 20", async () => {
    const user = await seedUser(db, { openId: "me", executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.honcho.getFacts({ openId: "me" });
    expect(res).toEqual([{ content: "fact-1" }]);
    expect(svc.getFacts).toHaveBeenCalledWith("me", 20);
  });
});

describe("honcho sovereign block", () => {
  it("blocks a sovereign user (externalServiceProcedure)", async () => {
    const user = await seedUser(db, { openId: "me", executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.honcho.addFact({ openId: "me", content: "x" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
