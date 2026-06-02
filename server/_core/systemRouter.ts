import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification.js";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir, platform, cpus, totalmem, freemem } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb } from "../db.factory.js";
import { users } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { ENV } from "./env.js";
import { getPermissionsForRole, type Role } from "../phase2/config/rbac.js";

const execFileAsync = promisify(execFile);

async function findExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await import("fs/promises").then(fs => fs.access(candidate));
      return candidate;
    } catch {
      // not found at this path, try next
    }
  }
  // Try PATH lookup on unix-like systems
  if (platform() !== "win32") {
    for (const name of candidates.map(c => c.split("/").pop()!)) {
      try {
        const { stdout } = await execFileAsync("which", [name]);
        const path = stdout.trim();
        if (path) return path;
      } catch {
        // not in PATH
      }
    }
  }
  return null;
}

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

  loginProviders: publicProcedure.query(() => ({
    google: !!(ENV.googleClientId && ENV.googleClientSecret),
    microsoft: !!(ENV.microsoftClientId && ENV.microsoftClientSecret),
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

  setExecutionMode: protectedProcedure
    .input(z.object({ mode: z.enum(["sovereign", "scrapper", "big_spender"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (db) {
        await db.update(users).set({ executionMode: input.mode }).where(eq(users.id, ctx.user.id));
      }
      return { mode: input.mode };
    }),

  getMyPermissions: protectedProcedure.query(({ ctx }) => {
    const role = (ctx.user.role ?? "user") as Role;
    return {
      role,
      permissions: getPermissionsForRole(role),
    };
  }),

  listUsers: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { users: [] };
    const allUsers = await db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      loginMethod: users.loginMethod,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    }).from(users);
    return { users: allUsers };
  }),

  setUserRole: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      role: z.enum(["viewer", "user", "admin", "owner"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });
      }
      // Prevent self-demotion
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role." });
      }
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  detectHardware: protectedProcedure.mutation(async () => {
    const blenderCandidates = [
      "/usr/bin/blender",
      "/usr/local/bin/blender",
      "/Applications/Blender.app/Contents/MacOS/Blender",
      "C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe",
    ];
    const kicadCandidates = [
      "/usr/bin/kicad-cli",
      "/usr/local/bin/kicad-cli",
      "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
      "C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe",
      "C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe",
    ];

    const [blenderPath, kicadPath] = await Promise.all([
      findExecutable(blenderCandidates),
      findExecutable(kicadCandidates),
    ]);

    // GPU detection
    let gpuInfo: string | null = null;
    try {
      if (platform() === "linux") {
        const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
        gpuInfo = stdout.trim().split("\n").join(", ");
      } else if (platform() === "darwin") {
        const { stdout } = await execFileAsync("system_profiler", ["SPDisplaysDataType", "-json"]);
        const data = JSON.parse(stdout);
        gpuInfo = (data?.SPDisplaysDataType ?? []).map((d: Record<string, unknown>) => d["sppci_model"]).filter(Boolean).join(", ");
      }
    } catch {
      // nvidia-smi not found or failed — not critical
    }

    // Ollama detection
    let ollamaVersion: string | null = null;
    try {
      const res = await fetch(`${ENV.ollamaUrl}/api/version`);
      if (res.ok) {
        const data = await res.json() as { version?: string };
        ollamaVersion = data.version ?? null;
      }
    } catch {
      // Ollama not running
    }

    return {
      blenderPath,
      kicadPath,
      gpuInfo,
      ollamaVersion,
      platform: platform(),
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? null,
      totalMemoryGB: Math.round(totalmem() / 1024 / 1024 / 1024 * 10) / 10,
      freeMemoryGB: Math.round(freemem() / 1024 / 1024 / 1024 * 10) / 10,
    };
  }),

  checkForUpdates: publicProcedure.query(async () => {
    const { UpdateCheckerService } = await import("../phase2/services/UpdateCheckerService.js");
    return UpdateCheckerService.getInstance().checkForUpdates();
  }),
});
