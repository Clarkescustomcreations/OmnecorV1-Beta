// shared/types/modelCatalog.ts
/**
 * Model-Fabric Phase 3 — unified model catalog shape.
 *
 * One `CatalogEntry` per runnable model, tagged with WHERE it runs
 * (`location`) and WHAT it can do (`capabilities`). The server aggregator
 * (`ModelCatalogService`) emits `local` / `mesh-peer` / `cloud` entries only —
 * per Model-Fabric Decision 3, the phone/web pickers (Phase 5) merge in
 * `location.type === "phone"` entries client-side (the server never sees a
 * phone's on-device GGUF/.litertlm files, only the phone itself does).
 */

export type CatalogLocation =
  | { type: "local"; backend: "omnecor-runtime" | "ollama" }
  | { type: "mesh-peer"; nodeId: string; nodeName: string }
  | { type: "cloud"; provider: string }
  | { type: "phone" };

export interface CatalogCapabilities {
  /**
   * Structured (OpenAI-shaped, or llama-server's grammar-guaranteed) tool
   * calling — curated/static per Model-Fabric Decision 2, never runtime-
   * probed (confirmed against lmstudio-js's `trainedForToolUse`: static
   * metadata, not a live probe). The text `<tool_call>` protocol is always
   * available as the floor regardless of this flag — every entry can run the
   * agentic tool loop, this only selects which protocol tier is used.
   */
  nativeTools: boolean;
  vision: boolean;
  contextWindow?: number;
  /**
   * Approximate on-disk model size in MB, when the source reports it (GGUF
   * file size for the local runtime, the Ollama manifest's `size` for local
   * Ollama models). Used as the `vramReq` estimate for mesh advertising
   * (Model-Fabric Phase 4) — undefined when the source doesn't report a size
   * (cloud, mesh-peer entries).
   */
  sizeMb?: number;
}

export interface CatalogEntry {
  /** Stable dedup identity — see ModelCatalogService.dedupKey(). */
  key: string;
  /** Chat provider id this entry routes through (ollama/llamacpp/openai/...). */
  providerId: string;
  modelId: string;
  name: string;
  location: CatalogLocation;
  capabilities: CatalogCapabilities;
  /**
   * Only meaningful for `local`/`omnecor-runtime` entries (Model-Fabric
   * Phase 8): true for the one model currently warm in the managed
   * `llama-server`. The others are hostable and load on demand (a short swap)
   * when selected. Absent/false everywhere else.
   */
  loaded?: boolean;
}

/**
 * Who actually *hosts* a model. Model-Fabric made Ollama optional and gave
 * Omnecor its own local runtime — so "local" is no longer one undifferentiated
 * bucket. With OMMESH, Omnecor can be hosting models on this PC *and* on
 * several mesh peers simultaneously, and each of those nodes must read as its
 * own distinct group in the picker / Model Hub. Ollama (local, or running on a
 * peer) is a separate, de-emphasized fallback brand — still offered, but no
 * longer the thing that hosts local models.
 */
export type CatalogHostBrand = "omnecor" | "ollama" | "cloud" | "phone";

/** A per-(brand, node) grouping descriptor for the pickers and Model Hub. */
export interface CatalogHostGroup {
  /** Stable group key — one group per host brand + node. */
  key: string;
  /** Display label, e.g. "Omnecor · This PC", "Omnecor · DadsPC", "Ollama · This PC", "Cloud". */
  label: string;
  brand: CatalogHostBrand;
  /** Node display name for local/mesh brands ("This PC" or the peer's name). */
  node?: string;
  /**
   * Sort rank (lower = earlier). Omnecor nodes lead, mesh Omnecor next, then
   * the Ollama fallback, then cloud — reflecting that Omnecor's own runtime is
   * now the primary host. Phone (APK-only, merged client-side) sorts to the top.
   */
  order: number;
}

/**
 * Resolve which host surfaces a catalog entry, and how it groups.
 *
 * Brand is *derived*, never stored twice: `cloud`/`phone` from `location.type`;
 * a `local` entry from `location.backend`; a `mesh-peer` entry from its
 * `providerId` — "ollama" means the peer is serving it through Ollama, anything
 * else (llamacpp) means the peer's own Omnecor runtime is hosting it. This
 * works because `MeshNode.refreshModelCatalog()` advertises each model's real
 * `providerId`, and `llamacpp` is the Omnecor-owned backend.
 *
 * Duplicated by hand in the APK's `packaging/android/omnecor-hq/lib/_core/
 * ai-models.ts` (standalone TS project, no `@shared` access) — keep in sync.
 */
export function describeCatalogHost(entry: CatalogEntry): CatalogHostGroup {
  const loc = entry.location;
  switch (loc.type) {
    case "local":
      return loc.backend === "ollama"
        ? { key: "ollama:local", label: "Ollama · This PC", brand: "ollama", node: "This PC", order: 20 }
        : { key: "omnecor:local", label: "Omnecor · This PC", brand: "omnecor", node: "This PC", order: 0 };
    case "mesh-peer":
      return entry.providerId === "ollama"
        ? { key: `ollama:mesh:${loc.nodeId}`, label: `Ollama · ${loc.nodeName}`, brand: "ollama", node: loc.nodeName, order: 30 }
        : { key: `omnecor:mesh:${loc.nodeId}`, label: `Omnecor · ${loc.nodeName}`, brand: "omnecor", node: loc.nodeName, order: 10 };
    case "cloud":
      return { key: "cloud", label: "Cloud", brand: "cloud", order: 40 };
    case "phone":
      return { key: "phone", label: "Phone", brand: "phone", node: "This phone", order: -10 };
  }
}
