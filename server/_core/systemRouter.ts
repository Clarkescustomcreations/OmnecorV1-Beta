import { z } from "zod";
import { notifyOwner } from "./notification.js";
import { adminProcedure, publicProcedure, router } from "./trpc.js";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      }).optional()
    )
    .query(() => ({
      ok: true,
      cpu: { percent: Math.round(Math.random() * 20 + 5) },
      ollama: { status: "ok" },
      chromadb: { status: "ok" }
    })),

  saveKeys: adminProcedure
    .input(
      z.object({
        keys: z.record(z.string(), z.string())
      })
    )
    .mutation(async ({ input }) => {
      // Stub for saving API keys
      return { success: true };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
