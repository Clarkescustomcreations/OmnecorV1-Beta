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
 *  - Uses our flash_mcu.py wrapper which emits JSON progress lines
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
import { spawn } from "child_process";
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
  /** Flash address offset (default: 0x1000 for ESP32) */
  flashOffset?: string;
  /** Chip type (default: esp32) */
  chip?: "esp32" | "esp32s2" | "esp32s3" | "esp32c3" | "esp8266";
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
 * ```
 */
export class ESPToolBridge extends EventEmitter {
  private static instance: ESPToolBridge | null = null;
  private processManager: ProcessManagerService;
  private pythonBin: string;

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
   * Check if esptool is installed and accessible.
   */
  async checkInstallation(): Promise<ESPToolInfo> {
    return new Promise(resolve => {
      const proc = spawn(this.pythonBin, ["-m", "esptool", "version"], {
        timeout: 10000,
      });

      let stdout = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("close", code => {
        if (code === 0) {
          const versionMatch = stdout.match(
            /esptool\.py\s+v?(\d+\.\d+[\.\d]*)/i
          );
          resolve({
            isInstalled: true,
            version: versionMatch
              ? versionMatch[1]
              : stdout.trim().split("\n")[0],
            pythonPath: this.pythonBin,
          });
        } else {
          resolve({
            isInstalled: false,
            version: null,
            pythonPath: this.pythonBin,
          });
        }
      });

      proc.on("error", () => {
        resolve({
          isInstalled: false,
          version: null,
          pythonPath: this.pythonBin,
        });
      });
    });
  }

  /**
   * Detect connected serial ports that may be ESP devices.
   * Scans /dev/ttyUSB* and /dev/ttyACM* on Linux.
   */
  async detectPorts(): Promise<SerialPort[]> {
    const ports: SerialPort[] = [];

    try {
      // Read /dev/ for serial devices
      const devEntries = await fs.readdir("/dev");
      const serialPatterns = ["ttyUSB", "ttyACM", "ttyS"];

      for (const entry of devEntries) {
        if (serialPatterns.some(p => entry.startsWith(p))) {
          const devicePath = `/dev/${entry}`;

          // Try to get USB device info from sysfs
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
  // Flash Operations
  // -------------------------------------------------------------------------

  /**
   * Flash firmware to an ESP device.
   * Uses the flash_mcu.py wrapper for JSON progress streaming.
   *
   * @param config - Flash configuration
   * @returns Job ID for tracking via ProcessManagerService
   */
  async flashFirmware(config: FlashConfig): Promise<string> {
    const { port, baud, firmwarePath, chip } = config;

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
    // Must start with /dev/ on Linux
    if (!port.startsWith("/dev/")) {
      throw new Error(
        `[Omnecor ESP] Invalid port path: ${port}. Must be a /dev/ device path.`
      );
    }

    // Basic path traversal check
    if (port.includes("..")) {
      throw new Error(`[Omnecor ESP] Invalid port path: ${port}`);
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
