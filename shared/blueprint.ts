/**
 * Blueprint Studio — shared types (server ⇄ client).
 *
 * The contract for the AI-assisted fabrication planning system: material
 * catalog entries (with real mechanical properties the calc engine consumes),
 * deterministic engineering-calc results, CAD compile output (mesh JSON the
 * ThreeViewer renders), nesting/cut-optimization results, and FEA job I/O.
 *
 * Unit conventions — everything crossing this boundary is SI-metric:
 *   lengths mm · areas mm² · volumes mm³ · forces N · moments N·mm
 *   stresses/moduli MPa · densities kg/m³ · masses g
 * The UI/agent layer converts to the plan's display units (imperial|metric).
 */

export type BlueprintUnits = "imperial" | "metric";
export type CadEngine = "jscad" | "openscad";

export const BLUEPRINT_CATEGORIES = [
  "carpentry",
  "metal_fab",
  "structure",
  "vehicle",
  "printing",
  "costume",
  "mixed",
  "other",
] as const;
export type BlueprintCategory = (typeof BLUEPRINT_CATEGORIES)[number];

export interface AssemblyStep {
  title: string;
  detail: string;
  /** Part labels (cut-list / CAD part names) used in this step. */
  parts?: string[];
  /** Tools needed for this step. */
  tools?: string[];
}

// ---------------------------------------------------------------------------
// Materials catalog
// ---------------------------------------------------------------------------

export type MaterialCategory =
  | "lumber"
  | "sheet_good"
  | "steel"
  | "aluminum"
  | "fastener"
  | "filament"
  | "resin"
  | "fabric"
  | "foam"
  | "thermoplastic"
  | "notion"; // sewing hardware: zippers, velcro, thread, elastic…

/**
 * What the strength numbers on a material mean — the calc engine picks its
 * safety-factor treatment from this:
 *  - `allowable` — published *design* values (graded softwood lumber); safety
 *    factors are already embedded, compare stresses directly.
 *  - `yield`     — metals; design against yield with an explicit SF.
 *  - `ultimate`  — plastics/composites/fabrics; design against ultimate with a
 *    larger explicit SF (and a print-anisotropy knockdown for FDM parts).
 */
export type StrengthBasis = "allowable" | "yield" | "ultimate";

/** A purchasable stock size for a material (lengths/sheets/spools/rolls). */
export interface MaterialStockSize {
  /** Display label, e.g. `2×4 × 8 ft`, `1220×2440×18 mm sheet`, `1 kg spool`. */
  label: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  /** Cross-section for linear stock, e.g. actual 38×89 for a nominal 2×4. */
  sectionWidthMm?: number;
  sectionHeightMm?: number;
  /** Tube/profile wall thickness. */
  wallMm?: number;
  /** Mass-sold stock (filament spools). */
  massG?: number;
  /** Indicative unit price in USD for this stock size (planning estimate only). */
  typicalCostUsd?: number;
}

export interface MaterialEntry {
  /** Stable catalog key, e.g. `lumber.spf_2x4`, `steel.sq_tube_2x2_125`. */
  key: string;
  category: MaterialCategory;
  name: string;
  description: string;
  strengthBasis: StrengthBasis;
  densityKgM3?: number;
  /** Young's modulus E (MPa). */
  elasticModulusMPa?: number;
  /** Metals: yield strength Fy (MPa). */
  yieldStrengthMPa?: number;
  /** Ultimate tensile strength (MPa). */
  tensileStrengthMPa?: number;
  /** Bending strength (MPa) — allowable Fb for graded lumber, MOR otherwise. */
  bendingStrengthMPa?: number;
  /** Shear strength (MPa) — allowable Fv for graded lumber. */
  shearStrengthMPa?: number;
  /** FDM prints: layer-adhesion knockdown (Z-strength ≈ tensile × this). */
  layerAdhesionFactor?: number;
  /** Max service temperature °C (plastics). */
  maxServiceTempC?: number;
  /** Fabric weight g/m². */
  arealDensityGM2?: number;
  /** Fabric stretch: none | 2-way | 4-way. */
  stretch?: "none" | "2-way" | "4-way";
  stockSizes: MaterialStockSize[];
  /** Indicative cost basis for rollups, e.g. { amount: 3.5, per: "m" }. */
  typicalCost?: { amountUsd: number; per: "each" | "m" | "m2" | "kg" | "spool" | "sheet" | "yd" };
  tags: string[];
  /** Honest caveats: grade assumptions, anisotropy, food-safety, outdoor use… */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Engineering calc engine
// ---------------------------------------------------------------------------

export interface CalcWarning {
  severity: "info" | "warning" | "critical";
  message: string;
}

/**
 * The uniform result envelope every deterministic calculation returns. The
 * `workings` lines show the formula and substituted numbers so the plan
 * document records *how* every safety-relevant number was derived — never
 * model mental math.
 */
export interface CalcResult {
  /** Which calculation ran, e.g. `beam_bending`, `column_buckling`. */
  calc: string;
  title: string;
  inputs: Record<string, number | string | boolean>;
  outputs: Record<string, number | string | boolean>;
  /** Formula + substitution lines, human-readable. */
  workings: string[];
  /** Governing safety factor (capacity ÷ demand) where applicable. */
  safetyFactor?: number;
  /** Overall pass/fail against the applied criteria. */
  pass?: boolean;
  warnings: CalcWarning[];
}

/** 1D stock nesting (cut optimization) result. */
export interface NestingResult1D {
  stockLengthMm: number;
  kerfMm: number;
  sticks: { index: number; cuts: { label: string; lengthMm: number }[]; wasteMm: number }[];
  sticksNeeded: number;
  totalPartsLengthMm: number;
  utilizationPct: number;
  /** Parts that do not fit a single stock length. */
  unplaced: { label: string; lengthMm: number }[];
}

/** 2D sheet nesting result (shelf/guillotine layout). */
export interface NestingResult2D {
  sheetWidthMm: number;
  sheetHeightMm: number;
  kerfMm: number;
  sheets: {
    index: number;
    placements: { label: string; xMm: number; yMm: number; wMm: number; hMm: number; rotated: boolean }[];
  }[];
  sheetsNeeded: number;
  utilizationPct: number;
  unplaced: { label: string; wMm: number; hMm: number }[];
}

// ---------------------------------------------------------------------------
// CAD compile (JSCAD in-process / OpenSCAD binary)
// ---------------------------------------------------------------------------

/** Indexed triangle mesh handed to the client 3D viewer. Coordinates in mm. */
export interface MeshJson {
  positions: number[]; // flat xyz
  indices: number[];
  normals?: number[];
  boundsMm: { min: [number, number, number]; max: [number, number, number] };
  triangleCount: number;
  volumeMm3?: number;
  surfaceAreaMm2?: number;
}

/** One compiled part (a CAD compile can emit several named solids). */
export interface CompiledPart {
  name: string;
  mesh: MeshJson;
  /** Estimated mass when a material density was supplied. */
  massG?: number;
}

export interface CadCompileResult {
  engine: CadEngine;
  parts: CompiledPart[];
  /** Generated artifacts persisted to blueprint_files (ids + kinds). */
  files: { id: string; kind: string; name: string }[];
  /** Compiler/console output (warnings, echo output). */
  log: string;
}

/** A 2D outline (used for patterns + DXF export). Ring of [x,y] mm points. */
export interface Outline2D {
  name: string;
  points: [number, number][];
  /** Optional inner holes, each a ring. */
  holes?: [number, number][][];
}

// ---------------------------------------------------------------------------
// FEA (fea_bridge.py — Gmsh tet meshing + linear-static elasticity)
// ---------------------------------------------------------------------------

/** Axis-aligned region selector for boundary conditions, in mesh mm coords. */
export interface FeaRegion {
  /** Select nodes within `tolMm` of the bounding-box face/plane. */
  kind: "min_x" | "max_x" | "min_y" | "max_y" | "min_z" | "max_z" | "box";
  tolMm?: number;
  /** For kind "box": explicit AABB. */
  box?: { min: [number, number, number]; max: [number, number, number] };
}

export interface FeaRequest {
  /** STL file to analyze (a blueprint_files id, resolved server-side). */
  stlFileId: string;
  /** Material properties. */
  elasticModulusMPa: number;
  poissonRatio: number;
  densityKgM3: number;
  /** Strength to judge von Mises stress against (per material basis). */
  strengthMPa: number;
  /** Fixed support region. */
  fixture: FeaRegion;
  /** Load region + total force vector in N. */
  load: { region: FeaRegion; forceN: [number, number, number] };
  includeGravity?: boolean;
  /** Target mesh element size in mm (default: bbox diagonal / 30). */
  meshSizeMm?: number;
}

export interface FeaResultSummary {
  status: "completed" | "failed";
  maxVonMisesMPa?: number;
  maxDisplacementMm?: number;
  safetyFactor?: number;
  nodeCount?: number;
  elementCount?: number;
  /** Per-vertex field data file (JSON) for the heatmap overlay, when produced. */
  fieldFileId?: string;
  error?: string;
  log?: string;
}

// ---------------------------------------------------------------------------
// Pattern generation (costume/fabric — true-scale printable pieces)
// ---------------------------------------------------------------------------

export interface PatternPieceSpec {
  name: string;
  outline: Outline2D;
  /** Seam allowance offset applied around the outline (mm). */
  seamAllowanceMm?: number;
  /** Cutting annotation, e.g. "Cut 2 mirrored — main fabric". */
  cutNote?: string;
  /** Grainline arrow angle in degrees (0 = +x). */
  grainlineDeg?: number;
}
