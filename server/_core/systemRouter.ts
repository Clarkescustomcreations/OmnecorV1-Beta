import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification.js";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir, platform, cpus, totalmem, freemem } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDb, updateUserExecutionMode } from "../db.factory.js";
import { users } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { ENV } from "./env.js";
import { getPermissionsForRole, type Role } from "../phase2/config/rbac.js";
import { PATHS } from "./paths.js";
import { type OmnecorSettings } from "../phase2/services/SettingsService.js";

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

const SETTINGS_PATH = join(PATHS.base, "settings.json");

// Helper — read settings file, return null if not found
function readSettingsFile(): OmnecorSettings | null {
  try {
    if (!existsSync(SETTINGS_PATH)) return null;
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as OmnecorSettings;
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

  loginProviders: publicProcedure.query(() => {
    const settings = readSettingsFile() || {};
    return {
      google: !!(ENV.googleClientId && ENV.googleClientSecret) || !!(settings.googleClientId && settings.googleClientSecret),
      microsoft: !!(ENV.microsoftClientId && ENV.microsoftClientSecret) || !!(settings.microsoftClientId && settings.microsoftClientSecret),
    };
  }),

  aiProviders: publicProcedure.query(() => {
    const settings = readSettingsFile() || {};
    return {
      openai: !!ENV.openaiApiKey || !!settings.openaiApiKey,
      anthropic: !!ENV.anthropicApiKey || !!settings.anthropicApiKey,
      gemini: !!ENV.geminiApiKey || !!settings.geminiApiKey,
      grok: !!ENV.xaiApiKey || !!settings.xaiApiKey,
      huggingface: !!ENV.huggingfaceApiKey || !!settings.huggingfaceApiKey,
      elevenlabs: !!ENV.elevenLabsApiKey || !!settings.elevenLabsApiKey,
      falai: !!ENV.falaiApiKey || !!settings.falaiApiKey,
      forge: !!ENV.forgeApiKey || !!settings.forgeApiKey,
      ollamaUrl: settings.OLLAMA_BASE_URL || ENV.ollamaUrl || "http://localhost:11434",
      n8nUrl: settings.n8nUrl || ENV.n8nUrl || "http://localhost:5678",
      comfyUrl: settings.comfyUrl || "",
    };
  }),

  getSettings: publicProcedure
    .query(() => {
      return readSettingsFile();
    }),

  /**
   * Report which social-login providers are configured (booleans only — never
   * returns the secrets). Drives the Settings → Social Login UI badges.
   */
  oauthStatus: publicProcedure.query(() => {
    const s = (readSettingsFile() as Record<string, string>) || {};
    return {
      google: !!(s.googleClientId || process.env.GOOGLE_CLIENT_ID),
      microsoft: !!(s.microsoftClientId || process.env.MICROSOFT_CLIENT_ID),
    };
  }),

  saveSettings: publicProcedure
    .input(z.object({ settings: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => {
      const current = readSettingsFile() || {};
      const updated = { ...current, ...input.settings };
      const dir = join(homedir(), ".omnecor");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), "utf-8");
      return { saved: true };
    }),

  saveKeys: adminProcedure
    .input(
      z.object({
        keys: z.record(z.string(), z.string())
      })
    )
    .mutation(async ({ input }) => {
      const current = readSettingsFile() || {};
      // Map frontend key names to internal setting names if necessary
      const keyMap: Record<string, string> = {
        openai: "openaiApiKey",
        OPENAI_API_KEY: "openaiApiKey",
        openaiApiKey: "openaiApiKey",

        anthropic: "anthropicApiKey",
        ANTHROPIC_API_KEY: "anthropicApiKey",
        anthropicApiKey: "anthropicApiKey",

        gemini: "geminiApiKey",
        GEMINI_API_KEY: "geminiApiKey",
        geminiApiKey: "geminiApiKey",

        grok: "xaiApiKey",
        GROK_API_KEY: "xaiApiKey",
        xaiApiKey: "xaiApiKey",

        huggingface: "huggingfaceApiKey",
        HUGGINGFACE_API_KEY: "huggingfaceApiKey",
        huggingfaceApiKey: "huggingfaceApiKey",

        elevenlabs: "elevenLabsApiKey",
        ELEVENLABS_API_KEY: "elevenLabsApiKey",
        elevenLabsApiKey: "elevenLabsApiKey",

        falai: "falaiApiKey",
        FAL_API_KEY: "falaiApiKey",
        falaiApiKey: "falaiApiKey",

        forge: "forgeApiKey",
        FORGE_API_KEY: "forgeApiKey",
        forgeApiKey: "forgeApiKey",

        OLLAMA_BASE_URL: "OLLAMA_BASE_URL",
        ollamaUrl: "OLLAMA_BASE_URL",

        n8nUrl: "n8nUrl",
        comfyUrl: "comfyUrl",

        googleClientId: "googleClientId",
        googleClientSecret: "googleClientSecret",
        microsoftClientId: "microsoftClientId",
        microsoftClientSecret: "microsoftClientSecret",
      };

      const updated = { ...current };
      for (const [k, v] of Object.entries(input.keys)) {
        const target = keyMap[k] || k;
        if (v) updated[target] = v;
      }

      const dir = join(homedir(), ".omnecor");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), "utf-8");
      return { success: true };
    }),

  applyOptimizations: adminProcedure
    .mutation(async () => {
      const settings = readSettingsFile() || {};
      if (platform() !== "linux") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workstation optimizations are currently only supported on Linux." });
      }

      const results: string[] = [];

      // ZRAM Setup
      if (settings.zramEnabled) {
        try {
          // Coerce to a bounded integer so it can never carry shell metacharacters.
          const sizeGB = Math.min(
            1024,
            Math.max(1, Math.floor(Number(settings.zramSizeGB) || 4)),
          );
          // Attempt to initialize zram device (requires root/sudo, usually handled by workstation-setup script).
          // execFile runs without a shell and each argument is passed discretely — no injection surface.
          await execFileAsync("sudo", ["modprobe", "zram"]);
          await execFileAsync("sudo", [
            "zramctl",
            "--find",
            "--size",
            `${sizeGB}G`,
            "--algorithm",
            "zstd",
          ]);
          results.push(`Initialized ${sizeGB}GB ZRAM device.`);
        } catch (e) {
          console.warn("[SystemRouter] ZRAM activation failed (likely missing sudo permissions):", e);
          results.push("ZRAM activation failed: Permission denied or module missing.");
        }
      }

      return { success: true, results };
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
      await updateUserExecutionMode(ctx.user.id, input.mode);
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
      // Prevent self-demotion
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change your own role." });
      }
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  detectHardware: protectedProcedure.mutation(async () => {
    const blenderCandidates = [
      ...(process.env.BLENDER_BIN ? [process.env.BLENDER_BIN] : []),
      "/usr/bin/blender",
      "/usr/local/bin/blender",
      "/snap/bin/blender",
      "/Applications/Blender.app/Contents/MacOS/Blender",
      "C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe",
    ];
    // KICAD_CLI_PATH is the canonical env var (also used by KiCadService.ts)
    const kicadCandidates = [
      ...(process.env.KICAD_CLI_PATH ? [process.env.KICAD_CLI_PATH] : []),
      "/usr/bin/kicad-cli",
      "/usr/local/bin/kicad-cli",
      "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
      "C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe",
      "C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe",
      "C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe",
    ];
    const esptoolCandidates = [
      "esptool",
      "esptool.py",
      "/usr/local/bin/esptool",
      "/usr/local/bin/esptool.py",
      "C:\\Python312\\Scripts\\esptool.exe",
      "C:\\Python311\\Scripts\\esptool.exe",
      "C:\\Python310\\Scripts\\esptool.exe",
    ];

    const [blenderPath, kicadPath, esptoolPath] = await Promise.all([
      findExecutable(blenderCandidates),
      findExecutable(kicadCandidates),
      findExecutable(esptoolCandidates),
    ]);

    // GPU detection — each platform branch is in its own try/catch so a failure
    // on one platform never suppresses detection on another.
    let gpuInfo: string | null = null;
    if (platform() === "linux") {
      try {
        const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
        // Filter blank lines so empty stdout → null, not ""
        const names = stdout.trim().split("\n").map(s => s.trim()).filter(Boolean);
        gpuInfo = names.length > 0 ? names.join(", ") : null;
      } catch {
        // nvidia-smi absent — not an error
      }
    } else if (platform() === "darwin") {
      try {
        const { stdout } = await execFileAsync("system_profiler", ["SPDisplaysDataType", "-json"]);
        const data = JSON.parse(stdout) as { SPDisplaysDataType?: Array<Record<string, unknown>> };
        const names = (data?.SPDisplaysDataType ?? [])
          .map(d => d["sppci_model"])
          .filter((v): v is string => typeof v === "string" && v.length > 0);
        gpuInfo = names.length > 0 ? names.join(", ") : null;
      } catch {
        // system_profiler absent or JSON parse failed — not critical
      }
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
      esptoolPath,
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

  openTerminal: protectedProcedure
    .input(z.object({
      rootDir: z.string(),
      prompt: z.string().optional(),
      providerId: z.string().optional(),
      modelId: z.string().optional(),
      sessionId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (platform() === "win32") {
        return { wslPrompt: true };
      }

      // Write the prompt to data/cli_prompt.json
      const dataDir = PATHS.data;
      writeFileSync(
        join(dataDir, "cli_prompt.json"),
        JSON.stringify({
          prompt: input.prompt ?? "",
          providerId: input.providerId ?? "",
          modelId: input.modelId ?? "",
          sessionId: input.sessionId ?? "",
        }, null, 2)
      );

      // Search for terminal emulator
      const terminalCandidates = [
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "kitty",
        "alacritty",
        "xterm",
      ];
      const found = await findExecutable(terminalCandidates);
      if (found) {
        const scriptPath = join(process.cwd(), "scripts", "omnecor-cli.js");
        const shellCmd = `OMNECOR_DATA_DIR='${dataDir}' node '${scriptPath}'; exec bash`;
        // rootDir is passed as an argument array — never embedded in a shell string
        if (found.endsWith("gnome-terminal")) {
          execFile(found, ["--working-directory", input.rootDir, "--", "bash", "-c", shellCmd], (err) => {
            if (err) console.error("[openTerminal] Failed to spawn terminal:", err);
          });
        } else if (found.endsWith("konsole")) {
          execFile(found, ["--workdir", input.rootDir, "-e", "bash", "-c", shellCmd], (err) => {
            if (err) console.error("[openTerminal] Failed to spawn terminal:", err);
          });
        } else if (found.endsWith("xfce4-terminal")) {
          execFile(found, ["--working-directory", input.rootDir, "-x", "bash", "-c", shellCmd], (err) => {
            if (err) console.error("[openTerminal] Failed to spawn terminal:", err);
          });
        } else {
          // xterm/kitty/alacritty fallback — rootDir passed via env var, never in shell string
          execFile(found, ["-e", "bash", "-c", `cd "$OMNECOR_ROOT_DIR" && ${shellCmd}`], {
            env: { ...process.env, OMNECOR_ROOT_DIR: input.rootDir },
          }, (err) => {
            if (err) console.error("[openTerminal] Failed to spawn terminal:", err);
          });
        }
        return { success: true };
      } else {
        throw new Error("No terminal emulator found. Please open terminal in the project directory manually and run: node scripts/omnecor-cli.js");
      }
    }),

  getPendingCliOutput: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const dataDir = PATHS.data;
      const outputPath = join(dataDir, "cli_output.json");
      if (existsSync(outputPath)) {
        try {
          const content = readFileSync(outputPath, "utf8");
          const data = JSON.parse(content);
          if (data.sessionId === input.sessionId && data.output) {
            // Clear the file after it is read
            try { writeFileSync(outputPath, "{}"); } catch {}
            return { output: data.output };
          }
        } catch (err) {
          console.error("Error reading cli_output.json:", err);
        }
      }
      return { output: null };
    }),

  clearPendingCliOutput: protectedProcedure
    .mutation(async () => {
      const dataDir = PATHS.data;
      const outputPath = join(dataDir, "cli_output.json");
      if (existsSync(outputPath)) {
        try { writeFileSync(outputPath, "{}"); } catch {}
      }
      return { success: true };
    }),
});
