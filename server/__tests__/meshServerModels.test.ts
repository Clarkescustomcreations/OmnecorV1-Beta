/**
 * Model-Fabric Phase 4 — MeshServer `GET /models` endpoint.
 *
 * No test previously exercised `MeshServer.handleRequest` at all (only the
 * standalone `canonicalPeerFingerprint` helper, in meshFingerprint.test.ts).
 * `handleRequest` is invoked directly (it's TypeScript-private, not
 * runtime-private) with hand-built req/res fakes — the same technique used
 * elsewhere in this suite for private-method coverage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const securityManagerMock = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  getServerTlsOptions: vi.fn(() => ({})),
  isTrusted: vi.fn(() => false),
}));
vi.mock("../ommesh/core/SecurityManager.js", () => ({ securityManager: securityManagerMock }));

const { MeshServer } = await import("../ommesh/core/MeshServer.js");

function makeReq(method: string, url: string, fingerprintHex: string) {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = {
    getPeerCertificate: () => ({ fingerprint256: fingerprintHex }),
  };
  return req;
}

function makeRes() {
  const res: any = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
  return res;
}

function fakeNode(models: unknown[]) {
  return {
    getIdentity: () => ({ id: "self-node", capabilities: { models } }),
  } as any;
}

describe("MeshServer — GET /models (Model-Fabric Phase 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityManagerMock.isReady.mockReturnValue(true);
    securityManagerMock.getServerTlsOptions.mockReturnValue({});
  });

  it("returns the node's advertised models for a trusted peer", async () => {
    securityManagerMock.isTrusted.mockReturnValue(true);
    const models = [{ name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "llamacpp" }];
    const server = new MeshServer(fakeNode(models));

    const req = makeReq("GET", "/models", "AA:BB:CC");
    const res = makeRes();
    await (server as any).handleRequest(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body).toEqual({ models });
  });

  it("rejects an untrusted peer with 403 before reaching /models (pinned-peer gate)", async () => {
    securityManagerMock.isTrusted.mockReturnValue(false);
    const server = new MeshServer(fakeNode([{ name: "should-not-be-returned", contextWindow: 0, vramReq: 0 }]));

    const req = makeReq("GET", "/models", "AA:BB:CC");
    const res = makeRes();
    await (server as any).handleRequest(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ error: "untrusted_peer" });
  });

  it("still answers GET /health for an untrusted peer (reachability probe, no model data)", async () => {
    securityManagerMock.isTrusted.mockReturnValue(false);
    const server = new MeshServer(fakeNode([{ name: "secret-model", contextWindow: 0, vramReq: 0 }]));

    const req = makeReq("GET", "/health", "AA:BB:CC");
    const res = makeRes();
    await (server as any).handleRequest(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    const body = JSON.parse(res.end.mock.calls[0][0]);
    expect(body).toEqual({ ok: true, nodeId: "self-node" });
    expect(body.models).toBeUndefined();
  });

  it("returns an empty models array when the node has none advertised", async () => {
    securityManagerMock.isTrusted.mockReturnValue(true);
    const server = new MeshServer(fakeNode([]));

    const req = makeReq("GET", "/models", "AA:BB:CC");
    const res = makeRes();
    await (server as any).handleRequest(req, res);

    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ models: [] });
  });
});
