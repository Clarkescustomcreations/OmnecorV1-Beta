import { z } from "zod";
import { router, protectedProcedure, adminProcedure, externalServiceProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";
import { createLogger } from "../_core/logger.js";
const log = createLogger("ollama");

const OLLAMA_FALLBACK_MODELS = [
  {
    id: "llama3.2:3b",
    name: "llama3.2:3b",
    description: "Meta's lightweight 3B instruction-tuned model, optimized for edge devices.",
    tags: ["chat", "general", "lightweight"],
    pulls: 850000,
    variantCount: 3,
    lastUpdated: "2024-09-25T00:00:00Z",
  },
  {
    id: "llama3.1:8b",
    name: "llama3.1:8b",
    description: "Meta's state-of-the-art 8B model with a 128k context window and advanced reasoning.",
    tags: ["chat", "coding", "reasoning"],
    pulls: 1500000,
    variantCount: 4,
    lastUpdated: "2024-07-23T00:00:00Z",
  },
  {
    id: "llama3:8b",
    name: "llama3:8b",
    description: "Meta's popular 8B instruction-tuned model for general tasks.",
    tags: ["chat", "general"],
    pulls: 2300000,
    variantCount: 3,
    lastUpdated: "2024-04-18T00:00:00Z",
  },
  {
    id: "deepseek-r1:8b",
    name: "deepseek-r1:8b",
    description: "DeepSeek's advanced reasoning model using reinforcement learning, matching frontier capabilities.",
    tags: ["reasoning", "coding", "math"],
    pulls: 2100000,
    variantCount: 5,
    lastUpdated: "2025-01-20T00:00:00Z",
  },
  {
    id: "mistral:7b",
    name: "mistral:7b",
    description: "Mistral AI's dense 7B model, high performance and customizable.",
    tags: ["chat", "coding"],
    pulls: 1800000,
    variantCount: 3,
    lastUpdated: "2023-09-27T00:00:00Z",
  },
  {
    id: "gemma2:9b",
    name: "gemma2:9b",
    description: "Google's highly efficient 9B model built on Gemini research.",
    tags: ["chat", "reasoning"],
    pulls: 750000,
    variantCount: 3,
    lastUpdated: "2024-06-27T00:00:00Z",
  },
  {
    id: "gemma2:2b",
    name: "gemma2:2b",
    description: "Google's ultra-lightweight 2B model for high speed and mobile tasks.",
    tags: ["chat", "lightweight"],
    pulls: 600000,
    variantCount: 2,
    lastUpdated: "2024-07-31T00:00:00Z",
  },
  {
    id: "qwen2.5:7b",
    name: "qwen2.5:7b",
    description: "Alibaba's advanced 7B multilingual LLM, strong in coding and mathematics.",
    tags: ["multilingual", "coding", "math"],
    pulls: 900000,
    variantCount: 4,
    lastUpdated: "2024-09-18T00:00:00Z",
  },
  {
    id: "phi3:3.8b",
    name: "phi3:3.8b",
    description: "Microsoft's lightweight 3.8B model, outstanding reasoning for its size.",
    tags: ["chat", "reasoning"],
    pulls: 1100000,
    variantCount: 3,
    lastUpdated: "2024-06-03T00:00:00Z",
  },
  {
    id: "codegemma:7b",
    name: "codegemma:7b",
    description: "Google's coding-specialized 7B model for auto-completion and generation.",
    tags: ["coding", "completion"],
    pulls: 400000,
    variantCount: 2,
    lastUpdated: "2024-04-09T00:00:00Z",
  }
];

const OLLAMA_BASE = () => ENV.ollamaUrl;

async function ollamaFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${OLLAMA_BASE()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Ollama error: ${res.status} ${body}` });
  }
  return res;
}

export const ollamaRouter = router({
  listModels: protectedProcedure.query(async () => {
    const res = await ollamaFetch("/api/tags");
    const data = await res.json() as { models: Array<{ name: string; size: number; digest: string; modified_at: string }> };
    return { models: data.models ?? [] };
  }),
  modelInfo: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(256) }))
    .query(async ({ input }) => {
      const res = await ollamaFetch("/api/show", {
        method: "POST",
        body: JSON.stringify({ name: input.name }),
      });
      return await res.json();
    }),
  pullModel: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      // Fire-and-forget pull — client polls listModels for completion
      fetch(`${OLLAMA_BASE()}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, stream: false }),
      }).catch((err: unknown) => {
        log.error(`[Ollama] Model pull failed for "${input.name}":`, err);
      });
      return { started: true, name: input.name };
    }),
  searchModels: externalServiceProcedure
    .input(z.object({
      query: z.string().max(128).default(""),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams({
          limit: String(input.limit),
          sort_by: "pulls",
          order: "desc",
        });
        if (input.query) params.set("search", input.query);

        const res = await fetch(`https://ollamadb.dev/api/v1/models?${params}`, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          throw new Error(`Model registry returned status ${res.status}`);
        }

        const data = await res.json() as {
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

        return {
          models: (data.data ?? []).map(m => ({
            id: m.model_identifier,
            name: m.model_identifier,
            description: m.description,
            tags: m.labels ?? [],
            pulls: m.pulls ?? 0,
            variantCount: m.tags ?? 0,
            lastUpdated: m.last_updated,
            url: m.url,
          })),
          total: data.total_count ?? 0,
        };
      } catch (err) {
        log.warn("Failed to fetch Ollama marketplace models, falling back to curated local catalog:", err);
        let filtered = OLLAMA_FALLBACK_MODELS;
        if (input.query) {
          const q = input.query.toLowerCase();
          filtered = OLLAMA_FALLBACK_MODELS.filter(
            m => m.id.toLowerCase().includes(q) ||
                 m.name.toLowerCase().includes(q) ||
                 m.description.toLowerCase().includes(q) ||
                 m.tags.some(t => t.toLowerCase().includes(q))
          );
        }
        return {
          models: filtered.slice(0, input.limit),
          total: filtered.length,
        };
      }
    }),

  deleteModel: adminProcedure
    .input(z.object({ name: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      // HITL: require manual approval before deleting a model
      const approved = await HITLApprovalService.getInstance().requestApproval("ollama.deleteModel", {
        name: input.name,
        warning: "This will permanently delete the model and its weights from disk.",
      }, "file");
      if (!approved) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Model deletion rejected by HITL." });
      }
      await ollamaFetch("/api/delete", {
        method: "DELETE",
        body: JSON.stringify({ name: input.name }),
      });
      return { deleted: true, name: input.name };
    }),
  createModelfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(256),
      modelfile: z.string().min(1).max(10000),
    }))
    .mutation(async ({ input }) => {
      await ollamaFetch("/api/create", {
        method: "POST",
        body: JSON.stringify({ name: input.name, modelfile: input.modelfile }),
      });
      return { created: true, name: input.name };
    }),
  runningModels: protectedProcedure.query(async () => {
    const res = await ollamaFetch("/api/ps");
    const data = await res.json() as { models: Array<{ name: string; size: number; expires_at: string }> };
    return { running: data.models ?? [] };
  }),
});
