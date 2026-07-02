/**
 * Route-level tests for `pcbEditorRouter`.
 *
 * The router is a thin ownership-enforcing wrapper over the `db-pcb` helper
 * layer, so those helpers are mocked and every test asserts the boundary the
 * helpers cannot: per-user ownership (a project/design owned by another user is
 * NOT_FOUND), the INTERNAL_SERVER_ERROR mapping when a helper returns null, the
 * Sovereign-mode gate on `reviewDesign` (the only cloud call), and the
 * canvasData JSON round-trip. No real DB — every dependency is mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// db-pcb helpers — mocked so ownership logic is asserted at the router boundary.
// Spread the real module so any non-mocked export another router might touch
// stays intact.
const pcb = vi.hoisted(() => ({
  createProject: vi.fn(),
  getProjectsByUserId: vi.fn(),
  getProjectById: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  saveDesign: vi.fn(),
  getDesignById: vi.fn(),
  getLatestDesign: vi.fn(),
  getDesignVersions: vi.fn(),
  deleteDesign: vi.fn(),
  createExport: vi.fn(),
  getExportsByDesign: vi.fn(),
  createAIReview: vi.fn(),
  getAIReviewsByDesign: vi.fn(),
}));
vi.mock("../db-pcb.js", async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  ...pcb,
}));

// Audit middleware runs on every protectedProcedure; stub it so nothing hits
// the real file DB.
vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { makeContext } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;

function makeUser(executionMode: User["executionMode"] = "scrapper", id = 1): User {
  return {
    id,
    openId: `owner-${id}`,
    email: "u@example.com",
    name: "U",
    loginMethod: "manus",
    passwordHash: null,
    role: "user",
    executionMode,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as User;
}

function mkCaller(user: User | null) {
  const aiProvider = { chat: vi.fn() };
  const c: Caller = appRouter.createCaller(
    makeContext(user, {} as Db, { aiProvider })
  );
  return { caller: c, aiProvider };
}

beforeEach(() => {
  for (const fn of Object.values(pcb)) fn.mockReset();
});

describe("pcbEditor — auth boundary", () => {
  it("rejects unauthenticated getProjects", async () => {
    const { caller } = mkCaller(null);
    await expect(caller.pcbEditor.getProjects()).rejects.toThrow(TRPCError);
  });
});

describe("pcbEditor.createProject", () => {
  it("returns the created project", async () => {
    pcb.createProject.mockResolvedValue({ id: 9, userId: 1, name: "Board" });
    const { caller } = mkCaller(makeUser());
    const res = await caller.pcbEditor.createProject({ name: "Board" });
    expect(res).toMatchObject({ id: 9, name: "Board" });
    expect(pcb.createProject).toHaveBeenCalledWith(1, "Board", undefined, "schematic", null);
  });

  it("maps a null helper result to INTERNAL_SERVER_ERROR", async () => {
    pcb.createProject.mockResolvedValue(null);
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.createProject({ name: "Board" })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("pcbEditor.getProject — ownership", () => {
  it("returns NOT_FOUND for another user's project", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 2 });
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.getProject({ projectId: 3 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the project for its owner", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 1, name: "Mine" });
    const { caller } = mkCaller(makeUser());
    const res = await caller.pcbEditor.getProject({ projectId: 3 });
    expect(res).toMatchObject({ id: 3, name: "Mine" });
  });
});

describe("pcbEditor.updateProject / deleteProject — ownership", () => {
  it("update forbids another user's project (NOT_FOUND, no write)", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 2 });
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.updateProject({ projectId: 3, name: "x" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(pcb.updateProject).not.toHaveBeenCalled();
  });

  it("delete forbids another user's project (NOT_FOUND, no write)", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 2 });
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.deleteProject({ projectId: 3 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(pcb.deleteProject).not.toHaveBeenCalled();
  });

  it("delete succeeds for the owner", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 1 });
    pcb.deleteProject.mockResolvedValue(true);
    const { caller } = mkCaller(makeUser());
    expect(await caller.pcbEditor.deleteProject({ projectId: 3 })).toEqual({ success: true });
  });
});

describe("pcbEditor.saveDesign", () => {
  const canvasData = { nodes: [], edges: [] };

  it("forbids saving into another user's project", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 2 });
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.saveDesign({ projectId: 3, name: "v1", canvasData })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(pcb.saveDesign).not.toHaveBeenCalled();
  });

  it("inherits the parent project's mapId when saving", async () => {
    pcb.getProjectById.mockResolvedValue({ id: 3, userId: 1, mapId: "map-7" });
    pcb.saveDesign.mockResolvedValue({ id: 50, projectId: 3 });
    const { caller } = mkCaller(makeUser());
    await caller.pcbEditor.saveDesign({ projectId: 3, name: "v1", canvasData });
    expect(pcb.saveDesign).toHaveBeenCalledWith(3, 1, "v1", canvasData, undefined, "map-7");
  });
});

describe("pcbEditor.loadDesign", () => {
  it("returns NOT_FOUND for a design the caller does not own", async () => {
    pcb.getDesignById.mockResolvedValue({ id: 50, userId: 2 });
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.loadDesign({ designSaveId: 50 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("parses a string canvasData payload back into an object", async () => {
    pcb.getDesignById.mockResolvedValue({
      id: 50,
      userId: 1,
      canvasData: JSON.stringify({ nodes: [{ id: "n1" }], edges: [] }),
    });
    const { caller } = mkCaller(makeUser());
    const res = await caller.pcbEditor.loadDesign({ designSaveId: 50 });
    expect(res.canvasData).toEqual({ nodes: [{ id: "n1" }], edges: [] });
  });
});

describe("pcbEditor.reviewDesign — Sovereign-mode gate", () => {
  it("blocks a sovereign user before any DB read or model call", async () => {
    const { caller, aiProvider } = mkCaller(makeUser("sovereign"));
    await expect(
      caller.pcbEditor.reviewDesign({ designSaveId: 50, prompt: "check" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(pcb.getDesignById).not.toHaveBeenCalled();
    expect(aiProvider.chat).not.toHaveBeenCalled();
  });

  it("forbids reviewing a design the caller does not own", async () => {
    pcb.getDesignById.mockResolvedValue({ id: 50, userId: 2 });
    const { caller, aiProvider } = mkCaller(makeUser("scrapper"));
    await expect(
      caller.pcbEditor.reviewDesign({ designSaveId: 50, prompt: "check" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(aiProvider.chat).not.toHaveBeenCalled();
  });

  it("runs the openai review for the owner and persists it", async () => {
    pcb.getDesignById.mockResolvedValue({
      id: 50,
      userId: 1,
      canvasData: { nodes: [{ data: { reference: "R1", value: "10k" } }], metadata: { mode: "schematic" } },
      componentCount: 1,
      connectionCount: 0,
    });
    pcb.createAIReview.mockResolvedValue({ id: 1 });
    const { caller, aiProvider } = mkCaller(makeUser("scrapper"));
    aiProvider.chat.mockResolvedValue("Looks good");

    const res = await caller.pcbEditor.reviewDesign({ designSaveId: 50, prompt: "Any issues?" });
    expect(res).toEqual({ response: "Looks good" });
    expect(aiProvider.chat).toHaveBeenCalledOnce();
    expect(aiProvider.chat.mock.calls[0]?.[0]).toMatchObject({ providerId: "openai", modelId: "gpt-4o" });
    expect(pcb.createAIReview).toHaveBeenCalledOnce();
  });
});

describe("pcbEditor.exportDesign", () => {
  it("forbids exporting another user's design", async () => {
    pcb.getDesignById.mockResolvedValue({ id: 50, userId: 2 });
    const { caller } = mkCaller(makeUser());
    await expect(
      caller.pcbEditor.exportDesign({ designSaveId: 50, format: "svg" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates an export record for the owner", async () => {
    pcb.getDesignById.mockResolvedValue({ id: 50, userId: 1 });
    pcb.createExport.mockResolvedValue({ fileUrl: "/exports/design-50.svg", format: "svg", createdAt: new Date() });
    const { caller } = mkCaller(makeUser());
    const res = await caller.pcbEditor.exportDesign({ designSaveId: 50, format: "svg" });
    expect(res.format).toBe("svg");
    expect(res.fileUrl).toContain("/exports/");
  });
});
