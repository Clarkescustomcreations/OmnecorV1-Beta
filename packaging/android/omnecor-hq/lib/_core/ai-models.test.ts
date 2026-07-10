/**
 * Model-Fabric Phase 5 — the APK chat picker's unified catalog data source.
 *
 * `trpc-fetch` and `model-download` are mocked (both touch the network /
 * native filesystem respectively); `model-catalog`'s `capabilitiesForFile`/
 * `isNpuCapableFile` are real pure functions and run unmocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const trpcQueryMock = vi.hoisted(() => vi.fn());
vi.mock("./trpc-fetch", () => ({ trpcQuery: trpcQueryMock, trpcMutate: vi.fn() }));

const modelDownloadMock = vi.hoisted(() => ({
  listLocalGguf: vi.fn().mockResolvedValue([] as Array<{ filename: string; path: string; sizeBytes: number }>),
  listLocalTask: vi.fn().mockResolvedValue([] as Array<{ filename: string; path: string; sizeBytes: number }>),
}));
vi.mock("./model-download", () => modelDownloadMock);

import {
  fetchCatalog, listCatalogGroups, CLOUD_GROUP_ID,
  OMNECOR_LOCAL_GROUP_ID, OLLAMA_LOCAL_GROUP_ID, omnecorMeshGroupId, ollamaMeshGroupId,
  PHONE_PROVIDER_ID, type CatalogEntry,
} from "./ai-models";

function entry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, "modelId" | "providerId" | "location">): CatalogEntry {
  return {
    key: `${overrides.providerId}:${overrides.modelId}`,
    name: overrides.modelId,
    capabilities: { nativeTools: false, vision: false },
    ...overrides,
  };
}

describe("fetchCatalog", () => {
  beforeEach(() => {
    trpcQueryMock.mockReset();
  });

  it("returns the server catalog on success", async () => {
    const catalog = [entry({ providerId: "ollama", modelId: "llama3.2:3b", location: { type: "local", backend: "ollama" } })];
    trpcQueryMock.mockResolvedValue(catalog);
    expect(await fetchCatalog()).toEqual(catalog);
    expect(trpcQueryMock).toHaveBeenCalledWith("aiProvider.catalog");
  });

  it("degrades to an empty array when the request fails (server offline)", async () => {
    trpcQueryMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await fetchCatalog()).toEqual([]);
  });
});

describe("listCatalogGroups", () => {
  beforeEach(() => {
    trpcQueryMock.mockReset();
    modelDownloadMock.listLocalGguf.mockResolvedValue([]);
    modelDownloadMock.listLocalTask.mockResolvedValue([]);
  });

  it("always includes the Phone group, even with an empty catalog and no on-device models", async () => {
    trpcQueryMock.mockResolvedValue([]);
    const { groups, modelsByGroup } = await listCatalogGroups();
    expect(groups).toEqual([{ id: PHONE_PROVIDER_ID, name: expect.stringContaining("Phone") }]);
    expect(modelsByGroup[PHONE_PROVIDER_ID]).toEqual([]);
  });

  it("splits local entries into a self-hosted 'Omnecor · This PC' group and a de-emphasized 'Ollama · This PC' group", async () => {
    trpcQueryMock.mockResolvedValue([
      entry({ providerId: "llamacpp", modelId: "Llama-3.2-3B.gguf", location: { type: "local", backend: "omnecor-runtime" } }),
      entry({ providerId: "ollama", modelId: "qwen2.5:7b", location: { type: "local", backend: "ollama" } }),
    ]);
    const { groups, modelsByGroup } = await listCatalogGroups();

    expect(groups).toContainEqual({ id: OMNECOR_LOCAL_GROUP_ID, name: "Omnecor · This PC" });
    expect(groups).toContainEqual({ id: OLLAMA_LOCAL_GROUP_ID, name: "Ollama · This PC" });
    expect(modelsByGroup[OMNECOR_LOCAL_GROUP_ID]).toEqual([
      { id: "Llama-3.2-3B.gguf", name: "Llama-3.2-3B.gguf", providerId: "llamacpp" },
    ]);
    expect(modelsByGroup[OLLAMA_LOCAL_GROUP_ID]).toEqual([
      { id: "qwen2.5:7b", name: "qwen2.5:7b", providerId: "ollama" },
    ]);
    // Omnecor's own runtime is the primary host — it must sort ahead of Ollama.
    const omnecorIdx = groups.findIndex((g) => g.id === OMNECOR_LOCAL_GROUP_ID);
    const ollamaIdx = groups.findIndex((g) => g.id === OLLAMA_LOCAL_GROUP_ID);
    expect(omnecorIdx).toBeLessThan(ollamaIdx);
  });

  it("groups mesh-peer entries per node and brands each by its real host (Omnecor runtime vs Ollama)", async () => {
    trpcQueryMock.mockResolvedValue([
      entry({ providerId: "ollama", modelId: "qwen2.5:7b", location: { type: "mesh-peer", nodeId: "dads-pc", nodeName: "DadsPC" } }),
      entry({ providerId: "llamacpp", modelId: "phi-4.gguf", location: { type: "mesh-peer", nodeId: "studio-pc", nodeName: "StudioOnePC" } }),
    ]);
    const { groups, modelsByGroup } = await listCatalogGroups();

    // The peer serving via Ollama reads as "Ollama · DadsPC"; the peer running
    // Omnecor's own runtime reads as "Omnecor · StudioOnePC".
    expect(groups).toContainEqual({ id: ollamaMeshGroupId("dads-pc"), name: "Ollama · DadsPC" });
    expect(groups).toContainEqual({ id: omnecorMeshGroupId("studio-pc"), name: "Omnecor · StudioOnePC" });
    expect(modelsByGroup[ollamaMeshGroupId("dads-pc")]).toEqual([
      { id: "qwen2.5:7b", name: "qwen2.5:7b", providerId: "ollama", targetNodeId: "dads-pc" },
    ]);
    expect(modelsByGroup[omnecorMeshGroupId("studio-pc")]).toEqual([
      { id: "phi-4.gguf", name: "phi-4.gguf", providerId: "llamacpp", targetNodeId: "studio-pc" },
    ]);
  });

  it("collapses every cloud provider into a single 'Cloud' group", async () => {
    trpcQueryMock.mockResolvedValue([
      entry({ providerId: "openai", modelId: "gpt-4o", location: { type: "cloud", provider: "openai" } }),
      entry({ providerId: "anthropic", modelId: "claude-opus-4-8", location: { type: "cloud", provider: "anthropic" } }),
    ]);
    const { groups, modelsByGroup } = await listCatalogGroups();

    expect(groups).toContainEqual({ id: CLOUD_GROUP_ID, name: "Cloud" });
    expect(modelsByGroup[CLOUD_GROUP_ID]).toHaveLength(2);
    expect(modelsByGroup[CLOUD_GROUP_ID]!.map((m) => m.providerId).sort()).toEqual(["anthropic", "openai"]);
  });

  it("merges the phone's on-device models into the Phone group", async () => {
    modelDownloadMock.listLocalGguf.mockResolvedValue([
      { filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf", path: "/data/models/llama.gguf", sizeBytes: 123 },
    ]);
    trpcQueryMock.mockResolvedValue([]);

    const { modelsByGroup } = await listCatalogGroups();

    expect(modelsByGroup[PHONE_PROVIDER_ID]).toHaveLength(1);
    expect(modelsByGroup[PHONE_PROVIDER_ID]![0]!.id).toBe("phone:gguf:/data/models/llama.gguf");
    // Phone entries route through the on-device engine, never agentChatStream.
    expect(modelsByGroup[PHONE_PROVIDER_ID]![0]!.providerId).toBeUndefined();
  });

  it("degrades to Phone-only when the catalog fetch fails (server offline)", async () => {
    trpcQueryMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { groups, modelsByGroup } = await listCatalogGroups();
    expect(groups).toEqual([{ id: PHONE_PROVIDER_ID, name: expect.stringContaining("Phone") }]);
    expect(modelsByGroup).toEqual({ [PHONE_PROVIDER_ID]: [] });
  });
});
