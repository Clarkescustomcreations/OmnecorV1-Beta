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
export const mockMarketplaceModels: ModelMarketplaceItem[] = [];

/**
 * Local models - discovered from Ollama/Llama.cpp at runtime
 * TODO: Fetch from ollama.listModels or llamacpp endpoint
 */
export const mockLocalModels: LocalModel[] = [];

/**
 * API models - configured by user in settings
 * TODO: Load from user configuration and API health checks
 */
export const mockAPIModels: APIModel[] = [];

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
