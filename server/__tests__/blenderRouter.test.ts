/**
 * Integration tests for the Blender bridge.
 *
 * Requires Blender to be installed and findable via BLENDER_BIN (or the
 * default "blender" binary on PATH). Tests are automatically skipped when
 * Blender is not installed, so they are safe to include in the normal run.
 *
 * Test 3 (GLB export) runs the full Blender bridge end-to-end: Blender opens
 * in headless mode, exports the default startup scene (cube + camera + light)
 * to a GLB file, and we verify the binary was produced. This is the same
 * pipeline Omnecor's AI orchestration layer uses to request 3-D assets.
 */

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../db.factory.js", async (importActual) => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { appRouter } from "../routers.js";
import { BlenderBridge } from "../core_services/services/BlenderService.js";
import { createTestDb, makeContext, waitForJob } from "./_helpers/trpcHarness.js";

// Probe Blender at module load so describe.skipIf has a concrete boolean
const blenderInfo = await BlenderBridge.getInstance()
  .checkInstallation()
  .catch(() => ({ isInstalled: false, version: null, path: "", pythonVersion: null }));

let outputDir = "";

describe.skipIf(!blenderInfo.isInstalled)("blender bridge — installation, router, and GLB export", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnecor_blender_test_"));

    const { db } = await createTestDb();
    h.db = db;
    // status is publicProcedure — user can be null
    const ctx = makeContext(null, db as never, { blender: BlenderBridge.getInstance() });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("BlenderBridge.checkInstallation() reports isInstalled:true with a version string", () => {
    expect(blenderInfo.isInstalled).toBe(true);
    expect(typeof blenderInfo.version).toBe("string");
    expect(blenderInfo.version).toMatch(/^\d+\.\d+/); // e.g. "4.1.0"
    expect(blenderInfo.path).toBeTruthy();
  });

  it("blender.status via tRPC router returns the same installation shape", async () => {
    const status = await caller.blender.status();
    expect(status.isInstalled).toBe(true);
    expect(status.version).toMatch(/^\d+\.\d+/);
    expect(status.path).toBeTruthy();
  });

  it(
    "BlenderBridge.exportScene() exports the default cube scene to a GLB file",
    async () => {
      const glbPath = path.join(outputDir, "omnecor_test_cube.glb");

      // Omnecor AI layer requests a GLB export — bridge runs Blender headless
      const jobId = await BlenderBridge.getInstance().exportScene(glbPath);
      expect(typeof jobId).toBe("string");
      expect(jobId.length).toBeGreaterThan(0);

      const status = await waitForJob(jobId, 60_000);
      expect(status?.state).toBe("completed");

      // GLB file must exist and have non-zero content
      const stat = await fs.stat(glbPath);
      expect(stat.size).toBeGreaterThan(0);

      // Minimal GLB magic: first 4 bytes are 0x676C5446 ("glTF")
      const buf = Buffer.alloc(4);
      const fh = await fs.open(glbPath, "r");
      try {
        await fh.read(buf, 0, 4, 0);
      } finally {
        await fh.close();
      }
      expect(buf.toString("ascii")).toBe("glTF");
    },
    65_000
  );
});
