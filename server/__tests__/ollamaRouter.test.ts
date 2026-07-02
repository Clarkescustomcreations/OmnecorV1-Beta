/**
 * Route-level integration tests for `ollamaRouter`.
 *
 * Focus on the harness-testable surface (global fetch + HITLApprovalService
 * mocked):
 *  - searchModels offline fallback to the curated OLLAMA_FALLBACK_MODELS catalog
 *    (registry fetch fails) with query filtering + limit
 *  - pullModel fire-and-forget returns { started: true }
 *  - deleteModel admin gate + HITL approval (deny → FORBIDDEN, approve → delete)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
const hitl = vi.hoisted(() => ({ requestApproval: vi.fn() }));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/HITLApprovalService.js", () => ({
  HITLApprovalService: { getInstance: () => hitl },
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
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ollama.searchModels — offline fallback catalog", () => {
  it("falls back to the curated catalog when the registry is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const user = await seedUser(db, { executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.ollama.searchModels({});
    expect(res.models.length).toBeGreaterThan(0);
    // The curated catalog includes well-known local models.
    expect(res.models.some(m => m.id.startsWith("llama"))).toBe(true);
  });

  it("filters the fallback catalog by query and respects the limit", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const user = await seedUser(db, { executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.ollama.searchModels({ query: "llama", limit: 2 });
    expect(res.models.length).toBeLessThanOrEqual(2);
    expect(res.models.every(m =>
      m.id.toLowerCase().includes("llama") ||
      m.description.toLowerCase().includes("llama") ||
      m.tags.some(t => t.toLowerCase().includes("llama"))
    )).toBe(true);
  });
});

describe("ollama.pullModel", () => {
  it("returns started:true (fire-and-forget)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.ollama.pullModel({ name: "llama3.2:3b" });
    expect(res).toEqual({ started: true, name: "llama3.2:3b" });
  });
});

describe("ollama.deleteModel — admin gate + HITL", () => {
  it("forbids a non-admin user", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.ollama.deleteModel({ name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(hitl.requestApproval).not.toHaveBeenCalled();
  });

  it("FORBIDs when HITL rejects the deletion", async () => {
    hitl.requestApproval.mockResolvedValue(false);
    const admin = await seedUser(db, { role: "admin" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    await expect(caller.ollama.deleteModel({ name: "llama3" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled(); // never reaches the Ollama API
  });

  it("deletes when admin + HITL approves", async () => {
    hitl.requestApproval.mockResolvedValue(true);
    fetchMock.mockResolvedValue({ ok: true, text: async () => "", json: async () => ({}) });
    const admin = await seedUser(db, { role: "admin" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    const res = await caller.ollama.deleteModel({ name: "llama3" });
    expect(res).toEqual({ deleted: true, name: "llama3" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("ollama.listModels / runningModels — daemon reads (fetch mocked)", () => {
  it("listModels returns the daemon's model list from /api/tags", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2:3b", size: 2_000_000, digest: "abc", modified_at: "2026-01-01" }] }),
    });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.ollama.listModels();
    expect(res.models).toHaveLength(1);
    expect(res.models[0].name).toBe("llama3.2:3b");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/tags");
  });

  it("listModels maps a daemon error response to INTERNAL_SERVER_ERROR with the status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.ollama.listModels()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("Ollama error: 500"),
    });
  });

  it("listModels tolerates a daemon payload with no models field (empty list, not a crash)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect((await caller.ollama.listModels()).models).toEqual([]);
  });

  it("runningModels returns the /api/ps list (empty-safe)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "qwen2.5:3b", size: 3_000_000, expires_at: "2026-01-01" }] }),
    });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.ollama.runningModels();
    expect(res.running[0].name).toBe("qwen2.5:3b");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/ps");
  });
});

describe("ollama.modelInfo / createModelfile", () => {
  it("modelInfo POSTs the model name to /api/show and returns the daemon payload", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ license: "MIT", details: { family: "llama" } }) });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.ollama.modelInfo({ name: "llama3.2:3b" });
    expect(res).toMatchObject({ license: "MIT" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/show");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: "llama3.2:3b" });
  });

  it("createModelfile POSTs name+modelfile to /api/create and reports created", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.ollama.createModelfile({ name: "custom", modelfile: "FROM llama3.2:3b" });
    expect(res).toEqual({ created: true, name: "custom" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/create");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "custom",
      modelfile: "FROM llama3.2:3b",
    });
  });

  it("createModelfile surfaces a daemon rejection as INTERNAL_SERVER_ERROR", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "invalid modelfile" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.ollama.createModelfile({ name: "bad", modelfile: "NOPE" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
