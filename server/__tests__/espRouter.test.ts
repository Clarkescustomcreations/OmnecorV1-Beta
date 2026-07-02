/**
 * Integration tests for the ESP32 / esptool bridge.
 *
 * ESPToolBridge.checkInstallation() auto-discovers the Python interpreter that
 * has esptool installed (tries PYTHON_BIN, python3, python in order), so the
 * suite runs as long as esptool is reachable anywhere on the system.
 *
 * Hardware-dependent tests soft-skip when no USB serial port is detected:
 *   getChipInfo — reads chip identity; non-destructive; plug in ESP32 to run.
 *   erase       — erases flash; DESTRUCTIVE; set OMNECOR_TEST_ESP_ERASE=1
 *                 AND connect ESP32 to enable. Existing firmware will be wiped.
 *
 * Flash/read operations remain in the Priority 4 manual checklist — they
 * require a firmware binary supplied by the user.
 */

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "path";
import fs from "fs/promises";
import { appRouter } from "../routers.js";
import { ESPToolBridge, type SerialPort } from "../phase2/services/ESPToolService.js";
import { createTestDb, seedUser, makeContext, waitForJob } from "./_helpers/trpcHarness.js";
import { PATHS } from "../_core/paths.js";

// Minimal BLE advertiser: on boot it advertises the name OMNECOR_TEST_OK and
// prints a confirmation line over serial. Used by the gated compile+flash test.
const BLE_SKETCH = `#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

void setup() {
  Serial.begin(115200);
  Serial.println("Starting BLE work!");
  BLEDevice::init("OMNECOR_TEST_OK");
  BLEServer *pServer = BLEDevice::createServer();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->start();
  Serial.println("Advertising started. Broadcasting 'OMNECOR_TEST_OK'.");
}

void loop() {
  delay(2000);
}
`;

// Auto-discovering probe: ESPToolBridge.checkInstallation() tries python3,
// python, and PYTHON_BIN in sequence and caches the working interpreter.
const espInfo = await ESPToolBridge.getInstance()
  .checkInstallation()
  .catch(() => ({ isInstalled: false, version: null, pythonPath: "" }));

describe.skipIf(!espInfo.isInstalled)(
  "esp bridge — esptool installation, port detection, and hardware ops",
  () => {
    let caller: ReturnType<typeof appRouter.createCaller>;
    // Only USB serial adapters (ttyUSB*, ttyACM*) are real ESP32 candidates.
    // ttyS* are hardware UARTs that esptool will time out connecting to.
    let usbPorts: SerialPort[] = [];

    beforeAll(async () => {
      const { db } = await createTestDb();
      h.db = db;
      const user = await seedUser(db);
      const ctx = makeContext(user, db, { esp: ESPToolBridge.getInstance() });
      caller = appRouter.createCaller(ctx);

      const allPorts = await ESPToolBridge.getInstance().detectPorts();
      usbPorts = allPorts.filter(
        (p) => p.path.includes("ttyUSB") || p.path.includes("ttyACM")
      );
    });

    it("esptool is installed and checkInstallation returns a version string", () => {
      expect(espInfo.isInstalled).toBe(true);
      expect(typeof espInfo.version).toBe("string");
      expect(espInfo.version).toBeTruthy();
      expect(espInfo.pythonPath).toBeTruthy();
    });

    it("esp.status via tRPC router returns the same installation shape", async () => {
      const pubCtx = makeContext(null, null as never, {
        esp: ESPToolBridge.getInstance(),
      });
      const pubCaller = appRouter.createCaller(pubCtx);
      const status = await pubCaller.esp.status();
      expect(status.isInstalled).toBe(true);
      expect(status.version).toBeTruthy();
    });

    it("esp.detectPorts returns a valid SerialPort array (empty is fine without hardware)", async () => {
      const ports = await caller.esp.detectPorts();
      expect(Array.isArray(ports)).toBe(true);
      for (const port of ports) {
        expect(typeof port.path).toBe("string");
        expect(port.path.length).toBeGreaterThan(0);
        expect(typeof port.description).toBe("string");
      }
    });

    it("esp.getChipInfo returns chip data when an ESP32 is connected via USB", async () => {
      if (usbPorts.length === 0) {
        console.log(
          "  [skip] No USB serial port (ttyUSB*/ttyACM*) — " +
            "connect an ESP32 via USB to exercise getChipInfo."
        );
        return;
      }

      const chipInfo = await caller.esp.getChipInfo({ port: usbPorts[0].path });

      expect(typeof chipInfo.chipType).toBe("string");
      expect(chipInfo.chipType.length).toBeGreaterThan(0);
      expect(typeof chipInfo.chipId).toBe("string");
      expect(typeof chipInfo.macAddress).toBe("string");
      if (chipInfo.flashSize !== undefined) {
        expect(typeof chipInfo.flashSize).toBe("string");
      }
    }, 30_000);

    it(
      "esp.erase erases ESP32 flash (DESTRUCTIVE — set OMNECOR_TEST_ESP_ERASE=1 to enable)",
      async () => {
        if (usbPorts.length === 0) {
          console.log(
            "  [skip] No USB serial port — connect ESP32 to exercise erase."
          );
          return;
        }
        if (!process.env.OMNECOR_TEST_ESP_ERASE) {
          console.log(
            "  [skip] Set OMNECOR_TEST_ESP_ERASE=1 to enable flash erase. " +
              "WARNING: this permanently wipes existing firmware."
          );
          return;
        }

        const result = await caller.esp.erase({ port: usbPorts[0].path });
        expect(result.success).toBe(true);
        expect(typeof result.jobId).toBe("string");

        const status = await waitForJob(result.jobId, 60_000);
        expect(status?.state).toBe("completed");
      },
      65_000
    );

    it(
      "esp.compile builds the BLE sketch and esp.flash writes it to the ESP32 " +
        "(DESTRUCTIVE — set OMNECOR_TEST_ESP_FLASH=1 to enable)",
      async () => {
        if (usbPorts.length === 0) {
          console.log(
            "  [skip] No USB serial port — connect ESP32 to exercise compile+flash."
          );
          return;
        }
        if (!process.env.OMNECOR_TEST_ESP_FLASH) {
          console.log(
            "  [skip] Set OMNECOR_TEST_ESP_FLASH=1 to enable compile+flash. " +
              "WARNING: this overwrites the ESP32's firmware."
          );
          return;
        }

        // Stage a self-contained sketch under an allowed dir (PATHS.projects) so
        // esp.compile's validatePath accepts it. arduino-cli requires the .ino to
        // live in a folder of the same name.
        const sketchDir = path.join(PATHS.projects, "esp-sketches", "OmnecorBleTest");
        await fs.mkdir(sketchDir, { recursive: true });
        await fs.writeFile(path.join(sketchDir, "OmnecorBleTest.ino"), BLE_SKETCH, "utf-8");
        const outputDir = path.join(PATHS.exports, "esp-build");

        // 1. Compile via the real router path (validatePath → arduino-cli).
        const compile = await caller.esp.compile({
          sketchPath: sketchDir,
          fqbn: "esp32:esp32:esp32",
          outputDir,
        });
        expect(compile.success).toBe(true);
        const compileStatus = await waitForJob(compile.jobId, 300_000);
        expect(compileStatus?.state).toBe("completed");

        // arduino-cli emits a full 0x0-based merged image alongside the app bin.
        const mergedBin = path.join(outputDir, "OmnecorBleTest.ino.merged.bin");
        await expect(fs.access(mergedBin)).resolves.toBeUndefined();

        // 2. Flash the merged image at 0x0 via the real router path.
        const flash = await caller.esp.flash({
          port: usbPorts[0].path,
          firmwarePath: mergedBin,
          flashOffset: "0x0",
          baud: 921600,
        });
        expect(flash.success).toBe(true);
        const flashStatus = await waitForJob(flash.jobId, 120_000);
        expect(flashStatus?.state).toBe("completed");
      },
      430_000
    );
  }
);
