/**
 * Blueprint Studio — Build Plan PDF booklet tests (`buildPlanPdf`).
 *
 * Asserts the exporter produces a structurally valid multi-section PDF, embeds
 * a drawing SVG, transliterates the Greek/math glyphs that appear in calc
 * `workings` (pdfkit's Helvetica is WinAnsi — raw σ/τ/δ/⁴/≥/✓ would mojibake or
 * throw), and survives an empty plan.
 */
import { describe, it, expect } from "vitest";
import { buildPlanPdf } from "../core_services/blueprint/planPdf.js";
import type { BlueprintBomItem, BlueprintCutItem, BlueprintPlan, BlueprintSimResult } from "../../drizzle/schema.js";

const plan = {
  id: "p1",
  userId: 1,
  mapId: null,
  title: "Welding table",
  brief: "4×2 ft steel welding table, 500 lb capacity",
  category: "metal_fab",
  status: "ready",
  units: "imperial",
  cadEngine: "jscad",
  overview: "## Design\nWelded 2×2 steel frame with a 1/4in plate top. Breaks down into two halves.",
  assemblySteps: [{ title: "Cut legs", detail: "Cut 4 legs to length with a 45° miter.", parts: ["Leg"], tools: ["chop saw"] }],
  safetyNotes: "Wear a welding mask and gloves. Grind all sharp edges.",
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as BlueprintPlan;

const bomItems = [
  { id: "b1", planId: "p1", kind: "material", name: "2×2 square tube", materialKey: "steel.sq_tube_2x2_120", spec: "0.120 wall, 24 ft", quantity: 2, unit: "pcs", unitCost: 130, currency: "USD", supplier: "Metal Supermarket", url: null, notes: null, sortOrder: 0, createdAt: new Date() },
  { id: "b2", planId: "p1", kind: "hardware", name: "M10 bolts", materialKey: null, spec: "grade 8.8", quantity: 16, unit: "pcs", unitCost: 0.6, currency: "USD", supplier: null, url: null, notes: null, sortOrder: 1, createdAt: new Date() },
] as unknown as BlueprintBomItem[];

const cutItems = [
  { id: "c1", planId: "p1", partLabel: "Leg", stockName: "2×2 tube", materialKey: null, quantity: 4, lengthMm: 850, widthMm: null, thicknessMm: null, miter1Deg: 45, bevel1Deg: null, miter2Deg: 45, bevel2Deg: null, notes: "both ends mitered", sortOrder: 0, createdAt: new Date() },
] as unknown as BlueprintCutItem[];

// Workings deliberately carry the WinAnsi-unsafe glyphs the transliteration must handle.
const simResults = [
  {
    id: "s1",
    planId: "p1",
    kind: "calc",
    name: "Top rail bending @ 230 kg midspan",
    status: "completed",
    inputs: {},
    results: {
      safetyFactor: 12.54,
      pass: true,
      workings: ["σ = M/S = 4.2 MPa", "δ = 0.97 mm ≤ L/240", "π²EI term ⁴ ✓", "SF = 12.54 ≥ 1.67"],
    },
    jobId: null,
    fileId: null,
    createdAt: new Date(),
  },
] as unknown as BlueprintSimResult[];

const drawings = [
  {
    name: "Leg",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect x="10" y="10" width="100" height="100" fill="none" stroke="black"/></svg>',
  },
];

describe("buildPlanPdf", () => {
  it("produces a valid PDF booklet with an embedded drawing", async () => {
    const pdf = await buildPlanPdf({ plan, bomItems, cutItems, simResults, drawings });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("transliterates Greek/math glyphs in workings without throwing", async () => {
    const pdf = await buildPlanPdf({ plan, bomItems: [], cutItems: [], simResults, drawings: [] });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("survives an empty plan (no BOM/cut/sim/drawings)", async () => {
    const empty = { ...plan, overview: "", safetyNotes: "", assemblySteps: null } as unknown as BlueprintPlan;
    const pdf = await buildPlanPdf({ plan: empty, bomItems: [], cutItems: [], simResults: [], drawings: [] });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
