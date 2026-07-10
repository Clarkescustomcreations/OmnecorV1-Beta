/**
 * Route-level integration tests for `trainingRouter` (no-hardware surface).
 *
 * Covers: validateDataset (valid / invalid-lines / empty / traversal-reject),
 * startTraining delegation + error-code mapping (NOT_FOUND / TOO_MANY_REQUESTS
 * / INTERNAL_SERVER_ERROR), getArtifact shape, and registerArtifact
 * (NOT_FOUND for a missing path / success writes the registry record).
 * ValetArtifactRegistry and the processManager service are mocked, so no GPU,
 * no Kaggle, and no writes to the real artifact registry. The procedures that
 * touch ~/.kaggle or valet.config.json in the repo root are intentionally NOT
 * exercised here (real side effects → 🤝 collaborative).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
const registry = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn().mockResolvedValue(undefined),
  hashFile: vi.fn(),
  versionedPath: vi.fn(),
  registryRoot: "/tmp/omnecor-test-registry",
}));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../core_services/services/ValetArtifactRegistry.js", () => ({
  ValetArtifactRegistry: registry,
}));

vi.mock("../core_services/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appRouter } from "../routers.js";
import { PATHS } from "../_core/paths.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
const tempFiles: string[] = [];

/** Write a file under PATHS.data (an allowed validatePath root) and track it for cleanup. */
async function writeAllowed(name: string, content: string): Promise<string> {
  await fs.mkdir(PATHS.data, { recursive: true });
  const p = path.join(PATHS.data, `__test_${randomUUID()}_${name}`);
  await fs.writeFile(p, content, "utf-8");
  tempFiles.push(p);
  return p;
}

function services(spawnLoRATraining = vi.fn()) {
  return { processManager: { spawnLoRATraining, spawn: vi.fn() } };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  registry.read.mockReset();
  registry.write.mockClear();
});

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map(p => fs.rm(p, { force: true })));
});

describe("training.validateDataset", () => {
  it("accepts a well-formed JSONL file", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const file = await writeAllowed("ok.jsonl", `{"a":1}\n{"b":2}\n`);

    const res = await caller.training.validateDataset({ datasetPath: file });
    expect(res.success).toBe(true);
    expect(res.totalLines).toBe(2);
    expect(res.validLines).toBe(2);
    expect(res.invalidLines).toBe(0);
  });

  it("reports invalid JSON lines", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const file = await writeAllowed("bad.jsonl", `{"a":1}\nNOT JSON\n{"c":3}\n`);

    const res = await caller.training.validateDataset({ datasetPath: file });
    expect(res.success).toBe(false);
    expect(res.invalidLines).toBe(1);
    expect(res.validLines).toBe(2);
  });

  it("rejects an empty dataset", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const file = await writeAllowed("empty.jsonl", `\n   \n`);
    await expect(caller.training.validateDataset({ datasetPath: file })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a path-traversal dataset path", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(
      caller.training.validateDataset({ datasetPath: "../../../../etc/passwd" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("training.startTraining", () => {
  it("spawns a LoRA job and returns the jobId", async () => {
    const user = await seedUser(db);
    const spawn = vi.fn().mockResolvedValue("job-123");
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(spawn)));
    const file = await writeAllowed("train.jsonl", `{"x":1}\n`);

    const res = await caller.training.startTraining({ datasetPath: file });
    expect(res.success).toBe(true);
    expect(res.jobId).toBe("job-123");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("maps a 'not found' spawn error to NOT_FOUND", async () => {
    const user = await seedUser(db);
    const spawn = vi.fn().mockRejectedValue(new Error("script not found"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(spawn)));
    const file = await writeAllowed("t.jsonl", `{"x":1}\n`);
    await expect(caller.training.startTraining({ datasetPath: file })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps a 'Maximum concurrent' error to TOO_MANY_REQUESTS", async () => {
    const user = await seedUser(db);
    const spawn = vi.fn().mockRejectedValue(new Error("Maximum concurrent jobs reached"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(spawn)));
    const file = await writeAllowed("t.jsonl", `{"x":1}\n`);
    await expect(caller.training.startTraining({ datasetPath: file })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("maps an unknown spawn error to INTERNAL_SERVER_ERROR", async () => {
    const user = await seedUser(db);
    const spawn = vi.fn().mockRejectedValue(new Error("disk on fire"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services(spawn)));
    const file = await writeAllowed("t.jsonl", `{"x":1}\n`);
    await expect(caller.training.startTraining({ datasetPath: file })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("training.getArtifact / registerArtifact", () => {
  it("getArtifact returns the registry record plus registryRoot", async () => {
    registry.read.mockResolvedValue({ status: "ready", artifact_path: "/models/x" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const res = await caller.training.getArtifact();
    expect(res.status).toBe("ready");
    expect(res.registryRoot).toBe("/tmp/omnecor-test-registry");
  });

  it("registerArtifact throws NOT_FOUND when the artifact path is missing", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(
      caller.training.registerArtifact({ artifactPath: "/no/such/artifact/path-xyz" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(registry.write).not.toHaveBeenCalled();
  });

  it("registerArtifact writes a ready record for an existing path", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const file = await writeAllowed("artifact.gguf", "binary");

    const res = await caller.training.registerArtifact({ artifactPath: file, format: "gguf", source: "trained" });
    expect(res.success).toBe(true);
    expect(registry.write).toHaveBeenCalledOnce();
    expect(registry.write).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_path: file, status: "ready", format: "gguf", source: "trained" })
    );
  });
});
