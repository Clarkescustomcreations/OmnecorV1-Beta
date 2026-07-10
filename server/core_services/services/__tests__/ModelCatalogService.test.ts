/**
 * ModelCatalogService aggregation tests (Model-Fabric Phase 3 + Phase 8).
 *
 * Every upstream source (LocalLlmRuntimeService, AiProviderService,
 * meshNode's DiscoveryService) is mocked so these tests exercise only the
 * aggregation/dedup/tagging logic, not real subprocess/network/mDNS state.
 *
 * Phase 8: the local runtime now surfaces *every* indexed GGUF it can host
 * (not just the loaded one), flags the warm one `loaded`, and its models
 * suppress the duplicate Ollama-branded entries.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IndexedModel } from "../ModelIndexService.js";

const localLlm = vi.hoisted(() => ({
  isAvailable: vi.fn().mockReturnValue(false),
  isReady: vi.fn().mockReturnValue(false),
  getLoadedModelId: vi.fn().mockReturnValue(null as string | null),
  listModels: vi.fn().mockReturnValue([] as IndexedModel[]),
}));
vi.mock("../LocalLlmRuntimeService.js", () => ({
  LocalLlmRuntimeService: { getInstance: () => localLlm },
}));

const ai = vi.hoisted(() => ({
  discoverOllamaModels: vi.fn().mockResolvedValue([] as unknown[]),
  discoverProviderModels: vi.fn().mockResolvedValue([] as Array<{ id: string; name: string }>),
  hasProviderKey: vi.fn().mockReturnValue(false),
}));
vi.mock("../AiProviderService.js", () => ({
  AiProviderService: { getInstance: () => ai },
}));

const mesh = vi.hoisted(() => {
  const discovery = { getPeers: vi.fn(() => [] as unknown[]) };
  return { discovery, node: { getDiscovery: () => discovery } };
});
vi.mock("../../../ommesh/core/MeshNode.js", () => ({ meshNode: mesh.node }));

import { ModelCatalogService } from "../ModelCatalogService.js";

/** Build an IndexedModel with sensible defaults. */
function model(over: Partial<IndexedModel> & { id: string }): IndexedModel {
  return {
    name: over.id,
    path: `/models/${over.id}`,
    sizeBytes: 0,
    source: "ollama",
    ...over,
  };
}

/** Point the mocked runtime at a set of hostable models + which is warm. */
function setRuntime(models: IndexedModel[], loadedId: string | null = null) {
  localLlm.isAvailable.mockReturnValue(true);
  localLlm.isReady.mockReturnValue(loadedId !== null);
  localLlm.listModels.mockReturnValue(models);
  localLlm.getLoadedModelId.mockReturnValue(loadedId);
}

function resetMocks() {
  vi.clearAllMocks();
  localLlm.isAvailable.mockReturnValue(false);
  localLlm.isReady.mockReturnValue(false);
  localLlm.getLoadedModelId.mockReturnValue(null);
  localLlm.listModels.mockReturnValue([]);
  ai.discoverOllamaModels.mockResolvedValue([]);
  ai.discoverProviderModels.mockResolvedValue([]);
  ai.hasProviderKey.mockReturnValue(false);
  mesh.discovery.getPeers.mockReturnValue([]);
}

describe("ModelCatalogService.getCatalog", () => {
  let service: ModelCatalogService;

  beforeEach(() => {
    resetMocks();
    service = ModelCatalogService.getInstance();
  });

  it("returns an empty catalog when every source is offline/unconfigured", async () => {
    expect(await service.getCatalog()).toEqual([]);
  });

  it("lists every indexed GGUF the runtime can host, not just the loaded one", async () => {
    setRuntime(
      [
        model({ id: "deepseek-r1:14b", name: "deepseek-r1:14b", sizeBytes: 8_000_000_000 }),
        model({ id: "qwen2.5:7b", name: "qwen2.5:7b" }),
      ],
      "deepseek-r1:14b",
    );

    const catalog = await service.getCatalog();
    const runtime = catalog.filter((e) => e.providerId === "llamacpp");
    expect(runtime).toHaveLength(2);
    expect(runtime.every((e) => e.location.type === "local" && (e.location as any).backend === "omnecor-runtime")).toBe(true);
  });

  it("flags only the currently-loaded model with `loaded`", async () => {
    setRuntime(
      [model({ id: "a", name: "a" }), model({ id: "b", name: "b" })],
      "b",
    );
    const catalog = await service.getCatalog();
    expect(catalog.find((e) => e.modelId === "a")!.loaded).toBeFalsy();
    expect(catalog.find((e) => e.modelId === "b")!.loaded).toBe(true);
  });

  it("omits all local runtime entries when no llama-server binary is available", async () => {
    localLlm.isAvailable.mockReturnValue(false);
    localLlm.listModels.mockReturnValue([model({ id: "x" })]); // present but unhostable
    expect((await service.getCatalog()).find((e) => e.providerId === "llamacpp")).toBeUndefined();
  });

  it("converts the indexed model's byte size to sizeMb (or omits it when 0)", async () => {
    setRuntime([
      model({ id: "big", name: "big", sizeBytes: 3_221_225_472 }), // 3072 MB
      model({ id: "sizeless", name: "sizeless", sizeBytes: 0 }),
    ]);
    const catalog = await service.getCatalog();
    expect(catalog.find((e) => e.modelId === "big")!.capabilities.sizeMb).toBeCloseTo(3072, 5);
    expect(catalog.find((e) => e.modelId === "sizeless")!.capabilities.sizeMb).toBeUndefined();
  });

  it("aggregates locally-installed Ollama models when the runtime is unavailable", async () => {
    ai.discoverOllamaModels.mockResolvedValue([
      { name: "qwen2.5:7b", digest: "sha256:aaa" },
      { name: "llama3.2:3b", digest: "sha256:bbb" },
    ]);
    const catalog = await service.getCatalog();
    expect(catalog).toHaveLength(2);
    expect(catalog.find((e) => e.modelId === "qwen2.5:7b")).toMatchObject({
      providerId: "ollama",
      location: { type: "local", backend: "ollama" },
    });
  });

  it("skips the Ollama API source entirely when the runtime is available (index already covers it)", async () => {
    setRuntime([model({ id: "deepseek-r1:14b", name: "deepseek-r1:14b" })], "deepseek-r1:14b");
    ai.discoverOllamaModels.mockResolvedValue([{ name: "deepseek-r1:14b", digest: "sha256:aaa" }]);
    const catalog = await service.getCatalog();
    // No Ollama-branded entries: the runtime hosts everything the store has,
    // read straight off disk, so the live Ollama API is never even queried.
    expect(catalog.some((e) => e.providerId === "ollama")).toBe(false);
    expect(ai.discoverOllamaModels).not.toHaveBeenCalled();
    // The model shows once, under the Omnecor runtime.
    expect(catalog.filter((e) => e.modelId === "deepseek-r1:14b")).toHaveLength(1);
    expect(catalog.find((e) => e.modelId === "deepseek-r1:14b")!.providerId).toBe("llamacpp");
  });

  it("includes the Ollama source only when the runtime is unavailable (Ollama is the only path)", async () => {
    localLlm.isAvailable.mockReturnValue(false);
    ai.discoverOllamaModels.mockResolvedValue([{ name: "deepseek-r1:14b", digest: "sha256:aaa" }]);
    const catalog = await service.getCatalog();
    expect(catalog.find((e) => e.providerId === "ollama" && e.modelId === "deepseek-r1:14b")).toBeDefined();
    expect(ai.discoverOllamaModels).toHaveBeenCalled();
  });

  it("does not flag any model `loaded` while the runtime isn't ready (mid-swap / failed load)", async () => {
    setRuntime([model({ id: "a" }), model({ id: "b" })], null); // isReady false
    const catalog = await service.getCatalog();
    expect(catalog.some((e) => e.loaded)).toBe(false);
  });

  it("Ollama-absent: a discovery failure yields zero Ollama entries without breaking the catalog", async () => {
    ai.discoverOllamaModels.mockRejectedValue(new Error("ECONNREFUSED"));
    setRuntime([model({ id: "local.gguf", name: "local" })]);
    const catalog = await service.getCatalog();
    expect(catalog.find((e) => e.providerId === "ollama")).toBeUndefined();
    expect(catalog.find((e) => e.providerId === "llamacpp")).toBeDefined();
  });

  it("dedups two Ollama tags that share the same content digest, keeping the first-seen name", async () => {
    ai.discoverOllamaModels.mockResolvedValue([
      { name: "qwen2.5:latest", digest: "sha256:same-weights" },
      { name: "qwen2.5:7b-instruct", digest: "sha256:same-weights" },
    ]);
    const ollama = (await service.getCatalog()).filter((e) => e.providerId === "ollama");
    expect(ollama).toHaveLength(1);
    expect(ollama[0]!.modelId).toBe("qwen2.5:latest");
  });

  it("merges mesh-peer advertised models, tagged with the peer's node id", async () => {
    mesh.discovery.getPeers.mockReturnValue([
      { name: "peer-1", capabilities: { models: [{ name: "qwen2.5:7b", contextWindow: 32768, vramReq: 8 }] } },
    ]);
    const catalog = await service.getCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      providerId: "ollama",
      modelId: "qwen2.5:7b",
      location: { type: "mesh-peer", nodeId: "peer-1", nodeName: "peer-1" },
      capabilities: { contextWindow: 32768 },
    });
  });

  it("always tags a mesh-peer entry nativeTools:false", async () => {
    mesh.discovery.getPeers.mockReturnValue([
      { name: "peer-1", capabilities: { models: [{ name: "qwen2.5:7b", contextWindow: 32768, vramReq: 8, nativeTools: true }] } },
    ]);
    expect((await service.getCatalog())[0]!.capabilities.nativeTools).toBe(false);
  });

  it("respects an explicit per-model provider on a mesh peer entry", async () => {
    mesh.discovery.getPeers.mockReturnValue([
      { name: "peer-2", capabilities: { models: [{ name: "local-llama.gguf", contextWindow: 8192, vramReq: 4, provider: "llamacpp" }] } },
    ]);
    expect((await service.getCatalog())[0]!.providerId).toBe("llamacpp");
  });

  it("ignores a peer with an empty/missing models list", async () => {
    mesh.discovery.getPeers.mockReturnValue([
      { name: "peer-empty", capabilities: { models: [] } },
      { name: "peer-no-caps", capabilities: undefined },
    ]);
    expect(await service.getCatalog()).toEqual([]);
  });

  it("queries only cloud providers with a configured API key, tagged nativeTools:true", async () => {
    ai.hasProviderKey.mockImplementation((p: string) => p === "openai");
    ai.discoverProviderModels.mockImplementation(async (p: string) =>
      p === "openai" ? [{ id: "gpt-4o", name: "GPT-4o" }] : []
    );
    const catalog = await service.getCatalog();
    expect(ai.discoverProviderModels).toHaveBeenCalledTimes(1);
    expect(ai.discoverProviderModels).toHaveBeenCalledWith("openai");
    expect(catalog).toEqual([
      {
        key: "cloud:openai::name:gpt-4o",
        providerId: "openai",
        modelId: "gpt-4o",
        name: "GPT-4o",
        location: { type: "cloud", provider: "openai" },
        capabilities: { nativeTools: true, vision: false, contextWindow: undefined },
      },
    ]);
  });

  it("getCatalog({isSovereign:true}) never calls the cloud source, even with a configured key", async () => {
    ai.hasProviderKey.mockImplementation((p: string) => p === "openai");
    ai.discoverProviderModels.mockResolvedValue([{ id: "gpt-4o", name: "GPT-4o" }]);
    const catalog = await service.getCatalog({ isSovereign: true });
    expect(catalog).toEqual([]);
    expect(ai.discoverProviderModels).not.toHaveBeenCalled();
  });

  it("a sovereign catalog still surfaces local + mesh sources, only cloud is skipped", async () => {
    setRuntime([model({ id: "local.gguf", name: "local" })]);
    ai.hasProviderKey.mockImplementation((p: string) => p === "openai");
    ai.discoverProviderModels.mockResolvedValue([{ id: "gpt-4o", name: "GPT-4o" }]);
    const catalog = await service.getCatalog({ isSovereign: true });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.providerId).toBe("llamacpp");
    expect(ai.discoverProviderModels).not.toHaveBeenCalled();
  });

  it("a failing cloud provider is dropped, not fatal to the whole catalog", async () => {
    ai.hasProviderKey.mockImplementation((p: string) => p === "openai" || p === "anthropic");
    ai.discoverProviderModels.mockImplementation(async (p: string) => {
      if (p === "openai") throw new Error("401 unauthorized");
      if (p === "anthropic") return [{ id: "claude-opus-4-8", name: "Claude Opus 4.8" }];
      return [];
    });
    const catalog = await service.getCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.providerId).toBe("anthropic");
  });

  it("aggregates runtime + mesh + cloud in one call (Ollama folds into the runtime when available)", async () => {
    setRuntime([model({ id: "local.gguf", name: "local" })]);
    ai.discoverOllamaModels.mockResolvedValue([{ name: "llama3.2:3b", digest: "sha256:x" }]);
    mesh.discovery.getPeers.mockReturnValue([
      { name: "peer-1", capabilities: { models: [{ name: "mesh-model", contextWindow: 4096, vramReq: 2 }] } },
    ]);
    ai.hasProviderKey.mockImplementation((p: string) => p === "gemini");
    ai.discoverProviderModels.mockResolvedValue([{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }]);

    const catalog = await service.getCatalog();
    const byLocation = catalog.map((e) => e.location.type).sort();
    // One local (the Omnecor runtime) + mesh + cloud — the Ollama API source is
    // skipped since the runtime already hosts the store's models.
    expect(byLocation).toEqual(["cloud", "local", "mesh-peer"]);
    expect(ai.discoverOllamaModels).not.toHaveBeenCalled();
  });
});

describe("ModelCatalogService.collectLocalOnly", () => {
  let service: ModelCatalogService;

  beforeEach(() => {
    resetMocks();
    service = ModelCatalogService.getInstance();
  });

  it("excludes mesh-peer and cloud entries even when both sources have data", async () => {
    ai.hasProviderKey.mockImplementation((p: string) => p === "openai");
    ai.discoverProviderModels.mockResolvedValue([{ id: "gpt-4o", name: "GPT-4o" }]);
    mesh.discovery.getPeers.mockReturnValue([
      { name: "peer-1", capabilities: { models: [{ name: "mesh-model", contextWindow: 4096, vramReq: 2 }] } },
    ]);
    setRuntime([model({ id: "local.gguf", name: "local" })]);

    const catalog = await service.collectLocalOnly();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.location.type).toBe("local");
    expect(ai.discoverProviderModels).not.toHaveBeenCalled();
  });

  it("uses the runtime as the sole local source when it's available (Ollama API skipped)", async () => {
    setRuntime([model({ id: "local.gguf", name: "local" })]);
    ai.discoverOllamaModels.mockResolvedValue([{ name: "qwen2.5:7b", digest: "sha256:aaa" }]);
    const catalog = await service.collectLocalOnly();
    expect(catalog.map((e) => e.providerId)).toEqual(["llamacpp"]);
    expect(ai.discoverOllamaModels).not.toHaveBeenCalled();
  });

  it("falls back to the Ollama source for advertising when the runtime is unavailable", async () => {
    localLlm.isAvailable.mockReturnValue(false);
    ai.discoverOllamaModels.mockResolvedValue([{ name: "qwen2.5:7b", digest: "sha256:aaa" }]);
    const catalog = await service.collectLocalOnly();
    expect(catalog.map((e) => e.providerId)).toEqual(["ollama"]);
  });

  it("returns an empty array when no local source is available", async () => {
    expect(await service.collectLocalOnly()).toEqual([]);
  });
});
