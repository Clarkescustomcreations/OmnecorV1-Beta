/**
 * Model-Fabric Phase 5 — `AiProviderService.selectPeerNode`'s `targetNodeId`
 * pin. `AiProviderService.streamChat.test.ts` always mocks `selectPeerNode`
 * away at the method level (mesh offload is out of scope there), so the real
 * pinning logic added in Phase 5 has no coverage in that file — this is a
 * dedicated, focused suite for it. `meshNode` is mocked so no real mDNS/mTLS
 * state is touched; `selectPeerNode` is invoked directly (it's TypeScript-
 * private, not runtime-private — the same technique used elsewhere in this
 * suite for private-method coverage).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const meshNodeMock = vi.hoisted(() => ({
  getIdentity: vi.fn(() => ({ id: "self-node" })),
  getDiscovery: vi.fn(() => ({ getPeers: vi.fn(() => [] as unknown[]) })),
  getRouting: vi.fn(() => ({ decide: vi.fn() })),
}));
vi.mock("../../../ommesh/core/MeshNode.js", () => ({ meshNode: meshNodeMock }));

import { AiProviderService, type ChatInput } from "../AiProviderService.js";

function baseInput(overrides: Partial<ChatInput> = {}): ChatInput {
  return {
    providerId: "ollama",
    modelId: "qwen2.5:7b",
    messages: [{ role: "user", content: "hi" }],
    ...overrides,
  };
}

describe("AiProviderService.selectPeerNode — targetNodeId pin (Model-Fabric Phase 5)", () => {
  let service: AiProviderService;
  let getPeers: ReturnType<typeof vi.fn>;
  let decide: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    meshNodeMock.getIdentity.mockReturnValue({ id: "self-node" });
    getPeers = vi.fn(() => [] as unknown[]);
    meshNodeMock.getDiscovery.mockReturnValue({ getPeers });
    decide = vi.fn();
    meshNodeMock.getRouting.mockReturnValue({ decide });
    service = AiProviderService.getInstance();
  });

  function selectPeerNode(input: ChatInput) {
    return (service as any).selectPeerNode(input);
  }

  it("pins to the exact peer named by targetNodeId, bypassing the auto-scorer entirely", async () => {
    const dadsPc = { name: "dads-pc", address: "10.0.0.5", port: 3001, fingerprint: "fp-dads" };
    const studioPc = { name: "studio-pc", address: "10.0.0.6", port: 3001, fingerprint: "fp-studio" };
    getPeers.mockReturnValue([dadsPc, studioPc]);

    const peer = await selectPeerNode(baseInput({ targetNodeId: "dads-pc" }));

    expect(peer).toBe(dadsPc);
    // The whole point: the VRAM-weighted scorer is never even consulted.
    expect(decide).not.toHaveBeenCalled();
  });

  it("returns null (run locally) when targetNodeId equals the local node's own id", async () => {
    getPeers.mockReturnValue([{ name: "dads-pc" }]);

    const peer = await selectPeerNode(baseInput({ targetNodeId: "self-node" }));

    expect(peer).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it("throws when the pinned peer is not currently discoverable", async () => {
    getPeers.mockReturnValue([{ name: "studio-pc" }]);

    await expect(selectPeerNode(baseInput({ targetNodeId: "dads-pc" })))
      .rejects.toThrow(/dads-pc.*not currently discoverable/i);
  });

  it("falls back to the auto-scorer when targetNodeId is unset (unchanged pre-Phase-5 behavior)", async () => {
    const dadsPc = { name: "dads-pc" };
    getPeers.mockReturnValue([dadsPc]);
    decide.mockResolvedValue({ targetNodeId: "dads-pc", model: "qwen2.5:7b", estimatedLatency: 0, score: 1, fallbackChain: [] });

    const peer = await selectPeerNode(baseInput());

    expect(decide).toHaveBeenCalledOnce();
    expect(peer).toBe(dadsPc);
  });

  it("auto-scorer still returns null for local when it wins and no pin is set", async () => {
    decide.mockResolvedValue({ targetNodeId: "self-node", model: "qwen2.5:7b", estimatedLatency: 0, score: 1, fallbackChain: [] });

    const peer = await selectPeerNode(baseInput());

    expect(peer).toBeNull();
  });
});
