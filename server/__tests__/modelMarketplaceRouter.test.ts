/**
 * Route-level integration tests for `modelMarketplaceRouter`.
 *
 * Thin wrapper over ModelMarketplaceService — verify the auth gate and that
 * `search` routes to the right service method per `source` (ollama /
 * huggingface / all) and `featured` returns the curated hot list. Service is
 * mocked; no network.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));
const svc = vi.hoisted(() => ({
  searchOllama: vi.fn(),
  searchHuggingFace: vi.fn(),
  searchAll: vi.fn(),
  getHotModels: vi.fn(),
}));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/ModelMarketplaceService.js", () => ({
  ModelMarketplaceService: { getInstance: () => svc },
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

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vi.clearAllMocks();
});

describe("auth boundary", () => {
  it("rejects unauthenticated search", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.modelMarketplace.search({})).rejects.toThrow(TRPCError);
  });
});

describe("modelMarketplace.search routing", () => {
  it("source=ollama → searchOllama", async () => {
    svc.searchOllama.mockResolvedValue([{ id: "llama3" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.search({ query: "llama", source: "ollama", limit: 5 });
    expect(svc.searchOllama).toHaveBeenCalledWith("llama", 5);
    expect(res).toEqual({ models: [{ id: "llama3" }], total: 1 });
    expect(svc.searchAll).not.toHaveBeenCalled();
  });

  it("source=huggingface → searchHuggingFace", async () => {
    svc.searchHuggingFace.mockResolvedValue([{ id: "hf-1" }, { id: "hf-2" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.search({ query: "bert", source: "huggingface" });
    expect(svc.searchHuggingFace).toHaveBeenCalledWith("bert", 20); // default limit
    expect(res.total).toBe(2);
  });

  it("default source=all → searchAll", async () => {
    svc.searchAll.mockResolvedValue([{ id: "x" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.search({ query: "code" });
    expect(svc.searchAll).toHaveBeenCalledWith("code", 20);
    expect(res.total).toBe(1);
  });
});

describe("modelMarketplace.featured", () => {
  it("returns the curated hot models (no network)", async () => {
    svc.getHotModels.mockReturnValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.featured();
    expect(res.total).toBe(3);
    expect(svc.getHotModels).toHaveBeenCalledOnce();
  });
});
