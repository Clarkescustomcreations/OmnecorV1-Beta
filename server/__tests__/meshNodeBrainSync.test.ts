/**
 * Brains-Upgrade Phase 7 — MeshNode Brain Pack sync (send + receive).
 *
 * The heavy construction-time deps (DiscoveryService, RoutingEngine, MeshServer,
 * HostTelemetry, SecurityManager) are mocked exactly as in
 * meshNodeModelCatalog.test.ts, plus the runtime deps `receivePeerBrain`
 * dynamic-imports: BrainPackService (the importer), the local-owner DB lookup,
 * and the WS broadcaster. This exercises the new Phase 7 logic in isolation:
 *   • receivePeerBrain: resolve local owner → import → relay embedder verdict,
 *     and fail-closed (no owner / empty pack / import error) without throwing.
 *   • sendBrainToPeer(ByName): base64 + HMAC-signed envelope, peer-not-found.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const discoveryInstance = vi.hoisted(() => ({
  startMdnsBeacon: vi.fn().mockResolvedValue(undefined),
  refreshAdvertisement: vi.fn(),
  getPeers: vi.fn(() => [] as unknown[]),
  broadcastFingerprintUpdate: vi.fn(),
}));
vi.mock("../ommesh/core/DiscoveryService.js", () => ({
  DiscoveryService: class {
    constructor() {
      return discoveryInstance;
    }
  },
}));
vi.mock("../ommesh/core/RoutingEngine.js", () => ({ RoutingEngine: class { decide = vi.fn(); } }));
vi.mock("../ommesh/core/MeshServer.js", () => ({
  MeshServer: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
  },
  MESH_PORT: 3001,
}));
vi.mock("../ommesh/core/HostTelemetry.js", () => ({
  collectHostTelemetry: vi.fn().mockResolvedValue({ gpu: { vram: 0, utilization: 0, temperature: 0 }, cpu: 0, ram: 0 }),
}));

const securityMock = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  on: vi.fn(),
  getClientTlsOptions: vi.fn(() => ({})),
}));
vi.mock("../ommesh/core/SecurityManager.js", () => ({ securityManager: securityMock, SecurityManager: class {} }));

// --- runtime deps of receivePeerBrain -------------------------------------
const brainSvcMock = vi.hoisted(() => ({ importFromBuffer: vi.fn() }));
vi.mock("../core_services/services/BrainPackService.js", () => ({
  BrainPackService: { getInstance: () => brainSvcMock },
}));

const wsMock = vi.hoisted(() => ({ broadcastAll: vi.fn() }));
vi.mock("../core_services/websocket/WebSocketServer.js", () => ({ getWsInstance: () => wsMock }));

// Configurable fake DB: `ownerRows` is what every terminal .limit() resolves to.
const dbState = vi.hoisted(() => ({ ownerRows: [] as Array<{ id: number }> }));
vi.mock("../db.factory.js", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => dbState.ownerRows,
  };
  return { getDb: vi.fn(async () => chain) };
});

const { MeshNode } = await import("../ommesh/core/MeshNode.js");

const TEST_SECRET = "phase7-node-secret";

function freshIdentity() {
  return {
    id: "self-node",
    fingerprint: "fp-self",
    capabilities: { models: [], gpu: { vram: 0, utilization: 0, temperature: 0 }, cpu: 0, ram: 0, roles: ["peer"] },
  };
}

describe("MeshNode — Brain Pack sync (Brains-Upgrade Phase 7)", () => {
  const prevSecret = process.env.OMMESH_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
    securityMock.getIdentity.mockReturnValue(freshIdentity());
    discoveryInstance.getPeers.mockReturnValue([]);
    dbState.ownerRows = [{ id: 42 }];
    process.env.OMMESH_SECRET = TEST_SECRET;
  });

  // ─── receive ──────────────────────────────────────────────────────────────

  it("receivePeerBrain imports under the resolved local owner and relays the verdict", async () => {
    brainSvcMock.importFromBuffer.mockResolvedValue({
      brain: { id: "coding", status: "ready" },
      embedderMatch: true,
      chunksStored: 50,
      vectorsLoaded: 50,
    });
    const node = new MeshNode();
    const b64 = Buffer.from("real-obp").toString("base64");

    const res = await node.receivePeerBrain("peer-1", b64);

    expect(brainSvcMock.importFromBuffer).toHaveBeenCalledTimes(1);
    const [ownerId, buf] = brainSvcMock.importFromBuffer.mock.calls[0];
    expect(ownerId).toBe(42);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect((buf as Buffer).toString()).toBe("real-obp");
    expect(res).toEqual({
      ok: true,
      brainId: "coding",
      embedderMatch: true,
      status: "ready",
      chunksStored: 50,
      vectorsLoaded: 50,
    });
    expect(wsMock.broadcastAll).toHaveBeenCalledWith("ommesh:brain_received", expect.objectContaining({ brainId: "coding" }));
  });

  it("receivePeerBrain surfaces an incompatible embedder (ok:true, corpus not indexed)", async () => {
    brainSvcMock.importFromBuffer.mockResolvedValue({
      brain: { id: "coding", status: "incompatible" },
      embedderMatch: false,
      chunksStored: 50,
      vectorsLoaded: 0,
    });
    const node = new MeshNode();
    const res = await node.receivePeerBrain("peer-1", Buffer.from("x").toString("base64"));
    expect(res).toMatchObject({ ok: true, embedderMatch: false, status: "incompatible", vectorsLoaded: 0 });
  });

  it("receivePeerBrain fails closed when no local owner account exists", async () => {
    dbState.ownerRows = [];
    const node = new MeshNode();
    const res = await node.receivePeerBrain("peer-1", Buffer.from("x").toString("base64"));
    expect(res).toEqual({ ok: false, error: "no_local_owner" });
    expect(brainSvcMock.importFromBuffer).not.toHaveBeenCalled();
  });

  it("receivePeerBrain rejects an empty pack", async () => {
    const node = new MeshNode();
    const res = await node.receivePeerBrain("peer-1", "");
    expect(res).toEqual({ ok: false, error: "empty_pack" });
    expect(brainSvcMock.importFromBuffer).not.toHaveBeenCalled();
  });

  it("receivePeerBrain returns ok:false (never throws) on an import error", async () => {
    brainSvcMock.importFromBuffer.mockRejectedValue(new Error("corrupt gzip"));
    const node = new MeshNode();
    const res = await node.receivePeerBrain("peer-1", Buffer.from("x").toString("base64"));
    expect(res).toMatchObject({ ok: false, error: "corrupt gzip" });
  });

  // ─── send ───────────────────────────────────────────────────────────────

  it("sendBrainToPeerByName throws when the peer is not in the discovery table", async () => {
    const node = new MeshNode();
    await expect(node.sendBrainToPeerByName("ghost-node", Buffer.from("x"))).rejects.toThrow(/not in the discovery table/);
  });

  it("sendBrainToPeer pushes a base64, HMAC-signed envelope and relays the peer's result", async () => {
    const node = new MeshNode();
    const captured: { path?: string; body?: string } = {};
    // Override the private mTLS transport so no real socket is opened.
    (node as any).postToPeer = vi.fn(async (_peer: unknown, path: string, body: string) => {
      captured.path = path;
      captured.body = body;
      return JSON.stringify({ ok: true, brainId: "coding", embedderMatch: true, status: "ready" });
    });

    const packBytes = Buffer.from("gzip-obp-bytes");
    const peer = { name: "peer-1", address: "10.0.0.5", port: 3001, fingerprint: "fp-1" };
    const res = await node.sendBrainToPeer(peer as any, packBytes);

    expect(captured.path).toBe("/brain");
    const sent = JSON.parse(captured.body!);
    expect(sent.nodeId).toBe("self-node");
    expect(sent.brain).toBe(packBytes.toString("base64"));
    expect(typeof sent.timestamp).toBe("number");
    // Signature is a real HMAC over the canonical (nodeId, brain, timestamp).
    const canonical = JSON.stringify({ nodeId: sent.nodeId, brain: sent.brain, timestamp: sent.timestamp });
    expect(sent.sig).toBe(createHmac("sha256", TEST_SECRET).update(canonical).digest("hex"));
    expect(res).toMatchObject({ ok: true, brainId: "coding", embedderMatch: true });
  });

  it("sendBrainToPeer routes through the named peer from discovery", async () => {
    discoveryInstance.getPeers.mockReturnValue([{ name: "peer-1", address: "10.0.0.5", port: 3001, fingerprint: "fp-1" }]);
    const node = new MeshNode();
    const spy = vi
      .spyOn(node as any, "postToPeer")
      .mockResolvedValue(JSON.stringify({ ok: true, brainId: "coding" }));
    await node.sendBrainToPeerByName("peer-1", Buffer.from("x"));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "peer-1" }),
      "/brain",
      expect.any(String),
      120_000,
    );
  });
});
