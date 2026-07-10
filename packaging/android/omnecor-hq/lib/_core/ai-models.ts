/**
 * Real model catalog + resolution for the desktop's `ai.chat` / `podcast.*`
 * procedures. Replaces the hardcoded `"llama3.2:latest"` that used to be sprinkled
 * across the Chat, Podcast and Viewer screens — a guess that silently failed
 * whenever that exact tag wasn't installed on the PC.
 *
 *  • Local providers (ollama/llamacpp/forge) → the PC's *actually installed*
 *    models, fetched live from `ollama.listModels`.
 *  • Cloud providers → a curated catalog of current, selectable model ids,
 *    mirroring the desktop's `API_MODEL_CATALOG` in client/src/lib/aiModels.ts.
 *
 * `ai.chat` requires a non-empty `modelId` (server schema: z.string().min(1)),
 * so callers must resolve a real id before sending — never a placeholder.
 */
import { trpcQuery } from "./trpc-fetch";
import { listLocalGguf, listLocalTask } from "./model-download";
import {
  capabilitiesForFile, isNpuCapableFile, type ModelCapabilities,
} from "./model-catalog";

export interface ChatModel {
  id: string;
  name: string;
  /**
   * What the model can consume. Phone models carry the catalog truth (all
   * current on-device models are text-only) so the chat UI can disable the
   * attachment/photo buttons instead of erroring at send time. Absent for
   * remote models — attachments there upload to the PC and are always allowed.
   */
  capabilities?: ModelCapabilities;
  /** Phone GGUF whose quantization the Hexagon NPU can execute. */
  npuReady?: boolean;
  /**
   * Real chat provider id (ollama/llamacpp/openai/...) — set on every entry
   * sourced from the unified server catalog (`listCatalogGroups`, Model-Fabric
   * Phase 5). Absent on phone entries, which route through the on-device
   * engine instead of `agentChatStream`.
   */
  providerId?: string;
  /**
   * OMMESH peer node id to pin mesh routing to (Model-Fabric Phase 5) — set
   * only for a `mesh-peer` catalog entry, so selecting "qwen2.5:7b on DadsPC"
   * actually runs on DadsPC rather than wherever the mesh auto-scorer picks.
   */
  targetNodeId?: string;
}

/**
 * Synthetic provider id for the phone's own on-device models (GGUF via llama.rn
 * + `.litertlm` via LiteRT-LM). Grouped as its own provider so the chat picker
 * keeps PC/mesh models and phone models in separate sections, never one jumble.
 */
export const PHONE_PROVIDER_ID = "phone";
export const PHONE_PROVIDER = { id: PHONE_PROVIDER_ID, name: "📱 Phone (on-device)" };

/** Encode/parse a phone model id: `phone:<engine>:<absolutePath>`. */
export function makePhoneModelId(engine: "gguf" | "litert", path: string): string {
  return `${PHONE_PROVIDER_ID}:${engine}:${path}`;
}
export function parsePhoneModelId(id: string): { engine: "gguf" | "litert"; path: string } | null {
  const m = /^phone:(gguf|litert):(.+)$/.exec(id);
  return m ? { engine: m[1] as "gguf" | "litert", path: m[2] } : null;
}

/**
 * The phone's downloaded/importable on-device models — GGUF and LiteRT-LM —
 * ready to load and run without a PC. Sorted by engine then name.
 */
export async function listPhoneModels(): Promise<ChatModel[]> {
  const [gguf, task] = await Promise.all([listLocalGguf(), listLocalTask()]);
  const out: ChatModel[] = [];
  for (const m of gguf) {
    const npuReady = isNpuCapableFile(m.filename);
    out.push({
      id: makePhoneModelId("gguf", m.path),
      name: `${m.filename}  ·  GGUF${npuReady ? "  ·  ⚡NPU" : ""}`,
      capabilities: capabilitiesForFile(m.filename),
      npuReady,
    });
  }
  for (const m of task) {
    out.push({
      id: makePhoneModelId("litert", m.path),
      name: `${m.filename}  ·  LiteRT`,
      capabilities: capabilitiesForFile(m.filename),
      npuReady: false,
    });
  }
  return out;
}

/**
 * Curated cloud model catalog, keyed by the provider id returned by
 * `ai.getProviders`. Kept in sync with the desktop's API_MODEL_CATALOG.
 */
const CLOUD_CATALOG: Record<string, ChatModel[]> = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "o1", name: "o1" },
  ],
  anthropic: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  ],
  grok: [
    { id: "grok-2", name: "Grok 2" },
    { id: "grok-2-mini", name: "Grok 2 mini" },
  ],
};

/** Providers whose models come from the PC's local Ollama runtime. */
const LOCAL_PROVIDERS = new Set(["ollama", "llamacpp", "forge"]);

let _ollamaCache: ChatModel[] | null = null;

/** Installed Ollama models on the PC (cached for the session; refreshable). */
export async function fetchOllamaModels(force = false): Promise<ChatModel[]> {
  if (_ollamaCache && !force) return _ollamaCache;
  try {
    const res = await trpcQuery<{ models: { name: string }[] }>("ollama.listModels");
    _ollamaCache = (res?.models ?? []).map((m) => ({ id: m.name, name: m.name }));
  } catch {
    _ollamaCache = [];
  }
  return _ollamaCache;
}

/**
 * Real, selectable models for a provider: the PC's installed Ollama models for
 * local providers, or the curated catalog for a cloud provider. Returns `[]` for
 * providers with no enumerable model list (e.g. `ommesh`, which runs whatever
 * GGUF is loaded on the phone worker).
 */
export async function listModelsForProvider(providerId: string): Promise<ChatModel[]> {
  if (providerId === PHONE_PROVIDER_ID) return listPhoneModels();
  if (LOCAL_PROVIDERS.has(providerId)) return fetchOllamaModels();
  return CLOUD_CATALOG[providerId] ?? [];
}

/**
 * Resolve a real default model id for a provider, or `null` when none can be
 * determined (e.g. no Ollama models installed). Callers should surface a real
 * error in that case rather than guessing a model that may not exist.
 */
export async function resolveDefaultModel(providerId: string): Promise<string | null> {
  const models = await listModelsForProvider(providerId);
  return models[0]?.id ?? null;
}

/**
 * Model-Fabric Phase 5 — the unified chat picker's data source.
 *
 * Replaces the provider-centric flow above (`ai.getProviders` + per-provider
 * fetch) for the main chat screen: one call to the server's unified model
 * catalog (`aiProvider.catalog`, Model-Fabric Phase 3/4 — Omnecor-owned
 * runtime + optional local Ollama + OMMESH mesh peers + configured cloud
 * providers, deduped and already tool-capable) merged with the phone's own
 * on-device models, grouped as Phone / This PC / Mesh:<node> / Cloud. This is
 * what makes a real PC or mesh-peer model *selectable* at all — before this,
 * the picker only ever showed Ollama + a hardcoded cloud list + phone.
 *
 * `listModelsForProvider`/`resolveDefaultModel` above are UNCHANGED and still
 * used by the podcast tab's simpler per-provider default-model resolution —
 * this is a separate, additive data source for the chat picker specifically.
 */

/** Mirrors `shared/types/modelCatalog.ts` on the server — duplicated here
 *  since packaging/android is a standalone TS project with no access to the
 *  server/shared workspace. Keep in sync by hand if the server shape changes. */
export type CatalogLocation =
  | { type: "local"; backend: "omnecor-runtime" | "ollama" }
  | { type: "mesh-peer"; nodeId: string; nodeName: string }
  | { type: "cloud"; provider: string };

export interface CatalogEntry {
  key: string;
  providerId: string;
  modelId: string;
  name: string;
  location: CatalogLocation;
  capabilities: { nativeTools: boolean; vision: boolean; contextWindow?: number; sizeMb?: number };
  /** local/omnecor-runtime only: the model currently warm in llama-server
   *  (Model-Fabric Phase 8). Mirror of the server `CatalogEntry.loaded`. */
  loaded?: boolean;
}

/** One selectable group in the picker's chip row. */
export interface ModelGroup {
  id: string;
  name: string;
}

export const CLOUD_GROUP_ID = "cloud";
export const OMNECOR_LOCAL_GROUP_ID = "omnecor:local";
export const OLLAMA_LOCAL_GROUP_ID = "ollama:local";
export function omnecorMeshGroupId(nodeId: string): string {
  return `omnecor:mesh:${nodeId}`;
}
export function ollamaMeshGroupId(nodeId: string): string {
  return `ollama:mesh:${nodeId}`;
}

export type CatalogHostBrand = "omnecor" | "ollama" | "cloud";

/**
 * Mirrors `shared/types/modelCatalog.ts` `describeCatalogHost` — duplicated
 * here since packaging/android is a standalone TS project (no `@shared`
 * access). Keep in sync by hand. Brand is derived, never stored twice: a
 * `local` entry from its backend; a `mesh-peer` entry from `providerId`
 * ("ollama" = the peer is serving via Ollama, anything else = the peer's own
 * Omnecor runtime). With OMMESH, Omnecor can host on this phone's PC *and* on
 * several peers at once, so each node reads as its own "Omnecor · <node>" group.
 */
export function describeCatalogHost(entry: CatalogEntry): {
  key: string;
  label: string;
  brand: CatalogHostBrand;
  order: number;
} {
  const loc = entry.location;
  switch (loc.type) {
    case "local":
      return loc.backend === "ollama"
        ? { key: OLLAMA_LOCAL_GROUP_ID, label: "Ollama · This PC", brand: "ollama", order: 20 }
        : { key: OMNECOR_LOCAL_GROUP_ID, label: "Omnecor · This PC", brand: "omnecor", order: 0 };
    case "mesh-peer":
      return entry.providerId === "ollama"
        ? { key: ollamaMeshGroupId(loc.nodeId), label: `Ollama · ${loc.nodeName}`, brand: "ollama", order: 30 }
        : { key: omnecorMeshGroupId(loc.nodeId), label: `Omnecor · ${loc.nodeName}`, brand: "omnecor", order: 10 };
    case "cloud":
      return { key: CLOUD_GROUP_ID, label: "Cloud", brand: "cloud", order: 40 };
  }
}

/**
 * Fetch the unified server-side catalog. Empty on any failure (server
 * offline, request error) — the picker degrades to phone-only, never crashes,
 * matching every other network call in this file.
 */
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  try {
    return await trpcQuery<CatalogEntry[]>("aiProvider.catalog");
  } catch {
    return [];
  }
}

/**
 * Build the chat picker's groups + per-group model lists from the server
 * catalog plus the phone's own on-device models. Every non-phone `ChatModel`
 * carries a real `providerId` (and `targetNodeId` for a mesh-peer entry) so
 * the caller can drive `agentChatStream` directly off the selected entry —
 * no separate provider-resolution step, and no entry that can't run tools.
 */
export async function listCatalogGroups(): Promise<{
  groups: ModelGroup[];
  modelsByGroup: Record<string, ChatModel[]>;
}> {
  const [catalog, phoneModels] = await Promise.all([fetchCatalog(), listPhoneModels()]);

  // Phone (this device's own on-device models) always leads.
  const modelsByGroup: Record<string, ChatModel[]> = { [PHONE_PROVIDER_ID]: phoneModels };
  const groupMeta = new Map<string, { name: string; order: number }>();

  for (const entry of catalog) {
    const host = describeCatalogHost(entry);
    const chatModel: ChatModel = { id: entry.modelId, name: entry.name, providerId: entry.providerId };
    if (entry.location.type === "mesh-peer") chatModel.targetNodeId = entry.location.nodeId;
    if (!modelsByGroup[host.key]) {
      modelsByGroup[host.key] = [];
      groupMeta.set(host.key, { name: host.label, order: host.order });
    }
    modelsByGroup[host.key]!.push(chatModel);
  }

  // Omnecor nodes first, then Ollama fallback, then cloud (host order rank) —
  // phone is pinned to the very top regardless.
  const catalogGroups: ModelGroup[] = Array.from(groupMeta.entries())
    .sort(([, a], [, b]) => a.order - b.order || a.name.localeCompare(b.name))
    .map(([id, meta]) => ({ id, name: meta.name }));

  return { groups: [PHONE_PROVIDER, ...catalogGroups], modelsByGroup };
}
