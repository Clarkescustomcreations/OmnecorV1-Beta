/**
 * Batch G tail — route-level tests for `discoveryRouter` (article discovery feed).
 *
 * Drives `appRouter.createCaller(ctx)` against the real in-memory DB so the
 * `discoveredArticles` filters (unprocessed-only, project scope, newest-first,
 * limit) and the `markAsProcessed` write genuinely execute. Only the RSS/Atom
 * ingest (`ArticleDiscoveryService.discover`) is mocked — the router's job is to
 * call it and then return the current unprocessed set, which is asserted for real.
 *
 * Note: the feed is **project-scoped, not user-scoped** (discoveredArticles has
 * no userId column) — so these tests assert projectId filtering, not per-user
 * isolation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
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

const discoverMock = vi.hoisted(() => vi.fn());
vi.mock("../core_services/services/ArticleDiscoveryService.js", () => ({
  ArticleDiscoveryService: { getInstance: () => ({ discover: discoverMock }) },
}));

import { appRouter } from "../routers.js";
import { discoveredArticles, neuralMaps } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let user: User;

async function seedArticle(over: Partial<typeof discoveredArticles.$inferInsert> = {}) {
  const [row] = await db
    .insert(discoveredArticles)
    .values({
      title: "Article",
      url: `https://example.com/${randomUUID()}`,
      urlHash: randomUUID(),
      source: "rss",
      isProcessed: 0,
      fetchedAt: new Date(),
      ...over,
    })
    .returning();
  return row;
}

/** A neuralMap must exist before an article can reference it (FK cascade). */
async function seedMap(id: string) {
  await db.insert(neuralMaps).values({
    id,
    userId: user.id,
    name: `map-${id}`,
    rootDirectories: [],
    settings: {},
  });
  return id;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  user = await seedUser(db);
  discoverMock.mockReset();
});

describe("discovery — auth boundary", () => {
  it("rejects an unauthenticated listUnprocessed", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.discovery.listUnprocessed({})).rejects.toThrow(TRPCError);
  });
});

describe("discovery.listUnprocessed", () => {
  it("returns only unprocessed rows, newest-first, respecting the limit", async () => {
    await seedArticle({ title: "old", fetchedAt: new Date(1_000) });
    await seedArticle({ title: "new", fetchedAt: new Date(3_000) });
    await seedArticle({ title: "mid", fetchedAt: new Date(2_000) });
    await seedArticle({ title: "done", fetchedAt: new Date(4_000), isProcessed: 1 });

    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const rows = await caller.discovery.listUnprocessed({ limit: 2 });

    expect(rows).toHaveLength(2); // limit honored
    expect(rows.map(r => r.title)).toEqual(["new", "mid"]); // desc by fetchedAt
    expect(rows.every(r => r.isProcessed === 0)).toBe(true); // processed excluded
  });

  it("filters by projectId when supplied", async () => {
    const p1 = await seedMap("proj-1");
    await seedMap("proj-2");
    await seedArticle({ projectId: p1, title: "in-scope" });
    await seedArticle({ projectId: "proj-2", title: "other-project" });
    await seedArticle({ title: "no-project" });

    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const rows = await caller.discovery.listUnprocessed({ projectId: p1 });

    expect(rows.map(r => r.title)).toEqual(["in-scope"]);
  });
});

describe("discovery.getArticle", () => {
  it("returns the article by id", async () => {
    const a = await seedArticle({ title: "target" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const got = await caller.discovery.getArticle({ articleId: a.id });
    expect(got?.title).toBe("target");
  });

  it("returns null for a missing id", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.discovery.getArticle({ articleId: 99999 })).toBeNull();
  });
});

describe("discovery.markAsProcessed", () => {
  it("flips isProcessed so the row drops from the unprocessed feed", async () => {
    const a = await seedArticle({ title: "to-process" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    expect(await caller.discovery.markAsProcessed({ articleId: a.id })).toEqual({ success: true });

    const [row] = await db.select().from(discoveredArticles).where(eq(discoveredArticles.id, a.id));
    expect(row.isProcessed).toBe(1);
    expect(await caller.discovery.listUnprocessed({})).toHaveLength(0);
  });
});

describe("discovery.fetchArticles", () => {
  it("ingests via the discovery service and returns the fresh unprocessed set", async () => {
    // The service ingests two rows as a side effect; report how many it added.
    discoverMock.mockImplementation(async () => {
      await seedArticle({ title: "ingested-1" });
      await seedArticle({ title: "ingested-2" });
      return [{ id: 1 }, { id: 2 }];
    });

    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.discovery.fetchArticles({ source: "https://feed", limit: 10 });

    expect(discoverMock).toHaveBeenCalledWith("https://feed", 10);
    expect(res.success).toBe(true);
    expect(res.articlesAdded).toBe(2);
    expect(res.articles).toHaveLength(2);
  });

  it("surfaces an ingest failure instead of masking it", async () => {
    discoverMock.mockRejectedValue(new Error("feed unreachable"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.discovery.fetchArticles({ limit: 5 }),
    ).rejects.toThrow("feed unreachable");
  });
});
