/**
 * Batch D — DB schema-level behaviour tests (items 24 & 27 of the roadmap).
 *
 * These assert guarantees that live at the schema/persistence layer rather than
 * inside a single router:
 *
 *   24. `moeChainConfigs` is kept to **one row per (userId, chainType)**. There
 *       is no DB unique index on that pair — the invariant is enforced in
 *       application code (`_upsertMoeChain`: select-then-update-or-insert), so it
 *       is exercised here through the real `valet.saveMoeChain` / `getMoeChain`
 *       procedures (no projectPath → pure DB upsert, no .md side effect).
 *
 *   27. Deleting a `neuralMaps` row **cascades** to every child table that holds
 *       a `mapId`/`projectId` FK with `onDelete: "cascade"` (savedScripts,
 *       designProjects, curatedPosts, …). The harness runs SQLite with
 *       `PRAGMA foreign_keys = ON`, so this is a real cascade, and a second
 *       untouched map proves the cascade is scoped to the deleted map only.
 *
 * (Items 25 `savedScripts` CRUD + mapId scoping and 26 `neuralMaps` CRUD +
 * labelOverrides JSON are already covered by scriptsRouter.test.ts and
 * neuralMapsRouter.test.ts respectively.)
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

import { eq } from "drizzle-orm";
import { appRouter } from "../routers.js";
import {
  moeChainConfigs,
  neuralMaps,
  savedScripts,
  designProjects,
  curatedPosts,
} from "../../drizzle/schema.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

let store: TestDb;
let db: Db;

const step = (order: number, label: string) => ({
  order,
  label,
  taskCategories: ["general"],
  enabled: true,
});

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

// ── Item 24 — moeChainConfigs one-row-per-(userId, chainType) upsert ──────────
describe("moeChainConfigs — app-level upsert invariant (valet.saveMoeChain)", () => {
  it("re-saving the same chainType updates the existing row, never duplicates", async () => {
    const user = await seedUser(db);
    const caller = appRouter.createCaller(makeContext(user, db));

    await caller.valet.saveMoeChain({ chainType: "local", steps: [step(0, "First")] });
    await caller.valet.saveMoeChain({ chainType: "local", steps: [step(0, "Second"), step(1, "Third")] });

    const rows = await db.select().from(moeChainConfigs).where(eq(moeChainConfigs.userId, user.id));
    expect(rows).toHaveLength(1);

    const current = await caller.valet.getMoeChain({ chainType: "local" });
    expect(current?.steps).toHaveLength(2);
    expect(current?.steps?.[0]?.label).toBe("Second");
  });

  it("keeps a separate row per chainType for the same user", async () => {
    const user = await seedUser(db);
    const caller = appRouter.createCaller(makeContext(user, db));

    await caller.valet.saveMoeChain({ chainType: "local", steps: [step(0, "L")] });
    await caller.valet.saveMoeChain({ chainType: "cloud", steps: [step(0, "C")] });

    const rows = await db.select().from(moeChainConfigs).where(eq(moeChainConfigs.userId, user.id));
    expect(rows).toHaveLength(2);
    expect((await caller.valet.getMoeChain({ chainType: "local" }))?.steps?.[0]?.label).toBe("L");
    expect((await caller.valet.getMoeChain({ chainType: "cloud" }))?.steps?.[0]?.label).toBe("C");
  });

  it("isolates chain configs per user", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });

    await appRouter.createCaller(makeContext(alice, db)).valet.saveMoeChain({ chainType: "local", steps: [step(0, "alice")] });
    await appRouter.createCaller(makeContext(bob, db)).valet.saveMoeChain({ chainType: "local", steps: [step(0, "bob")] });

    expect((await appRouter.createCaller(makeContext(alice, db)).valet.getMoeChain({ chainType: "local" }))?.steps?.[0]?.label).toBe("alice");
    expect((await appRouter.createCaller(makeContext(bob, db)).valet.getMoeChain({ chainType: "local" }))?.steps?.[0]?.label).toBe("bob");
    expect(await db.select().from(moeChainConfigs)).toHaveLength(2);
  });
});

// ── Item 27 — FK cascade when a neuralMap is deleted ──────────────────────────
describe("neuralMaps delete — FK cascade to child tables", () => {
  async function seedMapWithChildren(mapId: string, userId: number) {
    await db.insert(neuralMaps).values({
      id: mapId,
      userId,
      name: `Map ${mapId}`,
      rootDirectories: [],
      settings: {},
    });
    await db.insert(savedScripts).values({ userId, mapId, name: "s", code: "print(1)" });
    await db.insert(designProjects).values({ userId, mapId, name: "board" });
    await db.insert(curatedPosts).values({ projectId: mapId, createdByUserId: userId, platform: "twitter" });
  }

  it("cascades to savedScripts, designProjects and curatedPosts — scoped to the deleted map", async () => {
    const user = await seedUser(db);
    await seedMapWithChildren("map-A", user.id);
    await seedMapWithChildren("map-B", user.id);

    // Sanity: both maps' children exist before the delete.
    expect(await db.select().from(savedScripts)).toHaveLength(2);
    expect(await db.select().from(designProjects)).toHaveLength(2);
    expect(await db.select().from(curatedPosts)).toHaveLength(2);

    await db.delete(neuralMaps).where(eq(neuralMaps.id, "map-A"));

    // map-A's children are gone…
    expect(await db.select().from(savedScripts).where(eq(savedScripts.mapId, "map-A"))).toHaveLength(0);
    expect(await db.select().from(designProjects).where(eq(designProjects.mapId, "map-A"))).toHaveLength(0);
    expect(await db.select().from(curatedPosts).where(eq(curatedPosts.projectId, "map-A"))).toHaveLength(0);

    // …while map-B's children are untouched (cascade is scoped, not global).
    expect(await db.select().from(savedScripts).where(eq(savedScripts.mapId, "map-B"))).toHaveLength(1);
    expect(await db.select().from(designProjects).where(eq(designProjects.mapId, "map-B"))).toHaveLength(1);
    expect(await db.select().from(curatedPosts).where(eq(curatedPosts.projectId, "map-B"))).toHaveLength(1);
  });
});
