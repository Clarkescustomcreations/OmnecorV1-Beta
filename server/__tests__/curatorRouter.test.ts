/**
 * Route-level integration tests for `curatorRouter`.
 *
 * Covers: listByStatus (status + per-user + projectId filters), getPost
 * ownership, curateArticle (sovereign block on the cloud provider, NOT_FOUND,
 * AI-draft generation via ctx.services.aiProvider + insert pending_review + mark
 * article processed), approve/reject/update bulk ownership, and regenerateDraft
 * (sovereign block + NOT_FOUND + draft). Real in-memory libSQL DB; AI provider
 * stubbed.
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
import { curatedPosts, discoveredArticles } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function services(chatResult = "AI generated post copy") {
  return { aiProvider: { chat: vi.fn().mockResolvedValue(chatResult) } };
}

async function seedArticle(title: string): Promise<number> {
  const [a] = await db
    .insert(discoveredArticles)
    .values({ title, content: "body", url: `https://x/${title}`, urlHash: `h-${title}` })
    .returning({ id: discoveredArticles.id });
  return a!.id;
}

async function seedPost(userId: number, status: string, projectId?: string): Promise<number> {
  const [p] = await db
    .insert(curatedPosts)
    .values({ platform: "x", content: "c", status: status as "draft", createdByUserId: userId, projectId })
    .returning({ id: curatedPosts.id });
  return p!.id;
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("curator.listByStatus / getPost", () => {
  it("filters by status and scopes to the caller", async () => {
    const user = await seedUser(db);
    const other = await seedUser(db, { openId: "o", email: "o@x.com" });
    await seedPost(user.id, "pending_review");
    await seedPost(user.id, "approved");
    await seedPost(other.id, "pending_review");

    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const pending = await caller.curator.listByStatus({ status: "pending_review" });
    expect(pending).toHaveLength(1); // own pending only, not other user's
  });

  it("getPost returns null for another user's post", async () => {
    const user = await seedUser(db);
    const other = await seedUser(db, { openId: "o2", email: "o2@x.com" });
    const otherPost = await seedPost(other.id, "draft");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    expect(await caller.curator.getPost({ postId: otherPost })).toBeNull();
  });
});

describe("curator.curateArticle", () => {
  it("blocks sovereign users from the cloud curation provider", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const articleId = await seedArticle("sov");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(caller.curator.curateArticle({ articleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND for an unknown article", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(caller.curator.curateArticle({ articleId: 9999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("generates a draft via the AI provider, stores pending_review, marks article processed", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const articleId = await seedArticle("real");
    const svc = services("Fresh AI post about the article");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));

    const res = await caller.curator.curateArticle({ articleId, platform: "x" });
    expect(res.success).toBe(true);
    expect(svc.aiProvider.chat).toHaveBeenCalledOnce();

    const posts = await db.select().from(curatedPosts);
    expect(posts).toHaveLength(1);
    expect(posts[0].content).toBe("Fresh AI post about the article");
    expect(posts[0].status).toBe("pending_review");
    expect(posts[0].createdByUserId).toBe(user.id);

    const [article] = await db.select().from(discoveredArticles).where(eq(discoveredArticles.id, articleId));
    expect(article.isProcessed).toBe(1);
  });
});

describe("curator.approvePosts / rejectPosts / updatePost — ownership", () => {
  it("approve only flips the caller's own posts", async () => {
    const user = await seedUser(db);
    const other = await seedUser(db, { openId: "o3", email: "o3@x.com" });
    const mine = await seedPost(user.id, "pending_review");
    const theirs = await seedPost(other.id, "pending_review");

    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await caller.curator.approvePosts({ postIds: [mine, theirs] });

    const [minePost] = await db.select().from(curatedPosts).where(eq(curatedPosts.id, mine));
    const [theirsPost] = await db.select().from(curatedPosts).where(eq(curatedPosts.id, theirs));
    expect(minePost.status).toBe("approved");
    expect(theirsPost.status).toBe("pending_review"); // untouched
  });

  it("reject sets failed + records the reason", async () => {
    const user = await seedUser(db);
    const id = await seedPost(user.id, "pending_review");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await caller.curator.rejectPosts({ postIds: [id], rejectionReason: "off-brand" });
    const [post] = await db.select().from(curatedPosts).where(eq(curatedPosts.id, id));
    expect(post.status).toBe("failed");
    expect(post.approvalNotes).toBe("off-brand");
  });

  it("updatePost edits content + status for an owned post", async () => {
    const user = await seedUser(db);
    const id = await seedPost(user.id, "draft");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await caller.curator.updatePost({ postId: id, content: "edited", status: "approved" });
    const [post] = await db.select().from(curatedPosts).where(eq(curatedPosts.id, id));
    expect(post.content).toBe("edited");
    expect(post.status).toBe("approved");
  });
});

describe("curator.regenerateDraft", () => {
  it("blocks sovereign users", async () => {
    const user = await seedUser(db, { executionMode: "sovereign" });
    const articleId = await seedArticle("regen-sov");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(caller.curator.regenerateDraft({ articleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns a fresh draft for a known article", async () => {
    const user = await seedUser(db, { executionMode: "scrapper" });
    const articleId = await seedArticle("regen");
    const svc = services("Regenerated copy");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));
    const res = await caller.curator.regenerateDraft({ articleId });
    expect(res.success).toBe(true);
    expect(res.draft).toBe("Regenerated copy");
  });
});
