/**
 * Batch G tail — route-level tests for `ommeshRouter` (LAN mesh control plane).
 *
 * The `meshNode` singleton is mocked (no real mDNS/mTLS), and `$HOME` is
 * redirected to a throwaway temp dir BEFORE any import so the router's
 * `~/.omnecor/settings.json` read/write round-trip runs against a real (but
 * isolated) file — never the developer's home. We assert: auth boundary, the
 * admin gate on rotateCert / approvePeer, argument forwarding to the mesh node,
 * and the crossNodeSync / agentDiscourse persist→read-back round-trip.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const H = vi.hoisted(() => {
  const prevHome = process.env.HOME;
  const home = `/tmp/omnecor-ommesh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.HOME = home; // os.homedir() honors $HOME on POSIX
  return { home, prevHome };
});

vi.mock("../phase2/services/AuditLogService.js", () => ({
  AuditLogService: {
    getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }),
  },
}));

const mesh = vi.hoisted(() => {
  const discovery = { getPeers: vi.fn(() => [] as unknown[]) };
  const security = { rotateCertificate: vi.fn(), approvePeer: vi.fn() };
  return {
    discovery,
    security,
    node: {
      getDiscovery: () => discovery,
      getSecurity: () => security,
      routeInference: vi.fn(),
      getIdentity: vi.fn(),
      setCrossNodeSync: vi.fn(),
      setAgentDiscourse: vi.fn(),
      sendPeerDiscourse: vi.fn(),
    },
  };
});
vi.mock("../ommesh/core/MeshNode.js", () => ({ meshNode: mesh.node }));

import path from "node:path";
import { rmSync } from "node:fs";
import { appRouter } from "../routers.js";
import { createTestDb, seedUser, makeContext, type TestDb } from "./_helpers/trpcHarness.js";
import type { Db } from "../db.js";
import type { User } from "../../drizzle/schema.js";

type Caller = ReturnType<typeof appRouter.createCaller>;
let store: TestDb;
let db: Db;
let user: User;
let admin: User;

afterAll(() => {
  if (H.prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = H.prevHome;
  rmSync(H.home, { recursive: true, force: true });
});

beforeEach(async () => {
  store = await createTestDb();
  db = store.db;
  user = await seedUser(db);
  admin = await seedUser(db, { openId: "admin", email: "admin@x.com", role: "admin" });
  mesh.discovery.getPeers.mockReset().mockReturnValue([]);
  mesh.security.rotateCertificate.mockReset();
  mesh.security.approvePeer.mockReset();
  mesh.node.routeInference.mockReset();
  mesh.node.getIdentity.mockReset();
  mesh.node.setCrossNodeSync.mockReset();
  mesh.node.setAgentDiscourse.mockReset();
  mesh.node.sendPeerDiscourse.mockReset();
  // Isolated, clean settings file per test.
  rmSync(path.join(H.home, ".omnecor"), { recursive: true, force: true });
});

describe("ommesh — auth boundary", () => {
  it("rejects an unauthenticated discover", async () => {
    const caller = appRouter.createCaller(makeContext(null, db));
    await expect(caller.ommesh.discover()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("ommesh.discover / getIdentity / routeInference", () => {
  it("returns the discovered peers", async () => {
    mesh.discovery.getPeers.mockReturnValue([{ id: "peer-1" }, { id: "peer-2" }]);
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.ommesh.discover()).toEqual([{ id: "peer-1" }, { id: "peer-2" }]);
  });

  it("returns the local node identity", async () => {
    mesh.node.getIdentity.mockReturnValue({ nodeId: "self", name: "laptop" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.ommesh.getIdentity()).toEqual({ nodeId: "self", name: "laptop" });
  });

  it("forwards prompt + options to routeInference (defaulting options to {})", async () => {
    mesh.node.routeInference.mockResolvedValue({ text: "hi", node: "peer-1" });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    const res = await caller.ommesh.routeInference({ prompt: "hello" });
    expect(res).toEqual({ text: "hi", node: "peer-1" });
    expect(mesh.node.routeInference).toHaveBeenCalledWith("hello", {});
  });
});

describe("ommesh.approvePeer / rotateCert — admin gate", () => {
  it("forbids a non-admin from approving a peer", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.ommesh.approvePeer({ fingerprint: "AA:BB" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mesh.security.approvePeer).not.toHaveBeenCalled();
  });

  it("lets an admin pin a peer fingerprint", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    expect(await caller.ommesh.approvePeer({ fingerprint: "AA:BB:CC" })).toEqual({ success: true });
    expect(mesh.security.approvePeer).toHaveBeenCalledWith("AA:BB:CC");
  });

  it("forbids a non-admin from rotating the cert", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(caller.ommesh.rotateCert({ force: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mesh.security.rotateCertificate).not.toHaveBeenCalled();
  });

  it("rotates the cert for an admin (force forwarded)", async () => {
    mesh.security.rotateCertificate.mockResolvedValue({ rotated: true });
    const caller: Caller = appRouter.createCaller(makeContext(admin, db));
    expect(await caller.ommesh.rotateCert({ force: true })).toEqual({ rotated: true });
    expect(mesh.security.rotateCertificate).toHaveBeenCalledWith(true);
  });
});

describe("ommesh.sendPeerDiscourse", () => {
  it("forwards the inter-agent message to the mesh node", async () => {
    mesh.node.sendPeerDiscourse.mockResolvedValue({ delivered: true });
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    const res = await caller.ommesh.sendPeerDiscourse({
      peerId: "peer-1",
      fromAgentId: "a1",
      toAgentId: "a2",
      content: "ping",
    });
    expect(res).toEqual({ delivered: true });
    expect(mesh.node.sendPeerDiscourse).toHaveBeenCalledWith("peer-1", "a1", "a2", "ping");
  });

  it("rejects over-long content (>8000 chars) before dispatch", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await expect(
      caller.ommesh.sendPeerDiscourse({
        peerId: "p",
        fromAgentId: "a1",
        toAgentId: "a2",
        content: "x".repeat(8001),
      }),
    ).rejects.toThrow();
    expect(mesh.node.sendPeerDiscourse).not.toHaveBeenCalled();
  });
});

describe("ommesh cross-node sync + agent discourse — persist/read-back", () => {
  it("defaults both flags to false with no settings file", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    expect(await caller.ommesh.getCrossNodeSyncStatus()).toEqual({
      crossNodeSync: false,
      agentDiscourse: false,
    });
  });

  it("persists setCrossNodeSync + setAgentDiscourse and reads them back", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));

    expect(await caller.ommesh.setCrossNodeSync({ enabled: true })).toEqual({
      ok: true,
      crossNodeSync: true,
    });
    expect(mesh.node.setCrossNodeSync).toHaveBeenCalledWith(true);

    expect(await caller.ommesh.setAgentDiscourse({ enabled: true })).toEqual({
      ok: true,
      agentDiscourse: true,
    });
    expect(mesh.node.setAgentDiscourse).toHaveBeenCalledWith(true);

    // The status reads the persisted settings file (real round-trip in temp HOME).
    expect(await caller.ommesh.getCrossNodeSyncStatus()).toEqual({
      crossNodeSync: true,
      agentDiscourse: true,
    });
  });

  it("toggling one flag off preserves the other in the settings file", async () => {
    const caller: Caller = appRouter.createCaller(makeContext(user, db));
    await caller.ommesh.setCrossNodeSync({ enabled: true });
    await caller.ommesh.setAgentDiscourse({ enabled: true });
    await caller.ommesh.setCrossNodeSync({ enabled: false });

    expect(await caller.ommesh.getCrossNodeSyncStatus()).toEqual({
      crossNodeSync: false,
      agentDiscourse: true,
    });
  });
});
