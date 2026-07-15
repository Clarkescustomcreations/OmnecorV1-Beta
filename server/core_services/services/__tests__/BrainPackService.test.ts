/**
 * BrainPackService — import / persist / embedder-match / delete / export / rebuild.
 *
 * Backs the service with the REAL in-memory libSQL DB (full schema + migrations,
 * FK cascade ON) so `brains` / `brain_chunks` persistence and the cascade delete
 * genuinely execute. The vector store is replaced with a lightweight in-memory
 * fake — the packs carry PREBUILT embeddings, so no on-device embedder is needed
 * and the service's own logic (compatibility gating, durable chunk store,
 * collection lifecycle) is what's under test.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema.js";
import type { Db } from "../../../db.js";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../../../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

// In-memory fake vector store — records collections + docs by stable id.
const fakeStore = vi.hoisted(() => {
  const collections = new Map<string, Map<string, unknown>>();
  return {
    collections,
    getOrCreateCollection: vi.fn(async (name: string) => {
      if (!collections.has(name)) collections.set(name, new Map());
      return name;
    }),
    addDocumentsWithEmbeddings: vi.fn(
      async (name: string, docs: Array<{ id: string; embedding: number[] }>) => {
        const c = collections.get(name) ?? new Map();
        for (const d of docs) {
          if (d.embedding.length !== 384) throw new Error(`bad dim ${d.embedding.length}`);
          c.set(d.id, d);
        }
        collections.set(name, c);
      }
    ),
    deleteCollection: vi.fn(async (name: string) => {
      collections.delete(name);
    }),
  };
});
vi.mock("../VectorStore.js", () => ({
  getVectorStore: () => fakeStore,
}));

import { BrainPackService } from "../BrainPackService.js";
import { EMBEDDING_CONFIG } from "../../config/index.js";
import { packBrain, type PackBrainInput } from "../../brains/obpFormat.js";
import { brains, brainChunks, users } from "../../../../drizzle/schema.js";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../../drizzle/migrations");
const svc = BrainPackService.getInstance();
let db: Db;
let userId: number;

function vec(dim: number, seed: number): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i) * 0.1);
}

function makePack(over: Partial<PackBrainInput> = {}): Buffer {
  const dim = over.embedder?.dim ?? EMBEDDING_CONFIG.dimensions;
  return packBrain({
    id: "coding",
    name: "Coding",
    version: "1.0.0",
    domain: "coding",
    embedder: { id: EMBEDDING_CONFIG.modelId, dim: EMBEDDING_CONFIG.dimensions },
    charter: "Write tests first.",
    chunks: [
      { id: "c1", text: "guard nulls with optional chaining", metadata: { topic: "ts" }, embedding: vec(dim, 1) },
      { id: "c2", text: "memoize react renders", metadata: { topic: "react" }, embedding: vec(dim, 2) },
    ],
    ...over,
  });
}

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  h.db = db;
  fakeStore.collections.clear();
  vi.clearAllMocks();
  const [u] = await db
    .insert(users)
    .values({ openId: `u-${Date.now()}`, email: "a@b.c", name: "A", role: "user", executionMode: "scrapper" })
    .returning();
  userId = u.id;
});

describe("BrainPackService — import (embedder match)", () => {
  it("persists the brain row, chunk rows, and loads the vector index", async () => {
    const res = await svc.importFromBuffer(userId, makePack());
    expect(res.embedderMatch).toBe(true);
    expect(res.brain.status).toBe("ready");
    expect(res.chunksStored).toBe(2);
    expect(res.vectorsLoaded).toBe(2);

    const rows = await db.select().from(brains).where(eq(brains.id, "coding"));
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].embedderMatch).toBe(1);
    expect(rows[0].collectionName).toBe("brain_coding");

    const chunks = await db.select().from(brainChunks).where(eq(brainChunks.brainId, "coding"));
    expect(chunks.map(c => c.chunkId).sort()).toEqual(["c1", "c2"]);

    // Vector index got the real docs.
    expect(fakeStore.collections.get("brain_coding")?.size).toBe(2);
  });

  it("re-import replaces prior chunks and collection (idempotent)", async () => {
    await svc.importFromBuffer(userId, makePack());
    // Second import with a different chunk set under the same id.
    await svc.importFromBuffer(
      userId,
      makePack({ chunks: [{ id: "c9", text: "new content", embedding: vec(EMBEDDING_CONFIG.dimensions, 9) }] })
    );
    const chunks = await db.select().from(brainChunks).where(eq(brainChunks.brainId, "coding"));
    expect(chunks.map(c => c.chunkId)).toEqual(["c9"]);
    expect(fakeStore.deleteCollection).toHaveBeenCalledWith("brain_coding");
    expect(fakeStore.collections.get("brain_coding")?.has("c9")).toBe(true);
    expect(fakeStore.collections.get("brain_coding")?.has("c1")).toBe(false);
  });
});

describe("BrainPackService — import (embedder mismatch)", () => {
  it("flags an incompatible pack and does NOT index its corpus", async () => {
    const res = await svc.importFromBuffer(
      userId,
      makePack({ embedder: { id: "some-other-model", dim: EMBEDDING_CONFIG.dimensions } })
    );
    expect(res.embedderMatch).toBe(false);
    expect(res.brain.status).toBe("incompatible");
    expect(res.vectorsLoaded).toBe(0);
    // Chunks are still persisted durably (charter + corpus survive for rebuild).
    expect(res.chunksStored).toBe(2);
    const chunks = await db.select().from(brainChunks).where(eq(brainChunks.brainId, "coding"));
    expect(chunks.length).toBe(2);
    // But nothing was pushed to the vector index.
    expect(fakeStore.addDocumentsWithEmbeddings).not.toHaveBeenCalled();
    expect(fakeStore.collections.has("brain_coding")).toBe(false);
  });

  it("flags a dimension-mismatched pack incompatible", async () => {
    const res = await svc.importFromBuffer(
      userId,
      makePack({ embedder: { id: EMBEDDING_CONFIG.modelId, dim: 128 } })
    );
    expect(res.embedderMatch).toBe(false);
    expect(res.brain.embedderDim).toBe(128);
    expect(res.brain.status).toBe("incompatible");
  });
});

describe("BrainPackService — read / delete / export / rebuild", () => {
  it("lists and scopes brains by user", async () => {
    await svc.importFromBuffer(userId, makePack());
    const [other] = await db
      .insert(users)
      .values({ openId: `u2-${Date.now()}`, email: "x@y.z", name: "B", role: "user", executionMode: "scrapper" })
      .returning();
    expect(await svc.list(userId)).toHaveLength(1);
    expect(await svc.list(other.id)).toHaveLength(0);
    expect(await svc.get(other.id, "coding")).toBeNull();
  });

  it("refuses to clobber another user's brain of the same id", async () => {
    await svc.importFromBuffer(userId, makePack());
    const [other] = await db
      .insert(users)
      .values({ openId: `u3-${Date.now()}`, email: "p@q.r", name: "C", role: "user", executionMode: "scrapper" })
      .returning();
    await expect(svc.importFromBuffer(other.id, makePack())).rejects.toThrow(/belongs to another user/i);
  });

  it("reports stats", async () => {
    await svc.importFromBuffer(userId, makePack());
    const stats = await svc.stats(userId, "coding");
    expect(stats).toMatchObject({ domain: "coding", status: "ready", embedderMatch: true, chunkCount: 2, indexedCount: 2 });
  });

  it("delete drops the collection and cascade-removes chunks", async () => {
    await svc.importFromBuffer(userId, makePack());
    expect(await svc.delete(userId, "coding")).toBe(true);
    expect(await db.select().from(brains).where(eq(brains.id, "coding"))).toHaveLength(0);
    expect(await db.select().from(brainChunks).where(eq(brainChunks.brainId, "coding"))).toHaveLength(0);
    expect(fakeStore.deleteCollection).toHaveBeenCalledWith("brain_coding");
  });

  it("delete of another user's brain returns false and changes nothing", async () => {
    await svc.importFromBuffer(userId, makePack());
    const [other] = await db
      .insert(users)
      .values({ openId: `u4-${Date.now()}`, email: "s@t.u", name: "D", role: "user", executionMode: "scrapper" })
      .returning();
    expect(await svc.delete(other.id, "coding")).toBe(false);
    expect(await db.select().from(brains).where(eq(brains.id, "coding"))).toHaveLength(1);
  });

  it("export round-trips a stored brain back to a valid .obp", async () => {
    await svc.importFromBuffer(userId, makePack());
    const buf = await svc.export(userId, "coding");
    // Re-import the exported pack under a fresh DB → identical structure.
    const { unpackBrain } = await import("../../brains/obpFormat.js");
    const pack = unpackBrain(buf);
    expect(pack.manifest.id).toBe("coding");
    expect(pack.manifest.chunkCount).toBe(2);
    expect(pack.chunks.map(c => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("rebuildIndex reloads vectors from the durable chunk store", async () => {
    await svc.importFromBuffer(userId, makePack());
    fakeStore.collections.clear(); // simulate a lost/rebuilt index
    const res = await svc.rebuildIndex(userId, "coding");
    expect(res.status).toBe("ready");
    expect(res.vectorsLoaded).toBe(2);
    expect(fakeStore.collections.get("brain_coding")?.size).toBe(2);
  });
});
