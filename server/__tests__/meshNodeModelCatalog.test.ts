/**
 * Model-Fabric Phase 4 — MeshNode's model-catalog advertising.
 *
 * Every heavy dependency MeshNode.ts touches at construction/start time
 * (SecurityManager singleton, DiscoveryService, RoutingEngine, MeshServer,
 * HostTelemetry, and the dynamically-imported ModelCatalogService) is
 * mocked, so this exercises only the new Phase 4 logic: mapping
 * ModelCatalogService.collectLocalOnly() entries into
 * NodeCapabilities.models, and gating discovery.refreshAdvertisement() on
 * an actual telemetry or model-list change (hashModelList itself is the
 * real implementation — not mocked — so the gating is genuinely exercised).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const discoveryInstance = vi.hoisted(() => ({
  startMdnsBeacon: vi.fn().mockResolvedValue(undefined),
  refreshAdvertisement: vi.fn(),
  getPeers: vi.fn(() => [] as unknown[]),
  broadcastFingerprintUpdate: vi.fn(),
}));
vi.mock("../ommesh/core/DiscoveryService.js", () => ({
  // A class whose constructor returns the shared mock instance — `vi.fn(() =>
  // ...)` can't be `new`ed (arrow functions have no [[Construct]]).
  DiscoveryService: class {
    constructor() {
      return discoveryInstance;
    }
  },
}));

vi.mock("../ommesh/core/RoutingEngine.js", () => ({
  RoutingEngine: class {
    decide = vi.fn();
  },
}));

vi.mock("../ommesh/core/MeshServer.js", () => ({
  MeshServer: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
  },
  MESH_PORT: 3001,
}));

const telemetryMock = vi.hoisted(() => ({
  collectHostTelemetry: vi.fn().mockResolvedValue({
    gpu: { vram: 4096, utilization: 10, temperature: 40 },
    cpu: 8,
    ram: 16000,
  }),
}));
vi.mock("../ommesh/core/HostTelemetry.js", () => telemetryMock);

const securityMock = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ommesh/core/SecurityManager.js", () => ({
  securityManager: securityMock,
  SecurityManager: class {},
}));

const catalogMock = vi.hoisted(() => ({
  collectLocalOnly: vi.fn().mockResolvedValue([] as unknown[]),
}));
vi.mock("../core_services/services/ModelCatalogService.js", () => ({
  ModelCatalogService: { getInstance: () => catalogMock },
}));

const { MeshNode } = await import("../ommesh/core/MeshNode.js");

function freshIdentity() {
  return {
    id: "self-node",
    fingerprint: "fp-self",
    capabilities: {
      models: [],
      gpu: { vram: 0, utilization: 0, temperature: 0 },
      cpu: 0,
      ram: 0,
      roles: ["peer"],
    },
  };
}

describe("MeshNode — model catalog advertising (Model-Fabric Phase 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    securityMock.getIdentity.mockReturnValue(freshIdentity());
    discoveryInstance.startMdnsBeacon.mockResolvedValue(undefined);
    discoveryInstance.getPeers.mockReturnValue([]);
    telemetryMock.collectHostTelemetry.mockResolvedValue({
      gpu: { vram: 4096, utilization: 10, temperature: 40 },
      cpu: 8,
      ram: 16000,
    });
    catalogMock.collectLocalOnly.mockResolvedValue([]);
  });

  it("populates identity.capabilities.models from collectLocalOnly() on start()", async () => {
    catalogMock.collectLocalOnly.mockResolvedValue([
      {
        modelId: "llama3.2:3b",
        providerId: "llamacpp",
        name: "llama3.2:3b",
        location: { type: "local", backend: "omnecor-runtime" },
        capabilities: { nativeTools: false, vision: false, contextWindow: 8192, sizeMb: 2048 },
      },
    ]);

    const node = new MeshNode();
    await node.start();

    expect(node.getIdentity().capabilities.models).toEqual([
      { name: "llama3.2:3b", contextWindow: 8192, vramReq: 2048, provider: "llamacpp" },
    ]);
  });

  it("defaults contextWindow/vramReq to 0 when the catalog entry doesn't report them", async () => {
    catalogMock.collectLocalOnly.mockResolvedValue([
      {
        modelId: "qwen2.5:7b",
        providerId: "ollama",
        name: "qwen2.5:7b",
        location: { type: "local", backend: "ollama" },
        capabilities: { nativeTools: false, vision: false },
      },
    ]);

    const node = new MeshNode();
    await node.start();

    expect(node.getIdentity().capabilities.models).toEqual([
      { name: "qwen2.5:7b", contextWindow: 0, vramReq: 0, provider: "ollama" },
    ]);
  });

  it("advertises no models (fails safe) when the catalog lookup throws", async () => {
    catalogMock.collectLocalOnly.mockRejectedValue(new Error("boom"));

    const node = new MeshNode();
    await node.start();

    expect(node.getIdentity().capabilities.models).toEqual([]);
  });

  it("does not re-advertise when neither telemetry nor the model list changed", async () => {
    const node = new MeshNode();
    await node.start();
    discoveryInstance.refreshAdvertisement.mockClear();

    await (node as any).refreshTelemetry();

    expect(discoveryInstance.refreshAdvertisement).not.toHaveBeenCalled();
  });

  it("re-advertises when the model list changes even though telemetry is unchanged", async () => {
    const node = new MeshNode();
    await node.start();
    discoveryInstance.refreshAdvertisement.mockClear();

    catalogMock.collectLocalOnly.mockResolvedValue([
      {
        modelId: "new-model",
        providerId: "ollama",
        name: "new-model",
        location: { type: "local", backend: "ollama" },
        capabilities: { nativeTools: false, vision: false },
      },
    ]);

    await (node as any).refreshTelemetry();

    expect(discoveryInstance.refreshAdvertisement).toHaveBeenCalledTimes(1);
    expect(node.getIdentity().capabilities.models).toEqual([
      { name: "new-model", contextWindow: 0, vramReq: 0, provider: "ollama" },
    ]);
  });

  it("re-advertises on a material GPU change even when the model list is unchanged", async () => {
    const node = new MeshNode();
    await node.start();
    discoveryInstance.refreshAdvertisement.mockClear();

    telemetryMock.collectHostTelemetry.mockResolvedValue({
      gpu: { vram: 1024, utilization: 90, temperature: 70 }, // > 512 MB delta from primed 4096
      cpu: 8,
      ram: 16000,
    });

    await (node as any).refreshTelemetry();

    expect(discoveryInstance.refreshAdvertisement).toHaveBeenCalledTimes(1);
  });
});
