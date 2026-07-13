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
  listRepoFiles: vi.fn(),
  startHuggingFaceDownload: vi.fn(),
  startBaseModelDownload: vi.fn(),
  getDownloadStatus: vi.fn(),
  listDownloads: vi.fn(),
}));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/ModelMarketplaceService.js", () => ({
  ModelMarketplaceService: { getInstance: () => svc },
}));

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

describe("modelMarketplace HF download surface", () => {
  it("listRepoFiles delegates the repo id", async () => {
    svc.listRepoFiles.mockResolvedValue([{ path: "m.gguf", filename: "m.gguf", sizeBytes: 1, quant: null }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.listRepoFiles({ repoId: "owner/repo" });
    expect(svc.listRepoFiles).toHaveBeenCalledWith("owner/repo");
    expect(res.files).toHaveLength(1);
  });

  it("downloadModel delegates repoId/filePath/sizeBytes and returns the tracking id", async () => {
    svc.startHuggingFaceDownload.mockReturnValue({ id: "dl-1" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.downloadModel({ repoId: "owner/repo", filePath: "m.gguf", sizeBytes: 42 });
    expect(svc.startHuggingFaceDownload).toHaveBeenCalledWith("owner/repo", "m.gguf", 42);
    expect(res.id).toBe("dl-1");
  });

  it("downloadBaseModel delegates the repo id to the whole-repo download", async () => {
    svc.startBaseModelDownload.mockReturnValue({ id: "dl-base" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.downloadBaseModel({ repoId: "org/base" });
    expect(svc.startBaseModelDownload).toHaveBeenCalledWith("org/base");
    expect(res.id).toBe("dl-base");
  });

  it("downloadStatus rejects a non-uuid id before touching the service", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.modelMarketplace.downloadStatus({ id: "nope" })).rejects.toBeTruthy();
    expect(svc.getDownloadStatus).not.toHaveBeenCalled();
  });

  it("downloadStatus returns the status for a valid uuid", async () => {
    svc.getDownloadStatus.mockReturnValue({ id: "abc", state: "done" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.downloadStatus({ id: "123e4567-e89b-12d3-a456-426614174000" });
    expect(svc.getDownloadStatus).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174000");
    expect(res?.state).toBe("done");
  });

  it("downloads returns the service's list", async () => {
    svc.listDownloads.mockReturnValue([{ id: "a" }, { id: "b" }]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.modelMarketplace.downloads();
    expect(res.downloads).toHaveLength(2);
  });
});
