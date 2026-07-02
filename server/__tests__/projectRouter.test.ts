/**
 * Route-level integration tests for `projectRouter`.
 *
 * Exercises the service-delegating procedures with stubbed `ctx.services`
 * (fileWatcher + hashTracker) and the real `validatePath` security guard:
 *  - list maps WatcherStatus → UI shape (name = basename(rootDir))
 *  - getWatcherStatus / unregisterWatcher delegate to fileWatcher
 *  - checkAgentLoop / resetLoopDetector / getLoopDetectorState delegate to the
 *    loop detector (HashTrackerService)
 *  - readFile / registerProject reject path-traversal via validatePath
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import path from "node:path";
import fsp from "node:fs/promises";

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

import { appRouter } from "../routers.js";
import { PATHS } from "../_core/paths.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function makeServices(overrides: Record<string, unknown> = {}) {
  return {
    fileWatcher: {
      registerProject: vi.fn().mockResolvedValue(undefined),
      unregisterProject: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue([]),
      getFileTree: vi.fn().mockResolvedValue([]),
    },
    hashTracker: {
      hashAction: vi.fn().mockReturnValue("hash-abc"),
      checkAndRecord: vi.fn().mockReturnValue({ isLoop: false, count: 1 }),
      resetSession: vi.fn(),
      getSessionSnapshot: vi.fn().mockReturnValue(null),
    },
    ...overrides,
  };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
});

describe("auth boundary", () => {
  it("rejects unauthenticated list", async () => {
    const caller = appRouter.createCaller(makeContext(null, db, makeServices()));
    await expect(caller.project.list()).rejects.toThrow(TRPCError);
  });
});

describe("project.list / getWatcherStatus", () => {
  it("maps watcher statuses to the UI selector shape", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    (services.fileWatcher.getStatus as ReturnType<typeof vi.fn>).mockReturnValue([
      { projectId: "p1", rootDir: "/home/u/cool-project", isActive: true },
      { projectId: "p2", rootDir: "/", isActive: false },
    ]);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));

    const list = await caller.project.list();
    expect(list).toEqual([
      { id: "p1", name: "cool-project", projectId: "p1", rootDir: "/home/u/cool-project", isActive: true },
      { id: "p2", name: "p2", projectId: "p2", rootDir: "/", isActive: false }, // basename("/")="" → projectId fallback
    ]);
  });

  it("getWatcherStatus returns the raw fileWatcher status", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    const status = [{ projectId: "p", rootDir: "/r", isActive: true }];
    (services.fileWatcher.getStatus as ReturnType<typeof vi.fn>).mockReturnValue(status);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));
    expect(await caller.project.getWatcherStatus()).toEqual(status);
  });

  it("unregisterWatcher delegates to fileWatcher.unregisterProject", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));
    const res = await caller.project.unregisterWatcher({ projectId: "gone" });
    expect(res.success).toBe(true);
    expect(services.fileWatcher.unregisterProject).toHaveBeenCalledWith("gone");
  });
});

describe("project loop detector", () => {
  it("checkAgentLoop hashes then records, returning the detector result", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));

    const res = await caller.project.checkAgentLoop({
      sessionId: "s1",
      toolName: "edit",
      args: { file: "a.ts" },
      state: { step: 1 },
    });

    expect(services.hashTracker.hashAction).toHaveBeenCalledWith("edit", { file: "a.ts" }, { step: 1 });
    expect(services.hashTracker.checkAndRecord).toHaveBeenCalledWith("s1", "hash-abc");
    expect(res).toEqual({ isLoop: false, count: 1 });
  });

  it("resetLoopDetector resets the session", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));
    const res = await caller.project.resetLoopDetector({ sessionId: "s2" });
    expect(res.success).toBe(true);
    expect(services.hashTracker.resetSession).toHaveBeenCalledWith("s2");
  });

  it("getLoopDetectorState reports exists:false when no snapshot", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    expect(await caller.project.getLoopDetectorState({ sessionId: "none" })).toEqual({
      exists: false,
      snapshot: null,
    });
  });

  it("getLoopDetectorState returns the snapshot when present", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    const snap = { actions: 3, lastHash: "h" };
    (services.hashTracker.getSessionSnapshot as ReturnType<typeof vi.fn>).mockReturnValue(snap);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));
    expect(await caller.project.getLoopDetectorState({ sessionId: "s" })).toEqual({
      exists: true,
      snapshot: snap,
    });
  });
});

describe("project validatePath guard", () => {
  it("readFile rejects a path-traversal path", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    await expect(
      caller.project.readFile({ path: "../../../../etc/passwd" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("registerProject rejects a directory outside the allowed roots", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    await expect(
      caller.project.registerProject({ projectId: "evil", rootDir: "/etc" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Real-filesystem happy paths ─────────────────────────────────────────────
//
// A scratch directory under PATHS.projects (an allowed validatePath root — in
// dev this resolves inside <repo>/data, never the user's home) exercises the
// read/write/tree procedures against the real fs instead of only the guard's
// rejection branch.

describe("project fs procedures — real directory under an allowed root", () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await fsp.mkdtemp(path.join(PATHS.projects, "router-test-"));
  });

  afterEach(async () => {
    await fsp.rm(scratch, { recursive: true, force: true });
  });

  it("writeFile persists content that readFile then returns", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    const file = path.join(scratch, "notes.md");

    const wrote = await caller.project.writeFile({ path: file, content: "hello omnecor" });
    expect(wrote).toEqual({ success: true });
    expect(await fsp.readFile(file, "utf-8")).toBe("hello omnecor");

    const read = await caller.project.readFile({ path: file });
    expect(read).toEqual({ content: "hello omnecor" });
  });

  it("readFile maps a missing file to BAD_REQUEST (fs error surfaced, not masked)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    await expect(
      caller.project.readFile({ path: path.join(scratch, "ghost.txt") })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("getFileTree returns the root's children with nested directories marked", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    await fsp.mkdir(path.join(scratch, "src"));
    await fsp.writeFile(path.join(scratch, "src", "index.ts"), "export {}");
    await fsp.writeFile(path.join(scratch, "README.md"), "# hi");

    const tree = await caller.project.getFileTree({ projectId: "p", rootDir: scratch });
    const names = tree.map(n => n.name).sort();
    expect(names).toEqual(["README.md", "src"]);
    const src = tree.find(n => n.name === "src");
    expect(src?.type).toBe("directory");
    expect(src?.children?.map(c => c.name)).toEqual(["index.ts"]);
  });

  it("getFileTree rejects a file path (not a directory) with NOT_FOUND", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    const file = path.join(scratch, "single.txt");
    await fsp.writeFile(file, "x");
    await expect(
      caller.project.getFileTree({ projectId: "p", rootDir: file })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getFileTree rejects a traversal rootDir with NOT_FOUND (its catch-all wrap)", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, makeServices()));
    await expect(
      caller.project.getFileTree({ projectId: "p", rootDir: "../../etc" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("registerProject accepts a real directory and hands the RESOLVED path to the watcher", async () => {
    const user = await seedUser(db);
    const services = makeServices();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services));

    const res = await caller.project.registerProject({ projectId: "p-live", rootDir: scratch });
    expect(res.success).toBe(true);
    expect(services.fileWatcher.registerProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-live", rootDir: res.rootDir })
    );
  });
});
