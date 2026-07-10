/**
 * Route-level integration tests for `knowledgeBaseRouter`.
 *
 * The router wraps MemoryArchitectService (ChromaDB). Every procedure must
 * degrade gracefully when the memory layer is offline (the common local case —
 * no ChromaDB running): return a safe empty/false result instead of throwing.
 * These tests stub ctx.services.memoryArchitect for both the offline and online
 * paths and assert delegation + graceful degradation. No real ChromaDB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function services(online: boolean, overrides: Record<string, unknown> = {}) {
  return {
    memoryArchitect: {
      isOnline: () => online,
      getStatus: vi.fn().mockResolvedValue({ online, chromaUrl: "http://localhost:8000", initialized: online }),
      deleteCollection: vi.fn().mockResolvedValue(undefined),
      ingestDirectory: vi.fn().mockResolvedValue({ filesProcessed: 3, chunksStored: 12, errors: [], durationMs: 5 }),
      ingestDocument: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([{ id: "1", score: 0.9 }]),
      retrieveContext: vi.fn().mockResolvedValue("relevant context here"),
      consolidateEpisodic: vi.fn().mockResolvedValue(undefined),
      ensureProjectMemory: vi.fn().mockResolvedValue("proj_collection"),
      ...overrides,
    },
  };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("knowledgeBase.status", () => {
  it("returns the service status when online", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(true)));
    const res = await caller.knowledgeBase.status();
    expect(res.online).toBe(true);
  });

  it("falls back to an offline status when getStatus throws", async () => {
    const user = await seedUser(db);
    const svc = services(true, { getStatus: vi.fn().mockRejectedValue(new Error("no chroma")) });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.knowledgeBase.status();
    expect(res.online).toBe(false);
    expect(res.initialized).toBe(false);
  });
});

describe("knowledgeBase — graceful offline degradation", () => {
  it("deleteCollection returns success:false offline (no throw)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(false)));
    expect(await caller.knowledgeBase.deleteCollection({ projectId: "p" })).toEqual({ success: false });
  });

  it("ingestDirectory reports offline error without touching the filesystem", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(false)));
    const res = await caller.knowledgeBase.ingestDirectory({ projectId: "p", directoryPath: "/anything" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("offline");
    expect(res.filesProcessed).toBe(0);
  });

  it("ingestDocument / consolidate / ensureProject degrade offline", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(false)));
    expect(await caller.knowledgeBase.ingestDocument({ projectId: "p", documentId: "d", text: "x" }))
      .toMatchObject({ success: false });
    expect(await caller.knowledgeBase.consolidate({ projectId: "p", conversationId: "c", summary: "s", keyInsights: [] }))
      .toMatchObject({ success: false });
    expect(await caller.knowledgeBase.ensureProject({ projectId: "p" }))
      .toEqual({ success: false, collectionName: null });
  });

  it("search returns [] and retrieveContext returns empty offline", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(false)));
    expect(await caller.knowledgeBase.search({ projectId: "p", query: "q" })).toEqual([]);
    expect(await caller.knowledgeBase.retrieveContext({ projectId: "p", prompt: "hi" }))
      .toEqual({ context: "", tokenEstimate: 0 });
  });
});

describe("knowledgeBase — online delegation", () => {
  it("deleteCollection delegates and returns success when online", async () => {
    const user = await seedUser(db);
    const svc = services(true);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    expect(await caller.knowledgeBase.deleteCollection({ projectId: "proj-1" })).toEqual({ success: true });
    expect(svc.memoryArchitect.deleteCollection).toHaveBeenCalledWith("proj-1");
  });

  it("search returns ranked results when online", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(true)));
    const res = await caller.knowledgeBase.search({ projectId: "p", query: "vec" });
    expect(res).toHaveLength(1);
  });

  it("retrieveContext returns context + a token estimate (~len/4)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(true)));
    const res = await caller.knowledgeBase.retrieveContext({ projectId: "p", prompt: "hi" });
    expect(res.context).toBe("relevant context here");
    expect(res.tokenEstimate).toBe(Math.ceil("relevant context here".length / 4));
  });

  it("ensureProject returns the collection name when online", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(true)));
    expect(await caller.knowledgeBase.ensureProject({ projectId: "p" }))
      .toEqual({ success: true, collectionName: "proj_collection" });
  });
});
