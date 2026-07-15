/**
 * Brains-Upgrade Phase 7 — MeshServer `POST /brain` endpoint.
 *
 * Exercises `MeshServer.handleRequest` (TypeScript-private, invoked directly
 * with req/res fakes — same technique as meshServerModels.test.ts) for Brain
 * Pack sync: the pinned-peer trust gate applies, and the same fail-closed HMAC
 * signature + replay-window contract as /sync and /discourse guards the route.
 * A well-signed, in-window request reaches `node.receivePeerBrain` and its
 * result (including the embedder-match verdict) is relayed to the sender.
 *
 * `verifyHmacSig` is the REAL crypto (not mocked), so a valid signature is
 * produced with the same HMAC the production sender uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { createHmac } from "crypto";

const securityManagerMock = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  getServerTlsOptions: vi.fn(() => ({})),
  isTrusted: vi.fn(() => true),
}));
vi.mock("../ommesh/core/SecurityManager.js", () => ({ securityManager: securityManagerMock }));

const { MeshServer } = await import("../ommesh/core/MeshServer.js");

const TEST_SECRET = "phase7-brain-sync-secret";

function makeReq(method: string, url: string, body?: string) {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { getPeerCertificate: () => ({ fingerprint256: "AA:BB:CC" }) };
  if (method === "POST") {
    process.nextTick(() => {
      if (body) req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  return req;
}

function makeRes() {
  return { writeHead: vi.fn(), end: vi.fn() } as any;
}

/** Build a correctly-signed /brain envelope, matching MeshNode.sendBrainToPeer. */
function signedBody(
  fields: { nodeId?: string; brain?: string; timestamp?: number },
  secret = TEST_SECRET,
) {
  const nodeId = fields.nodeId ?? "peer-node";
  const brain = fields.brain ?? Buffer.from("fake-obp-bytes").toString("base64");
  const timestamp = fields.timestamp ?? Date.now();
  const canonical = JSON.stringify({ nodeId, brain, timestamp });
  const sig = createHmac("sha256", secret).update(canonical).digest("hex");
  return JSON.stringify({ nodeId, brain, timestamp, sig });
}

function fakeNode(receive: (nodeId: string, b64: string) => Promise<any>) {
  return {
    getIdentity: () => ({ id: "self-node", capabilities: { models: [] } }),
    receivePeerBrain: vi.fn(receive),
  } as any;
}

describe("MeshServer — POST /brain (Brains-Upgrade Phase 7)", () => {
  const prevSecret = process.env.OMMESH_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
    securityManagerMock.isTrusted.mockReturnValue(true);
    process.env.OMMESH_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.OMMESH_SECRET;
    else process.env.OMMESH_SECRET = prevSecret;
  });

  it("imports a well-signed pack and relays the embedder-match verdict", async () => {
    const node = fakeNode(async () => ({
      ok: true,
      brainId: "coding",
      embedderMatch: true,
      status: "ready",
      chunksStored: 50,
      vectorsLoaded: 50,
    }));
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(makeReq("POST", "/brain", signedBody({})), res);

    expect(node.receivePeerBrain).toHaveBeenCalledTimes(1);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body).toMatchObject({ ok: true, brainId: "coding", embedderMatch: true, status: "ready" });
  });

  it("surfaces an incompatible embedder as a successful-but-flagged import (still 200)", async () => {
    const node = fakeNode(async () => ({
      ok: true,
      brainId: "coding",
      embedderMatch: false,
      status: "incompatible",
      chunksStored: 50,
      vectorsLoaded: 0,
    }));
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(makeReq("POST", "/brain", signedBody({})), res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body).toMatchObject({ ok: true, embedderMatch: false, status: "incompatible", vectorsLoaded: 0 });
  });

  it("returns 400 when the receiver fails to import (corrupt pack / no owner)", async () => {
    const node = fakeNode(async () => ({ ok: false, error: "no_local_owner" }));
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(makeReq("POST", "/brain", signedBody({})), res);

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ ok: false, error: "no_local_owner" });
  });

  it("rejects an untrusted peer with 403 before any brain handling", async () => {
    securityManagerMock.isTrusted.mockReturnValue(false);
    const node = fakeNode(async () => ({ ok: true }));
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(makeReq("POST", "/brain", signedBody({})), res);

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
    expect(node.receivePeerBrain).not.toHaveBeenCalled();
  });

  it("rejects a bad signature with 401 (fail-closed)", async () => {
    const node = fakeNode(async () => ({ ok: true }));
    const server = new MeshServer(node);
    const res = makeRes();
    const badSig = signedBody({}, "the-wrong-secret");
    await (server as any).handleRequest(makeReq("POST", "/brain", badSig), res);

    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
    expect(node.receivePeerBrain).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp (replay guard) with 401", async () => {
    const node = fakeNode(async () => ({ ok: true }));
    const server = new MeshServer(node);
    const res = makeRes();
    const stale = signedBody({ timestamp: Date.now() - 10 * 60_000 });
    await (server as any).handleRequest(makeReq("POST", "/brain", stale), res);

    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
    expect(node.receivePeerBrain).not.toHaveBeenCalled();
  });

  it("rejects a missing brain field with 400", async () => {
    const node = fakeNode(async () => ({ ok: true }));
    const server = new MeshServer(node);
    const res = makeRes();
    // Sign an envelope with no brain payload.
    const ts = Date.now();
    const canonical = JSON.stringify({ nodeId: "peer-node", timestamp: ts });
    const sig = createHmac("sha256", TEST_SECRET).update(canonical).digest("hex");
    const body = JSON.stringify({ nodeId: "peer-node", timestamp: ts, sig });
    await (server as any).handleRequest(makeReq("POST", "/brain", body), res);

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
    expect(node.receivePeerBrain).not.toHaveBeenCalled();
  });
});
