/**
 * Unit tests for the main-chat Blueprint integration (de-isolation):
 *  - `buildChatBlueprintTools` — create_blueprint attaches to the active Project
 *    or bootstraps a new one; the domain tools resolve the conversation's active
 *    plan (erroring before one is opened); open_blueprint resumes an existing plan.
 *  - `injectBlueprintContext` — attached Build Plans become chat context, gated by
 *    the map's enableAIContext, passthrough when there's nothing to add.
 *
 * Real in-memory libSQL via the shared harness (actual schema + migrations), with
 * `getDb` redirected to it — the tools/injector run their real DB writes/reads.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

import { and, eq } from "drizzle-orm";
import { blueprintBomItems, blueprintPlans, neuralMaps } from "../../drizzle/schema.js";
import { buildChatBlueprintTools, resolveProjectMap, type CreateBlueprintResult } from "../core_services/blueprint/chatBlueprintTools.js";
import { getDb } from "../db.factory.js";
import { injectBlueprintContext } from "../_core/blueprintContext.js";
import { createTestDb, seedUser, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

let store: TestDb;
let db: Db;
let alice: Awaited<ReturnType<typeof seedUser>>;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  alice = await seedUser(db, { name: "Alice" });
});

async function seedMap(overrides: Partial<typeof neuralMaps.$inferInsert> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  await db.insert(neuralMaps).values({
    id,
    userId: alice.id,
    name: overrides.name ?? "My Project",
    mode: "standard",
    rootDirectories: [],
    settings: (overrides.settings as Record<string, unknown>) ?? { enableAIContext: true },
    projectContext: overrides.projectContext ?? null,
  });
  return id;
}

const tool = (tools: ReturnType<typeof buildChatBlueprintTools>, name: string) => {
  const t = tools.find((x) => x.definition.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
};

describe("buildChatBlueprintTools — create_blueprint", () => {
  it("attaches the plan to the active map when one is provided", async () => {
    const mapId = await seedMap({ name: "Garage builds" });
    const tools = buildChatBlueprintTools({ userId: alice.id, activeMapId: mapId });
    const raw = await tool(tools, "create_blueprint").execute({ title: "Welding table", brief: "500 lb steel top" });
    const res = JSON.parse(raw) as CreateBlueprintResult;

    expect(res.mapCreated).toBe(false);
    expect(res.mapId).toBe(mapId);
    const [plan] = await db.select().from(blueprintPlans).where(eq(blueprintPlans.id, res.planId));
    expect(plan.mapId).toBe(mapId);
    expect(plan.title).toBe("Welding table");
    expect(plan.userId).toBe(alice.id);
  });

  it("bootstraps a NEW Project when no map is active", async () => {
    const tools = buildChatBlueprintTools({ userId: alice.id });
    const raw = await tool(tools, "create_blueprint").execute({ title: "Go-kart frame", brief: "single seat" });
    const res = JSON.parse(raw) as CreateBlueprintResult;

    expect(res.mapCreated).toBe(true);
    expect(res.mapName).toBe("Go-kart frame");
    const [map] = await db.select().from(neuralMaps).where(eq(neuralMaps.id, res.mapId));
    expect(map.userId).toBe(alice.id);
    expect((map.projectContext as Record<string, unknown>)?.description).toBe("single seat");
    const [plan] = await db.select().from(blueprintPlans).where(eq(blueprintPlans.id, res.planId));
    expect(plan.mapId).toBe(res.mapId);
  });

  it("bootstraps a new Project when the active map id is a phantom (not this user's)", async () => {
    const tools = buildChatBlueprintTools({ userId: alice.id, activeMapId: "does-not-exist" });
    const res = JSON.parse(await tool(tools, "create_blueprint").execute({ title: "Shelf" })) as CreateBlueprintResult;
    expect(res.mapCreated).toBe(true);
    expect(res.mapId).not.toBe("does-not-exist");
  });
});

describe("buildChatBlueprintTools — domain tool plan resolution", () => {
  it("domain tools error before a plan is opened, then succeed after create_blueprint", async () => {
    const tools = buildChatBlueprintTools({ userId: alice.id });
    const setBom = tool(tools, "set_bom");
    await expect(setBom.execute({ items: [{ name: "Steel tube", quantity: 4, unit: "stick" }] })).rejects.toThrow(
      /create_blueprint first/i,
    );

    const res = JSON.parse(await tool(tools, "create_blueprint").execute({ title: "Bench" })) as CreateBlueprintResult;
    const msg = await setBom.execute({ items: [{ name: "Steel tube", quantity: 4, unit: "stick" }] });
    expect(msg).toMatch(/BOM/i);
    const rows = await db.select().from(blueprintBomItems).where(eq(blueprintBomItems.planId, res.planId));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Steel tube");
  });

  it("open_blueprint resumes an existing owned plan", async () => {
    const mapId = await seedMap();
    const first = buildChatBlueprintTools({ userId: alice.id, activeMapId: mapId });
    const created = JSON.parse(await tool(first, "create_blueprint").execute({ title: "Cabinet" })) as CreateBlueprintResult;

    // A fresh tool set (new conversation) has no active plan until open_blueprint.
    const second = buildChatBlueprintTools({ userId: alice.id, activeMapId: mapId });
    await tool(second, "open_blueprint").execute({ planId: created.planId });
    const msg = await tool(second, "set_bom").execute({ items: [{ name: "Ply", quantity: 2, unit: "sheet" }] });
    expect(msg).toMatch(/BOM/i);
  });

  it("open_blueprint rejects a plan owned by someone else", async () => {
    const bob = await seedUser(db, { name: "Bob", email: "bob@x.com" });
    const bobTools = buildChatBlueprintTools({ userId: bob.id });
    const bobPlan = JSON.parse(await tool(bobTools, "create_blueprint").execute({ title: "Bob's" })) as CreateBlueprintResult;

    const aliceTools = buildChatBlueprintTools({ userId: alice.id });
    await expect(tool(aliceTools, "open_blueprint").execute({ planId: bobPlan.planId })).rejects.toThrow(/isn't yours|not/i);
  });
});

describe("resolveProjectMap (shared Studio + chat map bootstrap)", () => {
  it("returns an existing owned map untouched", async () => {
    const mapId = await seedMap({ name: "Existing" });
    const db = await getDb();
    const r = await resolveProjectMap(db, alice.id, { mapId, fallbackName: "x" });
    expect(r).toEqual({ mapId, mapCreated: false, mapName: "Existing" });
  });

  it("creates a map with newMapName + brief when none is given", async () => {
    const db = await getDb();
    const r = await resolveProjectMap(db, alice.id, { newMapName: "Shop Builds", brief: "welded steel", fallbackName: "fallback" });
    expect(r.mapCreated).toBe(true);
    expect(r.mapName).toBe("Shop Builds");
    const [map] = await db.select().from(neuralMaps).where(eq(neuralMaps.id, r.mapId));
    expect((map.projectContext as Record<string, unknown>)?.description).toBe("welded steel");
  });

  it("falls back to fallbackName when newMapName is blank", async () => {
    const db = await getDb();
    const r = await resolveProjectMap(db, alice.id, { newMapName: "   ", fallbackName: "My Plan" });
    expect(r.mapName).toBe("My Plan");
  });
});

describe("injectBlueprintContext", () => {
  const base = { role: "user" as const, content: "what did we plan?" };

  it("injects attached plans when enableAIContext is on", async () => {
    const mapId = await seedMap({ settings: { enableAIContext: true } });
    const tools = buildChatBlueprintTools({ userId: alice.id, activeMapId: mapId });
    await tool(tools, "create_blueprint").execute({ title: "Welding table", brief: "steel" });

    const out = await injectBlueprintContext({ mapId, userId: alice.id, messages: [base], systemPrompt: "sys" });
    expect(out.injected).toBe(true);
    expect(out.systemPrompt).toMatch(/Welding table/);
    expect(out.messages.some((m) => m.role === "system" && /Attached Build Plans/.test(m.content))).toBe(true);
  });

  it("is a passthrough when enableAIContext is off", async () => {
    const mapId = await seedMap({ settings: { enableAIContext: false } });
    const tools = buildChatBlueprintTools({ userId: alice.id, activeMapId: mapId });
    await tool(tools, "create_blueprint").execute({ title: "Hidden plan" });

    const out = await injectBlueprintContext({ mapId, userId: alice.id, messages: [base], systemPrompt: "sys" });
    expect(out.injected).toBe(false);
    expect(out.systemPrompt).toBe("sys");
  });

  it("is a passthrough when the map has no plans, or no map/user is given", async () => {
    const mapId = await seedMap();
    expect((await injectBlueprintContext({ mapId, userId: alice.id, messages: [base] })).injected).toBe(false);
    expect((await injectBlueprintContext({ mapId: undefined, userId: alice.id, messages: [base] })).injected).toBe(false);
    expect((await injectBlueprintContext({ mapId, userId: null, messages: [base] })).injected).toBe(false);
  });

  it("does not leak another user's plans through their map id", async () => {
    const mapId = await seedMap();
    const bob = await seedUser(db, { name: "Bob", email: "bob2@x.com" });
    // Bob asking with Alice's map id must see nothing (ownership filter).
    const out = await injectBlueprintContext({ mapId, userId: bob.id, messages: [base] });
    expect(out.injected).toBe(false);
  });
});
