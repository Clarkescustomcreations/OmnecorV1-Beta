/**
 * Golden-value tests for the Blueprint Studio deterministic calc engine.
 *
 * Every closed-form result is checked against hand-computed textbook values —
 * these are the numbers users cut wood and steel by, so the tolerance is tight.
 */
import { describe, it, expect } from "vitest";
import {
  beamAnalysis,
  boardFeet,
  boltedConnection,
  columnBuckling,
  compoundMiter,
  fabricYardage,
  fastenerGroupCheck,
  filletWeld,
  heatCheck,
  massG,
  mmFromIn,
  nFromKg,
  nFromLbf,
  nest1D,
  nest2D,
  printedPart,
  rafterCalc,
  rectSection,
  rectTubeSection,
  requiredSafetyFactor,
  roundBarSection,
  roundTubeSection,
  stairCalc,
  torsion,
  triangleSolve,
  woodJoinery,
} from "../core_services/blueprint/calcEngine.js";

describe("unit conversions", () => {
  it("converts inches, pounds-force and kilograms", () => {
    expect(mmFromIn(1)).toBeCloseTo(25.4, 10);
    expect(nFromLbf(1)).toBeCloseTo(4.4482216, 6);
    expect(nFromKg(100)).toBeCloseTo(980.665, 3);
  });
});

describe("section properties", () => {
  it("computes a 2×4 rectangle (38×89 mm) exactly", () => {
    const s = rectSection(38, 89);
    expect(s.A).toBeCloseTo(3382, 5);
    expect(s.I).toBeCloseTo((38 * 89 ** 3) / 12, 3); // 2 232 220.9 mm⁴ approx
    expect(s.S).toBeCloseTo(s.I / 44.5, 3);
    expect(s.r).toBeCloseTo(Math.sqrt(s.I / s.A), 6);
  });

  it("computes a square tube (50.8×50.8×3.05) as outer minus inner", () => {
    const s = rectTubeSection(50.8, 50.8, 3.05);
    const bi = 50.8 - 2 * 3.05;
    expect(s.A).toBeCloseTo(50.8 * 50.8 - bi * bi, 4);
    expect(s.I).toBeCloseTo((50.8 ** 4 - bi ** 4) / 12, 2);
  });

  it("computes round bar and round tube", () => {
    const bar = roundBarSection(20);
    expect(bar.A).toBeCloseTo((Math.PI * 400) / 4, 4);
    expect(bar.I).toBeCloseTo((Math.PI * 20 ** 4) / 64, 4);
    const tube = roundTubeSection(25.4, 3.05);
    const id = 25.4 - 6.1;
    expect(tube.I).toBeCloseTo((Math.PI * (25.4 ** 4 - id ** 4)) / 64, 4);
  });

  it("rejects impossible walls", () => {
    expect(() => rectTubeSection(20, 20, 11)).toThrow();
    expect(() => roundTubeSection(20, 10)).toThrow();
  });
});

describe("beamAnalysis", () => {
  const material = {
    elasticModulusMPa: 9650,
    bendingStrengthMPa: 6.0,
    shearStrengthMPa: 0.93,
    strengthBasis: "allowable" as const,
  };

  it("matches PL/4 and PL³/48EI for a simple beam, midspan point load", () => {
    const L = 1000;
    const P = 1000;
    const res = beamAnalysis({
      spanMm: L,
      support: "simple",
      pointLoadN: P,
      section: { shape: "rect", widthMm: 38, depthMm: 89 },
      ...material,
    });
    const I = (38 * 89 ** 3) / 12;
    const S = I / 44.5;
    expect(res.outputs.maxMomentNmm).toBeCloseTo((P * L) / 4, 0);
    expect(res.outputs.bendingStressMPa as number).toBeCloseTo((P * L) / 4 / S, 2);
    expect(res.outputs.deflectionMm as number).toBeCloseTo((P * L ** 3) / (48 * 9650 * I), 2);
    expect(res.pass).toBe(true); // σ ≈ 5.0 MPa < 6.0 allowable, δ ≈ 0.97 < L/240
    expect(res.safetyFactor).toBeGreaterThan(1);
  });

  it("matches 5wL⁴/384EI for a simple beam under UDL", () => {
    const L = 2000;
    const w = 1; // N/mm
    const res = beamAnalysis({
      spanMm: L,
      support: "simple",
      udlNPerMm: w,
      section: { shape: "rect", widthMm: 38, depthMm: 140 }, // 2×6
      ...material,
    });
    const I = (38 * 140 ** 3) / 12;
    expect(res.outputs.maxMomentNmm).toBeCloseTo((w * L * L) / 8, 0);
    expect(res.outputs.deflectionMm as number).toBeCloseTo((5 * w * L ** 4) / (384 * 9650 * I), 2);
  });

  it("matches PL and PL³/3EI for a tip-loaded cantilever", () => {
    const L = 500;
    const P = 200;
    const res = beamAnalysis({
      spanMm: L,
      support: "cantilever",
      pointLoadN: P,
      section: { shape: "rect_tube", widthMm: 25.4, depthMm: 25.4, wallMm: 1.65 },
      elasticModulusMPa: 200000,
      bendingStrengthMPa: 315,
      strengthBasis: "yield",
    });
    expect(res.outputs.maxMomentNmm).toBeCloseTo(P * L, 0);
    const bi = 25.4 - 3.3;
    const I = (25.4 ** 4 - bi ** 4) / 12;
    expect(res.outputs.deflectionMm as number).toBeCloseTo((P * L ** 3) / (3 * 200000 * I), 2);
  });

  it("fails an overloaded beam with a critical warning", () => {
    const res = beamAnalysis({
      spanMm: 3000,
      support: "simple",
      pointLoadN: nFromKg(500),
      section: { shape: "rect", widthMm: 19, depthMm: 38 },
      ...material,
    });
    expect(res.pass).toBe(false);
    expect(res.warnings.some((w) => w.severity === "critical")).toBe(true);
    expect(res.safetyFactor!).toBeLessThan(1);
  });

  it("derates FDM prints via the layer-adhesion knockdown", () => {
    const base = {
      spanMm: 200,
      support: "simple" as const,
      pointLoadN: 100,
      section: { shape: "rect" as const, widthMm: 20, depthMm: 10 },
      elasticModulusMPa: 3500,
      bendingStrengthMPa: 60,
      strengthBasis: "ultimate" as const,
    };
    const solid = beamAnalysis(base);
    const zLoaded = beamAnalysis({ ...base, layerAdhesionFactor: 0.65 });
    expect(zLoaded.safetyFactor!).toBeCloseTo(solid.safetyFactor! * 0.65, 2);
  });
});

describe("columnBuckling", () => {
  it("matches Euler π²EI/L² for pinned-pinned", () => {
    const res = columnBuckling({
      lengthMm: 1000,
      endCondition: "pinned_pinned",
      axialLoadN: 1000,
      section: { shape: "round_tube", odMm: 25.4, wallMm: 3.05 },
      elasticModulusMPa: 200000,
      strengthBasis: "yield",
    });
    const id = 25.4 - 6.1;
    const I = (Math.PI * (25.4 ** 4 - id ** 4)) / 64;
    expect(res.outputs.eulerCriticalN as number).toBeCloseTo((Math.PI ** 2 * 200000 * I) / 1000 ** 2, 0);
  });

  it("halves-ish capacity for fixed-free (K=2 → 4× shorter effective capacity)", () => {
    const base = {
      axialLoadN: 100,
      section: { shape: "rect" as const, widthMm: 38, depthMm: 38 },
      elasticModulusMPa: 9650,
      strengthBasis: "allowable" as const,
      lengthMm: 800,
    };
    const pinned = columnBuckling({ ...base, endCondition: "pinned_pinned" });
    const flag = columnBuckling({ ...base, endCondition: "fixed_free" });
    expect((flag.outputs.eulerCriticalN as number) * 4).toBeCloseTo(pinned.outputs.eulerCriticalN as number, 0);
  });
});

describe("carpentry geometry", () => {
  it("rafter: 4:12 pitch over 3000 mm run", () => {
    const res = rafterCalc({ runMm: 3000, riseOver12: 4 });
    expect(res.outputs.riseMm as number).toBeCloseTo(1000, 0);
    expect(res.outputs.plumbCutDeg as number).toBeCloseTo(18.43, 1);
    expect(res.outputs.rafterLengthMm as number).toBeCloseTo(Math.sqrt(3000 ** 2 + 1000 ** 2), 0);
  });

  it("stairs: 2670 mm rise → 14 equal risers under the IRC max", () => {
    const res = stairCalc({ totalRiseMm: 2670, targetRiserMm: 190 });
    expect(res.outputs.risers).toBe(14);
    expect(res.outputs.riserHeightMm as number).toBeCloseTo(2670 / 14, 1);
    expect(res.warnings.some((w) => w.severity === "critical")).toBe(false);
  });

  it("stairs: flags risers above 196 mm as critical", () => {
    const res = stairCalc({ totalRiseMm: 1000, targetRiserMm: 250 });
    expect(res.warnings.some((w) => w.severity === "critical")).toBe(true);
  });

  it("compound miter anchors: flat frame, vertical box, 45° splay", () => {
    const flat = compoundMiter({ cornerAngleDeg: 90, slopeFromHorizontalDeg: 0 });
    expect(flat.outputs.miterDeg as number).toBeCloseTo(45, 1);
    expect(flat.outputs.bevelDeg as number).toBeCloseTo(0, 1);

    const vertical = compoundMiter({ cornerAngleDeg: 90, slopeFromHorizontalDeg: 90 });
    expect(vertical.outputs.miterDeg as number).toBeCloseTo(0, 1);
    expect(vertical.outputs.bevelDeg as number).toBeCloseTo(45, 1);

    const splayed = compoundMiter({ cornerAngleDeg: 90, slopeFromHorizontalDeg: 45 });
    expect(splayed.outputs.miterDeg as number).toBeCloseTo(35.26, 1);
    expect(splayed.outputs.bevelDeg as number).toBeCloseTo(30, 1);
  });

  it("triangle: SSS 3-4-5 is right-angled; SAS and ASA agree", () => {
    const sss = triangleSolve({ aMm: 300, bMm: 400, cMm: 500 });
    expect(sss.outputs.CDeg as number).toBeCloseTo(90, 3);
    expect(sss.outputs.areaMm2 as number).toBeCloseTo(60000, 0);

    const sas = triangleSolve({ aMm: 300, bMm: 400, CDeg: 90 });
    expect(sas.outputs.cMm as number).toBeCloseTo(500, 3);

    const asa = triangleSolve({ aMm: 300, BDeg: 53.13010235, CDeg: 90 });
    expect(asa.outputs.bMm as number).toBeCloseTo(400, 1);
  });
});

describe("fastenerGroupCheck", () => {
  it("passes and fails around the required SF", () => {
    const ok = fastenerGroupCheck({ fastenerName: "#8 screw", capacityPerFastenerN: 400, count: 6, appliedLoadN: 1000 });
    expect(ok.safetyFactor).toBeCloseTo(2.4, 3);
    expect(ok.pass).toBe(true);
    const bad = fastenerGroupCheck({ fastenerName: "#8 screw", capacityPerFastenerN: 400, count: 2, appliedLoadN: 1000 });
    expect(bad.pass).toBe(false);
  });
});

describe("stock nesting", () => {
  it("1D: packs 4×800 mm parts into 8 ft sticks with kerf (3 per stick)", () => {
    const res = nest1D([{ label: "rail", lengthMm: 800, quantity: 4 }], 2438, 3);
    expect(res.sticksNeeded).toBe(2);
    expect(res.sticks[0].cuts.length).toBe(3); // 800+3+800+3+800 = 2406 ≤ 2438
    expect(res.sticks[1].cuts.length).toBe(1);
    expect(res.unplaced).toHaveLength(0);
  });

  it("1D: reports oversized parts as unplaced instead of looping", () => {
    const res = nest1D([{ label: "too long", lengthMm: 3000, quantity: 1 }], 2438, 3);
    expect(res.sticksNeeded).toBe(0);
    expect(res.unplaced).toHaveLength(1);
  });

  it("2D: fits 8 shelf panels on one 4×8 sheet", () => {
    const res = nest2D(
      [{ label: "shelf", wMm: 600, hMm: 280, quantity: 8 }],
      1220,
      2440,
      3,
    );
    expect(res.sheetsNeeded).toBe(1);
    expect(res.unplaced).toHaveLength(0);
    const placed = res.sheets[0].placements;
    expect(placed).toHaveLength(8);
    // No overlaps: pairwise AABB check.
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const overlap =
          a.xMm < b.xMm + b.wMm && b.xMm < a.xMm + a.wMm && a.yMm < b.yMm + b.hMm && b.yMm < a.yMm + a.hMm;
        expect(overlap).toBe(false);
      }
    }
  });

  it("fabric: yardage for bodysuit panels on a 1500 mm roll", () => {
    const res = fabricYardage(
      [
        { label: "front", wMm: 600, hMm: 800, quantity: 2 },
        { label: "sleeve", wMm: 450, hMm: 600, quantity: 2 },
      ],
      1500,
    );
    expect(res.outputs.yards as number).toBeGreaterThan(1);
    expect(res.outputs.unplacedPieces).toBe(0);
  });
});

describe("rollup helpers", () => {
  it("mass and board feet", () => {
    // 1 liter (1e6 mm³) of water-density material = 1000 g
    expect(massG(1e6, 1000)).toBeCloseTo(1000, 6);
    // classic: 2×4 (nominal) × 8 ft = 5.333 bf
    expect(boardFeet(2, 4, 8)).toBeCloseTo(16 / 3, 4);
  });

  it("safety-factor policy by basis", () => {
    expect(requiredSafetyFactor("allowable")).toBe(1.0);
    expect(requiredSafetyFactor("yield")).toBe(1.67);
    expect(requiredSafetyFactor("ultimate")).toBe(2.5);
    // A bad basis forced past the type must fail loud, not return undefined.
    expect(() => requiredSafetyFactor("bogus" as never)).toThrow(/Unknown strength basis/);
  });
});

describe("filletWeld", () => {
  it("throat + capacity match 0.707·leg and 0.6·FEXX", () => {
    const res = filletWeld({ legMm: 6, lengthMm: 100, electrodeStrengthMPa: 490, appliedLoadN: 20000 });
    expect(res.outputs.throatMm as number).toBeCloseTo(0.707 * 6, 3);
    expect(res.outputs.weldAreaMm2 as number).toBeCloseTo(0.707 * 6 * 100, 2);
    expect(res.outputs.capacityN as number).toBeCloseTo(0.707 * 6 * 100 * 0.6 * 490, 0);
    expect(res.safetyFactor!).toBeCloseTo((0.707 * 6 * 100 * 0.6 * 490) / 20000, 2);
    expect(res.pass).toBe(true);
  });

  it("fails an over-loaded weld with a critical warning", () => {
    const res = filletWeld({ legMm: 6, lengthMm: 100, electrodeStrengthMPa: 490, appliedLoadN: 90000 });
    expect(res.pass).toBe(false);
    expect(res.warnings.some((w) => w.severity === "critical")).toBe(true);
  });
});

describe("boltedConnection", () => {
  it("returns the governing of bolt-shear / bearing / tear-out", () => {
    const res = boltedConnection({
      boltDiameterMm: 12.7,
      boltCount: 2,
      plateThicknessMm: 6,
      edgeDistanceMm: 25,
      boltUltimateMPa: 830,
      plateUltimateMPa: 400,
      appliedLoadN: 40000,
    });
    const boltShear = 0.6 * 830 * ((Math.PI * 12.7 ** 2) / 4) * 1 * 2;
    const bearing = 2.4 * 12.7 * 6 * 400 * 2;
    const tearout = 1.2 * (25 - 12.7 / 2) * 6 * 400 * 2;
    expect(res.outputs.boltShearN as number).toBeCloseTo(boltShear, 0);
    expect(res.outputs.bearingN as number).toBeCloseTo(bearing, 0);
    expect(res.outputs.tearoutN as number).toBeCloseTo(tearout, 0);
    // Tear-out is the smallest here → governs.
    expect(res.outputs.governing).toBe("edge tear-out");
    expect(res.outputs.capacityN as number).toBeCloseTo(tearout, 0);
    expect(res.safetyFactor!).toBeCloseTo(tearout / 40000, 2);
    expect(res.pass).toBe(true);
  });

  it("flags a hole too close to the edge (tear-out → ~0)", () => {
    const res = boltedConnection({
      boltDiameterMm: 12.7,
      boltCount: 1,
      plateThicknessMm: 6,
      edgeDistanceMm: 5, // < d/2 → clear distance negative
      boltUltimateMPa: 830,
      plateUltimateMPa: 400,
      appliedLoadN: 5000,
    });
    expect(res.outputs.tearoutN).toBe(0);
    expect(res.pass).toBe(false);
    expect(res.warnings.some((w) => w.severity === "critical")).toBe(true);
  });
});

describe("torsion", () => {
  it("solid shaft: τ=T·c/J and θ=T·L/GJ", () => {
    const res = torsion({
      torqueNmm: 100000,
      lengthMm: 500,
      section: { shape: "round_bar", diameterMm: 20 },
      shearModulusMPa: 79300,
      shearStrengthMPa: 200,
    });
    const J = (Math.PI * 20 ** 4) / 32;
    expect(res.outputs.polarMomentMm4 as number).toBeCloseTo(J, 1);
    expect(res.outputs.maxShearStressMPa as number).toBeCloseTo((100000 * 10) / J, 2);
    expect(res.outputs.angleOfTwistDeg as number).toBeCloseTo(((100000 * 500) / (79300 * J)) * (180 / Math.PI), 2);
    expect(res.safetyFactor!).toBeCloseTo(200 / ((100000 * 10) / J), 2);
    expect(res.pass).toBe(true);
  });

  it("tube J is π(od⁴−id⁴)/32", () => {
    const res = torsion({
      torqueNmm: 50000,
      lengthMm: 300,
      section: { shape: "round_tube", odMm: 25.4, wallMm: 3.05 },
      shearModulusMPa: 79300,
    });
    const id = 25.4 - 6.1;
    expect(res.outputs.polarMomentMm4 as number).toBeCloseTo((Math.PI * (25.4 ** 4 - id ** 4)) / 32, 1);
  });
});

describe("woodJoinery", () => {
  it("lag-screw withdrawal matches the NDS W=1800·G^1.5·D^0.75 formula", () => {
    const res = woodJoinery({
      fastener: "lag_screw",
      specificGravity: 0.42,
      diameterMm: 6.35, // 0.25 in
      penetrationMm: 50.8, // 2 in
      count: 4,
      appliedLoadN: 2000,
    });
    const wPerIn = 1800 * 0.42 ** 1.5 * 0.25 ** 0.75;
    expect(res.outputs.withdrawalPerInLbf as number).toBeCloseTo(wPerIn, 1);
    expect(res.outputs.groupCapacityN as number).toBeCloseTo(nFromLbf(wPerIn * 2 * 4), 0);
    expect(res.pass).toBe(true);
  });

  it("refuses end-grain withdrawal (no NDS value)", () => {
    const res = woodJoinery({
      specificGravity: 0.5,
      diameterMm: 8,
      penetrationMm: 60,
      count: 4,
      appliedLoadN: 500,
      endGrain: true,
    });
    expect(res.pass).toBe(false);
    expect(res.warnings.some((w) => w.severity === "critical" && /end-grain/i.test(w.message))).toBe(true);
  });
});

describe("printedPart", () => {
  it("effective section = solid shell + infill-scaled core", () => {
    const res = printedPart({
      mode: "tension",
      widthMm: 20,
      heightMm: 10,
      wallCount: 3,
      lineWidthMm: 0.4,
      infillPct: 20,
      tensileStrengthMPa: 50,
      loadN: 1000,
    });
    const t = 3 * 0.4;
    const coreA = (20 - 2 * t) * (10 - 2 * t);
    const effA = 20 * 10 - coreA + 0.2 * coreA;
    expect(res.outputs.effectiveAreaMm2 as number).toBeCloseTo(effA, 2);
    expect(res.safetyFactor!).toBeCloseTo(50 / (1000 / effA), 2);
    expect(res.pass).toBe(true); // SF ≈ 4.65 > 2.5
  });

  it("halves usable strength when loaded across the layers", () => {
    const base = {
      mode: "tension" as const,
      widthMm: 20,
      heightMm: 10,
      wallCount: 3,
      lineWidthMm: 0.4,
      infillPct: 20,
      tensileStrengthMPa: 50,
      loadN: 1000,
    };
    const along = printedPart(base);
    const across = printedPart({ ...base, loadAcrossLayers: true, layerAdhesionFactor: 0.5 });
    expect(across.safetyFactor!).toBeCloseTo(along.safetyFactor! * 0.5, 2);
    expect(across.warnings.some((w) => /layer/i.test(w.message))).toBe(true);
  });

  it("rejects an unknown mode instead of silently treating it as bending", () => {
    expect(() =>
      printedPart({ mode: "compression" as never, widthMm: 20, heightMm: 10, wallCount: 3, lineWidthMm: 0.4, infillPct: 20, tensileStrengthMPa: 50, loadN: 1000 }),
    ).toThrow(/mode must be/);
  });
});

describe("heatCheck", () => {
  it("PLA passes indoors but fails in a hot car and in direct sun", () => {
    const indoor = heatCheck({ maxServiceTempC: 52, scenario: "indoor" });
    expect(indoor.outputs.expectedPeakC).toBe(30);
    expect(indoor.pass).toBe(true);

    const car = heatCheck({ maxServiceTempC: 52, scenario: "hot_car" });
    expect(car.outputs.expectedPeakC).toBe(75);
    expect(car.pass).toBe(false);
    expect(car.warnings.some((w) => w.severity === "critical")).toBe(true);

    const sun = heatCheck({ maxServiceTempC: 52, scenario: "direct_sun", ambientC: 40, surface: "dark" });
    expect(sun.outputs.expectedPeakC).toBe(70); // 40 + 30 dark-surface gain
    expect(sun.pass).toBe(false);
  });

  it("PETG survives direct sun with the margin honored", () => {
    const petg = heatCheck({ maxServiceTempC: 70, scenario: "direct_sun", ambientC: 40, surface: "light" });
    expect(petg.outputs.expectedPeakC).toBe(55); // 40 + 15 light gain
    expect(petg.outputs.headroomC).toBe(15);
    expect(petg.pass).toBe(true);
  });

  it("rejects an unknown scenario with a clear error (not a peakC crash)", () => {
    expect(() => heatCheck({ maxServiceTempC: 60, scenario: "sun" as never })).toThrow(/Unknown scenario/);
  });
});
