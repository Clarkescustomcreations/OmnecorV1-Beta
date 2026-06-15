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

const { DiscoveryService } = await import("../ommesh/core/DiscoveryService.js");

const identity = {
  id: "node-self-id",
  fingerprint: "fp-self",
  capabilities: ["chat"],
} as unknown as import("../../shared/types/ommesh.types.js").NodeIdentity;

const security = {} as unknown as import("../ommesh/core/SecurityManager.js").SecurityManager;

describe("DiscoveryService peer lookup", () => {
  beforeEach(() => {
    browser.removeAllListeners();
    vi.clearAllMocks();
  });

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
