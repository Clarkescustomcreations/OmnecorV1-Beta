/**
 * @file bridges/ESPToolBridge.ts
 * @description Omnecor — ESP Microcontroller Flashing Bridge
 *
 * Provides a typed Node.js interface for flashing ESP32/ESP8266 microcontrollers
 * using esptool.py. This bridge:
 *
 *  - Detects connected ESP devices via serial port enumeration
 *  - Validates firmware binaries before flashing
 *  - Streams flash progress in real-time via ProcessManagerService
 *  - Supports chip identification and memory operations
 *  - Handles serial port permissions and error recovery
 *
 * Architecture Notes:
 *  - Uses our esptool_bridge.py wrapper which emits JSON progress lines
 *  - Serial port detection uses /dev/ttyUSB* and /dev/ttyACM* patterns on Linux
 *  - Flash operations are managed by ProcessManagerService for unified tracking
 *  - Progress events include: info, stdout, stderr, success, error
 *
 * Security Considerations:
 *  - Firmware paths are validated before flashing
 *  - Serial ports are validated against known device patterns
 *  - No arbitrary command execution — only esptool operations
 *  - User confirmation should be required before flashing (UI responsibility)
 */

import { EventEmitter } from "events";
import { spawn, execFileSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import { ProcessManagerService } from "./ProcessManagerService.js";
import { PYTHON_SCRIPTS } from "../config/index.js";
import { createLogger } from "../../_core/logger.js";
const log = createLogger("ESPTool");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Detected serial port information */
export interface SerialPort {
  /** Device path (e.g., /dev/ttyUSB0) */
  path: string;
  /** USB vendor ID */
  vendorId?: string;
  /** USB product ID */
  productId?: string;
  /** Human-readable description */
  description: string;
}

/** ESP chip information from chip_id */
export interface ESPChipInfo {
  chipType: string;
  chipId: string;
  macAddress: string;
  flashSize?: string;
}

/** Flash configuration */
export interface FlashConfig {
  /** Serial port path */
  port: string;
  /** Baud rate (default: 921600) */
  baud?: number;
  /** Path to the firmware binary */
  firmwarePath: string;
  /**
   * Flash write offset (default: `0x0`, i.e. a full/merged image such as an
   * arduino-cli `*.merged.bin`). Use `0x10000` for a bare app image or `0x1000`
   * for a raw bootloader. Must match the image type or the board won't boot.
   */
  flashOffset?: string;
  /** Chip type (default: esp32) */
  chip?: "esp32" | "esp32s2" | "esp32s3" | "esp32c3" | "esp8266";
}

/** Compile configuration */
export interface CompileConfig {
  /** Path to the .ino file or project directory */
  sketchPath: string;
  /** Fully Qualified Board Name (e.g., "esp32:esp32:esp32") */
  fqbn?: string;
  /** Output directory for the compiled .bin (default: alongside the sketch) */
  outputDir?: string;
}

/** Esptool installation info */
export interface ESPToolInfo {
  isInstalled: boolean;
  version: string | null;
  pythonPath: string;
}

// ---------------------------------------------------------------------------
// Bridge Implementation
// ---------------------------------------------------------------------------

/**
 * ESPToolBridge — Node.js integration layer for ESP microcontroller operations.
 *
 * @example
 * ```ts
 * const esp = ESPToolBridge.getInstance();
 *
 * // Detect connected devices
 * const ports = await esp.detectPorts();
 *
 * // Get chip info
 * const info = await esp.getChipInfo("/dev/ttyUSB0");
 *
 * // Flash firmware
 * const jobId = await esp.flashFirmware({
 *   port: "/dev/ttyUSB0",
 *   firmwarePath: "/firmware/app.bin",
 *   baud: 921600,
 * });
 * 
 * // Compile firmware
 * const compileJobId = await esp.compileFirmware({
 *   sketchPath: "/home/linux/OmnecorBleTest.ino",
 *   fqbn: "esp32:esp32:esp32",
 * });
 * ```
 */
export class ESPToolBridge extends EventEmitter {
  private static instance: ESPToolBridge | null = null;
  private processManager: ProcessManagerService;
  private pythonBin: string;
  /** Cached result of the first successful checkInstallation() call (esptool
   *  doesn't get uninstalled mid-session, so this stays valid indefinitely). */
  private cachedInstallInfo: ESPToolInfo | null = null;
  /** Short-lived cache of a *negative* probe + its expiry (epoch ms). Bounds the
   *  probe cost when the ESP status is polled while esptool is absent, but still
   *  re-detects a mid-session install once the TTL lapses. */
  private negativeInstallInfo: ESPToolInfo | null = null;
  private negativeInstallExpiry = 0;
  private static readonly NEGATIVE_TTL_MS = 30_000;

  private constructor() {
    super();
    this.processManager = ProcessManagerService.getInstance();
    this.pythonBin = PYTHON_SCRIPTS.pythonBin;
  }

  /** Retrieve the singleton instance */
  public static getInstance(): ESPToolBridge {
    if (!ESPToolBridge.instance) {
      ESPToolBridge.instance = new ESPToolBridge();
    }
    return ESPToolBridge.instance;
  }

  // -------------------------------------------------------------------------
  // Installation & Detection
  // -------------------------------------------------------------------------

  /**
   * Probe each Python candidate in order for esptool. Returns the first
   * working binary together with the version stdout so checkInstallation()
   * can parse the version without a second spawn.
   */
  private async discoverAndCheck(): Promise<{ bin: string; stdout: string } | null> {
    const candidates = [PYTHON_SCRIPTS.pythonBin, "python3", "python"];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const result = await new Promise<{ stdout: string } | null>(resolve => {
        let stdout = "";
        const p = spawn(candidate, ["-m", "esptool", "version"], { timeout: 10_000 });
        p.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        p.stderr?.resume();
        p.on("close", code => resolve(code === 0 ? { stdout } : null));
        p.on("error", () => resolve(null));
      });
      if (result) return { bin: candidate, stdout: result.stdout };
    }
    return null;
  }

  /**
   * Check if esptool is installed and accessible.
   * A *positive* result is cached for the singleton's lifetime (esptool doesn't
   * get uninstalled during a session). A *negative* result is cached only
   * briefly (NEGATIVE_TTL_MS) — long enough to bound the probe cost under
   * frequent polling, short enough that a mid-session install is still detected
   * — instead of being pinned for the whole process lifetime.
   */
  async checkInstallation(): Promise<ESPToolInfo> {
    if (this.cachedInstallInfo) return this.cachedInstallInfo;
    if (this.negativeInstallInfo && Date.now() < this.negativeInstallExpiry) {
      return this.negativeInstallInfo;
    }

    const found = await this.discoverAndCheck();
    if (!found) {
      // Not found — cache the negative for a short window so a later install is
      // still picked up once the TTL lapses.
      this.negativeInstallInfo = { isInstalled: false, version: null, pythonPath: PYTHON_SCRIPTS.pythonBin };
      this.negativeInstallExpiry = Date.now() + ESPToolBridge.NEGATIVE_TTL_MS;
      return this.negativeInstallInfo;
    }

    this.pythonBin = found.bin;
    // esptool ≤4.x prints "esptool.py v4.x"; esptool ≥5.x prints "esptool v5.3.1"
    // (no ".py"). Make the suffix optional so both banners parse to a clean number.
    const versionMatch = found.stdout.match(/esptool(?:\.py)?\s+v?(\d+\.\d+[\.\d]*)/i);
    this.cachedInstallInfo = {
      isInstalled: true,
      version: versionMatch ? versionMatch[1] : found.stdout.trim().split("\n")[0],
      pythonPath: found.bin,
    };
    return this.cachedInstallInfo;
  }

  /**
   * Detect connected serial ports that may be ESP devices.
   * On Linux/macOS: scans /dev/ttyUSB*, /dev/ttyACM*, /dev/cu.* via sysfs.
   * On Windows: queries COM ports via PowerShell Get-PnpDevice.
   */
  async detectPorts(): Promise<SerialPort[]> {
    const ports: SerialPort[] = [];

    if (process.platform === "win32") {
      try {
        // Use PowerShell to list COM ports with friendly names
        const raw = execFileSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            "Get-PnpDevice -Class Ports -Status OK | Select-Object FriendlyName,InstanceId | ConvertTo-Json -Compress",
          ],
          { timeout: 5000, encoding: "utf-8" }
        );
        const items: Array<{ FriendlyName?: string; InstanceId?: string }> =
          JSON.parse(raw.trim().startsWith("[") ? raw.trim() : `[${raw.trim()}]`);
        for (const item of items) {
          const match = item.FriendlyName?.match(/\((COM\d+)\)/);
          if (match) {
            ports.push({
              path: match[1],
              description: item.FriendlyName ?? match[1],
            });
          }
        }
      } catch {
        // PowerShell unavailable or no COM ports found — return empty list
        console.warn("[Omnecor ESP] Windows COM port enumeration failed; enter port manually.");
      }
      return ports;
    }

    try {
      // Read /dev/ for serial devices (Linux / macOS)
      const devEntries = await fs.readdir("/dev");
      const serialPatterns = ["ttyUSB", "ttyACM", "ttyS", "cu.usbserial", "cu.usbmodem", "tty.usbserial", "tty.usbmodem"];

      for (const entry of devEntries) {
        if (serialPatterns.some(p => entry.startsWith(p))) {
          const devicePath = `/dev/${entry}`;

          // Try to get USB device info from sysfs (Linux only)
          let description = `Serial port: ${entry}`;
          try {
            const sysPath = `/sys/class/tty/${entry}/device/../../`;
            const vendor = await fs
              .readFile(path.join(sysPath, "idVendor"), "utf-8")
              .catch(() => "");
            const product = await fs
              .readFile(path.join(sysPath, "idProduct"), "utf-8")
              .catch(() => "");

            if (vendor.trim() || product.trim()) {
              description = `USB Serial (${vendor.trim()}:${product.trim()})`;
            }

            ports.push({
              path: devicePath,
              vendorId: vendor.trim() || undefined,
              productId: product.trim() || undefined,
              description,
            });
          } catch {
            ports.push({ path: devicePath, description });
          }
        }
      }
    } catch (error) {
      console.warn(
        `[Omnecor ESP] Failed to enumerate serial ports: ${(error as Error).message}`
      );
    }

    return ports;
  }

  /**
   * Get chip information from a connected ESP device.
   */
  async getChipInfo(port: string): Promise<ESPChipInfo> {
    this.validatePort(port);

    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.pythonBin,
        ["-m", "esptool", "--port", port, "chip_id"],
        { timeout: 30000 }
      );

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", code => {
        if (code === 0) {
          // Parse chip info from esptool output
          const chipMatch = stdout.match(/Chip is ([\w\s-]+)/i);
          const macMatch = stdout.match(/MAC:\s*([\w:]+)/i);
          const flashMatch = stdout.match(/(\d+)MB flash/i);

          resolve({
            chipType: chipMatch ? chipMatch[1].trim() : "Unknown",
            chipId: this.extractChipId(stdout),
            macAddress: macMatch ? macMatch[1] : "Unknown",
            flashSize: flashMatch ? `${flashMatch[1]}MB` : undefined,
          });
        } else {
          reject(
            new Error(
              `[Omnecor ESP] chip_id failed on ${port}: ${stderr || stdout}`
            )
          );
        }
      });

      proc.on("error", err => {
        reject(
          new Error(`[Omnecor ESP] Failed to run esptool: ${err.message}`)
        );
      });
    });
  }

  // -------------------------------------------------------------------------
  // Compile & Flash Operations
  // -------------------------------------------------------------------------

  /**
   * Compile an Arduino sketch (.ino) to a .bin firmware using arduino-cli.
   * 
   * @param config - Compile configuration
   * @returns Job ID for tracking via ProcessManagerService
   */
  async compileFirmware(config: CompileConfig): Promise<string> {
    const { sketchPath, fqbn = "esp32:esp32:esp32", outputDir } = config;

    await this.validatePathExists(sketchPath, "Sketch path");

    const args = ["compile", "--fqbn", fqbn];
    if (outputDir) {
      await fs.mkdir(outputDir, { recursive: true });
      args.push("--output-dir", outputDir);
    }
    args.push(sketchPath);

    // Use ProcessManagerService for unified job tracking
    const jobId = await this.processManager.spawn({
      type: "custom", // Using custom process type for arduino-cli
      command: "arduino-cli",
      args,
      label: `ESP Compile: ${path.basename(sketchPath)}`,
      timeoutMs: 300000, // 5 minute timeout for compilation
      captureMode: "raw", // Raw capture so we get full build logs
    });

    log.info("Compile job started", { jobId, sketch: path.basename(sketchPath), fqbn });

    return jobId;
  }

  /**
   * Flash firmware to an ESP device.
   * Uses the esptool_bridge.py wrapper for JSON progress streaming.
   *
   * @param config - Flash configuration
   * @returns Job ID for tracking via ProcessManagerService
   */
  async flashFirmware(config: FlashConfig): Promise<string> {
    const { port, baud, firmwarePath, chip, flashOffset } = config;

    // Validate inputs
    this.validatePort(port);
    await this.validateFirmware(firmwarePath);

    // Use ProcessManagerService for unified job tracking
    const jobId = await this.processManager.spawn({
      type: "esp_flash",
      command: this.pythonBin,
      args: [
        PYTHON_SCRIPTS.espFlash,
        "--port",
        port,
        "--baud",
        String(baud || 921600),
        "--firmware_path",
        firmwarePath,
        "--flash_offset",
        flashOffset || "0x0",
        "--chip",
        chip || "esp32",
      ],
      label: `ESP Flash: ${path.basename(firmwarePath)} → ${port}`,
      timeoutMs: 120000, // 2 minute timeout for flashing
    });

    log.info("Flash job started", { jobId, port, firmware: path.basename(firmwarePath) });

    return jobId;
  }

  /**
   * Erase the flash memory of an ESP device.
   */
  async eraseFlash(port: string): Promise<string> {
    this.validatePort(port);

    const jobId = await this.processManager.spawn({
      type: "esp_flash",
      command: this.pythonBin,
      args: ["-m", "esptool", "--port", port, "erase_flash"],
      label: `ESP Erase Flash: ${port}`,
      timeoutMs: 60000,
    });

    return jobId;
  }

  /**
   * Read the flash memory of an ESP device to a file.
   */
  async readFlash(config: {
    port: string;
    outputFile: string;
    size?: string; // e.g., "0x400000" for 4MB
  }): Promise<string> {
    this.validatePort(config.port);

    const size = config.size || "0x400000"; // Default 4MB

    const jobId = await this.processManager.spawn({
      type: "esp_flash",
      command: this.pythonBin,
      args: [
        "-m",
        "esptool",
        "--port",
        config.port,
        "read_flash",
        "0",
        size,
        config.outputFile,
      ],
      label: `ESP Read Flash: ${config.port} → ${path.basename(config.outputFile)}`,
      timeoutMs: 120000,
    });

    return jobId;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /** Validate serial port path */
  private validatePort(port: string): void {
    // Accept Linux/macOS /dev/ paths and Windows COM ports
    const isLinuxPort = port.startsWith("/dev/");
    const isWindowsPort = /^COM\d+$/i.test(port);
    const isMacPort = port.startsWith("/dev/cu.") || port.startsWith("/dev/tty.");

    if (!isLinuxPort && !isWindowsPort && !isMacPort) {
      throw new Error(
        `[Omnecor ESP] Invalid port path: ${port}. Expected /dev/ttyUSB0 (Linux), /dev/cu.usbserial (macOS), or COM3 (Windows).`
      );
    }

    // Basic path traversal check
    if (port.includes("..")) {
      throw new Error(`[Omnecor ESP] Invalid port path: ${port}`);
    }
  }

  /** Validate that a file or directory exists */
  private async validatePathExists(filePath: string, label: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`[Omnecor ESP] ${label} not found: ${filePath}`);
    }
  }

  /** Validate firmware binary */
  private async validateFirmware(firmwarePath: string): Promise<void> {
    try {
      const stat = await fs.stat(firmwarePath);

      // Firmware should be a reasonable size (1KB to 16MB)
      if (stat.size < 1024) {
        throw new Error("Firmware file is too small (< 1KB)");
      }
      if (stat.size > 16 * 1024 * 1024) {
        throw new Error("Firmware file is too large (> 16MB)");
      }
    } catch (error) {
      if ((error as Error).message.includes("ENOENT")) {
        throw new Error(`[Omnecor ESP] Firmware not found: ${firmwarePath}`);
      }
      throw new Error(
        `[Omnecor ESP] Invalid firmware: ${(error as Error).message}`
      );
    }

    // Check for valid binary extensions
    const ext = path.extname(firmwarePath).toLowerCase();
    const validExtensions = [".bin", ".elf", ".hex"];
    if (!validExtensions.includes(ext)) {
      throw new Error(
        `[Omnecor ESP] Unexpected firmware extension: ${ext}. Expected: ${validExtensions.join(", ")}`
      );
    }
  }

  /** Extract chip ID from esptool output */
  private extractChipId(output: string): string {
    const idMatch = output.match(/Chip ID:\s*(0x[\da-fA-F]+)/i);
    if (idMatch) return idMatch[1];

    const serialMatch = output.match(/Serial Number:\s*([\da-fA-F]+)/i);
    if (serialMatch) return serialMatch[1];

    return "Unknown";
  }
}
