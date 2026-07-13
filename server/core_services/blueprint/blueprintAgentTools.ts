/**
 * Blueprint Studio — the agentic toolset.
 *
 * Builds the `ExtraAgentTool[]` a Blueprint planning run injects into
 * `ChatAgentRunner` (built-ins disabled — this agent designs and calculates;
 * it never edits files or runs shell commands). Every safety-relevant number
 * flows through the deterministic calc engine or the FEA bridge — the model
 * is instructed to never do load math in its head.
 *
 * All lengths crossing the tool boundary are millimeters; loads accept both
 * N and kg (converted via 9.80665). The UI converts to the plan's display
 * units — the stored truth stays metric.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db.factory.js";
import {
  blueprintBomItems,
  blueprintCutItems,
  blueprintFiles,
  blueprintPlans,
  blueprintSimResults,
  type BlueprintPlan,
} from "../../../drizzle/schema.js";
import type { ExtraAgentTool } from "../services/ChatAgentRunner.js";
import type { ToolDefinition } from "../services/toolSchemas.js";
import type { CalcResult, FeaRegion, PatternPieceSpec } from "@shared/blueprint";
import { isSovereignMode, assertImageProviderAllowedInMode } from "../../_core/sovereign.js";
import {
  beamAnalysis,
  boltedConnection,
  columnBuckling,
  compoundMiter,
  fabricYardage,
  fastenerGroupCheck,
  filletWeld,
  heatCheck,
  nFromKg,
  nest1D,
  nest2D,
  printedPart,
  rafterCalc,
  stairCalc,
  torsion,
  triangleSolve,
  woodJoinery,
  type SectionSpec,
} from "./calcEngine.js";
import { getMaterial, listCategories, searchMaterials } from "./materialsCatalog.js";
import { BlueprintCadService } from "./BlueprintCadService.js";
import { BlueprintFeaService } from "./BlueprintFeaService.js";
import { persistPlanFile } from "./fileStore.js";
import { buildDrawingSvg, buildDxf } from "./drawingSvg.js";
import { extractFeatureEdges, projectEdges } from "./meshUtils.js";
import { buildPatternPdf } from "./patternPdf.js";
import { generateConceptImage, type ConceptProvider } from "./conceptRender.js";
import { searchMaterialsWeb } from "./webMaterialSearch.js";

export interface BlueprintToolContext {
  planId: string;
  userId: number;
  executionMode?: string;
  /** Aborts long-running tools (FEA) when the client disconnects. */
  signal?: AbortSignal;
}

type Args = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

async function requirePlan(ctx: BlueprintToolContext): Promise<BlueprintPlan> {
  const db = await getDb();
  const [plan] = await db
    .select()
    .from(blueprintPlans)
    .where(and(eq(blueprintPlans.id, ctx.planId), eq(blueprintPlans.userId, ctx.userId)))
    .limit(1);
  if (!plan) throw new Error("Blueprint plan not found (or not yours).");
  return plan;
}

/** Fill material-dependent calc inputs from a catalog entry. */
function materialFill(materialKey: string | undefined) {
  if (!materialKey) return null;
  const mat = getMaterial(materialKey);
  if (!mat) throw new Error(`Unknown materialKey "${materialKey}" — use list_materials to find valid keys.`);
  return mat;
}

async function persistSimResult(
  ctx: BlueprintToolContext,
  kind: "calc" | "fea",
  name: string,
  inputs: Record<string, unknown>,
  results: Record<string, unknown>,
  status: "completed" | "failed" = "completed",
  fileId?: string,
): Promise<string> {
  const db = await getDb();
  const id = uuidv4();
  await db.insert(blueprintSimResults).values({ id, planId: ctx.planId, kind, name, status, inputs, results, fileId });
  return id;
}

async function persistFile(
  ctx: BlueprintToolContext,
  kind: (typeof blueprintFiles.$inferInsert)["kind"],
  name: string,
  data: Buffer | string,
  mimeType: string,
  meta?: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  // Revision lineage lives in the shared helper (reused by geometry import).
  return persistPlanFile(ctx.planId, kind, name, data, mimeType, meta);
}

function sectionFromArgs(raw: unknown): SectionSpec {
  const s = (raw ?? {}) as Args;
  const shape = str(s.shape);
  if (shape === "rect") return { shape, widthMm: num(s.widthMm)!, depthMm: num(s.depthMm)! };
  if (shape === "rect_tube") return { shape, widthMm: num(s.widthMm)!, depthMm: num(s.depthMm)!, wallMm: num(s.wallMm)! };
  if (shape === "round_bar") return { shape, diameterMm: num(s.diameterMm)! };
  if (shape === "round_tube") return { shape, odMm: num(s.odMm)!, wallMm: num(s.wallMm)! };
  throw new Error('section.shape must be one of "rect" | "rect_tube" | "round_bar" | "round_tube".');
}

const compact = (v: unknown) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// Tool definitions + executors
// ---------------------------------------------------------------------------

export function buildBlueprintTools(ctx: BlueprintToolContext): ExtraAgentTool[] {
  const sovereign = isSovereignMode(ctx.executionMode);

  const tools: ExtraAgentTool[] = [
    // ── Materials ───────────────────────────────────────────────────────────
    {
      title: "Materials catalog",
      definition: {
        name: "list_materials",
        description:
          "Search the built-in materials database (lumber, sheet goods, steel, aluminum, fasteners, 3D-print filaments, resins, fabrics, foams, thermoplastics) with real mechanical properties and typical costs. Use the returned `key` in other tools (engineering_calc, compile_cad, run_fea) so calculations use real properties.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search terms, e.g. \"square tube frame\" or \"stretch fabric bodysuit\"." },
            category: { type: "string", description: `Optional filter: ${listCategories().join(" | ")}` },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        const results = searchMaterials(String(args.query ?? ""), str(args.category) as never, 12);
        if (results.length === 0) return "No catalog matches — try broader terms or another category.";
        return compact(
          results.map((m) => ({
            key: m.key,
            name: m.name,
            category: m.category,
            strengthBasis: m.strengthBasis,
            densityKgM3: m.densityKgM3,
            E_MPa: m.elasticModulusMPa,
            yieldMPa: m.yieldStrengthMPa,
            tensileMPa: m.tensileStrengthMPa,
            bendingMPa: m.bendingStrengthMPa,
            stock: m.stockSizes.map((s) => ({ label: s.label, costUsd: s.typicalCostUsd })),
            notes: m.notes,
          })),
        );
      },
    },

    // ── Deterministic engineering calcs ────────────────────────────────────
    {
      title: "Engineering calculation",
      definition: {
        name: "engineering_calc",
        description:
          "Run a deterministic engineering calculation — ALWAYS use this instead of doing structural math yourself. calc types: beam_bending {spanMm, support: simple|cantilever|fixed_both, pointLoadKg|pointLoadN, pointPosMm?, totalUdlKg?, section {shape: rect|rect_tube|round_bar|round_tube, widthMm/depthMm/wallMm/odMm/diameterMm}, materialKey (fills E/strength) OR elasticModulusMPa+bendingStrengthMPa+strengthBasis, deflectionLimitRatio?, zLoadedPrint? (true = FDM layer-adhesion knockdown)}; column_buckling {lengthMm, endCondition: pinned_pinned|fixed_free|fixed_pinned|fixed_fixed, axialLoadKg|axialLoadN, section, materialKey?}; fastener_group {fastenerName, capacityPerFastenerN, count, appliedLoadKg|appliedLoadN}; fillet_weld {legMm, lengthMm (total weld run), electrodeStrengthMPa? (default E70=483), appliedLoadKg|appliedLoadN}; bolted_connection {boltDiameterMm, boltCount, plateThicknessMm, edgeDistanceMm, boltUltimateMPa? (grade 8.8≈800), materialKey (plate Fu) OR plateUltimateMPa, shearPlanes?, appliedLoadKg|appliedLoadN} — governs of bolt-shear/bearing/tear-out; torsion {torqueNmm OR torqueNm, lengthMm, section {round_bar diameterMm | round_tube odMm+wallMm}, materialKey (fills G+strength) OR shearModulusMPa+shearStrengthMPa} — shafts/axles; wood_joinery {fastener: lag_screw|wood_screw, diameterMm, penetrationMm, count, materialKey (fills specific gravity) OR specificGravity, endGrain?, appliedLoadKg|appliedLoadN} — screw withdrawal; printed_part {mode: tension|bending, widthMm, heightMm, wallCount, lineWidthMm, infillPct, materialKey (filament tensile/layerAdhesion) OR tensileStrengthMPa, loadAcrossLayers?, loadKg|loadN (tension) | spanMm+pointLoadKg|pointLoadN (bending)} — FDM part strength on the effective walls+infill section; heat_check {materialKey (fills maxServiceTempC) OR maxServiceTempC, scenario: indoor|outdoor_shade|direct_sun|hot_car|custom, ambientC? (sun/custom), surface: light|dark (sun), marginC?} — will a plastic part survive the heat/sun without softening; rafter {runMm, riseOver12|pitchDeg, overhangMm?}; stairs {totalRiseMm, targetRiserMm?, treadRunMm?}; compound_miter {cornerAngleDeg?, slopeFromHorizontalDeg}; triangle {aMm?,bMm?,cMm?,ADeg?,BDeg?,CDeg?}. The result (with workings + safety factor) is saved to the plan's Simulation record.",
        parameters: {
          type: "object",
          properties: {
            calc: {
              type: "string",
              enum: [
                "beam_bending",
                "column_buckling",
                "fastener_group",
                "fillet_weld",
                "bolted_connection",
                "torsion",
                "wood_joinery",
                "printed_part",
                "heat_check",
                "rafter",
                "stairs",
                "compound_miter",
                "triangle",
              ],
            },
            params: { type: "object", description: "Calculation parameters (see the description for each calc's fields)." },
            name: { type: "string", description: "Optional human title for the saved result." },
          },
          required: ["calc", "params"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        await requirePlan(ctx);
        const p = (args.params ?? {}) as Args;
        const calc = String(args.calc);
        let result: CalcResult;

        if (calc === "beam_bending" || calc === "column_buckling") {
          const mat = materialFill(str(p.materialKey));
          const zPrint = p.zLoadedPrint === true;
          if (calc === "beam_bending") {
            const spanMm = num(p.spanMm);
            if (!spanMm) throw new Error("beam_bending requires spanMm.");
            const pointLoadN = num(p.pointLoadN) ?? (num(p.pointLoadKg) !== undefined ? nFromKg(num(p.pointLoadKg)!) : undefined);
            const totalUdlKg = num(p.totalUdlKg);
            result = beamAnalysis({
              title: str(args.name),
              spanMm,
              support: (str(p.support) as "simple" | "cantilever" | "fixed_both") ?? "simple",
              pointLoadN,
              pointPosMm: num(p.pointPosMm),
              udlNPerMm: num(p.udlNPerMm) ?? (totalUdlKg !== undefined ? nFromKg(totalUdlKg) / spanMm : undefined),
              section: sectionFromArgs(p.section),
              elasticModulusMPa: num(p.elasticModulusMPa) ?? mat?.elasticModulusMPa ?? errMat("elasticModulusMPa"),
              bendingStrengthMPa:
                num(p.bendingStrengthMPa) ?? mat?.bendingStrengthMPa ?? mat?.yieldStrengthMPa ?? mat?.tensileStrengthMPa ?? errMat("bendingStrengthMPa"),
              shearStrengthMPa: num(p.shearStrengthMPa) ?? mat?.shearStrengthMPa,
              strengthBasis: (str(p.strengthBasis) as never) ?? mat?.strengthBasis ?? "ultimate",
              deflectionLimitRatio: num(p.deflectionLimitRatio),
              layerAdhesionFactor: zPrint ? (mat?.layerAdhesionFactor ?? 0.6) : undefined,
            });
          } else {
            result = columnBuckling({
              title: str(args.name),
              lengthMm: num(p.lengthMm) ?? errNum("lengthMm"),
              endCondition: (str(p.endCondition) as never) ?? "pinned_pinned",
              axialLoadN: num(p.axialLoadN) ?? (num(p.axialLoadKg) !== undefined ? nFromKg(num(p.axialLoadKg)!) : errNum("axialLoadN or axialLoadKg")),
              section: sectionFromArgs(p.section),
              elasticModulusMPa: num(p.elasticModulusMPa) ?? mat?.elasticModulusMPa ?? errMat("elasticModulusMPa"),
              compressiveStrengthMPa: num(p.compressiveStrengthMPa) ?? mat?.yieldStrengthMPa ?? mat?.bendingStrengthMPa,
              strengthBasis: (str(p.strengthBasis) as never) ?? mat?.strengthBasis ?? "ultimate",
            });
          }
        } else if (calc === "fastener_group") {
          result = fastenerGroupCheck({
            title: str(args.name),
            fastenerName: str(p.fastenerName) ?? "fastener",
            capacityPerFastenerN: num(p.capacityPerFastenerN) ?? errNum("capacityPerFastenerN"),
            count: num(p.count) ?? errNum("count"),
            appliedLoadN: num(p.appliedLoadN) ?? (num(p.appliedLoadKg) !== undefined ? nFromKg(num(p.appliedLoadKg)!) : errNum("appliedLoadN or appliedLoadKg")),
          });
        } else if (calc === "fillet_weld") {
          result = filletWeld({
            title: str(args.name),
            legMm: num(p.legMm) ?? errNum("legMm"),
            lengthMm: num(p.lengthMm) ?? errNum("lengthMm"),
            electrodeStrengthMPa: num(p.electrodeStrengthMPa) ?? 483, // E70
            appliedLoadN: num(p.appliedLoadN) ?? (num(p.appliedLoadKg) !== undefined ? nFromKg(num(p.appliedLoadKg)!) : errNum("appliedLoadN or appliedLoadKg")),
          });
        } else if (calc === "bolted_connection") {
          const mat = materialFill(str(p.materialKey));
          result = boltedConnection({
            title: str(args.name),
            boltDiameterMm: num(p.boltDiameterMm) ?? errNum("boltDiameterMm"),
            boltCount: num(p.boltCount) ?? errNum("boltCount"),
            plateThicknessMm: num(p.plateThicknessMm) ?? errNum("plateThicknessMm"),
            edgeDistanceMm: num(p.edgeDistanceMm) ?? errNum("edgeDistanceMm"),
            boltUltimateMPa: num(p.boltUltimateMPa) ?? 800, // grade 8.8
            plateUltimateMPa: num(p.plateUltimateMPa) ?? mat?.tensileStrengthMPa ?? mat?.yieldStrengthMPa ?? errMat("plateUltimateMPa"),
            shearPlanes: num(p.shearPlanes),
            appliedLoadN: num(p.appliedLoadN) ?? (num(p.appliedLoadKg) !== undefined ? nFromKg(num(p.appliedLoadKg)!) : errNum("appliedLoadN or appliedLoadKg")),
          });
        } else if (calc === "torsion") {
          const mat = materialFill(str(p.materialKey));
          const torqueNmm = num(p.torqueNmm) ?? (num(p.torqueNm) !== undefined ? num(p.torqueNm)! * 1000 : errNum("torqueNmm or torqueNm"));
          const poisson = num(p.poissonRatio) ?? (mat?.category === "steel" || mat?.category === "aluminum" ? 0.3 : 0.33);
          const shearModulusMPa = num(p.shearModulusMPa) ?? (mat?.elasticModulusMPa ? mat.elasticModulusMPa / (2 * (1 + poisson)) : errMat("shearModulusMPa"));
          const secRaw = (p.section ?? {}) as Args;
          const shape = str(secRaw.shape);
          const torsionSection =
            shape === "round_bar"
              ? { shape: "round_bar" as const, diameterMm: num(secRaw.diameterMm) ?? errNum("section.diameterMm") }
              : shape === "round_tube"
                ? { shape: "round_tube" as const, odMm: num(secRaw.odMm) ?? errNum("section.odMm"), wallMm: num(secRaw.wallMm) ?? errNum("section.wallMm") }
                : (() => {
                    throw new Error('torsion section.shape must be "round_bar" or "round_tube".');
                  })();
          result = torsion({
            title: str(args.name),
            torqueNmm,
            lengthMm: num(p.lengthMm) ?? errNum("lengthMm"),
            section: torsionSection,
            shearModulusMPa,
            shearStrengthMPa: num(p.shearStrengthMPa) ?? (mat?.yieldStrengthMPa ? 0.6 * mat.yieldStrengthMPa : mat?.shearStrengthMPa),
            strengthBasis: (str(p.strengthBasis) as never) ?? mat?.strengthBasis,
          });
        } else if (calc === "wood_joinery") {
          const mat = materialFill(str(p.materialKey));
          result = woodJoinery({
            title: str(args.name),
            fastener: (str(p.fastener) as "lag_screw" | "wood_screw") ?? "lag_screw",
            specificGravity: num(p.specificGravity) ?? (mat?.densityKgM3 ? mat.densityKgM3 / 1000 : errMat("specificGravity")),
            diameterMm: num(p.diameterMm) ?? errNum("diameterMm"),
            penetrationMm: num(p.penetrationMm) ?? errNum("penetrationMm"),
            count: num(p.count) ?? errNum("count"),
            endGrain: p.endGrain === true,
            appliedLoadN: num(p.appliedLoadN) ?? (num(p.appliedLoadKg) !== undefined ? nFromKg(num(p.appliedLoadKg)!) : errNum("appliedLoadN or appliedLoadKg")),
          });
        } else if (calc === "printed_part") {
          const mat = materialFill(str(p.materialKey));
          result = printedPart({
            title: str(args.name),
            mode: (str(p.mode) as "tension" | "bending") ?? "tension",
            widthMm: num(p.widthMm) ?? errNum("widthMm"),
            heightMm: num(p.heightMm) ?? errNum("heightMm"),
            wallCount: num(p.wallCount) ?? 3,
            lineWidthMm: num(p.lineWidthMm) ?? 0.4,
            infillPct: num(p.infillPct) ?? 20,
            tensileStrengthMPa: num(p.tensileStrengthMPa) ?? mat?.tensileStrengthMPa ?? mat?.bendingStrengthMPa ?? errMat("tensileStrengthMPa"),
            layerAdhesionFactor: num(p.layerAdhesionFactor) ?? mat?.layerAdhesionFactor,
            loadAcrossLayers: p.loadAcrossLayers === true,
            loadN: num(p.loadN) ?? (num(p.loadKg) !== undefined ? nFromKg(num(p.loadKg)!) : undefined),
            spanMm: num(p.spanMm),
            pointLoadN: num(p.pointLoadN) ?? (num(p.pointLoadKg) !== undefined ? nFromKg(num(p.pointLoadKg)!) : undefined),
          });
        } else if (calc === "heat_check") {
          const mat = materialFill(str(p.materialKey));
          const maxServiceTempC = num(p.maxServiceTempC) ?? mat?.maxServiceTempC;
          if (maxServiceTempC === undefined)
            throw new Error("Provide maxServiceTempC or a materialKey with a service temperature (list_materials — filaments/resins/thermoplastics carry one).");
          result = heatCheck({
            title: str(args.name),
            maxServiceTempC,
            scenario: (str(p.scenario) as never) ?? "direct_sun",
            ambientC: num(p.ambientC),
            surface: str(p.surface) === "dark" ? "dark" : str(p.surface) === "light" ? "light" : undefined,
            marginC: num(p.marginC),
          });
        } else if (calc === "rafter") {
          result = rafterCalc({
            title: str(args.name),
            runMm: num(p.runMm) ?? errNum("runMm"),
            riseOver12: num(p.riseOver12),
            pitchDeg: num(p.pitchDeg),
            overhangMm: num(p.overhangMm),
          });
        } else if (calc === "stairs") {
          result = stairCalc({
            title: str(args.name),
            totalRiseMm: num(p.totalRiseMm) ?? errNum("totalRiseMm"),
            targetRiserMm: num(p.targetRiserMm),
            treadRunMm: num(p.treadRunMm),
          });
        } else if (calc === "compound_miter") {
          result = compoundMiter({
            cornerAngleDeg: num(p.cornerAngleDeg),
            slopeFromHorizontalDeg: num(p.slopeFromHorizontalDeg) ?? errNum("slopeFromHorizontalDeg"),
          });
        } else if (calc === "triangle") {
          result = triangleSolve({
            aMm: num(p.aMm),
            bMm: num(p.bMm),
            cMm: num(p.cMm),
            ADeg: num(p.ADeg),
            BDeg: num(p.BDeg),
            CDeg: num(p.CDeg),
          });
        } else {
          throw new Error(`Unknown calc "${calc}".`);
        }

        await persistSimResult(ctx, "calc", str(args.name) ?? result.title, result.inputs, {
          outputs: result.outputs,
          workings: result.workings,
          safetyFactor: result.safetyFactor,
          pass: result.pass,
          warnings: result.warnings,
        });
        return compact(result);
      },
    },

    // ── Cut optimization ────────────────────────────────────────────────────
    {
      title: "Cut optimization",
      definition: {
        name: "optimize_cuts",
        description:
          'Optimize how parts are cut from stock, with kerf. mode "1d": {parts: [{label, lengthMm, quantity}], stockLengthMm, kerfMm?} for linear stock (lumber/tube). mode "2d": {parts: [{label, wMm, hMm, quantity, allowRotate?}], sheetWidthMm, sheetHeightMm, kerfMm?} for sheets. mode "fabric": {parts (2d), fabricWidthMm} → yardage. Returns per-stick/sheet cut assignments, waste %, and how many sticks/sheets/yards to buy. Pass writeToBom {materialKey?, name?, unit?, unitCost?, supplier?, url?, spec?} to record the buy-quantity straight onto the matching BOM stock line (upserted by materialKey, else name) — no need to re-key it into set_bom; the nesting result is saved to the plan for provenance.',
        parameters: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["1d", "2d", "fabric"] },
            parts: { type: "array", description: "Parts to cut (see description for the per-mode shape)." },
            stockLengthMm: { type: "number" },
            sheetWidthMm: { type: "number" },
            sheetHeightMm: { type: "number" },
            fabricWidthMm: { type: "number" },
            kerfMm: { type: "number", description: "Blade kerf (default 3 mm; use 0 for fabric/foam)." },
            writeToBom: { type: "object", description: "Optional: {materialKey?, name?, unit?, unitCost?, supplier?, url?, spec?} — upsert the computed buy-quantity onto the BOM." },
          },
          required: ["mode", "parts"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        const mode = String(args.mode);
        const kerf = num(args.kerfMm);
        const parts = (args.parts ?? []) as never[];

        let result: Record<string, unknown>;
        let buyQty: number;
        let defaultUnit: string;
        if (mode === "1d") {
          const r = nest1D(parts, num(args.stockLengthMm) ?? errNum("stockLengthMm"), kerf ?? 3);
          result = r as unknown as Record<string, unknown>;
          buyQty = r.sticksNeeded;
          defaultUnit = "stick";
        } else if (mode === "2d") {
          const r = nest2D(parts, num(args.sheetWidthMm) ?? errNum("sheetWidthMm"), num(args.sheetHeightMm) ?? errNum("sheetHeightMm"), kerf ?? 3);
          result = r as unknown as Record<string, unknown>;
          buyQty = r.sheetsNeeded;
          defaultUnit = "sheet";
        } else if (mode === "fabric") {
          const r = fabricYardage(parts, num(args.fabricWidthMm) ?? errNum("fabricWidthMm"));
          result = r as unknown as Record<string, unknown>;
          buyQty = num(r.outputs.yards) ?? 0;
          defaultUnit = "yd";
        } else {
          throw new Error('mode must be "1d", "2d", or "fabric".');
        }

        const wtb = args.writeToBom;
        if (wtb && typeof wtb === "object") {
          const w = wtb as Args;
          await requirePlan(ctx);
          const db = await getDb();
          const materialKey = str(w.materialKey);
          const name = str(w.name) ?? (materialKey ? (getMaterial(materialKey)?.name ?? "Stock") : "Stock");
          const patch = {
            name,
            kind: "material" as const,
            materialKey,
            spec: str(w.spec) ?? "",
            quantity: buyQty,
            unit: str(w.unit) ?? defaultUnit,
            unitCost: num(w.unitCost),
            supplier: str(w.supplier),
            url: str(w.url),
          };
          const existing = await db.select().from(blueprintBomItems).where(eq(blueprintBomItems.planId, ctx.planId));
          const match = existing.find((b) => (materialKey ? b.materialKey === materialKey : b.name === name));
          if (match) {
            await db.update(blueprintBomItems).set(patch).where(eq(blueprintBomItems.id, match.id));
          } else {
            await db.insert(blueprintBomItems).values({ id: uuidv4(), planId: ctx.planId, sortOrder: existing.length, ...patch });
          }
          await persistSimResult(ctx, "calc", `Cut optimization — ${name}`, { mode, buyQty, unit: patch.unit }, { nesting: result });
          return compact({ nesting: result, bomWrite: { name, quantity: buyQty, unit: patch.unit, updated: !!match } });
        }
        return compact(result);
      },
    },

    // ── Plan document ───────────────────────────────────────────────────────
    {
      title: "Update plan",
      definition: {
        name: "update_plan",
        description:
          "Update the persistent Build Plan document: title, overview (markdown — the design description), safetyNotes (markdown), category, status (draft|planning|ready|building|complete), and assemblySteps (ordered [{title, detail, parts?, tools?}]). Update sections incrementally as the design firms up — the user sees changes live.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            overview: { type: "string" },
            safetyNotes: { type: "string" },
            category: { type: "string", enum: ["carpentry", "metal_fab", "structure", "vehicle", "printing", "costume", "mixed", "other"] },
            status: { type: "string", enum: ["draft", "planning", "ready", "building", "complete"] },
            assemblySteps: { type: "array", description: "Ordered steps: [{title, detail, parts?: string[], tools?: string[]}]" },
          },
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        await requirePlan(ctx);
        const db = await getDb();
        const patch: Partial<typeof blueprintPlans.$inferInsert> = {};
        if (str(args.title)) patch.title = str(args.title);
        if (typeof args.overview === "string") patch.overview = args.overview;
        if (typeof args.safetyNotes === "string") patch.safetyNotes = args.safetyNotes;
        if (str(args.category)) patch.category = str(args.category) as never;
        if (str(args.status)) patch.status = str(args.status) as never;
        if (Array.isArray(args.assemblySteps)) {
          patch.assemblySteps = (args.assemblySteps as Args[]).map((s) => ({
            title: String(s.title ?? "Step"),
            detail: String(s.detail ?? ""),
            parts: Array.isArray(s.parts) ? (s.parts as string[]).map(String) : undefined,
            tools: Array.isArray(s.tools) ? (s.tools as string[]).map(String) : undefined,
          }));
        }
        if (Object.keys(patch).length === 0) return "Nothing to update — pass at least one field.";
        await db.update(blueprintPlans).set(patch).where(eq(blueprintPlans.id, ctx.planId));
        return `Plan updated: ${Object.keys(patch).join(", ")}.`;
      },
    },
    {
      title: "Bill of materials",
      definition: {
        name: "set_bom",
        description:
          'Write the plan\'s bill of materials. items: [{name, kind?: material|hardware|tool|consumable, materialKey? (catalog key), spec?, quantity, unit? (pcs|ft|m|sheet|yd|kg|spool), unitCost? (USD), supplier?, url?, notes?}]. mode "replace" rewrites the whole BOM (default); "append" adds to it.',
        parameters: {
          type: "object",
          properties: {
            items: { type: "array", description: "BOM line items." },
            mode: { type: "string", enum: ["replace", "append"] },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        await requirePlan(ctx);
        const db = await getDb();
        const items = (args.items ?? []) as Args[];
        if (!Array.isArray(items) || items.length === 0) throw new Error("items must be a non-empty array.");
        const mode = str(args.mode) ?? "replace";
        let sortStart = 0;
        if (mode === "replace") {
          await db.delete(blueprintBomItems).where(eq(blueprintBomItems.planId, ctx.planId));
        } else {
          const existing = await db.select().from(blueprintBomItems).where(eq(blueprintBomItems.planId, ctx.planId));
          sortStart = existing.length;
        }
        await db.insert(blueprintBomItems).values(
          items.map((item, i) => ({
            id: uuidv4(),
            planId: ctx.planId,
            name: String(item.name ?? "Item"),
            kind: (str(item.kind) as never) ?? "material",
            materialKey: str(item.materialKey),
            spec: str(item.spec) ?? "",
            quantity: num(item.quantity) ?? 1,
            unit: str(item.unit) ?? "pcs",
            unitCost: num(item.unitCost),
            supplier: str(item.supplier),
            url: str(item.url),
            notes: str(item.notes),
            sortOrder: sortStart + i,
          })),
        );
        const total = items.reduce((s, it) => s + (num(it.unitCost) ?? 0) * (num(it.quantity) ?? 1), 0);
        return `BOM ${mode === "replace" ? "written" : "extended"}: ${items.length} item(s), estimated cost $${total.toFixed(2)}.`;
      },
    },
    {
      title: "Cut list",
      definition: {
        name: "set_cut_list",
        description:
          'Write the plan\'s cut list. items: [{partLabel, stockName? (which BOM stock it comes from), materialKey?, quantity?, lengthMm?, widthMm?, thicknessMm?, miter1Deg?, bevel1Deg?, miter2Deg?, bevel2Deg?, notes?}]. Angles in degrees from a square cut (0/omitted = square). mode "replace" (default) or "append".',
        parameters: {
          type: "object",
          properties: {
            items: { type: "array", description: "Cut-list line items." },
            mode: { type: "string", enum: ["replace", "append"] },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        await requirePlan(ctx);
        const db = await getDb();
        const items = (args.items ?? []) as Args[];
        if (!Array.isArray(items) || items.length === 0) throw new Error("items must be a non-empty array.");
        const mode = str(args.mode) ?? "replace";
        let sortStart = 0;
        if (mode === "replace") {
          await db.delete(blueprintCutItems).where(eq(blueprintCutItems.planId, ctx.planId));
        } else {
          const existing = await db.select().from(blueprintCutItems).where(eq(blueprintCutItems.planId, ctx.planId));
          sortStart = existing.length;
        }
        await db.insert(blueprintCutItems).values(
          items.map((item, i) => ({
            id: uuidv4(),
            planId: ctx.planId,
            partLabel: String(item.partLabel ?? `Part ${sortStart + i + 1}`),
            stockName: str(item.stockName) ?? "",
            materialKey: str(item.materialKey),
            quantity: Math.max(1, Math.round(num(item.quantity) ?? 1)),
            lengthMm: num(item.lengthMm),
            widthMm: num(item.widthMm),
            thicknessMm: num(item.thicknessMm),
            miter1Deg: num(item.miter1Deg),
            bevel1Deg: num(item.bevel1Deg),
            miter2Deg: num(item.miter2Deg),
            bevel2Deg: num(item.bevel2Deg),
            notes: str(item.notes),
            sortOrder: sortStart + i,
          })),
        );
        return `Cut list ${mode === "replace" ? "written" : "extended"}: ${items.length} part(s).`;
      },
    },

    // ── CAD / geometry ──────────────────────────────────────────────────────
    {
      title: "Compile CAD model",
      definition: {
        name: "compile_cad",
        description:
          "Compile parametric CAD code into real geometry (mm units): interactive 3D model, binary STL, a dimensioned three-view blueprint drawing (SVG), and a DXF — all saved to the plan. The plan's engine decides the language. JSCAD (default): JavaScript with a `jscad` global (@jscad/modeling — jscad.primitives.cuboid/cylinder/sphere, jscad.booleans.union/subtract/intersect, jscad.transforms.translate/rotate/mirror, jscad.extrusions.extrudeLinear, jscad.primitives.polygon …); define `function main()` returning a solid, an array of solids, or [{name, geometry}] for multi-part assemblies. OpenSCAD engine: standard .scad source. Pass materialKey for mass estimates.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "The complete CAD program." },
            partName: { type: "string", description: "Name for the part/assembly (used in filenames + drawing title block)." },
            materialKey: { type: "string", description: "Catalog key for density → mass estimate." },
          },
          required: ["code"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        const plan = await requirePlan(ctx);
        const code = str(args.code) ?? errStr("code");
        const partName = str(args.partName) ?? "part";
        const mat = materialFill(str(args.materialKey));
        const cad = BlueprintCadService.getInstance();
        const { parts, log } = await cad.compile(plan.cadEngine, code, {
          partName,
          densityKgM3: mat?.densityKgM3,
        });

        const srcExt = plan.cadEngine === "openscad" ? "scad" : "jscad.js";
        const files: { id: string; name: string }[] = [];
        files.push(await persistFile(ctx, "cad_source", `${partName}.${srcExt}`, code, "text/plain", { engine: plan.cadEngine }));

        const summary: Args[] = [];
        for (const part of parts) {
          const meta = {
            partLabel: part.name,
            engine: plan.cadEngine,
            boundsMm: part.mesh.boundsMm,
            volumeMm3: part.mesh.volumeMm3,
            massG: part.massG,
          };
          files.push(await persistFile(ctx, "mesh_json", `${part.name}.mesh.json`, JSON.stringify(part.mesh), "application/json", meta));
          files.push(await persistFile(ctx, "stl", `${part.name}.stl`, cad.buildStl(part.mesh, part.name), "model/stl", meta));
          const svg = buildDrawingSvg(part.mesh, { partName: part.name, planTitle: plan.title, units: plan.units });
          files.push(await persistFile(ctx, "drawing_svg", `${part.name}.drawing.svg`, svg, "image/svg+xml", meta));
          const edges = extractFeatureEdges(part.mesh.positions, part.mesh.indices);
          const dxf = buildDxf(projectEdges(part.mesh.positions, edges, "front"));
          files.push(await persistFile(ctx, "drawing_dxf", `${part.name}.front.dxf`, dxf, "application/dxf", meta));

          const { min, max } = part.mesh.boundsMm;
          summary.push({
            name: part.name,
            sizeMm: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => Math.round(v * 100) / 100),
            volumeMm3: Math.round(part.mesh.volumeMm3 ?? 0),
            massG: part.massG,
            triangles: part.mesh.triangleCount,
          });
        }
        return compact({
          engine: plan.cadEngine,
          parts: summary,
          savedFiles: files.map((f) => f.name),
          compileLog: log.slice(0, 1500) || undefined,
        });
      },
    },
    {
      title: "Generate pattern",
      definition: {
        name: "generate_pattern",
        description:
          "Generate a true-scale printable pattern PDF (tiled US-Letter pages with calibration square, registration marks and glue-grid labels) for fabric/foam pieces. pieces: [{name, points: [[x,y]…] closed outline in mm, seamAllowanceMm? (typ. 10–15 for fabric, 0 for EVA foam), cutNote? (e.g. \"Cut 2 mirrored — main fabric\"), grainlineDeg?}]. Solid line = cut, dashed = stitch. Saved to the plan's files.",
        parameters: {
          type: "object",
          properties: {
            setName: { type: "string", description: "Name for this pattern set, e.g. \"Chest armor\" or \"Bodysuit\"." },
            pieces: { type: "array", description: "The pattern pieces (see description)." },
          },
          required: ["setName", "pieces"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        const plan = await requirePlan(ctx);
        const setName = str(args.setName) ?? "pattern";
        const rawPieces = (args.pieces ?? []) as Args[];
        if (!Array.isArray(rawPieces) || rawPieces.length === 0) throw new Error("pieces must be a non-empty array.");
        const pieces: PatternPieceSpec[] = rawPieces.map((piece, i) => {
          const pts = (piece.points ?? []) as [number, number][];
          if (!Array.isArray(pts) || pts.length < 3) throw new Error(`Piece ${i + 1} needs at least 3 outline points.`);
          return {
            name: str(piece.name) ?? `Piece ${i + 1}`,
            outline: { name: str(piece.name) ?? `Piece ${i + 1}`, points: pts.map((pt) => [Number(pt[0]), Number(pt[1])]) },
            seamAllowanceMm: num(piece.seamAllowanceMm),
            cutNote: str(piece.cutNote),
            grainlineDeg: num(piece.grainlineDeg),
          };
        });
        const pdf = await buildPatternPdf(pieces, { planTitle: plan.title, setName });
        const file = await persistFile(ctx, "pattern_pdf", `${setName}.pattern.pdf`, pdf, "application/pdf", {
          pieceCount: pieces.length,
        });
        return `Pattern PDF "${file.name}" generated (${pieces.length} pieces, ${(pdf.length / 1024).toFixed(0)} KB) and saved to the plan. Remind the user: print at 100% and verify the calibration square.`;
      },
    },

    // ── FEA ─────────────────────────────────────────────────────────────────
    {
      title: "FEA stress simulation",
      definition: {
        name: "run_fea",
        description:
          "Run a real finite-element stress analysis (Gmsh tet mesh + linear-static solve) on a previously compiled part's STL. Provide stlName (a filename from compile_cad's savedFiles; omit = latest STL), the material (materialKey or explicit elasticModulusMPa/densityKgM3/strengthMPa), a fixture region and a load. Regions: {kind: min_x|max_x|min_y|max_y|min_z|max_z, tolMm?} or {kind: box, box: {min:[x,y,z], max:[x,y,z]}}. load: {region, forceN: [fx,fy,fz]} (or forceKg for gravity-direction weight). Returns max von Mises stress, max displacement, and safety factor; the stress field is saved for the 3D heatmap. Takes up to a few minutes — it runs as a background job (the Simulation tab shows it running→completed) and survives a client disconnect, so the solve is never lost.",
        parameters: {
          type: "object",
          properties: {
            stlName: { type: "string" },
            materialKey: { type: "string" },
            elasticModulusMPa: { type: "number" },
            poissonRatio: { type: "number" },
            densityKgM3: { type: "number" },
            strengthMPa: { type: "number" },
            fixture: { type: "object", description: "Fixed-support region selector." },
            load: { type: "object", description: "{region, forceN:[fx,fy,fz]} or {region, forceKg}" },
            includeGravity: { type: "boolean" },
            meshSizeMm: { type: "number" },
            name: { type: "string", description: "Title for the saved result." },
          },
          required: ["fixture", "load"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        await requirePlan(ctx);
        const db = await getDb();
        // Resolve the STL to analyze.
        const stls = await db
          .select()
          .from(blueprintFiles)
          .where(and(eq(blueprintFiles.planId, ctx.planId), eq(blueprintFiles.kind, "stl")))
          .orderBy(desc(blueprintFiles.createdAt));
        const wanted = str(args.stlName);
        const stlRow = wanted ? stls.find((f) => f.name.includes(wanted)) : stls[0];
        if (!stlRow) throw new Error(wanted ? `No STL named "${wanted}" — run compile_cad first.` : "No compiled STL on this plan — run compile_cad first.");

        const mat = materialFill(str(args.materialKey));
        const E = num(args.elasticModulusMPa) ?? mat?.elasticModulusMPa;
        if (!E) throw new Error("Provide materialKey or elasticModulusMPa.");
        const density = num(args.densityKgM3) ?? mat?.densityKgM3 ?? 1000;
        const strength = num(args.strengthMPa) ?? mat?.yieldStrengthMPa ?? mat?.tensileStrengthMPa ?? mat?.bendingStrengthMPa ?? 0;
        const poisson = num(args.poissonRatio) ?? (mat?.category === "steel" || mat?.category === "aluminum" ? 0.3 : 0.35);

        const loadCfg = (args.load ?? {}) as Args;
        const forceN = Array.isArray(loadCfg.forceN)
          ? (loadCfg.forceN as number[]).map(Number)
          : num(loadCfg.forceKg) !== undefined
            ? [0, 0, -nFromKg(num(loadCfg.forceKg)!)]
            : null;
        if (!forceN || forceN.length !== 3) throw new Error("load.forceN must be [fx, fy, fz] in newtons (or pass load.forceKg).");

        const fea = BlueprintFeaService.getInstance();
        const avail = await fea.checkAvailability();
        if (!avail.available) {
          return `FEA is unavailable on this machine: ${avail.error}. Install with \`${avail.hint}\` — meanwhile rely on engineering_calc for the structural checks.`;
        }

        const request = {
          stlPath: stlRow.path,
          elasticModulusMPa: E,
          poissonRatio: poisson,
          densityKgM3: density,
          strengthMPa: strength,
          fixture: (args.fixture ?? { kind: "min_z" }) as FeaRegion,
          load: { region: (loadCfg.region ?? { kind: "max_z" }) as FeaRegion, forceN: forceN as [number, number, number] },
          includeGravity: args.includeGravity === true,
          meshSizeMm: num(args.meshSizeMm),
        };

        // Record a "running" row up-front (the Simulation tab shows it live),
        // then solve DECOUPLED from the chat-stream signal — a client
        // disconnect no longer kills a multi-minute solve; it finishes and the
        // row is updated in the background. The tool still awaits the result so
        // the agent can report it in the connected case.
        const simId = uuidv4();
        {
          const dbNow = await getDb();
          await dbNow.insert(blueprintSimResults).values({
            id: simId,
            planId: ctx.planId,
            kind: "fea",
            name: str(args.name) ?? `FEA — ${stlRow.name}`,
            status: "running",
            jobId: simId,
            inputs: { stl: stlRow.name, E_MPa: E, poisson, densityKgM3: density, strengthMPa: strength, fixture: args.fixture, load: args.load },
            results: {},
          });
        }

        const solve = (async () => {
          const { summary, fieldJson } = await fea.run(request); // no ctx.signal → survives a disconnect
          let fileId: string | undefined;
          if (summary.status === "completed" && fieldJson) {
            fileId = (
              await persistFile(ctx, "fea_result", `${stlRow.name.replace(/\.stl$/, "")}.fea.json`, fieldJson, "application/json", {
                stlFileId: stlRow.id,
                maxVonMisesMPa: summary.maxVonMisesMPa,
              })
            ).id;
          }
          const dbNow = await getDb();
          await dbNow
            .update(blueprintSimResults)
            .set({ status: summary.status, results: { ...summary } as Record<string, unknown>, fileId })
            .where(eq(blueprintSimResults.id, simId));
          return summary;
        })().catch(async (err) => {
          const summary = { status: "failed" as const, error: (err as Error).message };
          const dbNow = await getDb();
          await dbNow.update(blueprintSimResults).set({ status: "failed", results: summary }).where(eq(blueprintSimResults.id, simId)).catch(() => {});
          return summary;
        });

        return compact(await solve);
      },
    },

    // ── Concept renders ─────────────────────────────────────────────────────
    {
      title: "Concept render",
      definition: {
        name: "generate_concept_image",
        description:
          'Generate an illustrative concept image of the finished project and save it to the plan. provider: "local" (ComfyUI, works offline), "fal" or "openart" (cloud — unavailable in sovereign mode). Write a strong visual prompt (subject, materials, setting, style).',
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "The image prompt." },
            provider: { type: "string", enum: ["local", "fal", "openart"] },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        await requirePlan(ctx);
        const prompt = str(args.prompt) ?? errStr("prompt");
        const provider = (str(args.provider) as ConceptProvider) ?? "local";
        assertImageProviderAllowedInMode(provider, ctx.executionMode);
        const result = await generateConceptImage(prompt, provider);
        const ext = result.mimeType === "image/jpeg" ? "jpg" : result.mimeType === "image/webp" ? "webp" : "png";
        const file = await persistFile(ctx, "concept_image", `concept-${Date.now()}.${ext}`, result.data, result.mimeType, {
          prompt,
          provider,
        });
        return `Concept render "${file.name}" generated via ${provider} and saved to the plan (visible in the Overview tab).`;
      },
    },
  ];

  // ── Cloud-gated web search: never offered to sovereign users ─────────────
  if (!sovereign) {
    tools.push({
      title: "Web material search",
      definition: {
        name: "search_materials_web",
        description:
          "Search the live web for current material prices, availability, and specialty items (suppliers, product pages). Use for cost estimates and sourcing links — NEVER as a source of mechanical properties (those come from list_materials). Returns titles, URLs and snippets.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: 'e.g. "2x2 steel square tube 0.120 wall price per foot"' },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      execute: async (args: Args) => {
        const results = await searchMaterialsWeb(str(args.query) ?? errStr("query"));
        if (results.length === 0) return "No web results — try different terms.";
        return compact(results);
      },
    });
  }

  return tools;
}

function errNum(field: string): never {
  throw new Error(`Missing required numeric field "${field}".`);
}
function errStr(field: string): never {
  throw new Error(`Missing required field "${field}".`);
}
function errMat(field: string): never {
  throw new Error(`Provide "${field}" or a materialKey (find one with list_materials).`);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export interface PlanSnapshot {
  plan: BlueprintPlan;
  bomItems: (typeof blueprintBomItems.$inferSelect)[];
  cutItems: (typeof blueprintCutItems.$inferSelect)[];
  simResults: (typeof blueprintSimResults.$inferSelect)[];
  files: (typeof blueprintFiles.$inferSelect)[];
}

export async function loadPlanSnapshot(planId: string, userId: number): Promise<PlanSnapshot> {
  const db = await getDb();
  const [plan] = await db
    .select()
    .from(blueprintPlans)
    .where(and(eq(blueprintPlans.id, planId), eq(blueprintPlans.userId, userId)))
    .limit(1);
  if (!plan) throw new Error("Blueprint plan not found (or not yours).");
  const [bomItems, cutItems, simResults, files] = await Promise.all([
    db.select().from(blueprintBomItems).where(eq(blueprintBomItems.planId, planId)).orderBy(asc(blueprintBomItems.sortOrder)),
    db.select().from(blueprintCutItems).where(eq(blueprintCutItems.planId, planId)).orderBy(asc(blueprintCutItems.sortOrder)),
    db.select().from(blueprintSimResults).where(eq(blueprintSimResults.planId, planId)).orderBy(desc(blueprintSimResults.createdAt)),
    db.select().from(blueprintFiles).where(eq(blueprintFiles.planId, planId)).orderBy(desc(blueprintFiles.createdAt)),
  ]);
  return { plan, bomItems, cutItems, simResults, files };
}

/**
 * The Blueprint agent's system prompt: role + hard rules + a live snapshot of
 * the plan document so every turn sees the current BOM/cut list/verification
 * state without re-querying.
 */
export function buildBlueprintSystemPrompt(snapshot: PlanSnapshot, opts: { sovereign: boolean; feaAvailable: boolean; openscadAvailable: boolean }): string {
  const { plan } = snapshot;
  const bomSummary = snapshot.bomItems
    .map((b) => `- ${b.name} ×${b.quantity} ${b.unit}${b.unitCost != null ? ` @ $${b.unitCost}` : ""}${b.spec ? ` (${b.spec})` : ""}`)
    .join("\n");
  const cutSummary = snapshot.cutItems
    .map(
      (c) =>
        `- ${c.partLabel} ×${c.quantity}${c.lengthMm != null ? ` L=${c.lengthMm}mm` : ""}${c.miter1Deg ? ` miter1=${c.miter1Deg}°` : ""}${c.miter2Deg ? ` miter2=${c.miter2Deg}°` : ""}${c.stockName ? ` from ${c.stockName}` : ""}`,
    )
    .join("\n");
  const simSummary = snapshot.simResults
    .slice(0, 8)
    .map((s) => {
      const r = (s.results ?? {}) as Record<string, unknown>;
      return `- [${s.kind}] ${s.name}: ${s.status}${typeof r.safetyFactor === "number" ? `, SF=${r.safetyFactor}` : ""}${r.pass === false ? " ⚠ FAILED CHECK" : ""}`;
    })
    .join("\n");
  const fileSummary = snapshot.files
    .slice(0, 20)
    .map((f) => `- ${f.name} (${f.kind})`)
    .join("\n");

  return `You are Omnecor's Blueprint Studio agent — an expert fabrication planner covering carpentry, framing/structures, metal fabrication, vehicles, 3D printing, and multi-part costumes (fabric + foam + printed parts). You turn the user's project idea into a complete, followable Build Plan.

HARD RULES:
1. NEVER do structural/load math in your head. Every span, load, deflection, buckling, weld, bolt, torsion, or joint-strength number MUST come from the engineering_calc tool (or run_fea for 3D parts). Quote its safety factor and workings.
2. Use list_materials before recommending materials, and reference catalog keys so calcs use real properties. Use search_materials_web only for prices/sourcing${opts.sovereign ? " (unavailable in sovereign mode)" : ""} — never for mechanical properties.
3. Record everything in the plan document as you go: update_plan (overview, assemblySteps, safetyNotes, status), set_bom, set_cut_list. The user watches these update live — an answer that only lives in chat is not a deliverable.
4. Dimensions in tool calls are millimeters; loads in newtons or kg. Present values to the user in ${plan.units} units${plan.units === "imperial" ? " (convert: 25.4 mm/in, 304.8 mm/ft)" : ""}.
5. For anything people occupy (buildings, decks, stairs) or road-going vehicles, state clearly that local code/licensed-engineer review is required, and put it in safetyNotes.
6. Work incrementally: clarify requirements → propose the design approach in prose → record BOM + cut list → verify structure with calcs${opts.feaAvailable ? "/FEA" : " (FEA unavailable on this machine — pip install gmsh numpy scipy)"} → compile geometry + drawings → patterns for fabric parts → assembly steps + safety notes → set status "ready".

TOOL NOTES:
- compile_cad targets the plan's engine: ${plan.cadEngine.toUpperCase()}${plan.cadEngine === "openscad" && !opts.openscadAvailable ? " — WARNING: the OpenSCAD binary is NOT detected; either the user installs it (Settings → Advanced) or suggest switching the plan to JSCAD" : ""}. Keep models simple and parametric; one compile can return multiple named parts.
- optimize_cuts computes how many sticks/sheets/yards to buy; pass writeToBom to record the buy-quantity straight onto the matching BOM stock line — no need to re-key it into set_bom.
- engineering_calc also covers welds (fillet_weld), bolted joints (bolted_connection — governs bolt-shear/bearing/tear-out), shafts/axles (torsion) and screw withdrawal (wood_joinery). For 3D-printed parts, check strength with printed_part (effective walls+infill section, layer orientation); if the part lives anywhere hot (parked car, direct sun) also run heat_check — PLA softens on a hot dashboard.
- generate_pattern is for flat fabric/EVA pieces (true-scale printable PDF).
- generate_concept_image gives the user a visual of the finished project early — offer it.

CURRENT PLAN DOCUMENT (live snapshot):
Title: ${plan.title}
Category: ${plan.category} · Status: ${plan.status} · Units: ${plan.units} · CAD engine: ${plan.cadEngine}
Brief: ${plan.brief || "(none)"}
Overview: ${plan.overview ? `${plan.overview.slice(0, 600)}${plan.overview.length > 600 ? "…" : ""}` : "(not written yet)"}
Assembly steps: ${plan.assemblySteps?.length ?? 0}
BOM (${snapshot.bomItems.length} items):
${bomSummary || "(empty)"}
Cut list (${snapshot.cutItems.length} parts):
${cutSummary || "(empty)"}
Verification runs:
${simSummary || "(none yet)"}
Generated files:
${fileSummary || "(none yet)"}`;
}
