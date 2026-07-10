/**
 * Model-Fabric per-node host grouping — `describeCatalogHost` is the single
 * source of truth the web picker, the web Model Hub, and (mirrored by hand)
 * the APK picker all group by. These tests lock the brand-derivation +
 * ordering contract so the surfaces can't silently drift.
 */
import { describe, it, expect } from "vitest";
import { describeCatalogHost } from "@shared/types/modelCatalog.js";
import type { CatalogEntry, CatalogLocation } from "@shared/types/modelCatalog.js";

function entry(providerId: string, location: CatalogLocation): CatalogEntry {
  return {
    key: `${providerId}:${location.type}`,
    providerId,
    modelId: "m",
    name: "m",
    location,
    capabilities: { nativeTools: false, vision: false },
  };
}

describe("describeCatalogHost", () => {
  it("brands the Omnecor-owned local runtime as its own 'Omnecor · This PC' group", () => {
    const host = describeCatalogHost(entry("llamacpp", { type: "local", backend: "omnecor-runtime" }));
    expect(host).toMatchObject({ key: "omnecor:local", label: "Omnecor · This PC", brand: "omnecor", node: "This PC" });
  });

  it("brands local Ollama as a distinct, de-emphasized 'Ollama · This PC' group ordered after Omnecor", () => {
    const omnecor = describeCatalogHost(entry("llamacpp", { type: "local", backend: "omnecor-runtime" }));
    const ollama = describeCatalogHost(entry("ollama", { type: "local", backend: "ollama" }));
    expect(ollama).toMatchObject({ key: "ollama:local", label: "Ollama · This PC", brand: "ollama" });
    expect(omnecor.order).toBeLessThan(ollama.order);
  });

  it("derives a mesh peer's brand from providerId — llamacpp is the peer's own Omnecor runtime", () => {
    const host = describeCatalogHost(entry("llamacpp", { type: "mesh-peer", nodeId: "dads-pc", nodeName: "DadsPC" }));
    expect(host).toMatchObject({ key: "omnecor:mesh:dads-pc", label: "Omnecor · DadsPC", brand: "omnecor", node: "DadsPC" });
  });

  it("brands a mesh peer serving via Ollama as 'Ollama · <node>'", () => {
    const host = describeCatalogHost(entry("ollama", { type: "mesh-peer", nodeId: "dads-pc", nodeName: "DadsPC" }));
    expect(host).toMatchObject({ key: "ollama:mesh:dads-pc", label: "Ollama · DadsPC", brand: "ollama", node: "DadsPC" });
  });

  it("keeps each mesh peer distinct so 4+ Omnecor nodes never collapse together", () => {
    const a = describeCatalogHost(entry("llamacpp", { type: "mesh-peer", nodeId: "dads-pc", nodeName: "DadsPC" }));
    const b = describeCatalogHost(entry("llamacpp", { type: "mesh-peer", nodeId: "studio-pc", nodeName: "StudioOnePC" }));
    expect(a.key).not.toBe(b.key);
  });

  it("groups all cloud providers under a single 'Cloud' group, sorted last", () => {
    const cloud = describeCatalogHost(entry("openai", { type: "cloud", provider: "openai" }));
    const omnecorMesh = describeCatalogHost(entry("llamacpp", { type: "mesh-peer", nodeId: "x", nodeName: "X" }));
    expect(cloud).toMatchObject({ key: "cloud", label: "Cloud", brand: "cloud" });
    expect(cloud.order).toBeGreaterThan(omnecorMesh.order);
  });

  it("puts the phone (APK-only, merged client-side) at the very top", () => {
    const phone = describeCatalogHost(entry("phone", { type: "phone" }));
    const omnecorLocal = describeCatalogHost(entry("llamacpp", { type: "local", backend: "omnecor-runtime" }));
    expect(phone).toMatchObject({ brand: "phone", label: "Phone" });
    expect(phone.order).toBeLessThan(omnecorLocal.order);
  });

  it("ranks the full ordering Omnecor-local → Omnecor-mesh → Ollama-local → Ollama-mesh → Cloud", () => {
    const ranks = [
      describeCatalogHost(entry("llamacpp", { type: "local", backend: "omnecor-runtime" })).order,
      describeCatalogHost(entry("llamacpp", { type: "mesh-peer", nodeId: "p", nodeName: "P" })).order,
      describeCatalogHost(entry("ollama", { type: "local", backend: "ollama" })).order,
      describeCatalogHost(entry("ollama", { type: "mesh-peer", nodeId: "p", nodeName: "P" })).order,
      describeCatalogHost(entry("openai", { type: "cloud", provider: "openai" })).order,
    ];
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
