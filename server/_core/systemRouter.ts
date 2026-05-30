import { z } from "zod";
import { notifyOwner } from "./notification.js";
import { adminProcedure, publicProcedure, router } from "./trpc.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SETTINGS_PATH = join(homedir(), ".omnecor", "settings.json");

// Helper — read settings file, return null if not found
function readSettingsFile(): unknown {
  try {
    if (!existsSync(SETTINGS_PATH)) return null;
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

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

  getSettings: publicProcedure
    .query(() => {
      return readSettingsFile();
    }),

  saveSettings: publicProcedure
    .input(z.object({ settings: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => {
      const dir = join(homedir(), ".omnecor");
      if (!existsSync(dir)) {
        import("fs").then(({ mkdirSync }) => mkdirSync(dir, { recursive: true }));
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(input.settings, null, 2), "utf-8");
      return { saved: true };
    }),

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

  // =========================================================================
  // Docker Management (Sandboxing)
  // =========================================================================

  runInSandbox: adminProcedure
    .input(z.object({ image: z.string(), command: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.services.docker.runInSandbox(input.image, input.command);
    }),

  listContainers: adminProcedure.query(async ({ ctx }) => {
    return await ctx.services.docker.listContainers();
  }),

  stopContainer: adminProcedure
    .input(z.object({ containerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.services.docker.stopContainer(input.containerId);
    }),
});
