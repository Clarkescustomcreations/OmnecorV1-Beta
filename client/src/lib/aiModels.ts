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
 * Marketplace models - loaded from API in production
 * TODO: Fetch from real Ollama model registry or HuggingFace API
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
 * Local models - discovered from Ollama/Llama.cpp at runtime
 * TODO: Fetch from ollama.listModels or llamacpp endpoint
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
 * API models - configured by user in settings
 * TODO: Load from user configuration and API health checks
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
 * Get all available models (local + API)
 */
export function getAllModels(selectedId?: string): AIModel[] {
  const allModels: AIModel[] = [
    ...mockLocalModels.map(m => convertToAIModel(m, m.id === selectedId)),
    ...mockAPIModels.map(m => convertToAIModel(m, m.id === selectedId)),
  ];
  return allModels;
}

/**
 * Get models by source
 */
export function getModelsBySource(source: ModelSource): AIModel[] {
  const allModels = getAllModels();
  return allModels.filter(m => m.source === source);
}

/**
 * Get models by type
 */
export function getModelsByType(type: "local" | "api"): AIModel[] {
  const allModels = getAllModels();
  return allModels.filter(m => m.type === type);
}

/**
 * Check model health/availability
 */
export async function checkModelHealth(model: AIModel): Promise<ModelStatus> {
  try {
    if (model.type === "local") {
      // In production, would ping the local endpoint
      return "available";
    } else {
      // In production, would validate API key and endpoint
      return "available";
    }
  } catch (error) {
    console.error(`Health check failed for ${model.name}:`, error);
    return "error";
  }
}

/**
 * Get model by ID
 */
export function getModelById(id: string): AIModel | undefined {
  const allModels = getAllModels();
  return allModels.find(m => m.id === id);
}

/**
 * Get selected model
 */
export function getSelectedModel(): AIModel | undefined {
  const allModels = getAllModels();
  return allModels.find(m => m.isSelected);
}
