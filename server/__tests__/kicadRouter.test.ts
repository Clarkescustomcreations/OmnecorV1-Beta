/**
 * Integration tests for the KiCad bridge.
 *
 * Requires kicad-cli on PATH (KiCad 8+). Tests are automatically skipped when
 * kicad-cli is not installed. The DRC test writes a minimal .kicad_pcb fixture
 * to the system temp directory so validatePath in the router is bypassed —
 * the service is called directly for that case. Path validation itself is
 * already covered exhaustively in pathTraversal.test.ts.
 */

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { appRouter } from "../routers.js";
import { KiCadBridge } from "../phase2/services/KiCadService.js";
import { createTestDb, makeContext } from "./_helpers/trpcHarness.js";

// KiCad 8 PCB — 30 mm × 20 mm board with real copper:
//   - Net 1 "GND": horizontal F.Cu trace, transitions through a via to B.Cu,
//     then routes vertically — forming an L-shaped copper path across layers.
//   - Net 2 "VCC": short F.Cu stub trace (dangling — no pads).
// DRC will report unconnected/dangling-trace violations (expected on a bare
// copper fixture without footprints), proving the engine analysed copper not
// just the board outline. The test only checks result shape, not pass/fail.
const MINIMAL_PCB = `(kicad_pcb
  (version 20240108)
  (generator "pcbnew")
  (generator_version "8.0")
  (general
    (thickness 1.6)
    (legacy_teardrops no)
  )
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (44 "Edge.Cuts" user)
  )
  (setup
    (pad_to_mask_clearance 0)
    (allow_soldermask_bridges_in_footprints no)
    (pcbplotparams
      (layerselection 0x00010fc_ffffffff)
      (plot_on_all_layers_selection 0x0000000_00000000)
      (disableapertmacros no)
      (usegerberextensions no)
      (usegerberattributes yes)
      (usegerberadvancedattributes yes)
      (creategerberjobfile yes)
      (dashed_line_dash_ratio 12.000000)
      (dashed_line_gap_ratio 3.000000)
      (svgprecision 4)
      (plotframeref no)
      (viasonmask no)
      (mode 1)
      (useauxorigin no)
      (hpglpennumber 1)
      (hpglpenspeed 20)
      (hpglpendiameter 15.000000)
      (pdf_front_fp_property_popups yes)
      (pdf_back_fp_property_popups yes)
      (dxfpolygonmode yes)
      (dxfimperialunits yes)
      (dxfusepcbnewfont yes)
      (psnegative no)
      (psa4output no)
      (plotreference yes)
      (plotvalue yes)
      (plotfptext yes)
      (plotinvisibletext no)
      (sketchpadsonfab no)
      (subtractmaskfromsilk no)
      (outputformat 1)
      (mirror no)
      (drillshape 0)
      (scaleselection 1)
      (outputdirectory "")
    )
  )
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (gr_rect
    (start 0 0)
    (end 30 20)
    (stroke (width 0.05) (type solid))
    (layer "Edge.Cuts")
    (uuid "00000000-0000-0000-0000-000000000001")
  )
  (segment
    (start 3 5)
    (end 20 5)
    (width 0.25)
    (layer "F.Cu")
    (net 1)
    (uuid "00000000-0000-0000-0000-000000000002")
  )
  (via
    (at 20 5)
    (size 0.8)
    (drill 0.4)
    (layers "F.Cu" "B.Cu")
    (net 1)
    (uuid "00000000-0000-0000-0000-000000000003")
  )
  (segment
    (start 20 5)
    (end 20 15)
    (width 0.25)
    (layer "B.Cu")
    (net 1)
    (uuid "00000000-0000-0000-0000-000000000004")
  )
  (segment
    (start 3 15)
    (end 12 15)
    (width 0.25)
    (layer "F.Cu")
    (net 2)
    (uuid "00000000-0000-0000-0000-000000000005")
  )
)`;

// Probe kicad-cli at module load so describe.skipIf has a concrete boolean
const kicadInfo = await KiCadBridge.getInstance()
  .checkInstallation()
  .catch(() => ({
    isInstalled: false,
    version: null,
    cliPath: "kicad-cli",
    hasScriptingApi: false,
  }));

let fixturePath = "";
let fixtureDir = "";

describe.skipIf(!kicadInfo.isInstalled)("kicad bridge — installation, router, and DRC", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Write fixture to tmpdir — bypasses validatePath (not relevant to this test)
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnecor_kicad_test_"));
    fixturePath = path.join(fixtureDir, "test_board.kicad_pcb");
    await fs.writeFile(fixturePath, MINIMAL_PCB, "utf-8");

    const { db } = await createTestDb();
    h.db = db;
    // status is publicProcedure — user can be null
    const ctx = makeContext(null, db as never, { kicad: KiCadBridge.getInstance() });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    // Clean up fixture and any DRC output files written alongside it
    if (fixtureDir) await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("KiCadBridge.checkInstallation() reports isInstalled:true with a version string", () => {
    expect(kicadInfo.isInstalled).toBe(true);
    expect(typeof kicadInfo.version).toBe("string");
    expect(kicadInfo.version).toMatch(/\d+\.\d+/); // e.g. "8.0.3"
  });

  it("kicad.status via tRPC router returns the same installation shape", async () => {
    const status = await caller.kicad.status();
    expect(status.isInstalled).toBe(true);
    expect(status.version).toMatch(/\d+\.\d+/);
    expect(status.cliPath).toBeTruthy();
  });

  it(
    "KiCadBridge.runDRC() runs on a minimal fixture and returns a CheckResult",
    async () => {
      const result = await KiCadBridge.getInstance().runDRC(fixturePath);

      // Shape — every field must be present regardless of violation count
      expect(typeof result.passed).toBe("boolean");
      expect(typeof result.errors).toBe("number");
      expect(typeof result.warnings).toBe("number");
      expect(Array.isArray(result.violations)).toBe(true);

      // Each violation (if any) must have the expected fields
      for (const v of result.violations) {
        expect(["error", "warning"]).toContain(v.severity);
        expect(typeof v.message).toBe("string");
      }
    },
    30_000 // kicad-cli DRC can take a few seconds on first run
  );
});
