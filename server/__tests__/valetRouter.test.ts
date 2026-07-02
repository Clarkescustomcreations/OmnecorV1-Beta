/**
 * Batch E — route-level tests for `valetRouter` (the harness-drivable subset).
 *
 *   - testRoute (`valet.route`)  → delegates to a STUBBED ValetRouterService
 *     classifier, so the routing decision is exercised without the
 *     `valet_router_inference.py` bridge on :8010.
 *   - getMoeChain / saveMoeChain → real in-memory DB, per-user scoping.
 *   - initMoeChain               → first-run seed: cloud default steps + a
 *     mocked local-GGUF scan, with `preserveExisting` not clobbering a
 *     hand-built chain.
 *   - scanLocalModels            → GGUF mapping (and graceful empty) over a
 *     mocked `fs/promises.readdir`.
 *
 * Long-job / GPU / training procedures stay manual (hardware) per §11.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const valetSvc = vi.hoisted(() => ({ route: vi.fn() }));
vi.mock("../phase2/services/ValetRouterService.js", () => ({
  ValetRouterService: { getInstance: () => valetSvc },
}));

// Mock only `readdir` (used by the GGUF scan); delegate everything else so the
// harness migrations and other fs/promises calls keep working.
const fsState = vi.hoisted(() => ({ readdir: vi.fn() }));
vi.mock("fs/promises", async importActual => {
  const actual = await importActual<typeof import("fs/promises")>();
  return { ...actual, default: actual, readdir: (...args: unknown[]) => fsState.readdir(...args) };
});

import { appRouter } from "../routers.js";
import { moeChainConfigs } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

const ggufEntry = (name: string, parentPath = "/models") => ({ isFile: () => true, name, parentPath });
const step = (order: number, label: string) => ({
  order,
  label,
  taskCategories: ["general"],
  enabled: true,
});

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  valetSvc.route.mockReset();
  fsState.readdir.mockReset();
  fsState.readdir.mockResolvedValue([]); // default: empty models dir
});

describe("valet — auth boundary", () => {
  it("rejects unauthenticated getMoeChain", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.valet.getMoeChain({ chainType: "local" })).rejects.toThrow(TRPCError);
  });
});

describe("valet.testRoute (valet.route — stubbed classifier)", () => {
  it("delegates to ValetRouterService.route and returns its decision", async () => {
    valetSvc.route.mockResolvedValue({ mode: "api_direct", reasoning: "simple chat" });
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.valet.testRoute({ task: "summarise this" });
    expect(res).toEqual({ mode: "api_direct", reasoning: "simple chat" });
    expect(valetSvc.route).toHaveBeenCalledOnce();
    expect(valetSvc.route.mock.calls[0]?.[0]).toMatchObject({ task: "summarise this", taskType: "chat" });
  });
});

describe("valet.getMoeChain / saveMoeChain", () => {
  it("returns null when the user has no chain of that type", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.valet.getMoeChain({ chainType: "local" })).toBeNull();
  });

  it("persists a saved chain and reads it back", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.valet.saveMoeChain({ chainType: "local", steps: [step(0, "Router")] });
    const got = await caller.valet.getMoeChain({ chainType: "local" });
    expect(got?.steps?.[0]?.label).toBe("Router");
  });

  it("scopes chains per user", async () => {
    const alice = await seedUser(db, { openId: "a", email: "a@x.com" });
    const bob = await seedUser(db, { openId: "b", email: "b@x.com" });
    await appRouter.createCaller(makeContext(alice, db)).valet.saveMoeChain({ chainType: "local", steps: [step(0, "alice")] });
    expect(await appRouter.createCaller(makeContext(bob, db)).valet.getMoeChain({ chainType: "local" })).toBeNull();
  });
});

describe("valet.initMoeChain", () => {
  it("seeds the 7 default cloud steps (no local scan when chainType=cloud)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.valet.initMoeChain({ chainType: "cloud" });
    expect(res.localSteps).toHaveLength(0);
    expect(res.cloudSteps.length).toBeGreaterThan(0);
    expect(fsState.readdir).not.toHaveBeenCalled();

    const row = await caller.valet.getMoeChain({ chainType: "cloud" });
    expect(row?.steps?.length).toBe(res.cloudSteps.length);
  });

  it("does NOT clobber an existing hand-built chain (preserveExisting)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.valet.saveMoeChain({ chainType: "cloud", steps: [step(0, "my custom step")] });

    await caller.valet.initMoeChain({ chainType: "cloud" });
    const row = await caller.valet.getMoeChain({ chainType: "cloud" });
    expect(row?.steps).toHaveLength(1);
    expect(row?.steps?.[0]?.label).toBe("my custom step");
  });

  it("seeds local steps from the GGUF scan when chainType=local", async () => {
    fsState.readdir.mockResolvedValue([ggufEntry("phi3-mini.gguf")]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.valet.initMoeChain({ chainType: "local" });
    expect(res.cloudSteps).toHaveLength(0);
    expect(res.localSteps).toHaveLength(1);
    expect(res.localSteps[0]).toMatchObject({ label: "phi3-mini", ggufFile: "phi3-mini.gguf", enabled: false });
  });
});

describe("valet.scanLocalModels", () => {
  it("returns an empty list when the models dir has no GGUFs", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.valet.scanLocalModels()).toEqual([]);
  });

  it("maps each .gguf file to a disabled step and ignores non-GGUF files", async () => {
    fsState.readdir.mockResolvedValue([
      ggufEntry("qwen2.5-1.5b.gguf"),
      ggufEntry("README.md"),
      ggufEntry("llama3.gguf"),
    ]);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.valet.scanLocalModels();
    expect(res.map(s => s.ggufFile)).toEqual(["qwen2.5-1.5b.gguf", "llama3.gguf"]);
    expect(res.every(s => s.enabled === false)).toBe(true);
    expect(res[0].label).toBe("qwen2.5-1.5b");
  });

  it("degrades to an empty list when the models dir is unreadable", async () => {
    fsState.readdir.mockRejectedValue(new Error("ENOENT"));
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.valet.scanLocalModels()).toEqual([]);
  });
});

// Sanity: the chains seeded above really did land in the DB (not just echoed).
describe("valet.initMoeChain — persistence sanity", () => {
  it("writes a moeChainConfigs row for the seeded cloud chain", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.valet.initMoeChain({ chainType: "cloud" });
    const rows = await db.select().from(moeChainConfigs).where(eq(moeChainConfigs.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].chainType).toBe("cloud");
  });
});
