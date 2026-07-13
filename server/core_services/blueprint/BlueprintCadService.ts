/**
 * Blueprint Studio — dual-engine parametric CAD service.
 *
 * Engine 1 — JSCAD (@jscad/modeling), the built-in default: AI-generated
 * JavaScript CAD code executes in-process inside a `node:vm` sandbox (no
 * filesystem/network/process access exposed; wall-clock timeout), so geometry
 * works out of the box with zero external installs and renders instantly.
 *
 * Engine 2 — OpenSCAD, the optional external binary: exactly the Blender /
 * KiCad integration pattern — path from Settings → Advanced (`openscadPath`),
 * availability probed with `--version`, `.scad` compiled to STL via a safe
 * spawn (argument array, never a shell string), then parsed back to the same
 * mesh contract.
 *
 * Both engines produce `CompiledPart`s (MeshJson in mm) that feed the 3D
 * viewer, STL export, dimensioned drawing SVGs, and DXF handoff.
 *
 * Note on the vm sandbox: it prevents accidents (infinite loops, fs access),
 * not a hostile-multitenant boundary — the code being run is the user's own
 * AI-generated design script on their own machine, mirroring how Blender
 * `executeScript` already works.
 */
import vm from "node:vm";
import path from "path";
import os from "os";
import fsp from "fs/promises";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import * as modeling from "@jscad/modeling";
import type { CadEngine, CompiledPart, MeshJson } from "@shared/blueprint";
import { createLogger } from "../../_core/logger.js";
import { resolveDataPath } from "../../_core/paths.js";
import { getSetting } from "../services/SettingsService.js";
import { jscadGeom3ToMesh, meshToStlBinary, parseStl, toMeshJson } from "./meshUtils.js";

const log = createLogger("BlueprintCadService");

const JSCAD_TIMEOUT_MS = 15_000;
const OPENSCAD_TIMEOUT_MS = 120_000;
/** Guardrail: refuse meshes that would swamp the client viewer / DB payloads. */
const MAX_TRIANGLES = 400_000;

export interface CompileOptions {
  /** Fallback part name when the script returns unnamed geometry. */
  partName?: string;
  /** Material density for mass estimates (kg/m³). */
  densityKgM3?: number;
}

export interface EngineStatus {
  jscad: { available: true };
  openscad: { available: boolean; path: string; version?: string; error?: string };
}

export class BlueprintCadService {
  private static instance: BlueprintCadService | null = null;

  static getInstance(): BlueprintCadService {
    if (!this.instance) this.instance = new BlueprintCadService();
    return this.instance;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Engine status
  // ─────────────────────────────────────────────────────────────────────────

  private openscadPath(): string {
    const configured = getSetting<string>("openscadPath", "");
    return configured && configured.trim() ? configured.trim() : "openscad";
  }

  async getEngineStatus(): Promise<EngineStatus> {
    const bin = this.openscadPath();
    const openscad = await new Promise<EngineStatus["openscad"]>((resolve) => {
      try {
        const proc = spawn(bin, ["--version"], { timeout: 10_000 });
        let out = "";
        proc.stdout?.on("data", (d) => (out += d.toString()));
        proc.stderr?.on("data", (d) => (out += d.toString()));
        proc.on("error", (err) => resolve({ available: false, path: bin, error: err.message }));
        proc.on("close", (code) =>
          resolve(
            code === 0
              ? { available: true, path: bin, version: out.trim().split("\n")[0] }
              : { available: false, path: bin, error: `exit ${code}: ${out.trim()}` },
          ),
        );
      } catch (err) {
        resolve({ available: false, path: bin, error: (err as Error).message });
      }
    });
    return { jscad: { available: true }, openscad };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Compile
  // ─────────────────────────────────────────────────────────────────────────

  async compile(
    engine: CadEngine,
    code: string,
    opts: CompileOptions = {},
  ): Promise<{ parts: CompiledPart[]; log: string }> {
    const result = engine === "openscad" ? await this.compileOpenscad(code) : this.compileJscad(code);
    const named = result.parts.map((p, i) => ({
      ...p,
      name: p.name || (result.parts.length > 1 ? `${opts.partName ?? "part"}-${i + 1}` : (opts.partName ?? "part")),
    }));
    // Mass estimate from density.
    if (opts.densityKgM3) {
      for (const p of named) {
        if (p.mesh.volumeMm3) p.massG = Math.round(((p.mesh.volumeMm3 / 1e9) * opts.densityKgM3 * 1000) * 100) / 100;
      }
    }
    const totalTris = named.reduce((s, p) => s + p.mesh.triangleCount, 0);
    if (totalTris > MAX_TRIANGLES) {
      throw new Error(
        `Compiled geometry has ${totalTris.toLocaleString()} triangles (limit ${MAX_TRIANGLES.toLocaleString()}). Reduce segment counts / model complexity.`,
      );
    }
    if (named.length === 0) throw new Error("The script produced no 3D geometry — main() must return a solid (or array of solids).");
    return { parts: named, log: result.log };
  }

  /**
   * Execute JSCAD code in a vm sandbox. Script contract (documented to the AI
   * in the tool description):
   *   - a `jscad` global exposes @jscad/modeling (primitives, booleans,
   *     transforms, extrusions, expansions, measurements, maths, text, …)
   *   - define `function main() { … }` returning: a geom3, an array of geom3,
   *     or an array of `{ name, geometry }` for multi-part assemblies
   *   - `console.log` output is captured into the compile log.
   */
  compileJscad(code: string): { parts: CompiledPart[]; log: string } {
    const logs: string[] = [];
    const capture = (...args: unknown[]) =>
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    const sandbox: Record<string, unknown> = {
      jscad: modeling,
      console: { log: capture, warn: capture, error: capture, info: capture },
    };
    const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    try {
      vm.runInContext(code, ctx, { timeout: JSCAD_TIMEOUT_MS, filename: "design.jscad.js" });
      const raw = vm.runInContext(
        "typeof main === 'function' ? main() : (() => { throw new Error('Define function main() returning your geometry.'); })()",
        ctx,
        { timeout: JSCAD_TIMEOUT_MS },
      );
      return { parts: this.normalizeJscadResult(raw), log: logs.join("\n") };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      throw new Error(`JSCAD compile failed: ${msg}${logs.length ? `\nScript output:\n${logs.join("\n")}` : ""}`);
    }
  }

  private normalizeJscadResult(raw: unknown): CompiledPart[] {
    const geom3 = modeling.geometries.geom3;
    const toPart = (g: unknown, name: string): CompiledPart | null => {
      if (!geom3.isA(g)) return null;
      const { positions, indices } = jscadGeom3ToMesh(geom3.toPolygons(g as Parameters<typeof geom3.toPolygons>[0]));
      return { name, mesh: toMeshJson(positions, indices) };
    };
    const parts: CompiledPart[] = [];
    const push = (g: unknown, name: string) => {
      const p = toPart(g, name);
      if (p) parts.push(p);
    };
    if (Array.isArray(raw)) {
      raw.forEach((entry, i) => {
        if (entry && typeof entry === "object" && "geometry" in (entry as object)) {
          const e = entry as { name?: string; geometry: unknown };
          push(e.geometry, e.name ?? `part-${i + 1}`);
        } else {
          push(entry, "");
        }
      });
    } else {
      push(raw, "");
    }
    return parts;
  }

  /** Compile OpenSCAD source via the external binary → STL → mesh. */
  async compileOpenscad(code: string): Promise<{ parts: CompiledPart[]; log: string }> {
    const status = await this.getEngineStatus();
    if (!status.openscad.available) {
      throw new Error(
        `OpenSCAD is not available (${status.openscad.error ?? "binary not found"}). Install OpenSCAD and set its path in Settings → Advanced, or switch the plan's CAD engine to the built-in JSCAD.`,
      );
    }
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "omnecor-openscad-"));
    const scadFile = path.join(tmpDir, "design.scad");
    const stlFile = path.join(tmpDir, "design.stl");
    try {
      await fsp.writeFile(scadFile, code, "utf-8");
      const output = await new Promise<string>((resolve, reject) => {
        const proc = spawn(this.openscadPath(), ["-o", stlFile, "--export-format", "binstl", scadFile], {
          timeout: OPENSCAD_TIMEOUT_MS,
        });
        let out = "";
        proc.stdout?.on("data", (d) => (out += d.toString()));
        proc.stderr?.on("data", (d) => (out += d.toString()));
        proc.on("error", reject);
        proc.on("close", (exitCode) => {
          if (exitCode === 0) resolve(out);
          else reject(new Error(`OpenSCAD exited with code ${exitCode}:\n${out.slice(-4000)}`));
        });
      });
      const stl = await fsp.readFile(stlFile);
      const { positions, indices } = parseStl(stl);
      return { parts: [{ name: "", mesh: toMeshJson(positions, indices) }], log: output.trim() };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Artifacts + storage
  // ─────────────────────────────────────────────────────────────────────────

  buildStl(mesh: MeshJson, name: string): Buffer {
    return meshToStlBinary(mesh.positions, mesh.indices, name);
  }

  /** Plan artifact directory under the app data dir. */
  planDir(planId: string): string {
    // planId is a server-generated UUID (never user path input), but sanitize anyway.
    const safe = planId.replace(/[^a-zA-Z0-9-]/g, "");
    return resolveDataPath(path.join("blueprints", safe));
  }

  async saveArtifact(
    planId: string,
    filename: string,
    data: Buffer | string,
  ): Promise<{ filePath: string; sizeBytes: number }> {
    const dir = this.planDir(planId);
    const safeName = filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
    const filePath = path.join(dir, `${uuidv4().slice(0, 8)}-${safeName}`);
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    await fsp.writeFile(filePath, buf);
    log.info(`Saved blueprint artifact ${filePath} (${buf.length} bytes)`);
    return { filePath, sizeBytes: buf.length };
  }

  /** Read an artifact back, refusing paths outside the blueprints tree. */
  async readArtifact(filePath: string): Promise<Buffer> {
    const root = resolveDataPath("blueprints");
    const resolved = path.resolve(filePath);
    if (path.relative(root, resolved).startsWith("..")) {
      throw new Error("Artifact path escapes the blueprints directory.");
    }
    return fsp.readFile(resolved);
  }
}
