/**
 * Blueprint Studio — deterministic engineering calculation engine.
 *
 * Pure functions, SI-metric internally (mm, N, MPa — see shared/blueprint.ts).
 * Every result returns a `CalcResult` with `workings` lines showing the
 * formula and substituted numbers, so safety-relevant math is never model
 * mental arithmetic and the plan document records how each number was derived.
 *
 * Safety-factor policy (per material `strengthBasis`):
 *   allowable — graded-lumber design values: factors already embedded, so the
 *               criterion is stress ≤ allowable (required SF = 1.0).
 *   yield     — metals: required SF ≥ 1.67 on yield (AISC-ASD-like) for static
 *               service; the caller can raise it for dynamic/impact loads.
 *   ultimate  — plastics / small-clear wood MOR / composites: required SF ≥ 2.5.
 * FDM-printed parts loaded across layers additionally derate strength by the
 * material's `layerAdhesionFactor`.
 *
 * These checks are guidance for personal fabrication — structural work on
 * dwellings and road vehicles must be verified against local code / a licensed
 * engineer, and every structural CalcResult carries that warning.
 */
import type {
  CalcResult,
  CalcWarning,
  NestingResult1D,
  NestingResult2D,
  StrengthBasis,
} from "@shared/blueprint";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const MM_PER_IN = 25.4;
export const MM_PER_FT = 304.8;
export const N_PER_LBF = 4.4482216;
export const N_PER_KG = 9.80665;
export const MPA_PER_PSI = 0.00689476;

export const mmFromIn = (v: number) => v * MM_PER_IN;
export const mmFromFt = (v: number) => v * MM_PER_FT;
export const inFromMm = (v: number) => v / MM_PER_IN;
export const nFromLbf = (v: number) => v * N_PER_LBF;
export const nFromKg = (v: number) => v * N_PER_KG;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** Required safety factor for a strength basis (static service loads). */
export function requiredSafetyFactor(basis: StrengthBasis): number {
  switch (basis) {
    case "allowable":
      return 1.0;
    case "yield":
      return 1.67;
    case "ultimate":
      return 2.5;
    default:
      // Reachable only via a bad string forced past the type (tool `as never`
      // casts). Fail loud instead of returning undefined and silently failing
      // every SF comparison.
      throw new Error(`Unknown strength basis "${basis}" — use "allowable", "yield", or "ultimate".`);
  }
}

const STRUCTURAL_DISCLAIMER: CalcWarning = {
  severity: "info",
  message:
    "Guidance for personal fabrication. Structures people occupy and road-going vehicles must be verified against local building/vehicle code or by a licensed engineer.",
};

// ---------------------------------------------------------------------------
// Section properties
// ---------------------------------------------------------------------------

export interface SectionProps {
  /** Description, e.g. "rect 38×89". */
  label: string;
  /** Area mm². */
  A: number;
  /** Second moment of area about the bending axis, mm⁴. */
  I: number;
  /** Section modulus, mm³ (I / c). */
  S: number;
  /** Radius of gyration, mm. */
  r: number;
  /** Distance from neutral axis to extreme fiber, mm. */
  c: number;
  /** Shear-stress form factor: τmax = k·V/A (1.5 rect, ~2 thin round tube). */
  shearFactor: number;
}

/** Solid rectangle bent about the strong axis: b = width, h = depth (mm). */
export function rectSection(bMm: number, hMm: number): SectionProps {
  const A = bMm * hMm;
  const I = (bMm * hMm ** 3) / 12;
  const c = hMm / 2;
  return { label: `rect ${r2(bMm)}×${r2(hMm)}`, A, I, S: I / c, r: Math.sqrt(I / A), c, shearFactor: 1.5 };
}

/** Hollow rectangular tube: outer b×h, uniform wall t (mm). */
export function rectTubeSection(bMm: number, hMm: number, tMm: number): SectionProps {
  const bi = bMm - 2 * tMm;
  const hi = hMm - 2 * tMm;
  if (bi <= 0 || hi <= 0) throw new Error("Wall thickness exceeds tube half-size.");
  const A = bMm * hMm - bi * hi;
  const I = (bMm * hMm ** 3 - bi * hi ** 3) / 12;
  const c = hMm / 2;
  return {
    label: `rect tube ${r2(bMm)}×${r2(hMm)}×${r2(tMm)}`,
    A,
    I,
    S: I / c,
    r: Math.sqrt(I / A),
    c,
    shearFactor: 2.0,
  };
}

/** Solid round bar, diameter d (mm). */
export function roundBarSection(dMm: number): SectionProps {
  const A = (Math.PI * dMm ** 2) / 4;
  const I = (Math.PI * dMm ** 4) / 64;
  const c = dMm / 2;
  return { label: `round bar Ø${r2(dMm)}`, A, I, S: I / c, r: Math.sqrt(I / A), c, shearFactor: 4 / 3 };
}

/** Round tube: outer diameter od, wall t (mm). */
export function roundTubeSection(odMm: number, tMm: number): SectionProps {
  const id = odMm - 2 * tMm;
  if (id <= 0) throw new Error("Wall thickness exceeds tube radius.");
  const A = (Math.PI * (odMm ** 2 - id ** 2)) / 4;
  const I = (Math.PI * (odMm ** 4 - id ** 4)) / 64;
  const c = odMm / 2;
  return { label: `round tube Ø${r2(odMm)}×${r2(tMm)}`, A, I, S: I / c, r: Math.sqrt(I / A), c, shearFactor: 2.0 };
}

export type SectionSpec =
  | { shape: "rect"; widthMm: number; depthMm: number }
  | { shape: "rect_tube"; widthMm: number; depthMm: number; wallMm: number }
  | { shape: "round_bar"; diameterMm: number }
  | { shape: "round_tube"; odMm: number; wallMm: number };

export function sectionFromSpec(spec: SectionSpec): SectionProps {
  switch (spec.shape) {
    case "rect":
      return rectSection(spec.widthMm, spec.depthMm);
    case "rect_tube":
      return rectTubeSection(spec.widthMm, spec.depthMm, spec.wallMm);
    case "round_bar":
      return roundBarSection(spec.diameterMm);
    case "round_tube":
      return roundTubeSection(spec.odMm, spec.wallMm);
  }
}

// ---------------------------------------------------------------------------
// Beam analysis
// ---------------------------------------------------------------------------

export interface BeamInput {
  title?: string;
  spanMm: number;
  support: "simple" | "cantilever" | "fixed_both";
  /** Point load in N (applied at `pointPosMm` from the left/fixed end, default midspan/tip). */
  pointLoadN?: number;
  pointPosMm?: number;
  /** Uniform load in N/mm (use nFromKg(total)/span for a distributed mass). */
  udlNPerMm?: number;
  /** Include the member's own weight as extra UDL. */
  selfWeightNPerMm?: number;
  section: SectionSpec;
  /** Material properties. */
  elasticModulusMPa: number;
  bendingStrengthMPa: number;
  shearStrengthMPa?: number;
  strengthBasis: StrengthBasis;
  /** Deflection limit as span/N — default 240 (general); 360 for floors. */
  deflectionLimitRatio?: number;
  /** Override the basis-derived required safety factor. */
  requiredSF?: number;
  /** FDM prints loaded across layers: multiply strength by this knockdown. */
  layerAdhesionFactor?: number;
}

/**
 * Linear-elastic beam check: max moment, shear, bending/shear stress,
 * deflection, and pass/fail vs strength + deflection limits. Point and
 * uniform loads superpose (both effects are computed at their own worst
 * locations — conservative for the combined check).
 */
export function beamAnalysis(input: BeamInput): CalcResult {
  const L = input.spanMm;
  const sec = sectionFromSpec(input.section);
  const E = input.elasticModulusMPa;
  const I = sec.I;
  const w = (input.udlNPerMm ?? 0) + (input.selfWeightNPerMm ?? 0);
  const P = input.pointLoadN ?? 0;
  const workings: string[] = [`Section ${sec.label}: A=${r2(sec.A)} mm², I=${r2(I)} mm⁴, S=${r2(sec.S)} mm³`];
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];

  let Mmax = 0; // N·mm
  let Vmax = 0; // N
  let defl = 0; // mm

  if (input.support === "simple") {
    const a = Math.min(Math.max(input.pointPosMm ?? L / 2, 0), L);
    const b = L - a;
    if (P > 0) {
      const Mp = (P * a * b) / L;
      Mmax += Mp;
      Vmax += (P * Math.max(a, b)) / L;
      // Max deflection for an off-center point load (exact when a ≥ b).
      const bb = Math.min(a, b);
      const dp =
        a === b
          ? (P * L ** 3) / (48 * E * I)
          : (P * bb * (L ** 2 - bb ** 2) ** 1.5) / (9 * Math.sqrt(3) * L * E * I);
      defl += dp;
      workings.push(`Point: M=P·a·b/L = ${r2(P)}·${r2(a)}·${r2(b)}/${r2(L)} = ${r2(Mp)} N·mm; δ=${r3(dp)} mm`);
    }
    if (w > 0) {
      const Mw = (w * L ** 2) / 8;
      Mmax += Mw;
      Vmax += (w * L) / 2;
      const dw = (5 * w * L ** 4) / (384 * E * I);
      defl += dw;
      workings.push(`UDL: M=wL²/8 = ${r3(w)}·${r2(L)}²/8 = ${r2(Mw)} N·mm; δ=5wL⁴/384EI = ${r3(dw)} mm`);
    }
  } else if (input.support === "cantilever") {
    const a = Math.min(Math.max(input.pointPosMm ?? L, 0), L);
    if (P > 0) {
      const Mp = P * a;
      Mmax += Mp;
      Vmax += P;
      const dp = (P * a ** 2 * (3 * L - a)) / (6 * E * I);
      defl += dp;
      workings.push(`Point @${r2(a)}: M=P·a = ${r2(Mp)} N·mm; δ=Pa²(3L−a)/6EI = ${r3(dp)} mm`);
    }
    if (w > 0) {
      const Mw = (w * L ** 2) / 2;
      Mmax += Mw;
      Vmax += w * L;
      const dw = (w * L ** 4) / (8 * E * I);
      defl += dw;
      workings.push(`UDL: M=wL²/2 = ${r2(Mw)} N·mm; δ=wL⁴/8EI = ${r3(dw)} mm`);
    }
  } else {
    // fixed_both
    if (P > 0) {
      const Mp = (P * L) / 8; // midspan point load, fixed ends
      Mmax += Mp;
      Vmax += P / 2;
      const dp = (P * L ** 3) / (192 * E * I);
      defl += dp;
      workings.push(`Point (mid): M=PL/8 = ${r2(Mp)} N·mm; δ=PL³/192EI = ${r3(dp)} mm`);
      if (input.pointPosMm !== undefined && Math.abs(input.pointPosMm - L / 2) > L * 0.01) {
        warnings.push({ severity: "info", message: "Fixed-fixed point load treated as midspan (worst case)." });
      }
    }
    if (w > 0) {
      const Mw = (w * L ** 2) / 12; // at supports
      Mmax += Mw;
      Vmax += (w * L) / 2;
      const dw = (w * L ** 4) / (384 * E * I);
      defl += dw;
      workings.push(`UDL: M=wL²/12 = ${r2(Mw)} N·mm; δ=wL⁴/384EI = ${r3(dw)} mm`);
    }
  }

  const sigma = Mmax / sec.S; // MPa (N/mm²)
  const tau = Vmax > 0 ? (sec.shearFactor * Vmax) / sec.A : 0;
  workings.push(`Bending stress σ = M/S = ${r2(Mmax)}/${r2(sec.S)} = ${r3(sigma)} MPa`);
  if (tau > 0) workings.push(`Shear stress τ = ${sec.shearFactor}·V/A = ${r3(tau)} MPa`);

  const knock = input.layerAdhesionFactor ?? 1;
  const strength = input.bendingStrengthMPa * knock;
  if (knock < 1)
    workings.push(`FDM layer-adhesion knockdown ×${knock}: usable strength = ${r3(strength)} MPa`);
  const reqSF = input.requiredSF ?? requiredSafetyFactor(input.strengthBasis);
  const sf = sigma > 0 ? strength / sigma : Infinity;

  const limitRatio = input.deflectionLimitRatio ?? 240;
  const deflLimit = L / limitRatio;
  workings.push(
    `Deflection δ = ${r3(defl)} mm vs limit L/${limitRatio} = ${r3(deflLimit)} mm`,
    `Safety factor = ${r3(strength)}/${r3(sigma)} = ${r3(sf)} (required ≥ ${reqSF}, basis: ${input.strengthBasis})`,
  );

  let shearPass = true;
  if (input.shearStrengthMPa !== undefined && tau > 0) {
    const shearSF = (input.shearStrengthMPa * knock) / tau;
    shearPass = shearSF >= reqSF;
    workings.push(`Shear SF = ${r3(shearSF)} (required ≥ ${reqSF})`);
    if (!shearPass) warnings.push({ severity: "critical", message: "Shear stress exceeds capacity — deepen the member or shorten the span." });
  }

  const strengthPass = sf >= reqSF;
  const deflPass = defl <= deflLimit;
  if (!strengthPass)
    warnings.push({ severity: "critical", message: `Bending safety factor ${r3(sf)} is below the required ${reqSF}.` });
  if (!deflPass)
    warnings.push({ severity: "warning", message: `Deflection ${r3(defl)} mm exceeds L/${limitRatio} = ${r3(deflLimit)} mm — will feel bouncy/saggy even if strong enough.` });

  return {
    calc: "beam_bending",
    title: input.title ?? `Beam check — ${sec.label}, span ${r2(L)} mm (${input.support})`,
    inputs: {
      spanMm: L,
      support: input.support,
      pointLoadN: P,
      udlNPerMm: r3(w),
      section: sec.label,
      E_MPa: E,
      strengthMPa: input.bendingStrengthMPa,
      strengthBasis: input.strengthBasis,
    },
    outputs: {
      maxMomentNmm: r2(Mmax),
      maxShearN: r2(Vmax),
      bendingStressMPa: r3(sigma),
      shearStressMPa: r3(tau),
      deflectionMm: r3(defl),
      deflectionLimitMm: r3(deflLimit),
      safetyFactor: r3(sf),
    },
    workings,
    safetyFactor: r3(sf),
    pass: strengthPass && deflPass && shearPass,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Column buckling
// ---------------------------------------------------------------------------

export interface ColumnInput {
  title?: string;
  lengthMm: number;
  /** Effective-length factor: pinned-pinned 1.0, fixed-free 2.0, fixed-pinned 0.8, fixed-fixed 0.65. */
  endCondition: "pinned_pinned" | "fixed_free" | "fixed_pinned" | "fixed_fixed";
  axialLoadN: number;
  section: SectionSpec;
  elasticModulusMPa: number;
  /** Compression strength for the crushing check (yield / allowable-compression). */
  compressiveStrengthMPa?: number;
  strengthBasis: StrengthBasis;
  requiredSF?: number;
}

const K_FACTORS = { pinned_pinned: 1.0, fixed_free: 2.0, fixed_pinned: 0.8, fixed_fixed: 0.65 } as const;

/** Euler buckling + crushing check with slenderness reporting. */
export function columnBuckling(input: ColumnInput): CalcResult {
  const sec = sectionFromSpec(input.section);
  const K = K_FACTORS[input.endCondition];
  const Le = K * input.lengthMm;
  const slenderness = Le / sec.r;
  const Pcr = (Math.PI ** 2 * input.elasticModulusMPa * sec.I) / Le ** 2; // N
  const reqSF = input.requiredSF ?? Math.max(2.0, requiredSafetyFactor(input.strengthBasis)); // buckling is sudden — never below 2
  const sfBuckling = Pcr / input.axialLoadN;

  const workings = [
    `Section ${sec.label}: I=${r2(sec.I)} mm⁴, r=${r2(sec.r)} mm`,
    `Effective length Le = K·L = ${K}·${r2(input.lengthMm)} = ${r2(Le)} mm; slenderness Le/r = ${r2(slenderness)}`,
    `Euler Pcr = π²EI/Le² = ${r2(Pcr)} N`,
    `Buckling SF = ${r2(Pcr)}/${r2(input.axialLoadN)} = ${r3(sfBuckling)} (required ≥ ${reqSF})`,
  ];
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];

  let crushPass = true;
  if (input.compressiveStrengthMPa) {
    const sigma = input.axialLoadN / sec.A;
    const sfCrush = input.compressiveStrengthMPa / sigma;
    crushPass = sfCrush >= (input.requiredSF ?? requiredSafetyFactor(input.strengthBasis));
    workings.push(`Crushing: σ = P/A = ${r3(sigma)} MPa; SF = ${r3(sfCrush)}`);
    if (!crushPass) warnings.push({ severity: "critical", message: "Axial stress exceeds compressive capacity." });
  }
  if (slenderness < 30)
    warnings.push({ severity: "info", message: "Short column (Le/r < 30): crushing governs — Euler is not the limiting mode." });
  const pass = sfBuckling >= reqSF && crushPass;
  if (sfBuckling < reqSF)
    warnings.push({ severity: "critical", message: `Buckling safety factor ${r3(sfBuckling)} below required ${reqSF} — use a larger section or brace the column.` });

  return {
    calc: "column_buckling",
    title: input.title ?? `Column check — ${sec.label}, L=${r2(input.lengthMm)} mm (${input.endCondition})`,
    inputs: {
      lengthMm: input.lengthMm,
      endCondition: input.endCondition,
      K,
      axialLoadN: input.axialLoadN,
      section: sec.label,
      E_MPa: input.elasticModulusMPa,
    },
    outputs: {
      effectiveLengthMm: r2(Le),
      slenderness: r2(slenderness),
      eulerCriticalN: r2(Pcr),
      safetyFactor: r3(sfBuckling),
    },
    workings,
    safetyFactor: r3(sfBuckling),
    pass,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/** Fastener-group shear check: n fasteners × capacity vs applied load. */
export function fastenerGroupCheck(input: {
  title?: string;
  fastenerName: string;
  capacityPerFastenerN: number;
  count: number;
  appliedLoadN: number;
  requiredSF?: number;
}): CalcResult {
  const cap = input.capacityPerFastenerN * input.count;
  const reqSF = input.requiredSF ?? 1.5;
  const sf = cap / input.appliedLoadN;
  const pass = sf >= reqSF;
  return {
    calc: "fastener_group",
    title: input.title ?? `Connection — ${input.count}× ${input.fastenerName}`,
    inputs: {
      fastener: input.fastenerName,
      capacityPerFastenerN: input.capacityPerFastenerN,
      count: input.count,
      appliedLoadN: input.appliedLoadN,
    },
    outputs: { groupCapacityN: r2(cap), safetyFactor: r3(sf) },
    workings: [
      `Group capacity = ${input.count} × ${r2(input.capacityPerFastenerN)} = ${r2(cap)} N`,
      `SF = ${r2(cap)}/${r2(input.appliedLoadN)} = ${r3(sf)} (required ≥ ${reqSF})`,
    ],
    safetyFactor: r3(sf),
    pass,
    warnings: pass
      ? [STRUCTURAL_DISCLAIMER]
      : [STRUCTURAL_DISCLAIMER, { severity: "critical", message: "Connection under-strength — add fasteners or upsize." }],
  };
}

/**
 * Fillet-weld shear capacity. Throat = 0.707·leg; nominal weld shear strength
 * = 0.6·FEXX (AISC). Capacity = throat·length·0.6·FEXX. A fillet weld is
 * designed to the electrode ultimate, so the required SF defaults to 2.0.
 */
export function filletWeld(input: {
  title?: string;
  legMm: number;
  /** Total effective weld length (sum of all weld runs), mm. */
  lengthMm: number;
  /** Electrode ultimate strength FEXX (MPa) — E70 ≈ 483, E60 ≈ 414. */
  electrodeStrengthMPa: number;
  appliedLoadN: number;
  requiredSF?: number;
}): CalcResult {
  const throat = 0.707 * input.legMm;
  const area = throat * input.lengthMm; // mm²
  const nominalShearMPa = 0.6 * input.electrodeStrengthMPa;
  const capacity = nominalShearMPa * area; // N
  const reqSF = input.requiredSF ?? 2.0;
  const sf = input.appliedLoadN > 0 ? capacity / input.appliedLoadN : Infinity;
  const pass = sf >= reqSF;
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];
  if (input.legMm < 3)
    warnings.push({ severity: "warning", message: "Fillet leg below 3 mm — hard to deposit reliably; check the plate-thickness minimum weld size." });
  if (!pass)
    warnings.push({ severity: "critical", message: `Weld safety factor ${r3(sf)} below required ${reqSF} — lengthen the weld or increase the leg size.` });
  return {
    calc: "fillet_weld",
    title: input.title ?? `Fillet weld — ${r2(input.legMm)} mm leg × ${r2(input.lengthMm)} mm`,
    inputs: { legMm: input.legMm, lengthMm: input.lengthMm, electrodeStrengthMPa: input.electrodeStrengthMPa, appliedLoadN: input.appliedLoadN },
    outputs: { throatMm: r3(throat), weldAreaMm2: r2(area), nominalShearMPa: r2(nominalShearMPa), capacityN: r2(capacity), safetyFactor: r3(sf) },
    workings: [
      `Throat a = 0.707·leg = 0.707·${r2(input.legMm)} = ${r3(throat)} mm`,
      `Weld area = a·L = ${r3(throat)}·${r2(input.lengthMm)} = ${r2(area)} mm²`,
      `Nominal shear = 0.6·FEXX = 0.6·${r2(input.electrodeStrengthMPa)} = ${r2(nominalShearMPa)} MPa`,
      `Capacity = ${r2(nominalShearMPa)}·${r2(area)} = ${r2(capacity)} N`,
      `SF = ${r2(capacity)}/${r2(input.appliedLoadN)} = ${r3(sf)} (required ≥ ${reqSF})`,
    ],
    safetyFactor: r3(sf),
    pass,
    warnings,
  };
}

/**
 * Bolted-connection capacity — the governing of three limit states for a lap
 * joint loaded in shear: bolt shear (0.6·Fu·A per shear plane), plate bearing
 * (2.4·d·t·Fu_plate) and edge tear-out (1.2·lc·t·Fu_plate, lc = edge − d/2).
 * Values are AISC nominal strengths; required SF defaults to 2.0 on ultimate.
 */
export function boltedConnection(input: {
  title?: string;
  boltDiameterMm: number;
  boltCount: number;
  /** Connected-plate thickness (the thinner plate), mm. */
  plateThicknessMm: number;
  /** Edge distance to the nearest bolt centre, mm (drives tear-out). */
  edgeDistanceMm: number;
  /** Bolt ultimate tensile strength Fu, MPa — grade 8.8 ≈ 800, A307 ≈ 415. */
  boltUltimateMPa: number;
  /** Plate ultimate strength Fu, MPa — A36 ≈ 400. */
  plateUltimateMPa: number;
  appliedLoadN: number;
  /** Shear planes per bolt (single-shear lap = 1, double = 2). */
  shearPlanes?: number;
  requiredSF?: number;
}): CalcResult {
  const d = input.boltDiameterMm;
  const t = input.plateThicknessMm;
  const n = input.boltCount;
  const planes = input.shearPlanes ?? 1;
  const boltArea = (Math.PI * d ** 2) / 4;
  const boltShear = 0.6 * input.boltUltimateMPa * boltArea * planes * n; // N
  const bearing = 2.4 * d * t * input.plateUltimateMPa * n; // N
  const lc = input.edgeDistanceMm - d / 2;
  const tearout = 1.2 * Math.max(lc, 0) * t * input.plateUltimateMPa * n; // N
  const modes = [
    { name: "bolt shear", cap: boltShear },
    { name: "plate bearing", cap: bearing },
    { name: "edge tear-out", cap: tearout },
  ];
  const governing = modes.reduce((min, m) => (m.cap < min.cap ? m : min));
  const reqSF = input.requiredSF ?? 2.0;
  const sf = input.appliedLoadN > 0 ? governing.cap / input.appliedLoadN : Infinity;
  const pass = sf >= reqSF;
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];
  if (lc <= 0)
    warnings.push({ severity: "critical", message: "Edge distance is under half a bolt diameter — tear-out capacity is essentially zero; move the hole in from the edge." });
  if (!pass)
    warnings.push({ severity: "critical", message: `Governing limit state is ${governing.name} at SF ${r3(sf)} (< ${reqSF}).` });
  return {
    calc: "bolted_connection",
    title: input.title ?? `Bolted joint — ${n}× Ø${r2(d)} mm bolt`,
    inputs: {
      boltDiameterMm: d,
      boltCount: n,
      plateThicknessMm: t,
      edgeDistanceMm: input.edgeDistanceMm,
      boltUltimateMPa: input.boltUltimateMPa,
      plateUltimateMPa: input.plateUltimateMPa,
      appliedLoadN: input.appliedLoadN,
      shearPlanes: planes,
    },
    outputs: { boltShearN: r2(boltShear), bearingN: r2(bearing), tearoutN: r2(tearout), governing: governing.name, capacityN: r2(governing.cap), safetyFactor: r3(sf) },
    workings: [
      `Bolt shear = 0.6·Fu·(πd²/4)·planes·n = 0.6·${r2(input.boltUltimateMPa)}·${r2(boltArea)}·${planes}·${n} = ${r2(boltShear)} N`,
      `Bearing = 2.4·d·t·Fu·n = 2.4·${r2(d)}·${r2(t)}·${r2(input.plateUltimateMPa)}·${n} = ${r2(bearing)} N`,
      `Tear-out = 1.2·lc·t·Fu·n (lc = edge − d/2 = ${r2(lc)}) = ${r2(tearout)} N`,
      `Governing = ${governing.name} → capacity ${r2(governing.cap)} N`,
      `SF = ${r2(governing.cap)}/${r2(input.appliedLoadN)} = ${r3(sf)} (required ≥ ${reqSF})`,
    ],
    safetyFactor: r3(sf),
    pass,
    warnings,
  };
}

/**
 * Torsion of a circular shaft (solid bar or tube): max shear stress τ = T·c/J
 * and angle of twist θ = T·L/(G·J). J = π·d⁴/32 (solid) or π(od⁴−id⁴)/32 (tube).
 */
export function torsion(input: {
  title?: string;
  /** Applied torque, N·mm. */
  torqueNmm: number;
  lengthMm: number;
  section: { shape: "round_bar"; diameterMm: number } | { shape: "round_tube"; odMm: number; wallMm: number };
  /** Shear modulus G (MPa) — steel ≈ 79300, aluminum ≈ 26000. */
  shearModulusMPa: number;
  /** Torsional shear strength (MPa) for the pass check (≈ 0.6·yield). */
  shearStrengthMPa?: number;
  strengthBasis?: StrengthBasis;
  requiredSF?: number;
}): CalcResult {
  const od = input.section.shape === "round_bar" ? input.section.diameterMm : input.section.odMm;
  const id = input.section.shape === "round_bar" ? 0 : input.section.odMm - 2 * input.section.wallMm;
  if (id < 0) throw new Error("Wall thickness exceeds tube radius.");
  const J = (Math.PI * (od ** 4 - id ** 4)) / 32; // mm⁴
  const c = od / 2;
  const tau = (input.torqueNmm * c) / J; // MPa
  const thetaRad = (input.torqueNmm * input.lengthMm) / (input.shearModulusMPa * J);
  const workings = [
    `J = π(od⁴−id⁴)/32 = π(${r2(od)}⁴−${r2(id)}⁴)/32 = ${r2(J)} mm⁴`,
    `Max shear τ = T·c/J = ${r2(input.torqueNmm)}·${r2(c)}/${r2(J)} = ${r3(tau)} MPa`,
    `Angle of twist θ = T·L/(G·J) = ${r3(deg(thetaRad))}°`,
  ];
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];
  let sf: number | undefined;
  let pass: boolean | undefined;
  if (input.shearStrengthMPa) {
    const reqSF = input.requiredSF ?? requiredSafetyFactor(input.strengthBasis ?? "yield");
    sf = tau > 0 ? input.shearStrengthMPa / tau : Infinity;
    pass = sf >= reqSF;
    workings.push(`SF = ${r2(input.shearStrengthMPa)}/${r3(tau)} = ${r3(sf)} (required ≥ ${reqSF})`);
    if (!pass) warnings.push({ severity: "critical", message: `Torsional safety factor ${r3(sf)} below required ${reqSF} — use a larger diameter or a tube.` });
  }
  return {
    calc: "torsion",
    title: input.title ?? `Torsion — ${input.section.shape === "round_bar" ? `Ø${r2(od)} bar` : `Ø${r2(od)}×${r2(input.section.wallMm)} tube`}`,
    inputs: { torqueNmm: input.torqueNmm, lengthMm: input.lengthMm, odMm: od, idMm: r2(id), shearModulusMPa: input.shearModulusMPa },
    outputs: { polarMomentMm4: r2(J), maxShearStressMPa: r3(tau), angleOfTwistDeg: r3(deg(thetaRad)), safetyFactor: sf !== undefined ? r3(sf) : "n/a" },
    workings,
    safetyFactor: sf !== undefined ? r3(sf) : undefined,
    pass,
    warnings,
  };
}

/**
 * Lag-screw / wood-screw withdrawal (axial pull-out) for a fastener group.
 * NDS empirical withdrawal design value per inch of thread penetration:
 *   lag screw:  W = 1800 · G^1.5 · D^0.75   (lbf/in, D in inches)
 *   wood screw: W = 2850 · G²   · D          (lbf/in)
 * Computed imperial then returned in N. End-grain withdrawal is not permitted.
 */
export function woodJoinery(input: {
  title?: string;
  fastener?: "lag_screw" | "wood_screw";
  /** Specific gravity of the holding member (SPF ≈ 0.42, DF-L ≈ 0.50, SYP ≈ 0.55). */
  specificGravity: number;
  /** Fastener shank/root diameter, mm. */
  diameterMm: number;
  /** Thread penetration into the main member, mm. */
  penetrationMm: number;
  count: number;
  appliedLoadN: number;
  /** True when the screw enters end grain (withdrawal then not allowed). */
  endGrain?: boolean;
  requiredSF?: number;
}): CalcResult {
  const G = input.specificGravity;
  const Din = input.diameterMm / MM_PER_IN;
  const penIn = input.penetrationMm / MM_PER_IN;
  const type = input.fastener ?? "lag_screw";
  const wPerIn = type === "lag_screw" ? 1800 * G ** 1.5 * Din ** 0.75 : 2850 * G ** 2 * Din; // lbf/in
  const capacityLbf = wPerIn * penIn * input.count;
  const capacityN = nFromLbf(capacityLbf);
  const reqSF = input.requiredSF ?? 2.5; // withdrawal is variable — conservative
  const sf = input.appliedLoadN > 0 ? capacityN / input.appliedLoadN : Infinity;
  const pass = !input.endGrain && sf >= reqSF;
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];
  if (input.endGrain)
    warnings.push({ severity: "critical", message: "Screw is loaded in end-grain withdrawal — NDS assigns no withdrawal value; redesign so the fastener loads in shear or enters side grain." });
  else if (!pass)
    warnings.push({ severity: "critical", message: `Withdrawal safety factor ${r3(sf)} below required ${reqSF} — add screws, deepen penetration, or avoid loading the joint in withdrawal.` });
  warnings.push({ severity: "info", message: "Design withdrawal loading out where you can — a screw in shear/bearing is far more reliable than one in pull-out." });
  return {
    calc: "wood_joinery",
    title: input.title ?? `${type === "lag_screw" ? "Lag" : "Wood"}-screw withdrawal — ${input.count}× Ø${r2(input.diameterMm)} mm`,
    inputs: { fastener: type, specificGravity: G, diameterMm: input.diameterMm, penetrationMm: input.penetrationMm, count: input.count, appliedLoadN: input.appliedLoadN },
    outputs: { withdrawalPerInLbf: r2(wPerIn), groupCapacityN: r2(capacityN), safetyFactor: r3(sf) },
    workings: [
      `Per-inch withdrawal ${type === "lag_screw" ? "W=1800·G^1.5·D^0.75" : "W=2850·G²·D"} = ${r2(wPerIn)} lbf/in (G=${G}, D=${r3(Din)} in)`,
      `Group capacity = ${r2(wPerIn)}·${r3(penIn)} in·${input.count} = ${r2(capacityLbf)} lbf = ${r2(capacityN)} N`,
      `SF = ${r2(capacityN)}/${r2(input.appliedLoadN)} = ${r3(sf)} (required ≥ ${reqSF})`,
    ],
    safetyFactor: r3(sf),
    pass,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 3D-printed part strength + thermal service
// ---------------------------------------------------------------------------

/**
 * FDM printed-part strength on an *effective* rectangular section: the walls
 * form a solid shell of thickness t = wallCount·lineWidth and the core carries
 * only its infill fraction. Effective A and I are the shell plus infill-scaled
 * core. Loads across the layer lines derate strength by the material's
 * layer-adhesion factor (Z-strength ≪ in-plane strength).
 */
export function printedPart(input: {
  title?: string;
  mode: "tension" | "bending";
  /** Overall (bounding) solid cross-section, mm. */
  widthMm: number;
  heightMm: number;
  wallCount: number;
  lineWidthMm: number;
  /** Infill density 0–100 (%). */
  infillPct: number;
  tensileStrengthMPa: number;
  /** Z-strength knockdown when loaded across layers (0–1). */
  layerAdhesionFactor?: number;
  /** True when the principal stress crosses the print layers. */
  loadAcrossLayers?: boolean;
  /** tension: axial load N. */
  loadN?: number;
  /** bending: span + midspan point load. */
  spanMm?: number;
  pointLoadN?: number;
  requiredSF?: number;
}): CalcResult {
  if (input.mode !== "tension" && input.mode !== "bending") {
    throw new Error(`printed_part mode must be "tension" or "bending" (got "${input.mode}").`);
  }
  const w = input.widthMm;
  const h = input.heightMm;
  const t = Math.max(0, input.wallCount * input.lineWidthMm);
  const rho = Math.min(Math.max(input.infillPct, 0), 100) / 100;
  const coreW = Math.max(0, w - 2 * t);
  const coreH = Math.max(0, h - 2 * t);
  const coreA = coreW * coreH;
  const shellA = w * h - coreA;
  const effA = shellA + rho * coreA;
  const Ifull = (w * h ** 3) / 12;
  const Icore = (coreW * coreH ** 3) / 12;
  const effI = Ifull - Icore + rho * Icore;
  const knock = input.loadAcrossLayers ? (input.layerAdhesionFactor ?? 0.5) : 1;
  const strength = input.tensileStrengthMPa * knock;
  const reqSF = input.requiredSF ?? requiredSafetyFactor("ultimate");
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];
  if (input.loadAcrossLayers)
    warnings.push({ severity: "warning", message: `Load crosses the print layers — strength derated ×${knock} for layer adhesion. Reorient the part so the load runs along the layers if you can.` });
  if (t * 2 >= Math.min(w, h))
    warnings.push({ severity: "info", message: "Walls meet in the middle — the part is effectively solid; infill has no effect." });

  const workings: string[] = [
    `Shell t = wallCount·lineWidth = ${input.wallCount}·${r2(input.lineWidthMm)} = ${r2(t)} mm`,
    `Effective area = shell + ρ·core = ${r2(shellA)} + ${rho}·${r2(coreA)} = ${r2(effA)} mm²`,
  ];
  let sigma: number;
  let sf: number;
  let extraOut: Record<string, number | string>;
  if (input.mode === "tension") {
    const P = input.loadN ?? 0;
    sigma = effA > 0 ? P / effA : Infinity;
    sf = sigma > 0 ? strength / sigma : Infinity;
    workings.push(`σ = P/Aeff = ${r2(P)}/${r2(effA)} = ${r3(sigma)} MPa`);
    extraOut = { effectiveAreaMm2: r2(effA), tensileStressMPa: r3(sigma) };
  } else {
    const L = input.spanMm ?? 0;
    const P = input.pointLoadN ?? 0;
    const M = (P * L) / 4; // simple beam, midspan point load
    const S = h > 0 ? effI / (h / 2) : 0;
    sigma = S > 0 ? M / S : Infinity;
    sf = sigma > 0 ? strength / sigma : Infinity;
    workings.push(
      `Effective I = ${r2(effI)} mm⁴; S = I/c = ${r2(S)} mm³`,
      `M = PL/4 = ${r2(P)}·${r2(L)}/4 = ${r2(M)} N·mm; σ = M/S = ${r3(sigma)} MPa`,
    );
    extraOut = { effectiveIMm4: r2(effI), bendingStressMPa: r3(sigma) };
  }
  if (knock < 1) workings.push(`Layer-adhesion knockdown ×${knock}: usable strength = ${r3(strength)} MPa`);
  workings.push(`SF = ${r3(strength)}/${r3(sigma)} = ${r3(sf)} (required ≥ ${reqSF}, basis: ultimate)`);
  const pass = sf >= reqSF;
  if (!pass)
    warnings.push({ severity: "critical", message: `Printed-part safety factor ${r3(sf)} below required ${reqSF} — add walls, raise infill, thicken the section, or reorient.` });

  return {
    calc: "printed_part",
    title: input.title ?? `Printed part — ${input.mode}, ${r2(w)}×${r2(h)} mm, ${input.wallCount} walls @ ${input.infillPct}% infill`,
    inputs: {
      mode: input.mode,
      widthMm: w,
      heightMm: h,
      wallCount: input.wallCount,
      lineWidthMm: input.lineWidthMm,
      infillPct: input.infillPct,
      tensileStrengthMPa: input.tensileStrengthMPa,
      loadAcrossLayers: input.loadAcrossLayers ?? false,
    },
    outputs: { ...extraOut, usableStrengthMPa: r3(strength), safetyFactor: r3(sf) },
    workings,
    safetyFactor: r3(sf),
    pass,
    warnings,
  };
}

/** Peak-temperature presets (°C) for the thermal service check. */
const HEAT_SCENARIOS = {
  indoor: { peakC: 30, note: "typical heated/cooled interior" },
  outdoor_shade: { peakC: 45, note: "hot-summer ambient, out of direct sun" },
  direct_sun: { peakC: 0, note: "ambient + solar gain" },
  hot_car: { peakC: 75, note: "parked-car interior; a dark dashboard can exceed 80 °C" },
} as const;

/**
 * Will a plastic part survive its environment without softening? Compares the
 * material's max service temperature (heat-deflection / continuous-use temp)
 * against a conservative expected peak for the scenario. `direct_sun` adds a
 * solar-gain rise to ambient (dark surfaces get much hotter than light ones).
 * A screening check, not a thermal simulation — softening can begin below the
 * rated service temp, so keep a margin.
 */
export function heatCheck(input: {
  title?: string;
  /** Material max service / heat-deflection temperature, °C. */
  maxServiceTempC: number;
  scenario: "indoor" | "outdoor_shade" | "direct_sun" | "hot_car" | "custom";
  /** Ambient air temp for direct_sun / custom, °C (default 40). */
  ambientC?: number;
  /** Surface tone for direct_sun solar gain. */
  surface?: "light" | "dark";
  /** Recommended margin below the service temp, °C (default 10). */
  marginC?: number;
}): CalcResult {
  const margin = input.marginC ?? 10;
  const ambient = input.ambientC ?? 40;
  let peak: number;
  const workings: string[] = [];
  if (input.scenario === "custom") {
    peak = ambient;
    workings.push(`Custom expected peak = ${r2(peak)} °C`);
  } else if (input.scenario === "direct_sun") {
    const gain = input.surface === "dark" ? 30 : 15;
    peak = ambient + gain;
    workings.push(`Direct sun: ambient ${r2(ambient)} + solar gain ${gain} (${input.surface ?? "light"} surface) = ${r2(peak)} °C`);
  } else {
    const preset = HEAT_SCENARIOS[input.scenario as keyof typeof HEAT_SCENARIOS];
    if (!preset) {
      throw new Error(`Unknown scenario "${input.scenario}" — use "indoor", "outdoor_shade", "direct_sun", "hot_car", or "custom".`);
    }
    peak = preset.peakC;
    workings.push(`Scenario "${input.scenario}" (${preset.note}): expected peak ${r2(peak)} °C`);
  }
  const headroom = input.maxServiceTempC - peak;
  const pass = headroom >= margin;
  const marginal = headroom >= 0 && headroom < margin;
  workings.push(`Service temp ${r2(input.maxServiceTempC)} °C − expected peak ${r2(peak)} °C = ${r2(headroom)} °C headroom (want ≥ ${margin} °C)`);
  const warnings: CalcWarning[] = [
    { severity: "info", message: "Screening check only — glass-transition softening/creep can start below the rated service temp, and a loaded part sags sooner. Verify against your material's datasheet." },
  ];
  if (headroom < 0)
    warnings.push({ severity: "critical", message: `Expected peak ${r2(peak)} °C exceeds the material's ${r2(input.maxServiceTempC)} °C service limit — it will soften/deform. Use a higher-temp material (PETG/ASA/PC/nylon over PLA) or shade/ventilate the part.` });
  else if (marginal)
    warnings.push({ severity: "warning", message: `Only ${r2(headroom)} °C of headroom — thin margin for a hot day or a loaded part. Prefer ≥ ${margin} °C.` });
  return {
    calc: "heat_check",
    title: input.title ?? `Thermal service — ${input.scenario}`,
    inputs: {
      maxServiceTempC: input.maxServiceTempC,
      scenario: input.scenario,
      ambientC: input.scenario === "direct_sun" || input.scenario === "custom" ? ambient : "n/a",
      surface: input.surface ?? "n/a",
      marginC: margin,
    },
    outputs: { expectedPeakC: r2(peak), serviceTempC: r2(input.maxServiceTempC), headroomC: r2(headroom), pass },
    workings,
    pass,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Carpentry geometry
// ---------------------------------------------------------------------------

/** Rafter geometry from run + pitch (rise per 12 run, or degrees). */
export function rafterCalc(input: {
  title?: string;
  runMm: number;
  /** Either riseOver12 (e.g. 4 for 4:12) or pitchDeg. */
  riseOver12?: number;
  pitchDeg?: number;
  /** Overhang beyond the wall along the rafter slope. */
  overhangMm?: number;
}): CalcResult {
  const pitch =
    input.pitchDeg !== undefined ? input.pitchDeg : deg(Math.atan((input.riseOver12 ?? 0) / 12));
  const riseMm = input.runMm * Math.tan(rad(pitch));
  const slopeLen = input.runMm / Math.cos(rad(pitch));
  const total = slopeLen + (input.overhangMm ?? 0);
  return {
    calc: "rafter",
    title: input.title ?? `Rafter — run ${r2(input.runMm)} mm @ ${r2(pitch)}°`,
    inputs: { runMm: input.runMm, pitchDeg: r2(pitch), overhangMm: input.overhangMm ?? 0 },
    outputs: {
      riseMm: r2(riseMm),
      rafterLengthMm: r2(total),
      plumbCutDeg: r2(pitch),
      seatCutDeg: r2(90 - pitch),
      birdsmouthNote: "Seat width = wall plate width; never notch more than 1/3 of rafter depth.",
    },
    workings: [
      `Pitch = ${r2(pitch)}°  (rise ${r2(riseMm)} mm over run ${r2(input.runMm)} mm)`,
      `Slope length = run/cos(pitch) = ${r2(slopeLen)} mm${input.overhangMm ? ` + overhang ${input.overhangMm} = ${r2(total)} mm` : ""}`,
    ],
    warnings: [STRUCTURAL_DISCLAIMER],
  };
}

/** Stair stringer layout with IRC-style comfort/code checks. */
export function stairCalc(input: { title?: string; totalRiseMm: number; targetRiserMm?: number; treadRunMm?: number }): CalcResult {
  const target = input.targetRiserMm ?? 180;
  const risers = Math.max(1, Math.round(input.totalRiseMm / target));
  const riser = input.totalRiseMm / risers;
  const run = input.treadRunMm ?? 254; // 10 in
  const treads = risers - 1;
  const totalRun = treads * run;
  const stringerLen = Math.sqrt(input.totalRiseMm ** 2 + totalRun ** 2);
  const angle = deg(Math.atan2(input.totalRiseMm, totalRun));
  const warnings: CalcWarning[] = [STRUCTURAL_DISCLAIMER];
  if (riser > 196)
    warnings.push({ severity: "critical", message: `Riser ${r2(riser)} mm exceeds the 196 mm (7¾ in) IRC maximum.` });
  if (run < 254)
    warnings.push({ severity: "warning", message: "Tread run below 254 mm (10 in) IRC minimum." });
  const comfort = riser * 2 + run;
  if (comfort < 610 || comfort > 660)
    warnings.push({ severity: "info", message: `Comfort rule 2R+T = ${r2(comfort)} mm (ideal 610–660 mm).` });
  return {
    calc: "stairs",
    title: input.title ?? `Stairs — total rise ${r2(input.totalRiseMm)} mm`,
    inputs: { totalRiseMm: input.totalRiseMm, targetRiserMm: target, treadRunMm: run },
    outputs: {
      risers,
      riserHeightMm: r2(riser),
      treads,
      treadRunMm: run,
      totalRunMm: r2(totalRun),
      stringerLengthMm: r2(stringerLen),
      stairAngleDeg: r2(angle),
    },
    workings: [
      `Risers = round(${r2(input.totalRiseMm)}/${target}) = ${risers} → riser = ${r2(riser)} mm`,
      `Total run = ${treads} treads × ${run} = ${r2(totalRun)} mm; stringer = √(rise²+run²) = ${r2(stringerLen)} mm @ ${r2(angle)}°`,
    ],
    warnings,
  };
}

/**
 * Compound miter for a splayed box/frame: sides slope `slopeFromHorizontalDeg`
 * (90 = vertical box, 0 = flat frame) meeting at `cornerAngleDeg` (interior).
 * Returns the saw miter + blade bevel for stock cut flat.
 *   miter = atan(cos β · tan(γ/2)),  bevel = asin(sin β · sin(γ/2))
 * Anchors: flat frame (β=0,γ=90) → 45/0; vertical box (β=90) → 0/45;
 * 45° splay → 35.26/30.
 */
export function compoundMiter(input: { cornerAngleDeg?: number; slopeFromHorizontalDeg: number }): CalcResult {
  const corner = input.cornerAngleDeg ?? 90;
  // For an interior corner γ, each piece is cut at (180−γ)/2 from square when flat.
  const flatMiter = rad((180 - corner) / 2);
  const beta = rad(input.slopeFromHorizontalDeg);
  const miter = Math.atan(Math.cos(beta) * Math.tan(flatMiter));
  const bevel = Math.asin(Math.sin(beta) * Math.sin(flatMiter));
  return {
    calc: "compound_miter",
    title: `Compound miter — ${corner}° corner, ${r2(input.slopeFromHorizontalDeg)}° slope`,
    inputs: { cornerAngleDeg: corner, slopeFromHorizontalDeg: input.slopeFromHorizontalDeg },
    outputs: { miterDeg: r2(deg(miter)), bevelDeg: r2(deg(bevel)) },
    workings: [
      `Flat-frame miter for a ${corner}° corner = (180−${corner})/2 = ${r2(deg(flatMiter))}°`,
      `miter = atan(cos ${r2(input.slopeFromHorizontalDeg)}° · tan ${r2(deg(flatMiter))}°) = ${r2(deg(miter))}°`,
      `bevel = asin(sin ${r2(input.slopeFromHorizontalDeg)}° · sin ${r2(deg(flatMiter))}°) = ${r2(deg(bevel))}°`,
    ],
    warnings: [],
  };
}

/** Triangle solver — SSS / SAS / ASA. Sides mm, angles degrees (A opposite a…). */
export function triangleSolve(input: {
  aMm?: number;
  bMm?: number;
  cMm?: number;
  ADeg?: number;
  BDeg?: number;
  CDeg?: number;
}): CalcResult {
  let { aMm: a, bMm: b, cMm: c } = input;
  let A = input.ADeg,
    B = input.BDeg,
    C = input.CDeg;
  const workings: string[] = [];

  const known = [a, b, c].filter((v) => v !== undefined).length;
  if (known === 3) {
    // SSS — law of cosines
    A = deg(Math.acos((b! ** 2 + c! ** 2 - a! ** 2) / (2 * b! * c!)));
    B = deg(Math.acos((a! ** 2 + c! ** 2 - b! ** 2) / (2 * a! * c!)));
    C = 180 - A - B;
    workings.push("SSS: angles from the law of cosines.");
  } else if (known === 2 && [A, B, C].filter((v) => v !== undefined).length >= 1) {
    // SAS (included angle) or SSA — handle SAS: the given angle is between the two sides.
    if (a !== undefined && b !== undefined && C !== undefined) {
      c = Math.sqrt(a ** 2 + b ** 2 - 2 * a * b * Math.cos(rad(C)));
      A = deg(Math.asin((a * Math.sin(rad(C))) / c));
      B = 180 - A - C;
      workings.push("SAS: c from the law of cosines, then the law of sines.");
    } else if (a !== undefined && c !== undefined && B !== undefined) {
      b = Math.sqrt(a ** 2 + c ** 2 - 2 * a * c * Math.cos(rad(B)));
      A = deg(Math.asin((a * Math.sin(rad(B))) / b));
      C = 180 - A - B;
      workings.push("SAS: b from the law of cosines, then the law of sines.");
    } else if (b !== undefined && c !== undefined && A !== undefined) {
      a = Math.sqrt(b ** 2 + c ** 2 - 2 * b * c * Math.cos(rad(A)));
      B = deg(Math.asin((b * Math.sin(rad(A))) / a));
      C = 180 - A - B;
      workings.push("SAS: a from the law of cosines, then the law of sines.");
    } else {
      throw new Error("Provide the angle *between* the two known sides (SAS), or all three sides (SSS).");
    }
  } else if (known === 1 && [A, B, C].filter((v) => v !== undefined).length >= 2) {
    // ASA/AAS
    if (A === undefined) A = 180 - (B ?? 0) - (C ?? 0);
    if (B === undefined) B = 180 - A - (C ?? 0);
    if (C === undefined) C = 180 - A - B;
    const sinA = Math.sin(rad(A)),
      sinB = Math.sin(rad(B)),
      sinC = Math.sin(rad(C));
    const ratio = a !== undefined ? a / sinA : b !== undefined ? b / sinB : c! / sinC;
    a = a ?? ratio * sinA;
    b = b ?? ratio * sinB;
    c = c ?? ratio * sinC;
    workings.push("ASA/AAS: remaining angle from 180° sum, sides from the law of sines.");
  } else {
    throw new Error("Need SSS, SAS, or ASA/AAS inputs.");
  }

  const s = (a! + b! + c!) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - a!) * (s - b!) * (s - c!)));
  return {
    calc: "triangle",
    title: "Triangle solve",
    inputs: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Record<string, number>,
    outputs: {
      aMm: r2(a!),
      bMm: r2(b!),
      cMm: r2(c!),
      ADeg: r2(A!),
      BDeg: r2(B!),
      CDeg: r2(C!),
      areaMm2: r2(area),
    },
    workings,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Stock nesting / cut optimization
// ---------------------------------------------------------------------------

export interface CutPart1D {
  label: string;
  lengthMm: number;
  quantity: number;
}

/** 1D cutting-stock: first-fit-decreasing with kerf between cuts. */
export function nest1D(parts: CutPart1D[], stockLengthMm: number, kerfMm = 3): NestingResult1D {
  const expanded: { label: string; lengthMm: number }[] = [];
  for (const p of parts)
    for (let i = 0; i < p.quantity; i++)
      expanded.push({ label: p.quantity > 1 ? `${p.label} #${i + 1}` : p.label, lengthMm: p.lengthMm });
  expanded.sort((x, y) => y.lengthMm - x.lengthMm);

  const sticks: { cuts: { label: string; lengthMm: number }[]; used: number }[] = [];
  const unplaced: { label: string; lengthMm: number }[] = [];

  for (const part of expanded) {
    if (part.lengthMm > stockLengthMm) {
      unplaced.push(part);
      continue;
    }
    let placed = false;
    for (const stick of sticks) {
      const needed = part.lengthMm + (stick.cuts.length > 0 ? kerfMm : 0);
      if (stick.used + needed <= stockLengthMm) {
        stick.cuts.push(part);
        stick.used += needed;
        placed = true;
        break;
      }
    }
    if (!placed) sticks.push({ cuts: [part], used: part.lengthMm });
  }

  const totalParts = expanded.reduce((s, p) => s + p.lengthMm, 0) - unplaced.reduce((s, p) => s + p.lengthMm, 0);
  const totalStock = sticks.length * stockLengthMm;
  return {
    stockLengthMm,
    kerfMm,
    sticks: sticks.map((s, i) => ({ index: i + 1, cuts: s.cuts, wasteMm: r2(stockLengthMm - s.used) })),
    sticksNeeded: sticks.length,
    totalPartsLengthMm: r2(totalParts),
    utilizationPct: totalStock > 0 ? r2((totalParts / totalStock) * 100) : 0,
    unplaced,
  };
}

export interface CutPart2D {
  label: string;
  wMm: number;
  hMm: number;
  quantity: number;
  allowRotate?: boolean;
}

/** 2D sheet nesting: shelf (row) packing, guillotine-cut friendly. */
export function nest2D(parts: CutPart2D[], sheetWidthMm: number, sheetHeightMm: number, kerfMm = 3): NestingResult2D {
  interface Piece {
    label: string;
    w: number;
    h: number;
    allowRotate: boolean;
  }
  const pieces: Piece[] = [];
  for (const p of parts)
    for (let i = 0; i < p.quantity; i++)
      pieces.push({
        label: p.quantity > 1 ? `${p.label} #${i + 1}` : p.label,
        w: p.wMm,
        h: p.hMm,
        allowRotate: p.allowRotate ?? true,
      });
  // Tallest-first shelf packing.
  pieces.sort((a, b) => Math.max(b.h, b.w) - Math.max(a.h, a.w));

  interface Shelf {
    y: number;
    height: number;
    xCursor: number;
  }
  interface Sheet {
    shelves: Shelf[];
    yCursor: number;
    placements: NestingResult2D["sheets"][number]["placements"];
  }
  const sheets: Sheet[] = [];
  const unplaced: NestingResult2D["unplaced"] = [];

  const tryPlace = (sheet: Sheet, p: Piece): boolean => {
    const orientations: { w: number; h: number; rotated: boolean }[] = [{ w: p.w, h: p.h, rotated: false }];
    if (p.allowRotate && p.w !== p.h) orientations.push({ w: p.h, h: p.w, rotated: true });
    // Existing shelves first.
    for (const o of orientations) {
      for (const shelf of sheet.shelves) {
        if (o.h <= shelf.height && shelf.xCursor + o.w <= sheetWidthMm) {
          sheet.placements.push({ label: p.label, xMm: shelf.xCursor, yMm: shelf.y, wMm: o.w, hMm: o.h, rotated: o.rotated });
          shelf.xCursor += o.w + kerfMm;
          return true;
        }
      }
    }
    // New shelf (prefer the orientation with the smaller height to keep shelves short).
    orientations.sort((a, b) => a.h - b.h);
    for (const o of orientations) {
      if (o.w <= sheetWidthMm && sheet.yCursor + o.h <= sheetHeightMm) {
        const shelf: Shelf = { y: sheet.yCursor, height: o.h, xCursor: 0 };
        sheet.shelves.push(shelf);
        sheet.yCursor += o.h + kerfMm;
        sheet.placements.push({ label: p.label, xMm: 0, yMm: shelf.y, wMm: o.w, hMm: o.h, rotated: o.rotated });
        shelf.xCursor = o.w + kerfMm;
        return true;
      }
    }
    return false;
  };

  for (const p of pieces) {
    const fitsAtAll =
      (p.w <= sheetWidthMm && p.h <= sheetHeightMm) ||
      (p.allowRotate && p.h <= sheetWidthMm && p.w <= sheetHeightMm);
    if (!fitsAtAll) {
      unplaced.push({ label: p.label, wMm: p.w, hMm: p.h });
      continue;
    }
    let placed = false;
    for (const sheet of sheets) {
      if (tryPlace(sheet, p)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      const sheet: Sheet = { shelves: [], yCursor: 0, placements: [] };
      sheets.push(sheet);
      if (!tryPlace(sheet, p)) unplaced.push({ label: p.label, wMm: p.w, hMm: p.h });
    }
  }

  const usedArea = sheets.reduce((s, sh) => s + sh.placements.reduce((a, pl) => a + pl.wMm * pl.hMm, 0), 0);
  const totalArea = sheets.length * sheetWidthMm * sheetHeightMm;
  return {
    sheetWidthMm,
    sheetHeightMm,
    kerfMm,
    sheets: sheets.map((s, i) => ({ index: i + 1, placements: s.placements })),
    sheetsNeeded: sheets.length,
    utilizationPct: totalArea > 0 ? r2((usedArea / totalArea) * 100) : 0,
    unplaced,
  };
}

/** Fabric yardage from pattern pieces nested onto a fixed-width roll. */
export function fabricYardage(
  pieces: CutPart2D[],
  fabricWidthMm: number,
  wastageFactor = 1.15,
): CalcResult {
  // Nest onto a "sheet" the width of the fabric and effectively unlimited length,
  // then read how much length was consumed.
  const longEnough = 100_000; // 100 m — practical upper bound for one project
  const nested = nest2D(pieces, fabricWidthMm, longEnough, 10);
  let maxY = 0;
  for (const sheet of nested.sheets)
    for (const p of sheet.placements) maxY = Math.max(maxY, p.yMm + p.hMm);
  const lengthMm = maxY * wastageFactor;
  const yards = lengthMm / 914.4;
  const meters = lengthMm / 1000;
  return {
    calc: "fabric_yardage",
    title: `Fabric yardage — ${pieces.reduce((s, p) => s + p.quantity, 0)} pieces on ${r2(fabricWidthMm)} mm roll`,
    inputs: { fabricWidthMm, wastageFactor, pieceCount: pieces.reduce((s, p) => s + p.quantity, 0) },
    outputs: {
      lengthNeededMm: r2(lengthMm),
      yards: r2(Math.ceil(yards * 4) / 4), // round up to quarter-yard
      meters: r2(Math.ceil(meters * 10) / 10),
      unplacedPieces: nested.unplaced.length,
    },
    workings: [
      `Shelf-nested onto a ${r2(fabricWidthMm)} mm-wide roll → ${r2(maxY)} mm consumed`,
      `× ${wastageFactor} pattern-matching/shrinkage allowance = ${r2(lengthMm)} mm (${r2(yards)} yd)`,
    ],
    warnings:
      nested.unplaced.length > 0
        ? [{ severity: "critical", message: `${nested.unplaced.length} piece(s) are wider than the fabric — rotate or split them.` }]
        : [],
  };
}

// ---------------------------------------------------------------------------
// Mass / cost rollups
// ---------------------------------------------------------------------------

/** Mass (g) of a solid volume in mm³ at density kg/m³. */
export function massG(volumeMm3: number, densityKgM3: number): number {
  return (volumeMm3 / 1e9) * densityKgM3 * 1000;
}

/** Board feet for lumber pricing (nominal thickness×width in inches × length ft / 12). */
export function boardFeet(thicknessIn: number, widthIn: number, lengthFt: number): number {
  return (thicknessIn * widthIn * lengthFt) / 12;
}
