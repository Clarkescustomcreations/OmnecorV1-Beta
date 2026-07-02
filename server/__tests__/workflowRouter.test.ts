/**
 * Batch G tail — route-level tests for `workflowRouter` (the five built-in
 * agent skill-commands ported to Omnecor's runtime: review / remember / imprint).
 *
 * FS writes are isolated by pointing `OMNECOR_DATA` at a throwaway temp dir
 * BEFORE any import — so `PATHS.projects` (and the `validatePath` allow-list,
 * which is derived from it) resolve there. That means `validatePath` is
 * exercised for real (traversal is genuinely rejected), while nothing touches
 * the developer's real ~/.omnecor. Only the Valet model call
 * (`AiProviderService.chat`) is mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => {
  const prevData = process.env.OMNECOR_DATA;
  const dir = `/tmp/omnecor-workflow-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.OMNECOR_DATA = dir;
  return { dir, prevData };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const chatMock = vi.hoisted(() => vi.fn());
vi.mock("../phase2/services/AiProviderService.js", () => ({
  AiProviderService: { getInstance: () => ({ chat: chatMock }) },
}));

import path from "node:path";
import fs from "node:fs/promises";
import { rmSync } from "node:fs";
import { appRouter } from "../routers.js";
import { PATHS } from "../_core/paths.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let user: User;

const PROJECT = "testproj";

beforeAll(() => {
  // PATHS.projects resolves under the temp OMNECOR_DATA set in the hoisted block.
  expect(PATHS.projects.startsWith(H.dir)).toBe(true);
});

afterAll(() => {
  if (H.prevData === undefined) delete process.env.OMNECOR_DATA;
  else process.env.OMNECOR_DATA = H.prevData;
  rmSync(H.dir, { recursive: true, force: true });
});

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  user = await seedUser(db);
  chatMock.mockReset();
  // Clean any per-project artifacts between tests.
  rmSync(path.join(PATHS.projects, PROJECT), { recursive: true, force: true });
});

describe("workflow — auth boundary", () => {
  it("rejects an unauthenticated reviewContext", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.workflow.reviewContext()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("workflow.reviewContext", () => {
  it("returns the working-tree diff + plan excerpts (real git in the repo)", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.workflow.reviewContext();

    expect(res.isRepo).toBe(true); // the test process runs inside the repo
    expect(typeof res.diffStat).toBe("string");
    expect(typeof res.diff).toBe("string");
    expect(typeof res.hasChanges).toBe("boolean");
    expect(res.planExcerpts).toBeTypeOf("object");
  });
});

describe("workflow.rememberSave", () => {
  const saveInput = () => ({
    projectId: PROJECT,
    providerId: "ollama",
    modelId: "llama3",
    messages: [{ role: "user" as const, content: "we built the widget" }],
  });

  it("compresses via Valet, redacts secrets, and writes memory.md", async () => {
    // The model echoes a secret-looking value; the router must redact it.
    chatMock.mockResolvedValue(
      "# Memory\n## Current state\nToken 4111111111111111 was used.",
    );
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.workflow.rememberSave(saveInput());
    expect(res.saved).toBe(true);
    expect(res.path).toBe(path.join(PATHS.projects, PROJECT, "memory.md"));
    expect(res.content).not.toContain("4111111111111111"); // PAN redacted

    // The system preamble + transcript were forwarded to the provider.
    const arg = chatMock.mock.calls[0][0];
    expect(arg).toMatchObject({ providerId: "ollama", modelId: "llama3" });
    expect(arg.systemPrompt).toContain("compressing a development session");
    expect(arg.messages[0].content).toContain("[USER]: we built the widget");

    // The file is actually on disk with the redacted content.
    const onDisk = await fs.readFile(res.path, "utf8");
    expect(onDisk).toContain("# Memory");
    expect(onDisk).not.toContain("4111111111111111");
  });

  it("maps a model failure to INTERNAL_SERVER_ERROR", async () => {
    chatMock.mockRejectedValue(new Error("no provider configured"));
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.workflow.rememberSave(saveInput())).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("workflow.rememberRestore", () => {
  it("reports no memory for a fresh project", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.workflow.rememberRestore({ projectId: PROJECT });
    expect(res).toMatchObject({ hasMemory: false, memory: null });
  });

  it("reads back a previously saved memory", async () => {
    chatMock.mockResolvedValue("# Memory\n## Current state\nall green");
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.workflow.rememberSave({
      projectId: PROJECT,
      providerId: "ollama",
      modelId: "llama3",
      messages: [{ role: "user", content: "x" }],
    });

    const res = await caller.workflow.rememberRestore({ projectId: PROJECT });
    expect(res.hasMemory).toBe(true);
    expect(res.memory).toContain("all green");
  });
});

describe("workflow.imprint", () => {
  it("extracts consistency classes from a component and appends to ui-registry.md", async () => {
    // A component placed inside the projects root (validatePath requires this).
    const compDir = path.join(PATHS.projects, PROJECT, "components");
    await fs.mkdir(compDir, { recursive: true });
    const compPath = path.join(compDir, "Button.tsx");
    await fs.writeFile(
      compPath,
      `export function Button() { return <button className="bg-card text-foreground rounded-lg p-4 hover:bg-accent" />; }`,
      "utf8",
    );

    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.workflow.imprint({ projectId: PROJECT, filePath: compPath });

    expect(res.path).toBe(path.join(PATHS.projects, PROJECT, "ui-registry.md"));
    expect(res.entry).toContain("### Button.tsx");
    expect(res.entry).toContain("bg-card"); // background class picked
    expect(res.entry).toContain("text-foreground"); // text class picked
    expect(res.entry).toContain("hover:bg-accent"); // hover class picked

    const registry = await fs.readFile(res.path, "utf8");
    expect(registry).toContain("### Button.tsx");
  });

  it("rejects a path-traversal filePath via validatePath", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.workflow.imprint({ projectId: PROJECT, filePath: "../../etc/passwd" }),
    ).rejects.toThrow();
  });
});
