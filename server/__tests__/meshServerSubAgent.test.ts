/**
 * Mesh-Delegation.md — MeshServer `/subagent` routes.
 *
 * Exercises `MeshServer.handleRequest` (TypeScript-private, invoked directly
 * with req/res fakes — same technique as meshServerModels.test.ts) for the
 * delegation endpoints: the pinned-peer trust gate applies, control routes
 * reach `SubAgentHostService`, and host errors map to the right HTTP status.
 * `SubAgentHostService` is dynamic-imported by the handler, so it is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const securityManagerMock = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  getServerTlsOptions: vi.fn(() => ({})),
  isTrusted: vi.fn(() => true),
}));
vi.mock("../ommesh/core/SecurityManager.js", () => ({ securityManager: securityManagerMock }));

const hostMock = vi.hoisted(() => ({
  runTurn: vi.fn(),
  attach: vi.fn(),
  resolveApproval: vi.fn(),
  cancel: vi.fn(),
  detach: vi.fn(),
}));
class FakeHostError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
vi.mock("../core_services/services/SubAgentHostService.js", () => ({
  SubAgentHostService: { getInstance: () => hostMock },
  SubAgentHostError: FakeHostError,
}));

const { MeshServer } = await import("../ommesh/core/MeshServer.js");

function makeReq(method: string, url: string, body?: string) {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { getPeerCertificate: () => ({ fingerprint256: "AA:BB" }) };
  // Deliver the body asynchronously on the next tick (readBody attaches listeners).
  if (method === "POST") {
    process.nextTick(() => {
      if (body) req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  return req;
}

function makeRes() {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    writableEnded: false,
    destroyed: false,
  } as any;
}

const node = { getIdentity: () => ({ id: "self", capabilities: { models: [] } }) } as any;

describe("MeshServer — /subagent (Mesh-Delegation.md)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityManagerMock.isTrusted.mockReturnValue(true);
  });

  it("rejects an untrusted peer with 403 before any sub-agent handling", async () => {
    securityManagerMock.isTrusted.mockReturnValue(false);
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(makeReq("POST", "/subagent", "{}"), res);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
    expect(hostMock.runTurn).not.toHaveBeenCalled();
  });

  it("forwards an approval decision to the host and returns its result", async () => {
    hostMock.resolveApproval.mockReturnValue(true);
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(
      makeReq("POST", "/subagent/task-1/approval", JSON.stringify({ id: "blk", decision: "approve" })),
      res,
    );
    expect(hostMock.resolveApproval).toHaveBeenCalledWith("task-1", { id: "blk", decision: "approve", denyReason: undefined });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ resolved: true });
  });

  it("rejects a malformed approval body with 400", async () => {
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(
      makeReq("POST", "/subagent/task-1/approval", JSON.stringify({ decision: "approve" })),
      res,
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
    expect(hostMock.resolveApproval).not.toHaveBeenCalled();
  });

  it("cancels a run via the host and returns the run info", async () => {
    hostMock.cancel.mockReturnValue({ taskId: "task-1", status: "cancelled", turn: 1, lastSeq: 3 });
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(makeReq("POST", "/subagent/task-1/cancel", "{}"), res);
    expect(hostMock.cancel).toHaveBeenCalledWith("task-1", undefined);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ status: "cancelled" });
  });

  it("maps a host error code to the right HTTP status (concurrency_limit → 429)", async () => {
    hostMock.runTurn.mockRejectedValue(new FakeHostError("concurrency_limit", "too many"));
    const server = new MeshServer(node);
    const res = makeRes();
    await (server as any).handleRequest(
      makeReq("POST", "/subagent", JSON.stringify({ taskId: "t", label: "x", messages: [], originNodeId: "o" })),
      res,
    );
    expect(res.writeHead).toHaveBeenCalledWith(429, expect.anything());
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ error: "concurrency_limit" });
  });
});
