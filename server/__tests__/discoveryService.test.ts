import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";

// Mock the `bonjour` module so the DiscoveryService constructor does not touch
// real mDNS. The factory returns a fake instance whose `find()` yields an
// EventEmitter we can drive to simulate peer "up" events.
const browser = new EventEmitter();
const publish = vi.fn();
const unpublishAll = vi.fn((cb: () => void) => cb());
const find = vi.fn(() => browser);

vi.mock("bonjour", () => ({
  default: () => ({ publish, find, unpublishAll }),
}));

// Mock `https` so `fetchModelsFromPeer` (Model-Fabric Phase 4) never opens a
// real socket. `httpsRequest` is reconfigured per-test via mockImplementation.
const httpsRequest = vi.fn();
vi.mock("https", () => ({ request: httpsRequest }));

const { DiscoveryService } = await import("../ommesh/core/DiscoveryService.js");

const identity = {
  id: "node-self-id",
  fingerprint: "fp-self",
  capabilities: ["chat"],
} as unknown as import("../../shared/types/ommesh.types.js").NodeIdentity;

const security = {} as unknown as import("../ommesh/core/SecurityManager.js").SecurityManager;

/**
 * Build a fake `NodeIdentity` with real Model-Fabric-shaped capabilities
 * (unlike the `["chat"]` placeholder above, which predates Phase 4 and is
 * kept only for the two legacy tests that don't touch capabilities).
 */
function makeIdentity(models: Array<{ name: string; contextWindow: number; vramReq: number; provider?: string }> = []) {
  return {
    id: "node-self-id",
    fingerprint: "fp-self",
    capabilities: {
      models,
      gpu: { vram: 4096, utilization: 10, temperature: 40 },
      cpu: 8,
      ram: 16000,
      roles: ["peer"],
    },
  } as unknown as import("../../shared/types/ommesh.types.js").NodeIdentity;
}

/** A `SecurityManager`-shaped fake: real EventEmitter + stubbable trust/TLS. */
function makeSecurity(opts: { trusted?: boolean } = {}) {
  const sec = new EventEmitter() as unknown as import("../ommesh/core/SecurityManager.js").SecurityManager & EventEmitter;
  (sec as any).isTrusted = vi.fn(() => opts.trusted ?? true);
  (sec as any).getClientTlsOptions = vi.fn(() => ({}));
  return sec;
}

/** Queue one mocked `https.request` round trip: resolves on `req.end()`. */
function mockHttpsResponseOnce(status: number, body: string) {
  httpsRequest.mockImplementationOnce((_options: any, cb: any) => {
    const req: any = new EventEmitter();
    req.end = vi.fn(() => {
      const res: any = new EventEmitter();
      res.statusCode = status;
      cb(res);
      res.emit("data", Buffer.from(body));
      res.emit("end");
    });
    return req;
  });
}

/** Queue one mocked `https.request` that fails at the transport level. */
function mockHttpsErrorOnce(message: string) {
  httpsRequest.mockImplementationOnce(() => {
    const req: any = new EventEmitter();
    req.end = vi.fn(() => {
      req.emit("error", new Error(message));
    });
    return req;
  });
}

describe("DiscoveryService peer lookup", () => {
  beforeEach(() => {
    browser.removeAllListeners();
    vi.clearAllMocks();
  });

  // Note: legacy tests below use the `["chat"]` capabilities placeholder and
  // don't touch model-list handling; see `makeIdentity`/`makeSecurity` for the
  // Model-Fabric Phase 4 tests further down.

  // Regression guard: the mDNS beacon advertises `name: identity.id`, so a peer
  // is keyed and identified by its `name` — there is no `id` field on PeerInfo.
  // AiProviderService.selectPeerNode() must resolve a routing target via
  // `peers.find(p => p.name === targetNodeId)`. A lookup by `p.id` (the prior
  // bug) silently returns undefined and disables mesh offload.
  it("resolves a discovered peer by its advertised name (== node id)", async () => {
    const service = new DiscoveryService(identity, security);
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: "node-peer-id",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: JSON.stringify(["chat"]) },
    });

    const peers = service.getPeers();
    const targetNodeId = "node-peer-id";

    // The exact predicate AiProviderService uses to route to a remote node.
    const match = peers.find(p => p.name === targetNodeId);
    expect(match).toBeDefined();
    expect(match?.address).toBe("10.0.0.5");

    // PeerInfo has no `id` field — the old lookup would never match.
    expect((match as unknown as { id?: string }).id).toBeUndefined();
  });

  it("never discovers itself (ignores a service matching its own id)", async () => {
    const service = new DiscoveryService(identity, security);
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: identity.id,
      addresses: ["127.0.0.1"],
      port: 3001,
      txt: {},
    });

    expect(service.getPeers()).toHaveLength(0);
  });
});

// ── Model-Fabric Phase 4: beacon-minimal advertising + fetch-on-demand ──────

describe("DiscoveryService — beacon-minimal advertising (Model-Fabric Phase 4)", () => {
  beforeEach(() => {
    browser.removeAllListeners();
    vi.clearAllMocks();
  });

  it("publishes a TXT record without the full model list, plus a modelsHash", async () => {
    const selfIdentity = makeIdentity([
      { name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "llamacpp" },
    ]);
    const service = new DiscoveryService(selfIdentity, makeSecurity());
    await service.startMdnsBeacon();

    expect(publish).toHaveBeenCalledTimes(1);
    const txt = publish.mock.calls[0]![0].txt;
    expect(txt.modelsHash).toEqual(expect.any(String));
    expect(txt.modelsHash.length).toBeGreaterThan(0);

    const parsedCapabilities = JSON.parse(txt.capabilities);
    expect(parsedCapabilities.models).toBeUndefined();
    expect(parsedCapabilities.gpu).toEqual({ vram: 4096, utilization: 10, temperature: 40 });
  });

  // mDNS TXT records are a set of length-prefixed byte strings, each capped at
  // 255 bytes (RFC 6763 §6.1) — a single oversized entry breaks the whole
  // advertisement. Beacon-minimal (Decision 4) exists specifically so a large
  // model catalog can never blow this: prove it holds at a size no real
  // deployment would realistically exceed, not just for the 1-model happy path.
  it("keeps every TXT field under the 255-byte mDNS per-string limit even with 500 advertised models", async () => {
    const MDNS_TXT_ENTRY_LIMIT = 255;
    const manyModels = Array.from({ length: 500 }, (_, i) => ({
      name: `some-vendor/a-fairly-long-model-repo-name-${i}:latest-instruct-q4_k_m`,
      contextWindow: 131072,
      vramReq: 24576,
      provider: "ollama",
    }));
    const selfIdentity = makeIdentity(manyModels);
    const service = new DiscoveryService(selfIdentity, makeSecurity());
    await service.startMdnsBeacon();

    const txt = publish.mock.calls[0]![0].txt;
    expect(Buffer.byteLength(txt.fingerprint, "utf8")).toBeLessThan(MDNS_TXT_ENTRY_LIMIT);
    expect(Buffer.byteLength(txt.capabilities, "utf8")).toBeLessThan(MDNS_TXT_ENTRY_LIMIT);
    expect(Buffer.byteLength(txt.modelsHash, "utf8")).toBeLessThan(MDNS_TXT_ENTRY_LIMIT);

    // The whole point: capabilities size is flat regardless of catalog size
    // (it never contains `models`), not "still technically under the limit
    // but growing with the model count."
    const smallIdentity = makeIdentity([manyModels[0]!]);
    const smallService = new DiscoveryService(smallIdentity, makeSecurity());
    await smallService.startMdnsBeacon();
    const smallTxt = publish.mock.calls[1]![0].txt;
    expect(Buffer.byteLength(txt.capabilities, "utf8")).toBe(Buffer.byteLength(smallTxt.capabilities, "utf8"));
  });
});

describe("DiscoveryService — model list fetch-on-demand (Model-Fabric Phase 4)", () => {
  beforeEach(() => {
    browser.removeAllListeners();
    vi.clearAllMocks();
  });

  const peerModels = [{ name: "qwen2.5:7b", contextWindow: 32768, vramReq: 5000, provider: "ollama" }];

  it("fetches the full model list over mTLS when a trusted peer's modelsHash is new", async () => {
    mockHttpsResponseOnce(200, JSON.stringify({ models: peerModels }));

    const service = new DiscoveryService(makeIdentity(), makeSecurity({ trusted: true }));
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: JSON.stringify({ gpu: { vram: 1, utilization: 0, temperature: 0 } }), modelsHash: "hash-a" },
    });

    // The fetch is async (real https.request mock resolves on req.end()); wait a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const peer = service.getPeers().find((p) => p.name === "peer-1");
    expect(peer?.capabilities.models).toEqual(peerModels);
    expect(peer?.modelsHash).toBe("hash-a");
  });

  it("does not re-fetch when the same peer re-announces with an unchanged modelsHash", async () => {
    mockHttpsResponseOnce(200, JSON.stringify({ models: peerModels }));
    const service = new DiscoveryService(makeIdentity(), makeSecurity({ trusted: true }));
    await service.startMdnsBeacon();

    const announce = {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: JSON.stringify({ gpu: { vram: 1, utilization: 0, temperature: 0 } }), modelsHash: "hash-a" },
    };
    browser.emit("up", announce);
    await new Promise((r) => setTimeout(r, 0));
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    // Re-announce with the identical hash (e.g. a routine mDNS refresh) — no new fetch.
    browser.emit("up", announce);
    await new Promise((r) => setTimeout(r, 0));
    expect(httpsRequest).toHaveBeenCalledTimes(1);

    const peer = service.getPeers().find((p) => p.name === "peer-1");
    expect(peer?.capabilities.models).toEqual(peerModels);
  });

  it("re-fetches when a previously-seen peer's modelsHash changes", async () => {
    mockHttpsResponseOnce(200, JSON.stringify({ models: peerModels }));
    const service = new DiscoveryService(makeIdentity(), makeSecurity({ trusted: true }));
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: "{}", modelsHash: "hash-a" },
    });
    await new Promise((r) => setTimeout(r, 0));

    const newModels = [{ name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "llamacpp" }];
    mockHttpsResponseOnce(200, JSON.stringify({ models: newModels }));
    browser.emit("up", {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: "{}", modelsHash: "hash-b" },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(httpsRequest).toHaveBeenCalledTimes(2);
    const peer = service.getPeers().find((p) => p.name === "peer-1");
    expect(peer?.capabilities.models).toEqual(newModels);
    expect(peer?.modelsHash).toBe("hash-b");
  });

  it("skips the network fetch entirely for an untrusted peer (pinned-peer gate)", async () => {
    const service = new DiscoveryService(makeIdentity(), makeSecurity({ trusted: false }));
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: "{}", modelsHash: "hash-a" },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(httpsRequest).not.toHaveBeenCalled();
    const peer = service.getPeers().find((p) => p.name === "peer-1");
    expect(peer?.capabilities.models).toEqual([]);
  });

  it("retries the fetch once a not-yet-trusted peer becomes trusted (peer-trusted event)", async () => {
    const security = makeSecurity({ trusted: false });
    const service = new DiscoveryService(makeIdentity(), security);
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: "{}", modelsHash: "hash-a" },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(httpsRequest).not.toHaveBeenCalled();

    (security as any).isTrusted = vi.fn(() => true);
    mockHttpsResponseOnce(200, JSON.stringify({ models: peerModels }));
    security.emit("peer-trusted", "fp-peer");
    await new Promise((r) => setTimeout(r, 0));

    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const peer = service.getPeers().find((p) => p.name === "peer-1");
    expect(peer?.capabilities.models).toEqual(peerModels);
  });

  it("leaves the model list empty (not crashing) on a fetch error", async () => {
    mockHttpsErrorOnce("ECONNREFUSED");
    const service = new DiscoveryService(makeIdentity(), makeSecurity({ trusted: true }));
    await service.startMdnsBeacon();

    browser.emit("up", {
      name: "peer-1",
      addresses: ["10.0.0.5"],
      port: 3001,
      txt: { fingerprint: "fp-peer", capabilities: "{}", modelsHash: "hash-a" },
    });
    await new Promise((r) => setTimeout(r, 0));

    const peer = service.getPeers().find((p) => p.name === "peer-1");
    expect(peer?.capabilities.models).toEqual([]);
  });
});
