/**
 * Route-level integration tests for `mcpRouter`.
 *
 * Covers: listConnectedServers / listTools / agenticOsStatus delegation;
 * connectServer admin gate (user → FORBIDDEN) + sovereign remote-websocket
 * block; disconnectServer; and callTool — sovereign remote block, HITL gate on
 * a `dangerous` tool (denied → FORBIDDEN, approved → proceeds), prompt
 * sanitization, and delegation to ctx.services.agent.callMCPTool.
 * MCPClientService is mocked; ctx.services (hitl / promptSanitizer / agent) are
 * stubbed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown }));
const mcp = vi.hoisted(() => ({
  listConnectedServers: vi.fn().mockReturnValue([]),
  connectServer: vi.fn().mockResolvedValue(undefined),
  disconnectServer: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockReturnValue([]),
  isAgenticOsConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../db.factory.js", async importActual => {
  const actual = await importActual<typeof import("../db.factory.js")>();
  return { ...actual, getDb: async () => h.db };
});

vi.mock("../phase2/services/MCPClientService.js", () => ({
  MCPClientService: { getInstance: () => mcp },
}));

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;

function services(overrides: Record<string, unknown> = {}) {
  return {
    hitl: { requestApproval: vi.fn().mockResolvedValue(true) },
    promptSanitizer: { sanitize: (s: string) => ({ clean: s }) },
    agent: { callMCPTool: vi.fn().mockResolvedValue({ ok: true }) },
    ...overrides,
  };
}

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  h.db = db;
  vi.clearAllMocks();
  mcp.listConnectedServers.mockReturnValue([]);
  mcp.listTools.mockReturnValue([]);
  mcp.isAgenticOsConfigured.mockReturnValue(false);
});

describe("mcp read procedures", () => {
  it("listConnectedServers / listTools / agenticOsStatus delegate to the service", async () => {
    mcp.listConnectedServers.mockReturnValue([{ id: "s1", name: "S1", transport: "stdio" }]);
    mcp.listTools.mockReturnValue([{ name: "echo" }]);
    mcp.isAgenticOsConfigured.mockReturnValue(true);
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));

    expect(await caller.mcp.listConnectedServers()).toHaveLength(1);
    expect(await caller.mcp.listTools({})).toEqual([{ name: "echo" }]);
    expect(await caller.mcp.agenticOsStatus()).toEqual({ configured: true });
  });
});

describe("mcp.connectServer — admin gate + sovereign block", () => {
  it("forbids a non-admin user", async () => {
    const user = await seedUser(db, { role: "user" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(
      caller.mcp.connectServer({ id: "x", name: "X", transport: "stdio", command: "echo" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mcp.connectServer).not.toHaveBeenCalled();
  });

  it("lets an admin connect an stdio server", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db, services()));
    const res = await caller.mcp.connectServer({ id: "x", name: "X", transport: "stdio", command: "echo" });
    expect(res).toEqual({ connected: true });
    expect(mcp.connectServer).toHaveBeenCalledOnce();
  });

  it("blocks a sovereign admin from connecting a REMOTE websocket MCP server", async () => {
    const admin = await seedUser(db, { role: "admin", executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db, services()));
    await expect(
      caller.mcp.connectServer({ id: "x", name: "X", transport: "websocket", url: "wss://evil.example.com" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a sovereign admin to connect a LOCAL websocket MCP server", async () => {
    const admin = await seedUser(db, { role: "admin", executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db, services()));
    const res = await caller.mcp.connectServer({ id: "x", name: "X", transport: "websocket", url: "ws://localhost:9000" });
    expect(res).toEqual({ connected: true });
  });
});

describe("mcp.disconnectServer", () => {
  it("delegates to the service", async () => {
    const user = await seedUser(db);
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    const res = await caller.mcp.disconnectServer({ serverId: "s1" });
    expect(res).toEqual({ disconnected: true });
    expect(mcp.disconnectServer).toHaveBeenCalledWith("s1");
  });
});

describe("mcp.callTool", () => {
  it("calls a safe tool through sanitizer + agent", async () => {
    mcp.listConnectedServers.mockReturnValue([{ id: "s1", transport: "stdio" }]);
    mcp.listTools.mockReturnValue([{ name: "echo", dangerous: false }]);
    const user = await seedUser(db);
    const svc = services();
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));

    const res = await caller.mcp.callTool({ serverId: "s1", toolName: "echo", args: { msg: "hi" } });
    expect(res).toEqual({ ok: true });
    expect(svc.agent.callMCPTool).toHaveBeenCalledWith("s1", "echo", { msg: "hi" });
    expect(svc.hitl.requestApproval).not.toHaveBeenCalled(); // not dangerous
  });

  it("requires HITL approval for a dangerous tool and FORBIDs when denied", async () => {
    mcp.listConnectedServers.mockReturnValue([{ id: "s1", transport: "stdio" }]);
    mcp.listTools.mockReturnValue([{ name: "rm", dangerous: true }]);
    const user = await seedUser(db);
    const svc = services({ hitl: { requestApproval: vi.fn().mockResolvedValue(false) } });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));

    await expect(
      caller.mcp.callTool({ serverId: "s1", toolName: "rm", args: { path: "/" } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(svc.agent.callMCPTool).not.toHaveBeenCalled();
  });

  it("proceeds with a dangerous tool once HITL approves", async () => {
    mcp.listConnectedServers.mockReturnValue([{ id: "s1", transport: "stdio" }]);
    mcp.listTools.mockReturnValue([{ name: "rm", dangerous: true }]);
    const user = await seedUser(db);
    const svc = services({ hitl: { requestApproval: vi.fn().mockResolvedValue(true) } });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, svc));

    const res = await caller.mcp.callTool({ serverId: "s1", toolName: "rm", args: { path: "/tmp/x" } });
    expect(res).toEqual({ ok: true });
    expect(svc.agent.callMCPTool).toHaveBeenCalledOnce();
  });

  it("blocks a sovereign user from calling a tool on a REMOTE websocket server", async () => {
    mcp.listConnectedServers.mockReturnValue([{ id: "s1", transport: "websocket", url: "wss://evil.example.com" }]);
    mcp.listTools.mockReturnValue([{ name: "echo", dangerous: false }]);
    const user = await seedUser(db, { executionMode: "sovereign" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db, services()));
    await expect(
      caller.mcp.callTool({ serverId: "s1", toolName: "echo", args: {} })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
