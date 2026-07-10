/**
 * @file server/core_services/services/ModelManagementService.ts
 * @description Omnecor — Model Management Service
 *
 * Manages a local model registry (JSON file at `data/model-registry.json`).
 * Implements CRUD, versioning, and lifecycle tracking for models across
 * multiple providers (Ollama, OpenAI, Anthropic, HuggingFace, llamacpp, custom).
 *
 * No DB migration needed — uses simple JSON persistence for portability.
 */

import { promises as fs } from "fs";
import { createLogger } from "../../_core/logger.js";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("ModelManagement");

const REGISTRY_PATH = "data/model-registry.json";

export interface ModelRecord {
  id: string;                                              // e.g. "ollama:llama3.1:8b" or "custom:my-model"
  name: string;                                            // Display name
  provider: "ollama" | "openai" | "anthropic" | "huggingface" | "llamacpp" | "custom";
  version: string;                                         // e.g. "3.1", "1.0", "8b"
  quantization?: string;                                   // e.g. "4bit", "8bit", "16bit"
  filePath?: string;                                       // For local models (llamacpp, custom)
  sizeGb?: number;                                         // Estimated disk usage
  isActive: boolean;                                       // Currently selected for this provider
  installedAt: string;                                     // ISO timestamp
  lastUsedAt?: string;                                     // ISO timestamp
  metadata?: Record<string, unknown>;                      // Provider-specific metadata
}

interface ModelRegistry {
  version: number;
  models: ModelRecord[];
  lastUpdated: string;
}

/**
 * Singleton service for model registry management.
 */
export class ModelManagementService {
  private static instance: ModelManagementService;

  private constructor() {}

  public static getInstance(): ModelManagementService {
    if (!ModelManagementService.instance) {
      ModelManagementService.instance = new ModelManagementService();
    }
    return ModelManagementService.instance;
  }

  /**
   * Ensure the data directory exists.
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir("data", { recursive: true });
    } catch (err) {
      log.error("Failed to ensure data directory:", err);
    }
  }

  /**
   * Load the registry from disk, or return empty registry if file doesn't exist.
   */
  private async loadRegistry(): Promise<ModelRegistry> {
    try {
      const content = await fs.readFile(REGISTRY_PATH, "utf-8");
      const parsed = JSON.parse(content) as ModelRegistry;
      return parsed;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist yet — return empty registry
        return { version: 1, models: [], lastUpdated: new Date().toISOString() };
      }
      log.warn("Failed to load model registry:", err);
      return { version: 1, models: [], lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * Persist the registry to disk.
   */
  private async saveRegistry(registry: ModelRegistry): Promise<void> {
    try {
      await this.ensureDataDir();
      registry.lastUpdated = new Date().toISOString();
      await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
    } catch (err) {
      log.error("Failed to save model registry:", err);
      throw new Error(`Failed to persist model registry: ${(err as Error).message}`);
    }
  }

  /**
   * List all registered models.
   */
  async listModels(): Promise<ModelRecord[]> {
    const registry = await this.loadRegistry();
    return registry.models;
  }

  /**
   * List models for a specific provider.
   */
  async listModelsByProvider(provider: string): Promise<ModelRecord[]> {
    const registry = await this.loadRegistry();
    return registry.models.filter(m => m.provider === provider);
  }

  /**
   * Get a single model by ID.
   */
  async getModel(id: string): Promise<ModelRecord | null> {
    const registry = await this.loadRegistry();
    return registry.models.find(m => m.id === id) ?? null;
  }

  /**
   * Register (add or update) a model in the registry.
   */
  async registerModel(record: Omit<ModelRecord, "installedAt">): Promise<ModelRecord> {
    const registry = await this.loadRegistry();

    // Check if model with this ID already exists
    const existingIndex = registry.models.findIndex(m => m.id === record.id);
    const now = new Date().toISOString();

    const fullRecord: ModelRecord = {
      ...record,
      installedAt: existingIndex >= 0 ? registry.models[existingIndex]!.installedAt : now,
    };

    if (existingIndex >= 0) {
      // Update
      registry.models[existingIndex] = fullRecord;
      log.info(`Updated model: ${record.id}`);
    } else {
      // Add
      registry.models.push(fullRecord);
      log.info(`Registered new model: ${record.id}`);
    }

    await this.saveRegistry(registry);
    return fullRecord;
  }

  /**
   * Unregister (remove) a model from the registry.
   */
  async unregisterModel(id: string): Promise<boolean> {
    const registry = await this.loadRegistry();
    const index = registry.models.findIndex(m => m.id === id);

    if (index < 0) {
      log.warn(`Model not found for unregistration: ${id}`);
      return false;
    }

    const model = registry.models[index]!;

    // If this model is active, deactivate it first
    if (model.isActive) {
      model.isActive = false;
    }

    registry.models.splice(index, 1);
    await this.saveRegistry(registry);
    log.info(`Unregistered model: ${id}`);
    return true;
  }

  /**
   * Set a model as active for its provider.
   * Automatically deactivates any other active model for the same provider.
   */
  async setActiveModel(id: string): Promise<ModelRecord | null> {
    const registry = await this.loadRegistry();
    const model = registry.models.find(m => m.id === id);

    if (!model) {
      log.warn(`Cannot set active — model not found: ${id}`);
      return null;
    }

    // Deactivate all other models for this provider
    for (const m of registry.models) {
      if (m.provider === model.provider && m.id !== id) {
        m.isActive = false;
      }
    }

    // Activate this model
    model.isActive = true;
    model.lastUsedAt = new Date().toISOString();

    await this.saveRegistry(registry);
    log.info(`Set active model for ${model.provider}: ${id}`);
    return model;
  }

  /**
   * Sync Ollama models into the registry.
   * Compares current Ollama list with registry and upserts all active Ollama models.
   */
  async syncFromOllama(models: Array<{ name: string; size: number; digest?: string; modified_at?: string }>): Promise<void> {
    const registry = await this.loadRegistry();
    const now = new Date().toISOString();

    for (const ollamaModel of models) {
      const modelId = `ollama:${ollamaModel.name}`;
      const existingIndex = registry.models.findIndex(m => m.id === modelId);

      if (existingIndex >= 0) {
        // Update size and metadata if changed
        registry.models[existingIndex]!.sizeGb = ollamaModel.size / 1e9;
        registry.models[existingIndex]!.metadata = {
          ...(registry.models[existingIndex]?.metadata ?? {}),
          digest: ollamaModel.digest,
          modifiedAt: ollamaModel.modified_at,
        };
      } else {
        // Add new Ollama model
        const newModel: ModelRecord = {
          id: modelId,
          name: ollamaModel.name,
          provider: "ollama",
          version: ollamaModel.name.split(":")[1] ?? "latest",
          sizeGb: ollamaModel.size / 1e9,
          isActive: false,
          installedAt: now,
          metadata: {
            digest: ollamaModel.digest,
            modifiedAt: ollamaModel.modified_at,
          },
        };
        registry.models.push(newModel);
        log.info(`Synced new Ollama model: ${modelId}`);
      }
    }

    // Remove Ollama models that are no longer in Ollama
    const ollamaModelIds = new Set(models.map(m => `ollama:${m.name}`));
    registry.models = registry.models.filter(m => {
      if (m.provider !== "ollama") return true;
      if (!ollamaModelIds.has(m.id)) {
        log.info(`Removed stale Ollama model from registry: ${m.id}`);
      }
      return ollamaModelIds.has(m.id);
    });

    await this.saveRegistry(registry);
    log.info(`Synced Ollama models: ${models.length} current`);
  }

  /**
   * Update the lastUsedAt timestamp for a model.
   * Called after a successful model invocation.
   */
  async markModelUsed(id: string): Promise<void> {
    const registry = await this.loadRegistry();
    const model = registry.models.find(m => m.id === id);

    if (model) {
      model.lastUsedAt = new Date().toISOString();
      await this.saveRegistry(registry);
    }
  }

  /**
   * Get statistics about the registry.
   */
  async getStats(): Promise<{
    totalModels: number;
    activeModels: number;
    totalSizeGb: number;
    byProvider: Record<string, number>;
  }> {
    const registry = await this.loadRegistry();

    const stats = {
      totalModels: registry.models.length,
      activeModels: registry.models.filter(m => m.isActive).length,
      totalSizeGb: registry.models.reduce((sum, m) => sum + (m.sizeGb ?? 0), 0),
      byProvider: {} as Record<string, number>,
    };

    for (const model of registry.models) {
      stats.byProvider[model.provider] = (stats.byProvider[model.provider] ?? 0) + 1;
    }

    return stats;
  }
}
