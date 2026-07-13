/**
 * Blueprint Studio — FEA runner (Node side of fea_bridge.py).
 *
 * Writes the analysis request to a temp JSON, spawns the Python bridge
 * (Gmsh tet meshing + TET4 linear-static solve; deps: `pip install gmsh
 * numpy scipy`), and returns the strict-JSON summary plus the nodal field
 * file for the client heatmap overlay. Optional capability — availability
 * is probed so the UI/agent can degrade gracefully with the install hint,
 * exactly like the other Python services.
 */
import path from "path";
import os from "os";
import fsp from "fs/promises";
import { spawn } from "child_process";
import type { FeaRequest, FeaResultSummary } from "@shared/blueprint";
import { PYTHON_SCRIPTS } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("BlueprintFeaService");

const FEA_TIMEOUT_MS = 10 * 60 * 1000;

export interface FeaRunOutput {
  summary: FeaResultSummary;
  /** Raw nodal field JSON (positions/tets/displacement/vonMises) — persisted
   *  as a blueprint file for the 3D heatmap; null when the run failed. */
  fieldJson: Buffer | null;
  log: string;
}

export class BlueprintFeaService {
  private static instance: BlueprintFeaService | null = null;

  static getInstance(): BlueprintFeaService {
    if (!this.instance) this.instance = new BlueprintFeaService();
    return this.instance;
  }

  /** Probe whether the Python FEA deps are importable (cached for 5 min). */
  private availability: { at: number; ok: boolean; error?: string } | null = null;

  async checkAvailability(): Promise<{ available: boolean; error?: string; hint?: string }> {
    if (this.availability && Date.now() - this.availability.at < 5 * 60 * 1000) {
      return { available: this.availability.ok, error: this.availability.error, hint: this.availability.ok ? undefined : "pip install gmsh numpy scipy" };
    }
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      try {
        const proc = spawn(PYTHON_SCRIPTS.pythonBin, ["-c", "import gmsh, numpy, scipy"], { timeout: 30_000 });
        let err = "";
        proc.stderr?.on("data", (d) => (err += d.toString()));
        proc.on("error", (e) => resolve({ ok: false, error: e.message }));
        proc.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split("\n").pop() }));
      } catch (e) {
        resolve({ ok: false, error: (e as Error).message });
      }
    });
    this.availability = { at: Date.now(), ok: result.ok, error: result.error };
    return { available: result.ok, error: result.error, hint: result.ok ? undefined : "pip install gmsh numpy scipy" };
  }

  /**
   * Run one linear-static analysis on an STL already on disk. `request` is the
   * shared FeaRequest with `stlFileId` already resolved to `stlPath`.
   */
  async run(
    request: Omit<FeaRequest, "stlFileId"> & { stlPath: string },
    signal?: AbortSignal,
  ): Promise<FeaRunOutput> {
    if (signal?.aborted) {
      return { summary: { status: "failed", error: "FEA cancelled before it started." }, fieldJson: null, log: "" };
    }
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "omnecor-fea-"));
    const inputPath = path.join(tmpDir, "request.json");
    const outputPath = path.join(tmpDir, "field.json");
    try {
      await fsp.writeFile(inputPath, JSON.stringify(request), "utf-8");
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const proc = spawn(
          PYTHON_SCRIPTS.pythonBin,
          [PYTHON_SCRIPTS.feaBridge, "--input", inputPath, "--output", outputPath],
          { timeout: FEA_TIMEOUT_MS },
        );
        // Client disconnect (subscription teardown) kills the solver rather than
        // leaving a multi-minute Python process orphaned.
        const onAbort = () => proc.kill("SIGTERM");
        signal?.addEventListener("abort", onAbort, { once: true });
        let out = "";
        let err = "";
        proc.stdout?.on("data", (d) => (out += d.toString()));
        proc.stderr?.on("data", (d) => (err += d.toString()));
        proc.on("error", (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        });
        proc.on("close", () => {
          signal?.removeEventListener("abort", onAbort);
          if (signal?.aborted) reject(new Error("FEA cancelled — chat stream closed."));
          else resolve({ stdout: out, stderr: err });
        });
      });

      // The bridge emits exactly one strict-JSON line on stdout (last line wins
      // in case a dependency printed noise first).
      const jsonLine = stdout
        .trim()
        .split("\n")
        .reverse()
        .find((l) => l.trim().startsWith("{"));
      if (!jsonLine) {
        return {
          summary: { status: "failed", error: `FEA bridge produced no JSON. stderr: ${stderr.slice(-2000)}` },
          fieldJson: null,
          log: stderr,
        };
      }
      const parsed = JSON.parse(jsonLine) as FeaResultSummary & { hint?: string };
      if (parsed.status !== "completed") {
        const error = [parsed.error, parsed.hint ? `Hint: ${parsed.hint}` : ""].filter(Boolean).join(" — ");
        return { summary: { status: "failed", error }, fieldJson: null, log: stderr };
      }
      const fieldJson = await fsp.readFile(outputPath).catch(() => null);
      return { summary: parsed, fieldJson, log: stderr };
    } catch (err) {
      log.error("FEA run failed", { err: (err as Error).message });
      return { summary: { status: "failed", error: (err as Error).message }, fieldJson: null, log: "" };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
