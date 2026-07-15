/**
 * BrainAuthoringService — the Phase 5 authoring / distillation pipeline.
 *
 * The heavy externals are faked (on-device embedder, web scraper, distillation
 * model) but the pipeline's own logic runs for real: chunking, sanitize-then-
 * distill ordering, provenance classification, `.obp` assembly, disk write, and
 * the live import through the REAL BrainPackService against an in-memory DB. The
 * Sovereign gate uses the REAL guard so cloud-distill blocking is genuinely tested.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema.js";
import type { Db } from "../../../db.js";

const { TEST_BRAINS_DIR } = vi.hoisted(() => ({
  // Built from globals only (no imports — this factory is hoisted above them).
  TEST_BRAINS_DIR: `${process.env.TMPDIR?.replace(/\/$/, "") || "/tmp"}/omnecor-brains-test-${process.pid}`,
}));

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../../../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

// Point the on-disk brains dir at a temp location (BrainPackService keeps its
// real EMBEDDING_CONFIG; only the userDir is redirected).
vi.mock("../../config/index.js", async importActual => {
  const actual = await importActual<typeof import("../../config/index.js")>();
  return { ...actual, BRAINS_CONFIG: { ...actual.BRAINS_CONFIG, userDir: TEST_BRAINS_DIR } };
});

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
    deleteCollection: vi.fn(async (name: string) => void collections.delete(name)),
  };
});
vi.mock("../VectorStore.js", () => ({ getVectorStore: () => fakeStore }));

// Deterministic on-device embedder fake (dim 384, one vector per input text).
const fakeEmbedder = vi.hoisted(() => ({
  dimensions: 384,
  init: vi.fn(async () => {}),
  embedBatch: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => Array.from({ length: 384 }, (_, d) => Math.sin(i + d) * 0.1))
  ),
}));
vi.mock("../EmbeddingService.js", () => ({
  EmbeddingService: { getInstance: () => fakeEmbedder },
}));

// Scraper fake — scripted per URL.
const scrapeResults = vi.hoisted(() => new Map<string, unknown>());
const fakeScrape = vi.hoisted(() => vi.fn(async (url: string) =>
  scrapeResults.get(url) ?? { url, title: "", content: "", success: false, error: "unmocked" }
));
vi.mock("../ScraperService.js", () => ({
  ScraperService: { getInstance: () => ({ scrape: fakeScrape }) },
}));

// Distillation model fake — returns a JSON array of instruction examples.
const fakeChat = vi.hoisted(() => vi.fn(async () =>
  JSON.stringify([{ instruction: "What guards nulls?", input: "", output: "Optional chaining." }])
));
vi.mock("../AiProviderService.js", () => ({
  AiProviderService: { getInstance: () => ({ chat: fakeChat }) },
}));

import { BrainAuthoringService } from "../BrainAuthoringService.js";
import { BrainPackService } from "../BrainPackService.js";
import { brains, brainChunks, users } from "../../../../drizzle/schema.js";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../../drizzle/migrations");
const svc = BrainAuthoringService.getInstance();
let db: Db;
let userId: number;

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  h.db = db;
  fakeStore.collections.clear();
  scrapeResults.clear();
  vi.clearAllMocks();
  const [u] = await db
    .insert(users)
    .values({ openId: `u-${Date.now()}`, email: "a@b.c", name: "A", role: "user", executionMode: "scrapper" })
    .returning();
  userId = u.id;
});

afterAll(async () => {
  await fsp.rm(TEST_BRAINS_DIR, { recursive: true, force: true });
});

describe("BrainAuthoringService.build", () => {
  it("builds a raw-ingest brain from pasted text (no distill), writes + imports it", async () => {
    const res = await svc.build(userId, {
      id: "notes",
      name: "Notes",
      domain: "general",
      charter: "Be concise.",
      sources: [{ text: "Optional chaining guards nulls in TypeScript.", name: "ts-notes" }],
    }, "scrapper");

    expect(res.rawChunks).toBe(1);
    expect(res.distilledChunks).toBe(0);
    expect(res.totalChunks).toBe(1);
    expect(res.embedderMatch).toBe(true);
    expect(fakeChat).not.toHaveBeenCalled();

    // File was written to the (redirected) brains dir.
    const stat = await fsp.stat(res.filePath);
    expect(stat.size).toBe(res.bytes);

    // Imported live: brain row + durable chunks + provenance "ingested".
    const [row] = await db.select().from(brains).where(eq(brains.id, "notes"));
    expect(row.status).toBe("ready");
    expect((row.provenance as { source: string }).source).toBe("ingested");
    const chunks = await db.select().from(brainChunks).where(eq(brainChunks.brainId, "notes"));
    expect(chunks).toHaveLength(1);
    expect(fakeStore.collections.get("brain_notes")?.size).toBe(1);
  });

  it("distills synthetic Q&A and records a 'mixed' provenance", async () => {
    const res = await svc.build(userId, {
      id: "coding",
      name: "Coding",
      domain: "coding",
      charter: "Write tests first.",
      sources: [{ text: "TypeScript null handling.", name: "src" }],
      distill: { providerId: "ollama", modelId: "qwen2.5-coder:7b", maxExamplesPerChunk: 2 },
    }, "scrapper");

    expect(fakeChat).toHaveBeenCalledTimes(1);
    expect(res.rawChunks).toBe(1);
    expect(res.distilledChunks).toBe(1);
    expect(res.totalChunks).toBe(2);

    const [row] = await db.select().from(brains).where(eq(brains.id, "coding"));
    expect((row.provenance as { source: string; model?: string }).source).toBe("mixed");
    expect((row.provenance as { model?: string }).model).toBe("qwen2.5-coder:7b");
    const chunks = await db.select().from(brainChunks).where(eq(brainChunks.brainId, "coding"));
    const kinds = chunks.map(c => (c.metadata as { kind?: string }).kind).sort();
    expect(kinds).toEqual(["distilled", "reference"]);
    const distilled = chunks.find(c => (c.metadata as { kind?: string }).kind === "distilled")!;
    expect(distilled.text).toContain("Q: What guards nulls?");
    expect(distilled.text).toContain("A: Optional chaining.");
  });

  it("scrapes URL sources, sanitizes them, and reports scrape failures", async () => {
    scrapeResults.set("https://good.example/doc", {
      url: "https://good.example/doc", title: "Doc", content: "Clean body text.", markdown: "# Doc\nClean body text.", success: true,
    });
    // https://bad.example/404 is left unmocked → failure.
    const res = await svc.build(userId, {
      id: "web",
      name: "Web",
      domain: "general",
      charter: "",
      sources: [{ url: "https://good.example/doc" }, { url: "https://bad.example/404" }],
    }, "scrapper");

    expect(fakeScrape).toHaveBeenCalledTimes(2);
    expect(res.scrapeFailures).toEqual(["https://bad.example/404"]);
    expect(res.rawChunks).toBe(1);
    const chunks = await db.select().from(brainChunks).where(eq(brainChunks.brainId, "web"));
    expect((chunks[0].metadata as { sourceUri?: string }).sourceUri).toBe("https://good.example/doc");
  });

  it("blocks a CLOUD distiller in Sovereign mode (before any work)", async () => {
    await expect(
      svc.build(userId, {
        id: "blocked",
        name: "Blocked",
        domain: "coding",
        charter: "x",
        sources: [{ text: "some text" }],
        distill: { providerId: "anthropic", modelId: "claude-3-5-sonnet-20241022" },
      }, "sovereign")
    ).rejects.toThrow(/Sovereign/i);
    // Nothing ran: no scrape, no embed, no import.
    expect(fakeEmbedder.embedBatch).not.toHaveBeenCalled();
    expect(await db.select().from(brains)).toHaveLength(0);
  });

  it("allows a LOCAL distiller in Sovereign mode", async () => {
    const res = await svc.build(userId, {
      id: "sov",
      name: "Sovereign Brain",
      domain: "coding",
      charter: "x",
      sources: [{ text: "local only knowledge" }],
      distill: { providerId: "ollama", modelId: "qwen2.5-coder:7b" },
    }, "sovereign");
    expect(res.embedderMatch).toBe(true);
    expect(fakeChat).toHaveBeenCalled();
  });

  it("can build a charter-only brain with no sources (empty corpus)", async () => {
    const res = await svc.build(userId, {
      id: "charteronly",
      name: "Charter Only",
      domain: "rules",
      charter: "Always cite sources.",
      sources: [],
    }, "scrapper");
    expect(res.totalChunks).toBe(0);
    const [row] = await db.select().from(brains).where(eq(brains.id, "charteronly"));
    expect(row.charter).toContain("Always cite sources");
    expect(row.chunkCount).toBe(0);
  });

  it("respects includeRawChunks:false (distilled corpus only)", async () => {
    const res = await svc.build(userId, {
      id: "distonly",
      name: "Distilled Only",
      domain: "coding",
      charter: "x",
      sources: [{ text: "TypeScript null handling." }],
      distill: { providerId: "ollama", modelId: "m" },
      includeRawChunks: false,
    }, "scrapper");
    expect(res.rawChunks).toBe(0);
    expect(res.distilledChunks).toBe(1);
    const [row] = await db.select().from(brains).where(eq(brains.id, "distonly"));
    expect((row.provenance as { source: string }).source).toBe("distilled");
  });
});
