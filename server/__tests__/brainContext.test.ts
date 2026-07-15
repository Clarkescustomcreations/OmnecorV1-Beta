/**
 * injectBrainContext — the Brain Pack read/injection path (Phase 3).
 *
 * Backs the DB with the REAL in-memory schema (so ownership scoping genuinely
 * filters) and replaces the vector store with a canned fake (retrieval results
 * are scripted, so the merge/dedupe/rank/cite/sanitize logic is what's tested).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SearchResult } from "../core_services/services/VectorStore.js";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

const fakeStore = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  // Map<collectionName, SearchResult[]> scripted per test.
  results: new Map<string, unknown[]>(),
  semanticSearch: vi.fn(async (coll: string) => (fakeStore.results.get(coll) ?? []) as unknown[]),
}));
vi.mock("../core_services/services/VectorStore.js", () => ({
  getVectorStore: () => fakeStore,
}));

import { injectBrainContext, resolveAttachedBrainIds } from "../_core/brainContext.js";
import { brains, personas, users } from "../../drizzle/schema.js";
import { createTestDb, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

let store: TestDb;
let db: Db;
let userId: number;

async function seedBrain(over: Partial<typeof brains.$inferInsert> = {}) {
  const id = over.id ?? "coding";
  await db.insert(brains).values({
    id,
    userId,
    name: over.name ?? "Coding Brain",
    version: "1.0.0",
    domain: over.domain ?? "coding",
    charter: over.charter ?? "Always write tests. Prefer clarity.",
    charterSha256: "x".repeat(64),
    embedderId: "all-MiniLM-L6-v2",
    embedderDim: 384,
    embedderMatch: over.embedderMatch ?? 1,
    status: over.status ?? "ready",
    collectionName: over.collectionName ?? `brain_${id}`,
    chunkCount: over.chunkCount ?? 2,
    ...over,
  });
}

function result(id: string, text: string, distance: number, source?: string): SearchResult {
  return { id, text, distance, metadata: source ? { sourcePath: source } : {} };
}

async function seedPersona(id: string, brainIds: unknown) {
  await db.insert(personas).values({
    id,
    userId,
    name: "P",
    type: "self_clone",
    data: { brains: brainIds },
  });
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  fakeStore.results.clear();
  vi.clearAllMocks();
  const [u] = await db
    .insert(users)
    .values({ openId: `u-${Date.now()}`, email: "a@b.c", name: "A", role: "user", executionMode: "scrapper" })
    .returning();
  userId = u.id;
});

const baseMsgs = [{ role: "user", content: "how do I handle null in typescript" }];

describe("injectBrainContext — guards", () => {
  it("passes through when no brainIds", async () => {
    const res = await injectBrainContext({ brainIds: [], userId, messages: baseMsgs });
    expect(res.injected).toBe(false);
    expect(res.messages).toBe(baseMsgs);
  });

  it("passes through when userId is missing", async () => {
    const res = await injectBrainContext({ brainIds: ["coding"], userId: null, messages: baseMsgs });
    expect(res.injected).toBe(false);
  });

  it("does not resolve another user's brain (ownership scoping)", async () => {
    await seedBrain();
    const [other] = await db
      .insert(users)
      .values({ openId: `o-${Date.now()}`, email: "x@y.z", name: "B", role: "user", executionMode: "scrapper" })
      .returning();
    const res = await injectBrainContext({ brainIds: ["coding"], userId: other.id, messages: baseMsgs });
    expect(res.injected).toBe(false);
  });
});

describe("injectBrainContext — charter (always-on)", () => {
  it("injects an incompatible brain's charter but retrieves no corpus", async () => {
    await seedBrain({ embedderMatch: 0, status: "incompatible" });
    const res = await injectBrainContext({ brainIds: ["coding"], userId, messages: baseMsgs });
    expect(res.injected).toBe(true);
    expect(res.usedBrainIds).toContain("coding");
    const sys = res.messages.find(m => m.role === "system")!.content;
    expect(sys).toContain("Skills & Rules");
    expect(sys).toContain("Always write tests");
    expect(sys).not.toContain("Reference Knowledge");
    expect(fakeStore.semanticSearch).not.toHaveBeenCalled();
  });

  it("appends to systemPrompt and the system message (dual carrier)", async () => {
    await seedBrain();
    const res = await injectBrainContext({
      brainIds: ["coding"],
      userId,
      messages: baseMsgs,
      systemPrompt: "You are helpful.",
    });
    expect(res.systemPrompt).toContain("You are helpful.");
    expect(res.systemPrompt).toContain("Attached Brains");
  });
});

describe("resolveAttachedBrainIds — persona + per-chat union (Phase 4)", () => {
  const pid = "11111111-1111-1111-1111-111111111111";

  it("unions a persona's durable brains with per-chat brainIds (deduped)", async () => {
    await seedPersona(pid, ["a", "b"]);
    const ids = await resolveAttachedBrainIds({ userId, personaId: pid, brainIds: ["b", "c"] });
    expect(new Set(ids)).toEqual(new Set(["a", "b", "c"]));
  });

  it("ignores a foreign user's persona", async () => {
    await seedPersona(pid, ["a"]);
    const [other] = await db
      .insert(users)
      .values({ openId: `o2-${Date.now()}`, email: "z@z.z", name: "C", role: "user", executionMode: "scrapper" })
      .returning();
    const ids = await resolveAttachedBrainIds({ userId: other.id, personaId: pid, brainIds: ["x"] });
    expect(ids).toEqual(["x"]);
  });

  it("tolerates a persona whose data.brains is malformed", async () => {
    await seedPersona(pid, "not-an-array");
    const ids = await resolveAttachedBrainIds({ userId, personaId: pid, brainIds: ["x"] });
    expect(ids).toEqual(["x"]);
  });

  it("caps the union at 16 ids", async () => {
    await seedPersona(pid, Array.from({ length: 20 }, (_, i) => `p${i}`));
    const ids = await resolveAttachedBrainIds({ userId, personaId: pid, brainIds: [] });
    expect(ids).toHaveLength(16);
  });

  it("injectBrainContext resolves a persona's brain and injects its charter", async () => {
    await seedBrain(); // id "coding"
    await seedPersona(pid, ["coding"]);
    const res = await injectBrainContext({ personaId: pid, userId, messages: baseMsgs });
    expect(res.injected).toBe(true);
    expect(res.usedBrainIds).toContain("coding");
  });
});

describe("injectBrainContext — corpus retrieval + merge", () => {
  it("retrieves, cites, and injects corpus for a ready brain", async () => {
    await seedBrain();
    fakeStore.results.set("brain_coding", [
      result("c1", "Use optional chaining to guard nulls in TS.", 0.1, "docs://ts"),
    ]);
    const res = await injectBrainContext({ brainIds: ["coding"], userId, messages: baseMsgs });
    expect(res.injected).toBe(true);
    const sys = res.messages.find(m => m.role === "system")!.content;
    expect(sys).toContain("Reference Knowledge");
    expect(sys).toContain("optional chaining");
    expect(sys).toContain("[Brain: Coding Brain · docs://ts]");
  });

  it("merges + ranks across brains by distance and dedupes identical text", async () => {
    await seedBrain({ id: "a", name: "Alpha", collectionName: "brain_a" });
    await seedBrain({ id: "b", name: "Beta", collectionName: "brain_b" });
    fakeStore.results.set("brain_a", [
      result("a1", "shared chunk", 0.5),
      result("a2", "alpha-only near", 0.2),
    ]);
    fakeStore.results.set("brain_b", [
      result("b1", "shared chunk", 0.1), // closer duplicate — should win
      result("b2", "beta-only far", 0.9),
    ]);
    const res = await injectBrainContext({ brainIds: ["a", "b"], userId, messages: baseMsgs });
    const sys = res.messages.find(m => m.role === "system")!.content;
    // "shared chunk" appears once (deduped).
    expect(sys.match(/shared chunk/g)?.length).toBe(1);
    // Closest first: alpha-only near (0.2) before beta-only far (0.9).
    expect(sys.indexOf("alpha-only near")).toBeLessThan(sys.indexOf("beta-only far"));
  });

  it("only queries compatible (ready) brains", async () => {
    await seedBrain({ id: "good", name: "Good", collectionName: "brain_good" });
    await seedBrain({ id: "bad", name: "Bad", collectionName: "brain_bad", embedderMatch: 0, status: "incompatible" });
    fakeStore.results.set("brain_good", [result("g1", "good corpus text", 0.1)]);
    await injectBrainContext({ brainIds: ["good", "bad"], userId, messages: baseMsgs });
    expect(fakeStore.semanticSearch).toHaveBeenCalledWith("brain_good", expect.any(String), expect.any(Number));
    expect(fakeStore.semanticSearch).not.toHaveBeenCalledWith("brain_bad", expect.any(String), expect.any(Number));
  });
});
