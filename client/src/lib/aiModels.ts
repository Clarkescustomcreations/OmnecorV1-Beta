/**
 * AI Model Management Library
 *
 * Handles local models (Ollama, Llama.cpp) and API-based models
 * with configuration, discovery, and health checking.
 */

export type ModelSource =
  | "ollama"
  | "llamacpp"
  | "openai"
  | "anthropic"
  | "gemini"
  | "grok"
  | "custom";
export type ModelStatus = "available" | "loading" | "error" | "offline";

export interface LocalModel {
  id: string;
  name: string;
  source: "ollama" | "llamacpp";
  size: number; // in MB
  quantization?: string;
  contextWindow?: number;
  maxTokens?: number;
  status: ModelStatus;
  lastChecked?: Date;
  endpoint?: string;
}

export interface APIModel {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "gemini" | "grok" | "custom";
  apiKey?: string;
  endpoint?: string;
  status: ModelStatus;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

export interface AIModel {
  id: string;
  name: string;
  displayName: string;
  source: ModelSource;
  type: "local" | "api";
  status: ModelStatus;
  description?: string;
  capabilities?: {
    chat: boolean;
    completion: boolean;
    embedding: boolean;
    vision: boolean;
    functionCalling: boolean;
  };
  contextWindow?: number;
  maxTokens?: number;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
  lastUsed?: Date;
  isSelected?: boolean;
  metadata?: Record<string, any>;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: "local" | "api";
  isConfigured: boolean;
  endpoint?: string;
  apiKey?: string;
  models: AIModel[];
  status: ModelStatus;
  lastSynced?: Date;
}

export interface ModelMarketplaceItem {
  id: string;
  name: string;
  provider: ModelSource;
  description: string;
  size: number; // in MB
  quantizations: string[];
  popularity: number; // 0-100
  rating: number; // 0-5
  downloads: number;
  tags: string[];
  releaseDate: Date;
  latestVersion: string;
}

/**
 * TEST FIXTURE: Marketplace models - loaded from API in production
 * @deprecated For testing only. In production, fetch from real Ollama model registry or HuggingFace API
 */
export const mockMarketplaceModels: ModelMarketplaceItem[] = [
  {
    id: "llama3",
    name: "Llama 3",
    provider: "ollama",
    description: "Meta's Llama 3 8B instruction-tuned model",
    size: 4800,
    quantizations: ["Q4_K_M", "Q5_K_M", "Q8_0"],
    popularity: 92,
    rating: 4.7,
    downloads: 1_200_000,
    tags: ["chat", "instruction", "general"],
    releaseDate: new Date("2024-04-18"),
    latestVersion: "3.1",
  },
  {
    id: "mistral",
    name: "Mistral 7B",
    provider: "ollama",
    description: "Mistral 7B instruction-tuned model",
    size: 4100,
    quantizations: ["Q4_K_M", "Q5_K_M"],
    popularity: 85,
    rating: 4.5,
    downloads: 850_000,
    tags: ["chat", "instruction"],
    releaseDate: new Date("2023-10-10"),
    latestVersion: "0.3",
  },
];

/**
 * TEST FIXTURE: Local models - discovered from Ollama/Llama.cpp at runtime
 * @deprecated For testing only. In production, fetch from ollama.listModels or llamacpp endpoint
 */
export const mockLocalModels: LocalModel[] = [
  {
    id: "llama3:8b",
    name: "Llama 3 8B",
    source: "ollama",
    size: 4800,
    quantization: "Q4_K_M",
    contextWindow: 8192,
    maxTokens: 4096,
    status: "available",
    endpoint: "http://localhost:11434",
  },
  {
    id: "mistral:7b",
    name: "Mistral 7B",
    source: "ollama",
    size: 4100,
    quantization: "Q4_K_M",
    contextWindow: 8192,
    maxTokens: 4096,
    status: "available",
    endpoint: "http://localhost:11434",
  },
];

/**
 * TEST FIXTURE: API models - configured by user in settings
 * @deprecated For testing only. In production, load from user configuration and API health checks
 */
export const mockAPIModels: APIModel[] = [
  {
    id: "gpt-4",
    name: "GPT-4",
    provider: "openai",
    status: "available",
    costPer1kTokens: { input: 0.03, output: 0.06 },
  },
  {
    id: "claude-3-opus",
    name: "Claude 3 Opus",
    provider: "anthropic",
    status: "available",
    costPer1kTokens: { input: 0.015, output: 0.075 },
  },
  {
    id: "gemini-pro",
    name: "Gemini Pro",
    provider: "gemini",
    status: "available",
    costPer1kTokens: { input: 0.0005, output: 0.0015 },
  },
];

/**
 * Per-provider catalog of selectable API models, keyed by the provider id
 * returned by `aiProvider.getProviders`. Used by the chat ModelSelector to
 * expand an online provider into its concrete models (instead of a single
 * provider-level row). Only providers representable as a chat `providerId`
 * (openai/anthropic/gemini/grok) appear here.
 */
export const API_MODEL_CATALOG: Record<
  "openai" | "anthropic" | "gemini" | "grok",
  Array<{ id: string; name: string; costPer1kTokens?: { input: number; output: number } }>
> = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o", costPer1kTokens: { input: 0.0025, output: 0.01 } },
    { id: "gpt-4o-mini", name: "GPT-4o mini", costPer1kTokens: { input: 0.00015, output: 0.0006 } },
    { id: "o1", name: "o1", costPer1kTokens: { input: 0.015, output: 0.06 } },
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

/**
 * Documented context-window sizes (in tokens) for known cloud models.
 * Used to render real remaining-capacity figures in the chat context panel
 * instead of a hardcoded default. Values track each provider's published limits.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "o1": 200_000,
  "gpt-4": 8_192,
  // Anthropic (Claude 3.x / 4.x family)
  "claude-opus-4-8": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-3-opus": 200_000,
  // Google Gemini
  "gemini-2.0-flash": 1_048_576,
  "gemini-1.5-pro": 2_097_152,
  "gemini-1.5-flash": 1_048_576,
  "gemini-pro": 32_768,
  // xAI Grok
  "grok-2": 131_072,
  "grok-2-mini": 131_072,
};

/** Per-provider fallback context window when a specific model id is unknown. */
const PROVIDER_DEFAULT_CONTEXT_WINDOW: Record<string, number> = {
  openai: 128_000,
  anthropic: 200_000,
  gemini: 1_048_576,
  grok: 131_072,
  ollama: 8_192,
};

/**
 * Resolve the real context-window size for a selected model.
 * Falls back to the provider default, then a conservative 8K, so the chat
 * context meter always reflects the actual model rather than a fixed constant.
 */
export function getContextWindow(
  providerId?: string,
  modelId?: string,
): number {
  if (modelId && MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId];
  if (providerId && PROVIDER_DEFAULT_CONTEXT_WINDOW[providerId]) {
    return PROVIDER_DEFAULT_CONTEXT_WINDOW[providerId];
  }
  return 8_192;
}

/**
 * Convert local and API models to unified AIModel format
 */
export function convertToAIModel(
  model: LocalModel | APIModel,
  isSelected: boolean = false
): AIModel {
  if ("source" in model && (model as LocalModel).source) {
    // LocalModel
    const localModel = model as LocalModel;
    return {
      id: localModel.id,
      name: localModel.name,
      displayName: `${localModel.name} (${localModel.source})`,
      source: localModel.source,
      type: "local",
      status: localModel.status,
      contextWindow: localModel.contextWindow,
      maxTokens: localModel.maxTokens,
      isSelected,
      metadata: {
        size: localModel.size,
        quantization: localModel.quantization,
        endpoint: localModel.endpoint,
      },
      capabilities: {
        chat: true,
        completion: true,
        embedding: false,
        vision: false,
        functionCalling: false,
      },
    };
  } else {
    // APIModel
    const apiModel = model as APIModel;
    return {
      id: apiModel.id,
      name: apiModel.name,
      displayName: `${apiModel.name} (${apiModel.provider})`,
      source: apiModel.provider,
      type: "api",
      status: apiModel.status,
      costPer1kTokens: apiModel.costPer1kTokens,
      isSelected,
      metadata: {
        apiKey: apiModel.apiKey ? "***" : undefined,
        endpoint: apiModel.endpoint,
      },
      capabilities: {
        chat: true,
        completion: true,
        embedding: apiModel.provider === "openai",
        vision:
          apiModel.provider === "openai" || apiModel.provider === "gemini",
        functionCalling:
          apiModel.provider === "openai" || apiModel.provider === "anthropic",
      },
    };
  }
}

/**
 * Return a list of models with `isSelected` applied.
 * Pass the real models fetched via tRPC as the second argument.
 */
export function getAllModels(selectedId?: string, externalModels?: AIModel[]): AIModel[] {
  if (externalModels?.length) {
    return externalModels.map(m => ({ ...m, isSelected: m.id === selectedId }));
  }
  const local = mockLocalModels.map(m => convertToAIModel(m, m.id === selectedId));
  const api = mockAPIModels.map(m => convertToAIModel(m, m.id === selectedId));
  return [...local, ...api];
}

/**
 * Get models by source
 */
export function getModelsBySource(source: ModelSource, externalModels?: AIModel[]): AIModel[] {
  const allModels = getAllModels(undefined, externalModels);
  return allModels.filter(m => m.source === source);
}

/**
 * Get models by type
 */
export function getModelsByType(type: "local" | "api", externalModels?: AIModel[]): AIModel[] {
  const allModels = getAllModels(undefined, externalModels);
  return allModels.filter(m => m.type === type);
}

/**
 * Check model health/availability.
 * For local (Ollama/Llama.cpp) models: pings the inference endpoint and checks
 * that the model is actually loaded. For API models: returns the model's stored
 * status (key validation requires a backend round-trip via trpc.aiProvider.checkHealth).
 */
export async function checkModelHealth(model: AIModel): Promise<ModelStatus> {
  try {
    if (model.type === "local") {
      const endpoint = (model.metadata?.endpoint as string | undefined) ?? "http://localhost:11434";
      const base = endpoint.replace(/\/$/, "");
      const res = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return "error";
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const loaded = data.models?.some(m => m.name === model.id);
      return loaded ? "available" : "offline";
    }
    // API models: honour the status already returned by the provider list.
    return model.status ?? "offline";
  } catch (error) {
    console.error(`Health check failed for ${model.name}:`, error);
    return "error";
  }
}

/**
 * Get model by ID
 */
export function getModelById(id: string, externalModels?: AIModel[]): AIModel | undefined {
  const allModels = getAllModels(undefined, externalModels);
  return allModels.find(m => m.id === id);
}

/**
 * Get selected model
 */
export function getSelectedModel(externalModels?: AIModel[]): AIModel | undefined {
  const allModels = getAllModels(undefined, externalModels);
  return allModels.find(m => m.isSelected);
}
