/**
 * Batch G tail — route-level tests for `penpotRouter` (Penpot design integration).
 *
 * Thin orchestration over `PenpotService`, so the service is mocked and we drive
 * the real `appRouter.createCaller(ctx)` to assert: auth boundary, argument
 * forwarding, and — the security-relevant part — that the `componentName`
 * identifier regex rejects path-traversal/unsafe names before the service (which
 * uses the name as an output filename) is ever called.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const configure = vi.hoisted(() => vi.fn());
const generateComponent = vi.hoisted(() => vi.fn());
vi.mock("../phase2/services/PenpotService.js", () => ({
  PenpotService: { getInstance: () => ({ configure, generateComponent }) },
}));

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let user: User;

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  user = await seedUser(db);
  configure.mockReset().mockResolvedValue(undefined);
  generateComponent.mockReset().mockResolvedValue("/data/projects/out/Card.tsx");
});

describe("penpot — auth boundary", () => {
  it("rejects an unauthenticated configure", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(
      caller.penpot.configure({ url: "https://penpot.app", token: "t" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("penpot.configure", () => {
  it("forwards url + token to the service", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.penpot.configure({ url: "https://penpot.app", token: "secret-tok" }))
      .toEqual({ success: true });
    expect(configure).toHaveBeenCalledWith("https://penpot.app", "secret-tok");
  });

  it("rejects a non-URL endpoint before calling the service", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.penpot.configure({ url: "not-a-url", token: "t" })).rejects.toThrow();
    expect(configure).not.toHaveBeenCalled();
  });
});

describe("penpot.generateComponent", () => {
  it("forwards the ids + name and returns the produced file path", async () => {
    generateComponent.mockResolvedValue("/data/projects/out/MyButton.tsx");
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.penpot.generateComponent({
      fileId: "file-1",
      nodeId: "node-1",
      componentName: "MyButton",
    });
    expect(res).toEqual({ success: true, filePath: "/data/projects/out/MyButton.tsx" });
    expect(generateComponent).toHaveBeenCalledWith("file-1", "node-1", "MyButton", undefined);
  });

  it("rejects a traversal-style componentName (used as a filename) before the service", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    for (const bad of ["../evil", "foo/bar", "with space", "9startsWithDigit"]) {
      await expect(
        caller.penpot.generateComponent({ fileId: "f", nodeId: "n", componentName: bad }),
      ).rejects.toThrow();
    }
    expect(generateComponent).not.toHaveBeenCalled();
  });

  it("propagates a service failure", async () => {
    generateComponent.mockRejectedValue(new Error("penpot API 500"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.penpot.generateComponent({ fileId: "f", nodeId: "n", componentName: "Ok" }),
    ).rejects.toThrow("penpot API 500");
  });
});
