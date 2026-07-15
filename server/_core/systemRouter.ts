import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification.js";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, createWriteStream, openSync, closeSync } from "fs";
import fsPromises from "fs/promises";
import { join } from "path";
import { homedir, platform, cpus, totalmem, freemem, tmpdir, loadavg } from "os";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as https from "https";
import { getDb, updateUserExecutionMode } from "../db.factory.js";
import { users, mcpServerConfigs } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { ENV } from "./env.js";
import { getPermissionsForRole, type Role } from "../core_services/config/rbac.js";
import { PATHS } from "./paths.js";
import { type OmnecorSettings } from "../core_services/services/SettingsService.js";
import { LocalLlmRuntimeService } from "../core_services/services/LocalLlmRuntimeService.js";
import { resolveOllamaUrl } from "../core_services/services/ollamaUrl.js";

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

// Async version for hot-path mutation procedures
async function readSettingsFileAsync(): Promise<OmnecorSettings | null> {
  try {
    const text = await fsPromises.readFile(SETTINGS_PATH, "utf-8").catch(() => null);
    if (!text) return null;
    return JSON.parse(text) as OmnecorSettings;
  } catch {
    return null;
  }
}

async function writeSettingsFileAsync(settings: OmnecorSettings): Promise<void> {
  await fsPromises.mkdir(join(homedir(), ".omnecor"), { recursive: true });
  await fsPromises.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      }).optional()
    )
    .query(() => {
      const loads = loadavg();
      const numCpus = cpus().length || 1;
      const cpuPercent = Math.min(100, Math.round((loads[0] / numCpus) * 100));
      return {
        ok: true,
        cpu: { percent: cpuPercent },
        ollama: { status: "ok" },
        chromadb: { status: "ok" },
      };
    }),

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
      ollamaUrl: resolveOllamaUrl(),
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

  /**
   * Report which service-connection (System B) integrations have OAuth client
   * credentials configured — booleans only, never the secrets. Also returns the
   * exact callback base URL the operator must register with each provider. This
   * is server-computed because in the packaged desktop app the renderer origin
   * is `app://omnecor` (not a valid http redirect target).
   */
  integrationsStatus: protectedProcedure.query(async () => {
    const { listOAuthPlatforms, isPlatformConfigured, getRedirectUri } = await import(
      "../oauth/oauthClients.js"
    );
    const platforms = listOAuthPlatforms();
    const configured: Record<string, boolean> = {};
    for (const p of platforms) configured[p] = isPlatformConfigured(p);
    // Strip the trailing "/<platform>" to expose just the callback base.
    const callbackBase = getRedirectUri("").replace(/\/$/, "");
    return { platforms, configured, callbackBase };
  }),

  saveSettings: publicProcedure
    .input(z.object({ settings: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      const current = await readSettingsFileAsync() ?? {};
      // `sovereignBlockAiOnly` relaxes Sovereign mode's blocking of non-AI
      // external services, so it must NOT be settable through this
      // unauthenticated endpoint. Strip it here — it is changed only via the
      // admin-only `setSovereignBlockAiOnly` mutation below.
      const { sovereignBlockAiOnly: _guarded, ...safeSettings } = input.settings;
      const updated = { ...current, ...safeSettings } as OmnecorSettings;
      await writeSettingsFileAsync(updated);
      return { saved: true };
    }),

  // Admin-only: toggle whether Sovereign mode blocks ONLY cloud AI calls (true)
  // or all external calls including non-AI services (false). Gated behind
  // adminProcedure because it weakens the air-gap; never exposed via saveSettings.
  setSovereignBlockAiOnly: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const current = await readSettingsFileAsync() ?? {};
      const updated = { ...current, sovereignBlockAiOnly: input.enabled } as OmnecorSettings;
      await writeSettingsFileAsync(updated);
      return { enabled: input.enabled };
    }),

  saveKeys: adminProcedure
    .input(
      z.object({
        keys: z.record(z.string(), z.string())
      })
    )
    .mutation(async ({ input }) => {
      const current = await readSettingsFileAsync() ?? {};
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

      await writeSettingsFileAsync(updated as OmnecorSettings);
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

    // Ollama detection — probe the same endpoint inference resolves (settings > env).
    let ollamaVersion: string | null = null;
    try {
      const res = await fetch(`${resolveOllamaUrl()}/api/version`);
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
    const { UpdateCheckerService } = await import("../core_services/services/UpdateCheckerService.js");
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

  // ---------------------------------------------------------------------------
  // checkDependencies — single aggregate probe for the Launch Checklist step.
  // Returns a boolean per tool. Never throws — every check is individually
  // try/catch'd so one missing tool cannot suppress detection of others.
  // ---------------------------------------------------------------------------
  checkDependencies: protectedProcedure.query(async () => {
    const plt = platform();

    // ── Helper: run a binary with a version flag, resolve true if exit 0 ──
    const canRun = async (bin: string, args: string[]): Promise<boolean> => {
      try {
        await execFileAsync(bin, args, { timeout: 4000 });
        return true;
      } catch {
        return false;
      }
    };

    // ── Helper: HTTP probe with timeout ──
    const httpOk = async (url: string): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
      } catch {
        return false;
      }
    };

    // ── Ollama: ping the same endpoint inference resolves (settings > env) ──
    const ollamaResult = httpOk(`${resolveOllamaUrl()}/api/version`);

    // ── Python 3.10+ ──
    const pythonBin = plt === "win32" ? "python" : "python3";
    const pythonResult = (async () => {
      const found = await canRun(pythonBin, ["-c", "import sys; exit(0 if sys.version_info>=(3,10) else 1)"]);
      if (found) return true;
      // Windows fallback
      return plt === "win32"
        ? canRun("python3", ["-c", "import sys; exit(0 if sys.version_info>=(3,10) else 1)"])
        : false;
    })();

    // ── llama-cpp: the Omnecor-owned managed runtime is the real signal ──
    // (Model-Fabric Phase 1) — it means the llamacpp provider can actually
    // serve a chat request right now, not just that a binary exists somewhere.
    // Fall back to binary/module presence so "installed but not yet started
    // successfully" still shows something other than a flat "unavailable".
    const llamaCppResult = (async () => {
      if (LocalLlmRuntimeService.getInstance().isReady()) return true;
      const hasBinary = await canRun("llama-server", ["--version"]).catch(() => false)
        || await canRun("llama-cpp", ["--version"]).catch(() => false);
      if (hasBinary) return true;
      const pyBin = plt === "win32" ? "python" : "python3";
      return canRun(pyBin, ["-c", "import llama_cpp"]);
    })();

    // ── Blender ──
    const blenderResult = findExecutable([
      ...(process.env.BLENDER_BIN ? [process.env.BLENDER_BIN] : []),
      "/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender",
      "/Applications/Blender.app/Contents/MacOS/Blender",
      "C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
    ]).then(p => p !== null);

    // ── KiCad CLI ──
    const kicadResult = findExecutable([
      ...(process.env.KICAD_CLI_PATH ? [process.env.KICAD_CLI_PATH] : []),
      "/usr/bin/kicad-cli", "/usr/local/bin/kicad-cli",
      "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
      "C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe",
      "C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe",
    ]).then(p => p !== null);

    // ── Whisper STT server (Python bridge port 8001) ──
    const whisperResult = httpOk("http://localhost:8001/health");

    // ── TTS server / XTTS-v2 (Python bridge port 8002) ──
    const ttsResult = httpOk("http://localhost:8002/health");

    // ── ComfyUI (port 8188) ──
    const comfyResult = httpOk("http://localhost:8188/system_stats");

    // ── esptool ──
    const esptoolResult = findExecutable([
      "esptool", "esptool.py",
      "/usr/local/bin/esptool", "/usr/local/bin/esptool.py",
      "C:\\Python312\\Scripts\\esptool.exe",
      "C:\\Python311\\Scripts\\esptool.exe",
      "C:\\Python310\\Scripts\\esptool.exe",
    ]).then(p => p !== null);

    // ── arduino-cli ──
    const arduinoCliResult = findExecutable([
      "arduino-cli",
      "/usr/local/bin/arduino-cli",
      "/usr/bin/arduino-cli",
      "C:\\Program Files\\arduino-cli\\arduino-cli.exe",
    ]).then(p => p !== null);

    // ── Codebase Memory MCP ──
    const cbmMcpResult = findExecutable([
      homedir() + "/.local/bin/codebase-memory-mcp",
      "codebase-memory-mcp",
    ]).then(p => p !== null);

    // ── Valet Router ──
    const valetRouterResult = fsPromises.access(join(PATHS.valetRouter, "current.json")).then(() => true).catch(() => false);

    // Resolve all in parallel
    const [
      ollama, python, llamaCpp, blender, kicad,
      whisper, tts, comfyui, esptool, cbmMcp, valetRouter, arduinoCli
    ] = await Promise.all([
      ollamaResult, pythonResult, llamaCppResult, blenderResult, kicadResult,
      whisperResult, ttsResult, comfyResult, esptoolResult, cbmMcpResult, valetRouterResult, arduinoCliResult
    ]);

    return { ollama, python, llamaCpp, blender, kicad, whisper, tts, comfyui, esptool, cbmMcp, valetRouter, arduinoCli };
  }),

  // ---------------------------------------------------------------------------
  // installOllama — download and silently run the official Ollama installer.
  // Windows/Linux: fetch binary to tmpdir, run with execFile (no shell string).
  // macOS: spawn `open` with the download URL (pkg installer needs user GUI).
  // ---------------------------------------------------------------------------
  installOllama: adminProcedure.mutation(async () => {
    const plt = platform();

    // ── macOS: open download page — pkg needs user-facing GUI ──
    if (plt === "darwin") {
      const opener = spawn("open", ["https://ollama.com/download/mac"], {
        detached: true,
        stdio: "ignore",
      });
      opener.unref();
      return { success: true, message: "Opening Ollama download page in your browser." };
    }

    // ── Helper: download a URL to a local tmp file ──
    // Follows every 3xx redirect carrying a Location header — ollama.com now
    // serves 307s to GitHub releases, which 302 to the CDN (live-verified
    // 2026-07-03; the old 301/302-only check broke both Linux and Windows).
    // Redirects are capped and pinned to https so a hop can't loop or
    // downgrade the transport.
    const downloadToFile = (url: string, dest: string, maxRedirects = 10): Promise<void> =>
      new Promise((resolve, reject) => {
        const file = createWriteStream(dest);
        let redirects = 0;
        const request = (requestUrl: string) => {
          https.get(requestUrl, (res) => {
            const location = res.headers.location;
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
              res.resume(); // discard redirect body so the socket is freed
              if (++redirects > maxRedirects) {
                reject(new Error("Download failed: too many redirects"));
                return;
              }
              const next = new URL(location, requestUrl);
              if (next.protocol !== "https:") {
                reject(new Error(`Download failed: insecure redirect to ${next.protocol}//`));
                return;
              }
              return request(next.toString());
            }
            if (res.statusCode !== 200) {
              reject(new Error(`Download failed: HTTP ${res.statusCode ?? "unknown"}`));
              return;
            }
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve()));
          }).on("error", reject);
        };
        request(url);
        file.on("error", (err) => { try { unlinkSync(dest); } catch {} reject(err); });
      });

    if (plt === "win32") {
      const dest = join(tmpdir(), "OllamaSetup.exe");
      try {
        await downloadToFile("https://ollama.com/download/OllamaSetup.exe", dest);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Ollama download failed: ${(err as Error).message}. Try https://ollama.com manually.`,
        });
      }
      // Run the installer via spawn — spawn supports detached, execFile does not
      // /S is the Ollama silent-install flag; arg passed as array (no shell string)
      const proc = spawn(dest, ["/S"], { detached: true, stdio: "ignore" });
      proc.on("error", (err) => console.warn("[installOllama] Installer error:", err));
      proc.unref();
      return { success: true, message: "Ollama installer launched. It will install in the background." };
    }

    // ── Linux: download official install script, run with sh ──
    // Pre-flight: install.sh needs root. Detached with no tty, sudo cannot
    // prompt for a password, so a non-root server without passwordless sudo
    // would die silently while the UI reports success. Fail loudly instead.
    if (typeof process.getuid === "function" && process.getuid() !== 0) {
      const sudoOk = await execFileAsync("sudo", ["-n", "true"]).then(() => true).catch(() => false);
      if (!sudoOk) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Installing Ollama needs root privileges and passwordless sudo is not available to the Omnecor server. " +
            "Run `curl -fsSL https://ollama.com/install.sh | sh` in a terminal (it can prompt for your password), then click Re-check.",
        });
      }
    }

    // Pre-flight: the current install.sh aborts with a `zstd` requirement (it
    // ships zstd-compressed release tarballs). Missing, the detached installer
    // dies leaving only a log line, so the UI would report "install started"
    // then show Ollama still absent on Re-check. Check up front and surface the
    // exact package to install (mirrors the message the installer itself emits).
    const hasZstd = await findExecutable(["/usr/bin/zstd", "/usr/local/bin/zstd", "zstd"]);
    if (!hasZstd) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Ollama's installer requires `zstd` (for release-archive extraction) and it isn't installed. " +
          "Install it first — Debian/Ubuntu: `sudo apt-get install zstd`; Fedora/RHEL: `sudo dnf install zstd`; " +
          "Arch: `sudo pacman -S zstd` — then click Re-check.",
      });
    }

    const dest = join(tmpdir(), "ollama-install.sh");
    try {
      await downloadToFile("https://ollama.com/install.sh", dest);
    } catch (err) {
      // Throw (like the Windows branch) — SetupWizard's onSuccess toasts any
      // resolved mutation as green, so a resolved {success:false} would render
      // the failure as a success toast.
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Ollama download failed: ${(err as Error).message}. Try https://ollama.com manually.`,
      });
    }
    // sh with the script path as a discrete argument — no shell string interpolation
    // spawn supports detached; execFile does not when combined with a callback.
    // Installer output goes to a log file so background failures are diagnosable.
    const logPath = join(tmpdir(), "ollama-install.log");
    const logFd = openSync(logPath, "w");
    const proc = spawn("sh", [dest], { detached: true, stdio: ["ignore", logFd, logFd] });
    closeSync(logFd);
    proc.on("error", (err) => console.warn("[installOllama] Installer error:", err));
    proc.on("exit", (code) => {
      if (code === 0) console.log("[installOllama] Ollama installed successfully.");
      else console.warn(`[installOllama] Installer exited with code ${code} — see ${logPath}`);
    });
    proc.unref();

    return { success: true, message: `Ollama installation started in the background (log: ${logPath}).` };
  }),

  // ---------------------------------------------------------------------------
  // fetchValetModel — run scripts/fetch-valet-model.sh to download the Valet
  // Router model for local development.
  // ---------------------------------------------------------------------------
  fetchValetModel: adminProcedure.mutation(async () => {
    const scriptPath = join(process.cwd(), "scripts", "fetch-valet-model.sh");
    const proc = spawn("bash", [scriptPath], { detached: true, stdio: "ignore" });
    proc.unref();
    return { success: true, message: "Downloading Valet Router in the background. Check server logs for progress." };
  }),

  // ── Codebase Memory MCP Installer ──
  // adminProcedure: this pipes a remote install script into a shell, so it must
  // never be reachable unauthenticated (cf. fetchValetModel / installOllama).
  installCodebaseMemoryMCP: adminProcedure.mutation(async () => {
    const proc = spawn(
      "bash",
      ["-c", "curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --ui"],
      { detached: true, stdio: "ignore" },
    );
    proc.on("error", (err) =>
      console.warn("[installCodebaseMemoryMCP] Installer error:", err),
    );
    proc.unref();

    // Also register it in Omnecor's MCP registry. Awaited so an insert failure
    // is surfaced in logs rather than swallowed in a detached promise.
    try {
      const db = await getDb();
      await db
        .insert(mcpServerConfigs)
        .values({
          id: "codebase-memory-mcp",
          name: "Codebase Memory MCP",
          transport: "stdio",
          command: homedir() + "/.local/bin/codebase-memory-mcp",
          args: [],
        })
        .onConflictDoNothing();
    } catch (err) {
      console.warn("[installCodebaseMemoryMCP] Failed to register MCP server:", err);
    }

    return { success: true, message: "Codebase Memory MCP installation started." };
  }),
});
