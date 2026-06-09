import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";
import { createLogger } from "../_core/logger.js";
const log = createLogger("ollama");

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
  // UI-LOGIC-AUDIT: This feature is not yet accessible from the GUI.
  // SUGGESTION: Add a button or interaction box in the UI to trigger this logic.
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
  searchModels: protectedProcedure
    .input(z.object({
      query: z.string().max(128).default(""),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      // Proxy to ollamadb.dev — a community API for the Ollama model library
      // https://github.com/frefrik/ollama-models-api
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
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Model registry returned ${res.status}`,
        });
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
    }),

  deleteModel: adminProcedure
    .input(z.object({ name: z.string().min(1).max(256) }))
    .mutation(async ({ input }) => {
      // HITL: require manual approval before deleting a model
      const approved = await HITLApprovalService.getInstance().requestApproval("ollama.deleteModel", {
        name: input.name,
        warning: "This will permanently delete the model and its weights from disk.",
      });
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
