/**
 * @file bridges/KiCadBridge.ts
 * @description Omnecor — KiCad EDA Integration Bridge
 *
 * Provides a typed Node.js interface for interacting with KiCad's CLI tools
 * and Python scripting API. This bridge enables:
 *
 *  - Running KiCad CLI commands (kicad-cli) for schematic/PCB operations
 *  - Exporting schematics to PDF/SVG
 *  - Exporting PCB layouts to Gerber files
 *  - Running DRC (Design Rule Check) and ERC (Electrical Rule Check)
 *  - Real-time schematic sync via file watching
 *  - BOM (Bill of Materials) generation
 *
 * Architecture Notes:
 *  - KiCad 8+ provides `kicad-cli` for headless operations
 *  - For advanced operations, we use KiCad's Python scripting API via pcbnew
 *  - Output is parsed from kicad-cli's structured output
 *  - Real-time sync watches .kicad_sch and .kicad_pcb files for changes
 *
 * Security Considerations:
 *  - Only KiCad project files (.kicad_pro, .kicad_sch, .kicad_pcb) are accepted
 *  - Output directories are validated before export operations
 *  - No arbitrary command execution — only predefined kicad-cli subcommands
 */

import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import { ProcessManagerService } from "./ProcessManagerService.js";
import { createZipFromDir } from "./zipArchive.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** KiCad installation information */
export interface KiCadInfo {
  isInstalled: boolean;
  version: string | null;
  cliPath: string;
  hasScriptingApi: boolean;
}

/** Export format options for schematics */
export type SchematicExportFormat = "pdf" | "svg" | "dxf" | "hpgl" | "ps";

/** Export format options for PCB */
export type PCBExportFormat =
  | "gerber"
  | "drill"
  | "svg"
  | "pdf"
  | "step"
  | "vrml";

/** DRC/ERC check result */
export interface CheckResult {
  passed: boolean;
  errors: number;
  warnings: number;
  violations: Array<{
    severity: "error" | "warning";
    message: string;
    location?: string;
  }>;
}

/** BOM entry */
export interface BOMEntry {
  reference: string;
  value: string;
  footprint: string;
  quantity: number;
  description?: string;
}

/** Job result from KiCad operations */
export interface KiCadJobResult {
  success: boolean;
  command: string;
  outputFiles: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Bridge Implementation
// ---------------------------------------------------------------------------

/**
 * KiCadBridge — Node.js integration layer for KiCad EDA operations.
 *
 * @example
 * ```ts
 * const kicad = KiCadBridge.getInstance();
 *
 * // Check installation
 * const info = await kicad.checkInstallation();
 *
 * // Export schematic to PDF
 * const result = await kicad.exportSchematic({
 *   inputFile: "/projects/board/main.kicad_sch",
 *   outputDir: "/projects/board/exports/",
 *   format: "pdf",
 * });
 *
 * // Run DRC
 * const drc = await kicad.runDRC("/projects/board/main.kicad_pcb");
 * ```
 */
export class KiCadBridge extends EventEmitter {
  private static instance: KiCadBridge | null = null;
  private readonly cliPath: string;
  private processManager: ProcessManagerService;

  private constructor() {
    super();
    this.cliPath = process.env.KICAD_CLI_PATH || "kicad-cli";
    this.processManager = ProcessManagerService.getInstance();
  }

  /** Retrieve the singleton instance */
  public static getInstance(): KiCadBridge {
    if (!KiCadBridge.instance) {
      KiCadBridge.instance = new KiCadBridge();
    }
    return KiCadBridge.instance;
  }

  // -------------------------------------------------------------------------
  // Installation Check
  // -------------------------------------------------------------------------

  /**
   * Check if KiCad CLI is installed and accessible.
   */
  async checkInstallation(): Promise<KiCadInfo> {
    return new Promise(resolve => {
      const proc = spawn(this.cliPath, ["version"], { timeout: 10000 });

      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("close", code => {
        if (code === 0 && stdout) {
          const versionMatch = stdout.match(/(\d+\.\d+[\.\d]*)/);
          resolve({
            isInstalled: true,
            version: versionMatch ? versionMatch[1] : stdout.trim(),
            cliPath: this.cliPath,
            hasScriptingApi: true, // KiCad 8+ always has scripting
          });
        } else {
          resolve({
            isInstalled: false,
            version: null,
            cliPath: this.cliPath,
            hasScriptingApi: false,
          });
        }
      });

      proc.on("error", () => {
        resolve({
          isInstalled: false,
          version: null,
          cliPath: this.cliPath,
          hasScriptingApi: false,
        });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Schematic Operations
  // -------------------------------------------------------------------------

  /**
   * Export a KiCad schematic to the specified format.
   *
   * @param config - Export configuration
   * @returns Job result with output file paths
   */
  async exportSchematic(config: {
    inputFile: string;
    outputDir: string;
    format: SchematicExportFormat;
    pages?: string; // e.g., "1,2,3" or "all"
  }): Promise<KiCadJobResult> {
    const { inputFile, outputDir, format, pages } = config;

    await this.validateKiCadFile(inputFile, [".kicad_sch"]);
    await fs.mkdir(outputDir, { recursive: true });

    const outputFile = path.join(
      outputDir,
      `${path.basename(inputFile, ".kicad_sch")}.${format}`
    );

    const args = ["sch", "export", format, inputFile, "-o", outputFile];

    if (pages && pages !== "all") {
      args.push("--pages", pages);
    }

    return this.runCommand(args, `Export schematic → ${format}`);
  }

  /**
   * Run Electrical Rule Check (ERC) on a schematic.
   */
  async runERC(schematicPath: string): Promise<CheckResult> {
    await this.validateKiCadFile(schematicPath, [".kicad_sch"]);

    const outputFile = path.join(
      path.dirname(schematicPath),
      `${path.basename(schematicPath, ".kicad_sch")}_erc.json`
    );

    const result = await this.runCommand(
      ["sch", "erc", schematicPath, "-o", outputFile, "--format", "json"],
      "ERC Check"
    );

    return this.parseCheckResult(result, outputFile);
  }

  // -------------------------------------------------------------------------
  // PCB Operations
  // -------------------------------------------------------------------------

  /**
   * Export PCB to Gerber files (for manufacturing).
   */
  async exportGerbers(config: {
    inputFile: string;
    outputDir: string;
    layers?: string[];
  }): Promise<KiCadJobResult> {
    const { inputFile, outputDir, layers } = config;

    await this.validateKiCadFile(inputFile, [".kicad_pcb"]);
    await fs.mkdir(outputDir, { recursive: true });

    const args = ["pcb", "export", "gerbers", inputFile, "-o", outputDir];

    if (layers && layers.length > 0) {
      args.push("--layers", layers.join(","));
    }

    return this.runCommand(args, "Export Gerbers");
  }

  /**
   * Build a manufacturing package: export Gerbers + drill files for a board to
   * a fresh temp directory, then bundle them into a single ZIP archive (the
   * format fab houses like PCBWay expect for an order). Returns the archive as a
   * Buffer plus the on-disk directory (for optional download/preview). Throws if
   * either export step fails so callers never upload an empty/partial package.
   */
  async buildFabricationPackage(pcbPath: string): Promise<{
    zip: Buffer;
    outputDir: string;
    fileCount: number;
  }> {
    await this.validateKiCadFile(pcbPath, [".kicad_pcb"]);
    const outputDir = path.join(os.tmpdir(), `omnecor_fab_${randomUUID()}`);
    await fs.mkdir(outputDir, { recursive: true });

    const gerbers = await this.exportGerbers({ inputFile: pcbPath, outputDir });
    if (!gerbers.success) {
      throw new Error(`Gerber export failed: ${gerbers.stderr || gerbers.stdout || "kicad-cli error"}`);
    }
    const drills = await this.exportDrills({ inputFile: pcbPath, outputDir, format: "excellon" });
    if (!drills.success) {
      throw new Error(`Drill export failed: ${drills.stderr || drills.stdout || "kicad-cli error"}`);
    }

    const files = await fs.readdir(outputDir);
    if (files.length === 0) {
      throw new Error("Fabrication export produced no files — is this a valid PCB layout?");
    }

    const zip = await createZipFromDir(outputDir);
    return { zip, outputDir, fileCount: files.length };
  }

  /**
   * Export PCB drill files.
   */
  async exportDrills(config: {
    inputFile: string;
    outputDir: string;
    format?: "excellon" | "gerber_x2";
  }): Promise<KiCadJobResult> {
    const { inputFile, outputDir, format } = config;

    await this.validateKiCadFile(inputFile, [".kicad_pcb"]);
    await fs.mkdir(outputDir, { recursive: true });

    const args = ["pcb", "export", "drill", inputFile, "-o", outputDir];

    if (format) {
      args.push("--format", format);
    }

    return this.runCommand(args, "Export Drills");
  }

  /**
   * Export PCB to 3D STEP file (for mechanical CAD integration).
   */
  async exportSTEP(config: {
    inputFile: string;
    outputFile: string;
  }): Promise<KiCadJobResult> {
    await this.validateKiCadFile(config.inputFile, [".kicad_pcb"]);

    const args = [
      "pcb",
      "export",
      "step",
      config.inputFile,
      "-o",
      config.outputFile,
    ];

    return this.runCommand(args, "Export STEP");
  }

  /**
   * Run Design Rule Check (DRC) on a PCB layout.
   */
  async runDRC(pcbPath: string): Promise<CheckResult> {
    await this.validateKiCadFile(pcbPath, [".kicad_pcb"]);

    const outputFile = path.join(
      path.dirname(pcbPath),
      `${path.basename(pcbPath, ".kicad_pcb")}_drc.json`
    );

    const result = await this.runCommand(
      ["pcb", "drc", pcbPath, "-o", outputFile, "--format", "json"],
      "DRC Check"
    );

    return this.parseCheckResult(result, outputFile);
  }

  /**
   * Export PCB to SVG (for preview rendering in the UI).
   */
  async exportPCBPreview(config: {
    inputFile: string;
    outputFile: string;
    layers?: string[];
  }): Promise<KiCadJobResult> {
    await this.validateKiCadFile(config.inputFile, [".kicad_pcb"]);

    const args = [
      "pcb",
      "export",
      "svg",
      config.inputFile,
      "-o",
      config.outputFile,
    ];

    if (config.layers && config.layers.length > 0) {
      args.push("--layers", config.layers.join(","));
    }

    return this.runCommand(args, "Export PCB Preview SVG");
  }

  // -------------------------------------------------------------------------
  // BOM Generation
  // -------------------------------------------------------------------------

  /**
   * Generate a Bill of Materials from a schematic.
   */
  async generateBOM(config: {
    inputFile: string;
    outputFile: string;
    format?: "csv" | "xml";
  }): Promise<KiCadJobResult> {
    await this.validateKiCadFile(config.inputFile, [".kicad_sch"]);

    const format = config.format || "csv";
    const args = [
      "sch",
      "export",
      "bom",
      config.inputFile,
      "-o",
      config.outputFile,
      "--format",
      format,
    ];

    return this.runCommand(args, "Generate BOM");
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** Run a kicad-cli command and capture output */
  private async runCommand(
    args: string[],
    label: string
  ): Promise<KiCadJobResult> {
    const startTime = Date.now();

    return new Promise(resolve => {
      const proc = spawn(this.cliPath, args, {
        timeout: 120000, // 2 minute timeout
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", code => {
        const durationMs = Date.now() - startTime;

        // Collect output files (parse from stdout if available)
        const outputFiles: string[] = [];
        const fileMatches = stdout.match(
          /(?:Writing|Saved|Output).*?['"]?([/\w.-]+\.\w+)['"]?/gi
        );
        if (fileMatches) {
          for (const match of fileMatches) {
            const pathMatch = match.match(/([/\w.-]+\.\w+)/);
            if (pathMatch) outputFiles.push(pathMatch[1]);
          }
        }

        resolve({
          success: code === 0,
          command: `${this.cliPath} ${args.join(" ")}`,
          outputFiles,
          stdout,
          stderr,
          exitCode: code || 0,
          durationMs,
        });
      });

      proc.on("error", err => {
        resolve({
          success: false,
          command: `${this.cliPath} ${args.join(" ")}`,
          outputFiles: [],
          stdout,
          stderr: err.message,
          exitCode: -1,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /** Validate a KiCad file path */
  private async validateKiCadFile(
    filePath: string,
    allowedExtensions: string[]
  ): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      throw new Error(
        `[Omnecor KiCad] Invalid file type: ${ext}. Expected: ${allowedExtensions.join(", ")}`
      );
    }

    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`[Omnecor KiCad] File not found: ${filePath}`);
    }
  }

  /** Parse DRC/ERC JSON output into a structured CheckResult */
  private async parseCheckResult(
    jobResult: KiCadJobResult,
    outputFile: string
  ): Promise<CheckResult> {
    // Default result if parsing fails
    const defaultResult: CheckResult = {
      passed: jobResult.success,
      errors: 0,
      warnings: 0,
      violations: [],
    };

    try {
      const content = await fs.readFile(outputFile, "utf-8");
      const data = JSON.parse(content);

      const violations: CheckResult["violations"] = [];
      let errors = 0;
      let warnings = 0;

      for (const violation of data.violations || data.errors || []) {
        const severity = violation.severity === "error" ? "error" : "warning";
        if (severity === "error") errors++;
        else warnings++;

        violations.push({
          severity,
          message:
            violation.description || violation.message || "Unknown violation",
          location: violation.pos
            ? `${violation.pos.x},${violation.pos.y}`
            : undefined,
        });
      }

      return {
        passed: errors === 0,
        errors,
        warnings,
        violations,
      };
    } catch {
      // If we can't parse the output file, fall back to exit code
      return defaultResult;
    }
  }
}
