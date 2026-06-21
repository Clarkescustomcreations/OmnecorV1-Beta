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

export interface ChatModel {
  id: string;
  name: string;
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
