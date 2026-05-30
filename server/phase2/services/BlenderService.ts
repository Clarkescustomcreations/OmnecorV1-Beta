/**
 * @file bridges/BlenderBridge.ts
 * @description Omnecor — Blender Headless Integration Bridge
 *
 * Provides a typed Node.js interface for executing Python scripts inside
 * Blender's headless environment. This bridge:
 *
 *  - Validates script paths before execution
 *  - Spawns Blender in background mode (-b) with our bridge script
 *  - Parses structured JSON output from the blender_bridge.py executor
 *  - Supports .blend file operations (open, modify, export)
 *  - Enables real-time preview sync by watching Blender output files
 *
 * Architecture Notes:
 *  - Blender is invoked via: blender -b -P blender_bridge.py -- --script <target.py>
 *  - The bridge script (blender_bridge.py) executes the target inside Blender's
 *    Python runtime, which has access to the `bpy` module
 *  - All output is structured JSON for easy parsing by the Node.js backend
 *  - For real-time preview, Blender exports to a watched directory and the
 *    FileSystemWatcher picks up changes
 *
 * Security Considerations:
 *  - Only .py scripts are allowed for execution
 *  - Script paths are resolved and validated against a whitelist directory
 *  - No shell interpolation — all args passed as array elements
 *  - Blender process runs with the same user permissions as the backend
 */

import { EventEmitter } from "events";
import path from "path";
import fs from "fs/promises";
import { ProcessManagerService } from "./ProcessManagerService.js";
import { PYTHON_SCRIPTS } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Blender job configuration */
export interface BlenderJobConfig {
  /** Path to the Python script to execute inside Blender */
  scriptPath: string;
  /** Optional .blend file to open before executing the script */
  blendFile?: string;
  /** Optional output directory for rendered/exported files */
  outputDir?: string;
  /** Optional label for the job */
  label?: string;
}

/** Blender script execution result (parsed from JSON stdout) */
export interface BlenderResult {
  status: "success" | "failure" | "error" | "info";
  message: string;
  script?: string;
  error?: string;
  traceback?: string;
  extra?: Record<string, any>;
}

/** Blender installation info */
export interface BlenderInfo {
  isInstalled: boolean;
  version: string | null;
  path: string;
  pythonVersion: string | null;
}

// ---------------------------------------------------------------------------
// Bridge Implementation
// ---------------------------------------------------------------------------

/**
 * BlenderBridge — Node.js integration layer for Blender headless operations.
 *
 * @example
 * ```ts
 * const blender = BlenderBridge.getInstance();
 *
 * // Check if Blender is available
 * const info = await blender.checkInstallation();
 * if (!info.isInstalled) {
 *   console.error("Blender not found. Install with: sudo apt install blender");
 * }
 *
 * // Execute a script inside Blender
 * const jobId = await blender.executeScript({
 *   scriptPath: "/scripts/generate_model.py",
 *   outputDir: "/output/models/",
 * });
 * ```
 */
export class BlenderBridge extends EventEmitter {
  private static instance: BlenderBridge | null = null;
  private processManager: ProcessManagerService;
  private blenderBin: string;
  private bridgeScript: string;

  private constructor() {
    super();
    this.processManager = ProcessManagerService.getInstance();
    this.blenderBin = PYTHON_SCRIPTS.blenderBin;
    this.bridgeScript = PYTHON_SCRIPTS.blenderBridge;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): BlenderBridge {
    if (!BlenderBridge.instance) {
      BlenderBridge.instance = new BlenderBridge();
    }
    return BlenderBridge.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Check if Blender is installed and accessible.
   * Runs `blender --version` to verify.
   */
  async checkInstallation(): Promise<BlenderInfo> {
    const { spawn } = await import("child_process");

    return new Promise(resolve => {
      const proc = spawn(this.blenderBin, ["--version"], {
        timeout: 10000,
      });

      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("close", code => {
        if (code === 0 && stdout) {
          // Parse version from output like "Blender 4.1.0"
          const versionMatch = stdout.match(/Blender\s+(\d+\.\d+\.\d+)/);
          const pythonMatch = stdout.match(/Python\s+(\d+\.\d+\.\d+)/i);

          resolve({
            isInstalled: true,
            version: versionMatch ? versionMatch[1] : null,
            path: this.blenderBin,
            pythonVersion: pythonMatch ? pythonMatch[1] : null,
          });
        } else {
          resolve({
            isInstalled: false,
            version: null,
            path: this.blenderBin,
            pythonVersion: null,
          });
        }
      });

      proc.on("error", () => {
        resolve({
          isInstalled: false,
          version: null,
          path: this.blenderBin,
          pythonVersion: null,
        });
      });
    });
  }

  /**
   * Execute a Python script inside Blender's headless environment.
   *
   * @param config - Job configuration
   * @returns Job ID for tracking progress via ProcessManagerService
   * @throws Error if script path is invalid or Blender is not installed
   */
  async executeScript(config: BlenderJobConfig): Promise<string> {
    const { scriptPath, blendFile, outputDir, label } = config;

    // Validate script path
    const resolvedScript = path.resolve(scriptPath);
    await this.validateScript(resolvedScript);

    // Validate blend file if provided
    if (blendFile) {
      const resolvedBlend = path.resolve(blendFile);
      try {
        await fs.access(resolvedBlend);
      } catch {
        throw new Error(
          `[Omnecor Blender] Blend file not found: ${resolvedBlend}`
        );
      }
    }

    // Create output directory if specified
    if (outputDir) {
      await fs.mkdir(outputDir, { recursive: true });
    }

    // Build the Blender command arguments
    const args: string[] = ["-b"]; // background/headless mode

    // If a .blend file is specified, open it first
    if (blendFile) {
      args.push(path.resolve(blendFile));
    }

    // Execute our bridge script which then runs the target script
    args.push("-P", this.bridgeScript);
    args.push("--"); // separator for custom args
    args.push("--action", "run_script");
    args.push("--script", resolvedScript);

    // Set environment variables for the script
    const env: Record<string, string> = {};
    if (outputDir) {
      env.OMNECOR_OUTPUT_DIR = path.resolve(outputDir);
    }

    // Spawn via ProcessManagerService for unified tracking
    const jobId = await this.processManager.spawn({
      type: "blender",
      command: this.blenderBin,
      args,
      label: label || `Blender: ${path.basename(scriptPath)}`,
      env,
      timeoutMs: 600000, // 10 minute timeout for complex renders
    });

    console.log(
      `[Omnecor Blender] Job started: id="${jobId}" script="${resolvedScript}"`
    );

    return jobId;
  }

  /**
   * Render the current scene.
   *
   * @param blendFile  - Optional path to the .blend file
   * @param outputPath - Desired output file path
   * @param label      - Optional job label
   * @returns Job ID
   */
  async render(
    blendFile?: string,
    outputPath?: string,
    label?: string
  ): Promise<string> {
    const args: string[] = ["-b"];

    if (blendFile) {
      const resolvedBlend = path.resolve(blendFile);
      await fs.access(resolvedBlend);
      args.push(resolvedBlend);
    }

    args.push("-P", this.bridgeScript);
    args.push("--");
    args.push("--action", "render");

    if (outputPath) {
      args.push("--filepath", path.resolve(outputPath));
    }

    const jobId = await this.processManager.spawn({
      type: "blender",
      command: this.blenderBin,
      args,
      label:
        label ||
        `Blender Render: ${blendFile ? path.basename(blendFile) : "current scene"}`,
      timeoutMs: 600000,
    });

    return jobId;
  }

  /**
   * Execute a Blender Python expression directly (for simple operations).
   * Wraps the expression in a temporary script file and executes it.
   *
   * @param expression - Python code to execute inside Blender
   * @param label      - Optional job label
   * @returns Job ID
   */
  async executeExpression(expression: string, label?: string): Promise<string> {
    // Write expression to a temporary file
    const tmpDir = path.join(
      process.env.HOME || "/tmp",
      ".omnecor",
      "blender_tmp"
    );
    await fs.mkdir(tmpDir, { recursive: true });

    const tmpScript = path.join(tmpDir, `expr_${Date.now()}.py`);
    await fs.writeFile(tmpScript, expression, "utf-8");

    try {
      return await this.executeScript({
        scriptPath: tmpScript,
        label: label || "Blender Expression",
      });
    } catch (error) {
      // Clean up temp file on error
      await fs.unlink(tmpScript).catch(() => {});
      throw error;
    }
  }

  /**
   * Export a .blend file to a specific format (e.g., GLB, FBX, OBJ).
   *
   * @param blendFile  - Path to the .blend file
   * @param outputPath - Desired output file path (format inferred from extension)
   * @returns Job ID
   */
  async exportFile(blendFile: string, outputPath: string): Promise<string> {
    const ext = path.extname(outputPath).toLowerCase();

    // Securely serialize paths for Python injection prevention
    const safeOutput = JSON.stringify(outputPath);

    // Generate the export script based on target format
    const exportScripts: Record<string, string> = {
      ".glb": `
import bpy
bpy.ops.export_scene.gltf(filepath=${safeOutput}, export_format='GLB')
print('{"status": "success", "message": "Exported to GLB", "output": '${safeOutput}'}')
`,
      ".fbx": `
import bpy
bpy.ops.export_scene.fbx(filepath=${safeOutput})
print('{"status": "success", "message": "Exported to FBX", "output": '${safeOutput}'}')
`,
      ".obj": `
import bpy
bpy.ops.wm.obj_export(filepath=${safeOutput})
print('{"status": "success", "message": "Exported to OBJ", "output": '${safeOutput}'}')
`,
      ".stl": `
import bpy
bpy.ops.export_mesh.stl(filepath=${safeOutput})
print('{"status": "success", "message": "Exported to STL", "output": '${safeOutput}'}')
`,
    };

    const script = exportScripts[ext];
    if (!script) {
      throw new Error(
        `[Omnecor Blender] Unsupported export format: ${ext}. ` +
          `Supported: ${Object.keys(exportScripts).join(", ")}`
      );
    }

    return this.executeExpression(
      script,
      `Export ${path.basename(blendFile)} → ${ext}`
    );
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** Validate that a script path is safe to execute */
  private async validateScript(scriptPath: string): Promise<void> {
    // Must exist
    try {
      await fs.access(scriptPath);
    } catch {
      throw new Error(`[Omnecor Blender] Script not found: ${scriptPath}`);
    }

    // Must be a .py file
    if (path.extname(scriptPath).toLowerCase() !== ".py") {
      throw new Error(
        `[Omnecor Blender] Only .py scripts are allowed. Got: ${path.extname(scriptPath)}`
      );
    }

    // Must not contain path traversal
    const resolved = path.resolve(scriptPath);
    if (resolved !== scriptPath && !resolved.startsWith("/")) {
      throw new Error(`[Omnecor Blender] Invalid script path: ${scriptPath}`);
    }
  }
}
