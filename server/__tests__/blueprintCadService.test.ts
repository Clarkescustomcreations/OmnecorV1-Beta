/**
 * Blueprint Studio CAD pipeline tests — the JSCAD in-process engine, mesh
 * math (volume/area/bounds via real geometry), STL round-trip, feature-edge
 * projection for drawings, drawing/DXF generation, seam-allowance offsetting
 * and the tiled pattern PDF. OpenSCAD (external binary) is exercised only at
 * the status level so the suite runs on machines without it.
 */
import { describe, it, expect } from "vitest";
import { BlueprintCadService } from "../core_services/blueprint/BlueprintCadService.js";
import {
  computeVolumeMm3,
  extractFeatureEdges,
  meshToStlBinary,
  parseStl,
  projectEdges,
  toMeshJson,
} from "../core_services/blueprint/meshUtils.js";
import { buildDrawingSvg, buildDxf } from "../core_services/blueprint/drawingSvg.js";
import { parseDxf2d, outlineSvg } from "../core_services/blueprint/geometryImport.js";
import { offsetPolygon, buildPatternPdf } from "../core_services/blueprint/patternPdf.js";
import { buildTextToolSystemPrompt } from "../core_services/services/ChatAgentRunner.js";
import type { ToolDefinition } from "../core_services/services/toolSchemas.js";

const svc = BlueprintCadService.getInstance();

const CUBE_CODE = `
const { cuboid } = jscad.primitives;
function main() {
  return cuboid({ size: [10, 20, 30] });
}
`;

describe("BlueprintCadService — JSCAD engine", () => {
  it("compiles a cuboid with exact volume, bounds and mass", async () => {
    const { parts } = await svc.compile("jscad", CUBE_CODE, { partName: "block", densityKgM3: 1000 });
    expect(parts).toHaveLength(1);
    const p = parts[0];
    expect(p.name).toBe("block");
    expect(p.mesh.volumeMm3).toBeCloseTo(6000, 3);
    const { min, max } = p.mesh.boundsMm;
    expect(max[0] - min[0]).toBeCloseTo(10, 5);
    expect(max[1] - min[1]).toBeCloseTo(20, 5);
    expect(max[2] - min[2]).toBeCloseTo(30, 5);
    // 6000 mm³ at 1000 kg/m³ = 6 g
    expect(p.massG).toBeCloseTo(6, 3);
    expect(p.mesh.surfaceAreaMm2).toBeCloseTo(2 * (10 * 20 + 10 * 30 + 20 * 30), 2);
  });

  it("returns named multi-part assemblies", async () => {
    const code = `
const { cuboid, cylinder } = jscad.primitives;
const { translate } = jscad.transforms;
function main() {
  return [
    { name: "base", geometry: cuboid({ size: [40, 40, 5] }) },
    { name: "post", geometry: translate([0, 0, 20], cylinder({ radius: 5, height: 35 })) },
  ];
}
`;
    const { parts } = await svc.compile("jscad", code, {});
    expect(parts.map((p) => p.name)).toEqual(["base", "post"]);
    // Cylinder volume ≈ πr²h (within the segment approximation).
    expect(parts[1].mesh.volumeMm3! / (Math.PI * 25 * 35)).toBeGreaterThan(0.98);
  });

  it("supports booleans (subtract leaves the difference volume)", async () => {
    const code = `
const { cuboid } = jscad.primitives;
const { subtract } = jscad.booleans;
function main() {
  return subtract(cuboid({ size: [20, 20, 20] }), cuboid({ size: [10, 10, 30] }));
}
`;
    const { parts } = await svc.compile("jscad", code, {});
    expect(parts[0].mesh.volumeMm3).toBeCloseTo(20 ** 3 - 10 * 10 * 20, 1);
  });

  it("captures console.log output into the compile log", async () => {
    const code = `
const { cuboid } = jscad.primitives;
function main() {
  console.log("designing", 42);
  return cuboid({ size: [1, 1, 1] });
}
`;
    const { log } = await svc.compile("jscad", code, {});
    expect(log).toContain("designing 42");
  });

  it("rejects scripts without main() and scripts producing no solids", async () => {
    await expect(svc.compile("jscad", "const x = 1;", {})).rejects.toThrow(/main\(\)/);
    await expect(svc.compile("jscad", "function main() { return 42; }", {})).rejects.toThrow(/no 3D geometry/);
  });

  it("does not expose process/require inside the sandbox", async () => {
    await expect(svc.compile("jscad", `function main() { return require("fs"); }`, {})).rejects.toThrow();
    await expect(svc.compile("jscad", `function main() { return process.env; }`, {})).rejects.toThrow();
  });

  it("reports OpenSCAD engine status without throwing when absent", async () => {
    const status = await svc.getEngineStatus();
    expect(status.jscad.available).toBe(true);
    expect(typeof status.openscad.available).toBe("boolean");
    expect(status.openscad.path.length).toBeGreaterThan(0);
  });
});

describe("meshUtils — STL round-trip and projections", () => {
  it("binary STL round-trips triangle count and volume", async () => {
    const { parts } = await svc.compile("jscad", CUBE_CODE, {});
    const mesh = parts[0].mesh;
    const stl = meshToStlBinary(mesh.positions, mesh.indices, "block");
    const parsed = parseStl(stl);
    expect(parsed.indices.length).toBe(mesh.indices.length);
    expect(computeVolumeMm3(parsed.positions, parsed.indices)).toBeCloseTo(6000, 2);
  });

  it("parses ASCII STL too", () => {
    // One right triangle in the z=0 plane.
    const ascii = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid t`;
    const parsed = parseStl(Buffer.from(ascii, "ascii"));
    expect(parsed.indices.length).toBe(3);
    expect(parsed.positions.length).toBe(9);
  });

  it("extracts exactly the 12 hard edges of a cube and projects a rectangle", async () => {
    const { parts } = await svc.compile("jscad", CUBE_CODE, {});
    const mesh = parts[0].mesh;
    const edges = extractFeatureEdges(mesh.positions, mesh.indices);
    expect(edges.length).toBe(12); // face diagonals are coplanar → excluded
    const front = projectEdges(mesh.positions, edges, "front");
    // Front view of a cuboid: the 4 outline edges survive; the 4 depth edges
    // project to points and are dropped; the remaining 4 dedupe onto the outline.
    expect(front.length).toBe(4);
  });
});

describe("drawing + DXF generation", () => {
  it("builds a three-view SVG with real dimensions in the title block", async () => {
    const { parts } = await svc.compile("jscad", CUBE_CODE, {});
    const svg = buildDrawingSvg(parts[0].mesh, { partName: "block", planTitle: "Test Plan", units: "metric" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("FRONT");
    expect(svg).toContain("TOP");
    expect(svg).toContain("RIGHT");
    expect(svg).toContain("10.0 mm");
    expect(svg).toContain("30.0 mm");
    expect(svg).toContain("OMNECOR BLUEPRINT STUDIO");
  });

  it("formats imperial dimensions as feet/inches", async () => {
    const code = `
const { cuboid } = jscad.primitives;
function main() { return cuboid({ size: [609.6, 100, 100] }); } // 24 in wide
`;
    const { parts } = await svc.compile("jscad", code, {});
    const svg = buildDrawingSvg(parts[0].mesh, { partName: "board", planTitle: "Test", units: "imperial" });
    expect(svg).toContain("2&apos;"); // 2 ft
  });

  it("emits valid minimal DXF entities", async () => {
    const { parts } = await svc.compile("jscad", CUBE_CODE, {});
    const mesh = parts[0].mesh;
    const edges = extractFeatureEdges(mesh.positions, mesh.indices);
    const dxf = buildDxf(projectEdges(mesh.positions, edges, "front"));
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
    expect((dxf.match(/\nLINE\n/g) ?? []).length).toBe(4);
    expect(dxf.trim().endsWith("EOF")).toBe(true);
  });
});

describe("pattern generation", () => {
  it("offsets a square outward by the seam allowance", () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const offset = offsetPolygon(square, 10);
    const xs = offset.map((p) => p[0]);
    const ys = offset.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, 4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(120, 4);
  });

  it("builds a multi-page 1:1 pattern PDF", async () => {
    const pdf = await buildPatternPdf(
      [
        {
          name: "Chest panel",
          outline: { name: "Chest panel", points: [[0, 0], [350, 0], [400, 250], [200, 420], [0, 260]] },
          seamAllowanceMm: 12,
          cutNote: "Cut 2 mirrored — main fabric",
        },
        {
          name: "Shoulder",
          outline: { name: "Shoulder", points: [[0, 0], [180, 0], [180, 120], [0, 120]] },
          seamAllowanceMm: 0,
        },
      ],
      { planTitle: "Armor set", setName: "Torso" },
    );
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it("refuses an empty piece set", async () => {
    await expect(buildPatternPdf([], { planTitle: "x", setName: "y" })).rejects.toThrow();
  });
});

describe("geometry import — DXF reader", () => {
  it("parses LINE + LWPOLYLINE entities into segments with correct bounds", () => {
    const dxf = "0\nLINE\n10\n0\n20\n0\n11\n100\n21\n0\n0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n10\n50\n20\n0\n10\n50\n20\n30\n0\nEOF\n";
    const parsed = parseDxf2d(dxf);
    // 1 LINE + a closed 3-vertex polyline (2 open edges + 1 closing) = 4 segments.
    expect(parsed.segments).toHaveLength(4);
    expect(parsed.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 30 });

    const svg = outlineSvg(parsed, { title: "panel", units: "metric" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("<line");
    expect(svg).toContain("panel");
  });

  it("returns no segments for a DXF with no drawable entities", () => {
    const parsed = parseDxf2d("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n");
    expect(parsed.segments).toHaveLength(0);
    expect(parsed.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("does not treat an open polyline as closed", () => {
    // Same 3 vertices, no code-70 closed flag → only 2 segments.
    const dxf = "0\nLWPOLYLINE\n10\n0\n20\n0\n10\n50\n20\n0\n10\n50\n20\n30\n0\nEOF\n";
    expect(parseDxf2d(dxf).segments).toHaveLength(2);
  });
});

describe("ChatAgentRunner extraTools prompt integration", () => {
  const extra: ToolDefinition = {
    name: "engineering_calc",
    description: "Run a deterministic engineering calculation.",
    parameters: {
      type: "object",
      properties: {
        calc: { type: "string", description: "Which calculation to run." },
        params: { type: "object", description: "Calculation parameters." },
      },
      required: ["calc", "params"],
      additionalProperties: false,
    },
  };

  it("keeps the proven built-in wording unchanged by default", () => {
    const prompt = buildTextToolSystemPrompt();
    expect(prompt).toContain('"edit_file"');
    expect(prompt).toContain('"run_command"');
    expect(prompt).toContain('"start_job"');
    expect(prompt).not.toContain("delegate_task");
  });

  it("renders injected tools with field docs", () => {
    const prompt = buildTextToolSystemPrompt(undefined, false, [extra], true);
    expect(prompt).toContain('"engineering_calc"');
    expect(prompt).toContain('"calc" (string, required)');
    expect(prompt).toContain('4. "engineering_calc"'); // numbered after the 3 built-ins
  });

  it("omits built-ins entirely for domain-only runs and adapts the example", () => {
    const prompt = buildTextToolSystemPrompt(undefined, false, [extra], false);
    expect(prompt).not.toContain('"edit_file"');
    expect(prompt).toContain('1. "engineering_calc"');
    expect(prompt).toContain('{"action":"engineering_calc"');
  });
});
