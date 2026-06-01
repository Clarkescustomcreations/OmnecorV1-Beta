import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";

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
      }).catch(() => {}); // background — don't await
      return { started: true, name: input.name };
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
