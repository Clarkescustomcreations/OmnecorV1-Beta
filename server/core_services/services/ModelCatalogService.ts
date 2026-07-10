/**
 * ModelCatalogService — unified model catalog (Model-Fabric Phase 3).
 *
 * Aggregates every model this node can currently *run with full tool access*:
 * the Omnecor-owned local runtime (`LocalLlmRuntimeService`), an optional
 * local Ollama install, models advertised by discovered OMMESH peers
 * (`NodeCapabilities.models`, populated by each peer's `MeshNode` and fetched
 * on demand over mTLS — Model-Fabric Phase 4), and any cloud provider with a
 * configured API key. Deduped and tagged with `location` + `capabilities` per
 * the CatalogEntry shape in `shared/types/modelCatalog.ts`.
 *
 * The phone's on-device GGUF/.litertlm models are NOT aggregated here —
 * per Model-Fabric Decision 3 the phone/web picker (Phase 5) merges those in
 * client-side, since only the phone itself knows what it has downloaded.
 *
 * Every source degrades to `[]` independently on failure — one dead provider
 * (Ollama offline, a revoked cloud API key) must never blank the catalog.
 *
 * This service has no user context of its own — the caller (the router) must
 * pass `getCatalog({ isSovereign })` for a Sovereign/air-gapped user so the
 * cloud source is skipped rather than making a live call to a cloud
 * provider's model-list endpoint.
 */
import { createLogger } from "../../_core/logger.js";
import { AiProviderService } from "./AiProviderService.js";
import { LocalLlmRuntimeService } from "./LocalLlmRuntimeService.js";
import { meshNode } from "../../ommesh/core/MeshNode.js";
import type { CatalogEntry, CatalogLocation } from "@shared/types/modelCatalog.js";

const log = createLogger("ModelCatalog");

/** Cloud providers `discoverProviderModels` knows how to enumerate. */
const CLOUD_PROVIDERS = ["openai", "anthropic", "gemini", "grok", "huggingface"] as const;

export class ModelCatalogService {
  private static instance: ModelCatalogService | null = null;

  static getInstance(): ModelCatalogService {
    if (!ModelCatalogService.instance) {
      ModelCatalogService.instance = new ModelCatalogService();
    }
    return ModelCatalogService.instance;
  }

  /** Node-scoped part of the dedup key — same model on two different nodes is two entries. */
  private locationKey(loc: CatalogLocation): string {
    switch (loc.type) {
      case "local":
        return `local:${loc.backend}`;
      case "mesh-peer":
        return `mesh:${loc.nodeId}`;
      case "cloud":
        return `cloud:${loc.provider}`;
      case "phone":
        return "phone";
    }
  }

  /**
   * Dedup + tagging rule: (location node) + (content hash when available,
   * else the normalized model name). A content hash catches two differently-
   * tagged aliases of the exact same weights on the same node (e.g. an Ollama
   * digest shared by two tags) and collapses them to one entry; without a
   * hash, name-within-node is the identity.
   */
  private dedupKey(location: CatalogLocation, modelId: string, contentHash?: string): string {
    const node = this.locationKey(location);
    const identity = contentHash ? `hash:${contentHash}` : `name:${modelId.toLowerCase()}`;
    return `${node}::${identity}`;
  }

  private buildEntry(params: {
    providerId: string;
    modelId: string;
    name?: string;
    location: CatalogLocation;
    nativeTools: boolean;
    vision?: boolean;
    contextWindow?: number;
    contentHash?: string;
    sizeMb?: number;
    loaded?: boolean;
  }): CatalogEntry {
    return {
      key: this.dedupKey(params.location, params.modelId, params.contentHash),
      providerId: params.providerId,
      modelId: params.modelId,
      name: params.name ?? params.modelId,
      location: params.location,
      capabilities: {
        nativeTools: params.nativeTools,
        // No current source reports real vision support for any model —
        // false is the honest default, not a stub, until a real signal exists.
        vision: params.vision ?? false,
        contextWindow: params.contextWindow,
        sizeMb: params.sizeMb,
      },
      ...(params.loaded ? { loaded: true } : {}),
    };
  }

  /**
   * The Omnecor-owned local llama-server runtime — every GGUF this node can
   * host (Model-Fabric Phase 8: models dir + Ollama blob store, discovered by
   * `ModelIndexService`), not just the one currently loaded. The warm model is
   * flagged `loaded`; the rest hot-swap in on demand when selected. Returns
   * `[]` when no `llama-server` binary is available (nothing is hostable).
   *
   * `nativeTools: false` — curated default-off for unknown small GGUFs (the
   * lmstudio-js `trainedForToolUse` finding backing Decision 2); the runtime's
   * grammar-guaranteed `<tool_call>` upgrade is a per-request capability of
   * ChatAgentRunner's protocol selection, not a property of this catalog entry.
   */
  private collectLocalRuntime(): CatalogEntry[] {
    const runtime = LocalLlmRuntimeService.getInstance();
    if (!runtime.isAvailable()) return [];
    // Only the model that's actually warm gets `loaded` — not one mid-swap or
    // one whose load failed (getLoadedModelId is set before health confirms).
    const loadedId = runtime.isReady() ? runtime.getLoadedModelId() : null;
    return runtime.listModels().map((m) =>
      this.buildEntry({
        providerId: "llamacpp",
        modelId: m.id,
        name: m.name,
        location: { type: "local", backend: "omnecor-runtime" },
        nativeTools: false,
        sizeMb: m.sizeBytes > 0 ? m.sizeBytes / (1024 * 1024) : undefined,
        loaded: m.id === loadedId,
      }),
    );
  }

  /** Optional local Ollama — absent/unreachable simply yields no entries. */
  private async collectLocalOllama(): Promise<CatalogEntry[]> {
    let models: Array<{ name?: string; digest?: string; size?: number }> = [];
    try {
      models = await AiProviderService.getInstance().discoverOllamaModels();
    } catch (err) {
      log.warn("[ModelCatalogService] Ollama discovery failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
    return models
      .filter((m): m is { name: string; digest?: string; size?: number } => typeof m?.name === "string" && !!m.name)
      .map((m) =>
        this.buildEntry({
          providerId: "ollama",
          modelId: m.name,
          location: { type: "local", backend: "ollama" },
          nativeTools: false,
          contentHash: typeof m.digest === "string" && m.digest ? m.digest : undefined,
          sizeMb: typeof m.size === "number" && m.size > 0 ? m.size / (1024 * 1024) : undefined,
        })
      );
  }

  /**
   * Local-only sources (Omnecor runtime + optional Ollama) — deliberately
   * excludes mesh peers and cloud. Used by `MeshNode` to build the model list
   * *this* node advertises to the mesh (Model-Fabric Phase 4): advertising a
   * peer's already-relayed models back out, or cloud models (never mesh-
   * routable — see `CLOUD_PROVIDER_IDS`), would be wrong on both counts.
   */
  async collectLocalOnly(): Promise<CatalogEntry[]> {
    const local = this.collectLocalRuntime();
    const ollama = await this.collectOllamaWhenNoRuntime();
    const byKey = new Map<string, CatalogEntry>();
    for (const entry of [...local, ...ollama]) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    }
    return Array.from(byKey.values());
  }

  /**
   * The optional-Ollama source, but **only when the Omnecor runtime can't host**
   * (no `llama-server` binary). Once the runtime is available it reads GGUFs
   * straight from the Ollama blob store (`ModelIndexService`), so every Ollama
   * model already appears — tool-owned — under the Omnecor brand; querying the
   * live Ollama API too would just re-list the same models under a second brand
   * (and by *content*, not merely by matching names). When the runtime is
   * unavailable, Ollama stays the sole path to those models, so it's included.
   */
  private async collectOllamaWhenNoRuntime(): Promise<CatalogEntry[]> {
    if (LocalLlmRuntimeService.getInstance().isAvailable()) return [];
    return this.collectLocalOllama();
  }

  /**
   * Models advertised by discovered OMMESH peers, sourced from each peer's
   * `PeerInfo.capabilities.models` (`DiscoveryService` fetches the full list
   * over mTLS on demand — see Model-Fabric Phase 4). An entry missing
   * `provider` (older peer build) defaults to "ollama" (today's only
   * mesh-routable backend besides llamacpp — see MESH_ROUTABLE_PROVIDERS).
   *
   * `nativeTools: false` is hardcoded, not curated per-model, on purpose: the
   * mesh inference wire protocol (`AiProviderService.routeToPeer` →
   * `MeshNode.executeOnPeer`) returns a flattened `{content}` string with no
   * field for a structured `toolCalls[]` result, so native tool-calling has
   * no way to reach the caller for a mesh-peer turn regardless of what the
   * underlying model supports. Do not source this from `m.provider`/peer
   * metadata without first adding real toolCalls-over-mesh plumbing — see
   * the comment on `routeToPeer`.
   */
  private collectMeshPeers(): CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for (const peer of meshNode.getDiscovery().getPeers()) {
      for (const m of peer.capabilities?.models ?? []) {
        if (!m?.name) continue;
        out.push(
          this.buildEntry({
            providerId: m.provider ?? "ollama",
            modelId: m.name,
            location: { type: "mesh-peer", nodeId: peer.name, nodeName: peer.name },
            nativeTools: false,
            contextWindow: m.contextWindow > 0 ? m.contextWindow : undefined,
          })
        );
      }
    }
    return out;
  }

  /**
   * Cloud providers with a configured API key, queried in parallel via the
   * existing live `discoverProviderModels`. A provider with no key is
   * skipped entirely (no network call); a provider whose call fails is
   * logged and dropped rather than failing the whole catalog.
   * `nativeTools: true` — known-true for cloud per Decision 2.
   */
  private async collectCloud(): Promise<CatalogEntry[]> {
    const svc = AiProviderService.getInstance();
    const configured = CLOUD_PROVIDERS.filter((p) => svc.hasProviderKey(p));
    const settled = await Promise.allSettled(configured.map((p) => svc.discoverProviderModels(p)));

    const out: CatalogEntry[] = [];
    settled.forEach((res, i) => {
      const providerId = configured[i]!;
      if (res.status !== "fulfilled") {
        log.warn(`[ModelCatalogService] cloud discovery failed for ${providerId}`, {
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
        return;
      }
      for (const m of res.value) {
        out.push(
          this.buildEntry({
            providerId,
            modelId: m.id,
            name: m.name,
            location: { type: "cloud", provider: providerId },
            nativeTools: true,
          })
        );
      }
    });
    return out;
  }

  /**
   * Aggregate every runnable model this node can currently reach, deduped
   * and tagged. Source order (local runtime → local Ollama → mesh peers →
   * cloud) is also the dedup precedence: when two sources collide on the
   * same key (only possible for `local` entries — mesh/cloud keys are always
   * node/provider-scoped and can't collide with `local`), the first-seen
   * entry wins.
   *
   * `isSovereign` must be passed by the caller (the router reads it off
   * `ctx.user.executionMode` / the server-wide override via `isSovereignMode`)
   * — this service has no user context of its own. When true, `collectCloud()`
   * is skipped entirely: an air-gapped user must never trigger a live call to
   * a cloud provider's model-list endpoint, the same boundary `chatStream`/
   * `agentChatStream` enforce via `assertProviderAllowedInMode` before any
   * cloud provider is touched.
   */
  async getCatalog(opts: { isSovereign?: boolean } = {}): Promise<CatalogEntry[]> {
    const [local, ollama, cloud] = await Promise.all([
      Promise.resolve(this.collectLocalRuntime()),
      this.collectOllamaWhenNoRuntime(),
      opts.isSovereign ? Promise.resolve([]) : this.collectCloud(),
    ]);
    const mesh = this.collectMeshPeers();

    const byKey = new Map<string, CatalogEntry>();
    for (const entry of [...local, ...ollama, ...mesh, ...cloud]) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    }
    return Array.from(byKey.values());
  }
}
