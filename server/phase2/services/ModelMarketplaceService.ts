/**
 * ModelMarketplaceService — curated model library with automated sync
 *
 * Aggregates models from multiple sources:
 * - Ollama local library (http://localhost:11434)
 * - Ollama registry (via ollamadb.dev API)
 * - HuggingFace models API
 *
 * Degrades gracefully when external services are offline.
 */

import { ENV } from "../../_core/env.js";
import { createLogger } from "../../_core/logger.js";

const log = createLogger("modelMarketplace");

export interface MarketplaceModel {
  id: string;
  name: string;
  source: "ollama" | "huggingface";
  description: string;
  tags: string[];
  sizeGb?: number;
  downloads?: number;
  pullCommand?: string;  // e.g. "ollama pull llama3.1:8b"
  huggingFaceId?: string;
  url?: string;
}

// Curated list of popular models for the "Featured" tab
const FEATURED_MODELS: MarketplaceModel[] = [
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B",
    source: "ollama",
    description: "Meta's Llama 3.1 8B — fast, capable open-source LLM for local inference.",
    tags: ["llm", "general", "popular"],
    pullCommand: "ollama pull llama3.1:8b",
  },
  {
    id: "mistral:7b",
    name: "Mistral 7B",
    source: "ollama",
    description: "Mistral AI's 7B model — efficient and versatile for most tasks.",
    tags: ["llm", "general", "popular"],
    pullCommand: "ollama pull mistral:7b",
  },
  {
    id: "phi-3:mini",
    name: "Phi-3 Mini",
    source: "ollama",
    description: "Microsoft's Phi-3 mini — tiny and fast, great for edge devices.",
    tags: ["llm", "lightweight"],
    pullCommand: "ollama pull phi-3:mini",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 9B",
    source: "ollama",
    description: "Google's Gemma 2 9B — high performance open-source model.",
    tags: ["llm", "general"],
    pullCommand: "ollama pull gemma2:9b",
  },
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    source: "ollama",
    description: "Alibaba's Qwen 2.5 7B — multilingual and code-aware.",
    tags: ["llm", "code", "multilingual"],
    pullCommand: "ollama pull qwen2.5:7b",
  },
  {
    id: "codellama:7b",
    name: "Code Llama 7B",
    source: "ollama",
    description: "Meta's Code Llama 7B — specialized for code generation and understanding.",
    tags: ["llm", "code"],
    pullCommand: "ollama pull codellama:7b",
  },
  {
    id: "llava:latest",
    name: "LLaVA",
    source: "ollama",
    description: "LLaVA — vision-language model for image understanding.",
    tags: ["multimodal", "vision"],
    pullCommand: "ollama pull llava:latest",
  },
  {
    id: "deepseek-coder:6.7b",
    name: "DeepSeek Coder 6.7B",
    source: "ollama",
    description: "DeepSeek's code-specialized 6.7B model.",
    tags: ["llm", "code"],
    pullCommand: "ollama pull deepseek-coder:6.7b",
  },
];

export class ModelMarketplaceService {
  private static instance: ModelMarketplaceService | null = null;

  private constructor() {}

  public static getInstance(): ModelMarketplaceService {
    if (!ModelMarketplaceService.instance) {
      ModelMarketplaceService.instance = new ModelMarketplaceService();
    }
    return ModelMarketplaceService.instance;
  }

  /**
   * Get curated featured models (no network calls)
   */
  getHotModels(): MarketplaceModel[] {
    return FEATURED_MODELS;
  }

  /**
   * Search Ollama library via ollamadb.dev API
   * Degrades gracefully if API is unavailable
   */
  async searchOllama(query: string, limit: number): Promise<MarketplaceModel[]> {
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        sort_by: "pulls",
        order: "desc",
      });
      if (query) params.set("search", query);

      const res = await fetch(`https://ollamadb.dev/api/v1/models?${params}`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log.warn(`[Ollama] Registry returned ${res.status}, degrading gracefully`);
        return [];
      }

      const data = (await res.json()) as {
        data: Array<{
          model_identifier: string;
          description: string;
          labels: string[];
          pulls: number;
          tags: number;
          last_updated: string;
          url: string;
        }>;
        total_count: number;
      };

      return (data.data ?? []).map(m => ({
        id: m.model_identifier,
        name: m.model_identifier,
        source: "ollama" as const,
        description: m.description || "No description available",
        tags: m.labels ?? [],
        downloads: m.pulls ?? 0,
        url: m.url,
        pullCommand: `ollama pull ${m.model_identifier}`,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[Ollama] Search failed: ${msg}, returning empty array`);
      return [];
    }
  }

  /**
   * Search HuggingFace models
   * Requires HUGGINGFACE_API_KEY — returns empty if not configured
   */
  async searchHuggingFace(query: string, limit: number): Promise<MarketplaceModel[]> {
    if (!ENV.huggingfaceApiKey) {
      log.debug("[HuggingFace] API key not configured, skipping");
      return [];
    }

    try {
      const params = new URLSearchParams({
        search: query || "",
        filter: "text-generation",
        limit: String(limit),
        sort: "downloads",
      });

      const res = await fetch(`https://huggingface.co/api/models?${params}`, {
        headers: {
          "Authorization": `Bearer ${ENV.huggingfaceApiKey}`,
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        log.warn(`[HuggingFace] API returned ${res.status}, degrading gracefully`);
        return [];
      }

      const data = (await res.json()) as Array<{
        id: string;
        modelId: string;
        name?: string;
        description?: string;
        tags?: string[];
        downloads?: number;
        url?: string;
      }>;

      // Filter to text-generation models and map to MarketplaceModel
      return (Array.isArray(data) ? data : [])
        .filter(m => m.tags?.includes("text-generation") ?? false)
        .slice(0, limit)
        .map(m => ({
          id: m.id || m.modelId,
          name: m.name || m.modelId,
          source: "huggingface" as const,
          description: m.description || "No description available",
          tags: m.tags ?? [],
          downloads: m.downloads,
          huggingFaceId: m.modelId,
          url: m.url || `https://huggingface.co/${m.modelId}`,
        }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[HuggingFace] Search failed: ${msg}, returning empty array`);
      return [];
    }
  }

  /**
   * Search all sources in parallel, merge and deduplicate results
   */
  async searchAll(query: string, limit: number): Promise<MarketplaceModel[]> {
    const [ollamaResults, hfResults] = await Promise.allSettled([
      this.searchOllama(query, limit),
      this.searchHuggingFace(query, limit),
    ]);

    const results: MarketplaceModel[] = [];
    const seenIds = new Set<string>();

    // Collect Ollama results
    if (ollamaResults.status === "fulfilled") {
      for (const model of ollamaResults.value) {
        if (!seenIds.has(model.id)) {
          results.push(model);
          seenIds.add(model.id);
        }
      }
    }

    // Collect HuggingFace results
    if (hfResults.status === "fulfilled") {
      for (const model of hfResults.value) {
        if (!seenIds.has(model.id)) {
          results.push(model);
          seenIds.add(model.id);
        }
      }
    }

    // Sort by downloads/popularity (if available)
    results.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));

    return results.slice(0, limit);
  }
}
