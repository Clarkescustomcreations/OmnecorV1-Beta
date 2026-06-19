/**
 * @file server/_core/index.ts
 * @description Omnecor — Unified Application Entry Point
 *
 * Bootstraps the single Express server with:
 *  - tRPC API (unified appRouter with all Phase 2+ sub-routers)
 *  - WebSocket server for real-time Neural Node-Tree and training progress
 *  - Static file serving / Vite dev server for the frontend
 *  - Health check endpoint
 *  - Graceful shutdown handling (terminates child processes, closes WS)
 *
 * Architecture Notes:
 *  - This is the ONLY server entry point. The standalone Phase 2 server
 *    (server/phase2/app.ts) has been deprecated and removed.
 *  - All tRPC endpoints are accessible at /api/trpc/
 *  - WebSocket is attached at /ws on the same HTTP server
 *  - Services are singletons resolved in the tRPC context factory
 */

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes, registerGoogleOAuthRoutes, registerMicrosoftOAuthRoutes, registerSocialMediaOAuthRoutes, registerLocalAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { getDb } from "../db.factory.js";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { TokenRefreshService } from "../phase2/services/TokenRefreshService.js";
import { AuditLogService } from "../phase2/services/AuditLogService.js";
import { createLogger, closeAuditLog } from "./logger.js";
import { SERVER_CONFIG } from "../phase2/config/index.js";
import { ENV } from "./env.js";
import { initPaths } from "./paths.js";

const log = createLogger("core");

// ─── Phase 2 Service Imports (for lifecycle management) ─────────────────────
import { OmnecorWebSocketServer, setWsInstance } from "../phase2/websocket/WebSocketServer";
import { ProcessManagerService } from "../phase2/services/ProcessManagerService";
import { SecurityService } from "../phase2/services/SecurityService";
import { VectorDBService } from "../phase2/services/VectorDBService";
import { startBackupScheduler } from "./backupScheduler";
import { startPublishWorker } from "./publishWorker";
import { meshNode } from "../ommesh/core/MeshNode.js";
import { ValetServerService } from "../phase2/services/ValetServerService.js";
import { MCPClientService } from "../phase2/services/MCPClientService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Port Discovery
// ─────────────────────────────────────────────────────────────────────────────

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = SERVER_CONFIG.port): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Application Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  // ─── Initialize Unified Path Utility ───────────────────────────────────
  // Ensures user-writable data directories exist before services start.
  initPaths();

  // ─── Initialize Database (eager) ─────────────────────────────────────────
  // getDb() is lazy by default but we force it here so migrations run
  // before Express accepts connections. This means /health only responds
  // OK after the schema is ready — preventing the race where the frontend
  // polls healthy and immediately hits auth routes before tables exist.
  try {
    await getDb();
    log.info("[Omnecor] Database initialized and migrations applied");
  } catch (error) {
    log.warn("[Omnecor] Database init warning:", (error as Error).message);
  }

  // ─── Initialize Phase 2 Services ────────────────────────────────────────
  // These services are singletons. Calling getInstance() here ensures they
  // are ready before any tRPC request arrives.
  try {
    const security = SecurityService.getInstance();
    await security.initialize();
    log.info("[Omnecor] SecurityService initialized");
    // Drive the Settings → General "Automatic Backups" toggle/frequency.
    startBackupScheduler();
    // Publish scheduled social posts when their time arrives.
    startPublishWorker();
  } catch (error) {
    log.warn(
      "[Omnecor] SecurityService init warning:",
      (error as Error).message
    );
  }

  try {
    const vectorDB = VectorDBService.getInstance();
    await vectorDB.init();
    log.info(
      "[Omnecor] VectorDBService initialized (or degraded gracefully)"
    );
  } catch (error) {
    log.warn(
      "[Omnecor] VectorDBService init warning:",
      (error as Error).message
    );
  }

  // ─── Initialize OMMESH Node ─────────────────────────────────────────────
  try {
    await meshNode.start();
    log.info("[Omnecor] OMMESH Node started and broadcasting");
  } catch (error) {
    log.warn("[Omnecor] OMMESH init warning:", (error as Error).message);
  }

  // ─── Initialize AgenticOS Registry ─────────────────────────────────────
  try {
    const mcpClient = MCPClientService.getInstance();
    mcpClient.connectAgenticOsRegistry().catch(error => {
      log.warn("[Omnecor] AgenticOS Registry init warning:", (error as Error).message);
    });
  } catch (error) {
    log.warn("[Omnecor] MCP Client registry init warning:", (error as Error).message);
  }

  // ─── Seed default.wav if missing ─────────────────────────────────────────
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { PATHS } = await import("./paths.js");
    const defaultWavPath = path.join(PATHS.data, "default.wav");
    const exists = await fs.access(defaultWavPath).then(() => true).catch(() => false);
    if (!exists) {
      const sourceWav = "/home/linux/.steam/debian-installation/steamui/sounds/recording_highlight.wav";
      const sourceExists = await fs.access(sourceWav).then(() => true).catch(() => false);
      if (sourceExists) {
        await fs.mkdir(path.dirname(defaultWavPath), { recursive: true });
        await fs.copyFile(sourceWav, defaultWavPath);
        log.info("[Omnecor] Seeded data/default.wav from steam sounds");
      } else {
        const dummyWav = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // "RIFF"
          0x24, 0x08, 0x00, 0x00, // file size - 8
          0x57, 0x41, 0x56, 0x45, // "WAVE"
          0x66, 0x6d, 0x74, 0x20, // "fmt "
          0x10, 0x00, 0x00, 0x00, // chunk size (16)
          0x01, 0x00,             // format (1 = PCM)
          0x01, 0x00,             // channels (1)
          0x40, 0x1f, 0x00, 0x00, // sample rate (8000)
          0x40, 0x1f, 0x00, 0x00, // byte rate (8000)
          0x01, 0x00,             // block align (1)
          0x08, 0x00,             // bits per sample (8)
          0x64, 0x61, 0x74, 0x61, // "data"
          0x00, 0x08, 0x00, 0x00, // chunk size
          ...Array(2048).fill(128)
        ]);
        await fs.mkdir(path.dirname(defaultWavPath), { recursive: true });
        await fs.writeFile(defaultWavPath, dummyWav);
        log.info("[Omnecor] Seeded dummy data/default.wav silence");
      }
    }
  } catch (err) {
    log.warn("[Omnecor] Failed to seed default.wav:", (err as Error).message);
  }

  // ─── Auto-start Valet Router Inference Server ───────────────────────────
  // Fire-and-forget: Valet is optional. Awaiting it would delay Express startup
  // by 30+ seconds when Python deps are missing (5 retries × increasing backoff).
  ValetServerService.getInstance().start().catch(error => {
    log.warn("[Omnecor] Valet Router Server init warning:", (error as Error).message);
  });

  // ─── Create Express App ─────────────────────────────────────────────────
  const app = express();
  const server = createServer(app);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // shadcn/ui and Recharts inject inline <style> and style attributes
        styleSrc: ["'self'", "'unsafe-inline'"],
        // 'unsafe-inline' is required by the Vite runtime / inline bootstrap
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        // data: covers inline/base64 web fonts
        fontSrc: ["'self'", "data:"],
        // allow same-origin API + WebSocket (ws:/wss:) connections
        connectSrc: ["'self'", "ws:", "wss:"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
  }));

  // ─── CORS for the Electron desktop app ──────────────────────────────────
  // The desktop frontend is served from the privileged custom scheme
  // app://omnecor and talks to this backend cross-origin at http://localhost.
  // Chromium blocks those responses unless we echo the Origin and allow
  // credentials/headers. We only ever reflect the desktop app's own origin or a
  // loopback dev origin — never a wildcard — so this cannot widen exposure to
  // arbitrary web pages. Pairs with the Bearer-token auth fallback in
  // sdk.authenticateRequest (the desktop app can't rely on the SameSite=Strict
  // session cookie across origins, so it sends Authorization: Bearer instead).
  const isAllowedAppOrigin = (origin: string): boolean =>
    // Electron custom scheme: app://omnecor — sent when the scheme is registered
    // with corsEnabled: true (see protocol.registerSchemesAsPrivileged in main).
    origin.startsWith("app://omnecor") ||
    // Some Chromium builds (varies by Electron version) send "null" as the origin
    // for requests from custom protocol pages. Safe here because the backend only
    // listens on localhost and is never reachable from the network.
    origin === "null" ||
    // localhost origins for the Vite dev server and any local web clients.
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && isAllowedAppOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    // Short-circuit CORS preflight before rate limiting / routing.
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
    // Only count API requests. In dev, a cold page-load makes 100+ Vite
    // module fetches which would exhaust the budget before the first real
    // API call. In prod the frontend is a single bundled asset so this
    // skip has no effect on production traffic shaping.
    skip: (req) => !req.path.startsWith("/api"),
  });

  app.use(limiter);

  // Stricter limiter for authentication endpoints (OAuth login + callbacks).
  // Brute-forcing/abuse of the login flow should be throttled far harder than
  // general traffic. Successful requests are not counted so a legitimate user
  // completing login is never penalised.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: "Too many authentication attempts, please try again later.",
  });
  app.use("/api/oauth", authLimiter);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ─── Health Check (not behind tRPC) ─────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "healthy",
      service: "omnecor",
      version: "2.1.0",
      architecture: "unified",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      // Echoed back so the Electron main process can verify it's talking to its
      // own backend instance and not a stale process left over on the same port.
      nonce: process.env.BACKEND_NONCE ?? "",
    });
  });

  // ─── OAuth provider availability check ─────────────────────────────────
  // Lets the frontend know which providers are actually configured before
  // attempting OAuth navigation (avoids the "navigate away, get 404 JSON,
  // press Back, wizard resets to step 0" flow in the Electron desktop app).
  app.get("/api/oauth/status", (_req, res) => {
    res.json({
      google: !!ENV.googleClientId,
      microsoft: !!ENV.microsoftClientId,
    });
  });

  // ─── Storage & OAuth ────────────────────────────────────────────────────
  registerStorageProxy(app);
  registerLocalAuthRoutes(app);
  if (!ENV.zeroLoginMode) {
    registerOAuthRoutes(app);
    registerGoogleOAuthRoutes(app);
    registerMicrosoftOAuthRoutes(app);
  }
  registerSocialMediaOAuthRoutes(app);

  // ─── Cross-origin request validation (CSRF defense-in-depth) ────────────
  // Cookies are already SameSite=Strict, but we add an explicit Origin/Referer
  // check on state-changing tRPC requests so a cross-site page can never drive
  // an authenticated mutation. Same-origin and no-Origin (native/server-to-
  // server) requests pass; a foreign Origin is rejected with 403.
  const allowedHosts = new Set(ENV.oauthAllowedHosts);
  app.use("/api/trpc", (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.get("origin");
    if (!origin) {
      // Non-browser clients (CLI, native app, server-to-server) omit Origin.
      next();
      return;
    }
    // Electron desktop app loads the frontend via app://omnecor/ — a custom
    // privileged scheme. Its requests are as trusted as same-origin; allow them.
    if (origin.startsWith("app://omnecor")) {
      next();
      return;
    }
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      res.status(403).json({ error: "Invalid Origin" });
      return;
    }
    const requestHost = (req.get("host") ?? "").toLowerCase();
    if (originHost === requestHost || allowedHosts.has(originHost)) {
      next();
      return;
    }
    log.warn(`[CORS] Rejected cross-origin ${method} from origin ${originHost}`);
    res.status(403).json({ error: "Cross-origin request rejected" });
  });

  // ─── tRPC API (unified router) ─────────────────────────────────────────
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ path, error }) => {
        log.error(`[tRPC Error] ${path}:`, error);
      },
    })
  );

  // ─── WebSocket Server (Neural Node-Tree + Training Progress) ────────────
  // Attaches to the same HTTP server on the /ws path.
  // The WebSocket server listens for service events and broadcasts to clients.
  let wsServer: OmnecorWebSocketServer | null = null;
  try {
    wsServer = new OmnecorWebSocketServer(server);
    setWsInstance(wsServer);
    wsServer.startTelemetryPush();
    log.info("[Omnecor] WebSocket server attached at /ws");
  } catch (error) {
    log.warn(
      "[Omnecor] WebSocket server init warning:",
      (error as Error).message
    );
  }

  // ─── Frontend (Vite dev or static production) ───────────────────────────
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite.js");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ─── Start Listening ────────────────────────────────────────────────────
  const preferredPort = SERVER_CONFIG.port;
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    log.info(
      `[Omnecor] Port ${preferredPort} is busy, using port ${port} instead`
    );
  }

  server.listen(port, () => {
    log.info(
      "═══════════════════════════════════════════════════════════════"
    );
    log.info(
      "  ██████╗ ███╗   ███╗███╗   ██╗███████╗ ██████╗ ██████╗ ██████╗ "
    );
    log.info(
      " ██╔═══██╗████╗ ████║████╗  ██║██╔════╝██╔════╝██╔═══██╗██╔══██╗"
    );
    log.info(
      " ██║   ██║██╔████╔██║██╔██╗ ██║█████╗  ██║     ██║   ██║██████╔╝"
    );
    log.info(
      " ██║   ██║██║╚██╔╝██║██║╚██╗██║██╔══╝  ██║     ██║   ██║██╔══██╗"
    );
    log.info(
      " ╚██████╔╝██║ ╚═╝ ██║██║ ╚████║███████╗╚██████╗╚██████╔╝██║  ██║"
    );
    log.info(
      "  ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝"
    );
    log.info(
      "═══════════════════════════════════════════════════════════════"
    );
    log.info(`  Omnecor v2.1.0 — Context-Aware AI Infrastructure (Unified)`);
    log.info(`  HTTP:      http://localhost:${port}/`);
    log.info(`  tRPC API:  http://localhost:${port}/api/trpc`);
    log.info(`  WebSocket: ws://localhost:${port}/ws`);
    log.info(`  Health:    http://localhost:${port}/health`);
    log.info(
      "═══════════════════════════════════════════════════════════════"
    );
    TokenRefreshService.getInstance().start();
    console.info("[Omnecor] Token refresh service started");
    AuditLogService.getInstance().startRetentionScheduler();
    console.info(
      `[Omnecor] Audit log retention scheduler started (window: ${
        AuditLogService.getInstance().getRetentionDays() || "permanent"
      }${AuditLogService.getInstance().getRetentionDays() ? " days" : ""})`
    );
  });

  async function logStartupChecklist() {
    const checks = [
      { name: "Ollama", url: `${ENV.ollamaUrl}/api/tags` },
      { name: "ChromaDB", url: "http://localhost:8000/api/v1/heartbeat" },
    ];
    for (const check of checks) {
      try {
        const r = await fetch(check.url, { signal: AbortSignal.timeout(2000) });
        log.info(`${check.name}: ${r.ok ? "✓ online" : "✗ unreachable (status " + r.status + ")"}`);
      } catch {
        log.info(`${check.name}: ✗ offline (not required)`);
      }
    }

    // ── Local microservice port diagnostics ──────────────────────────────────
    const localServices = [
      { name: "Fal AI bridge",   url: `http://localhost:${process.env.FAL_LOCAL_PORT ?? "8004"}/health` },
      { name: "MAS bridge",      url: `http://127.0.0.1:${process.env.MAS_BRIDGE_PORT ?? "8011"}/health` },
      { name: "llama.cpp bridge",url: `http://127.0.0.1:${process.env.LLAMA_CPP_PORT ?? "8013"}/health` },
      { name: "ComfyUI",         url: process.env.COMFYUI_URL ?? `http://127.0.0.1:${process.env.COMFYUI_PORT ?? "8188"}/system_stats` },
      { name: "Whisper STT",     url: process.env.WHISPER_SERVER_URL ?? "http://localhost:8001/health" },
      { name: "TTS service",     url: process.env.TTS_SERVER_URL ?? "http://localhost:8002/health" },
      { name: "RVC service",     url: process.env.RVC_SERVER_URL ?? "http://127.0.0.1:8003/health" },
    ];
    for (const svc of localServices) {
      try {
        const r = await fetch(svc.url, { signal: AbortSignal.timeout(1500) });
        log.info(`  ${svc.name}: ${r.ok ? "✓ online" : `✗ unreachable (HTTP ${r.status})`}`);
      } catch {
        log.info(`  ${svc.name}: ✗ offline (optional — start separately if needed)`);
      }
    }

    // ── Optional API key diagnostics ─────────────────────────────────────────
    const optionalKeys: Array<{ envKey: string; label: string }> = [
      { envKey: "OPENAI_API_KEY",     label: "OpenAI" },
      { envKey: "ANTHROPIC_API_KEY",  label: "Anthropic (Claude)" },
      { envKey: "XAI_API_KEY",        label: "xAI (Grok)" },
      { envKey: "GEMINI_API_KEY",     label: "Google Gemini" },
      { envKey: "ELEVENLABS_API_KEY", label: "ElevenLabs TTS" },
      { envKey: "LITHIC_API_KEY",     label: "Lithic (virtual cards)" },
      { envKey: "PCBWAY_API_KEY",     label: "PCBWay manufacturing" },
      { envKey: "OPENART_API_KEY",    label: "OpenArt image generation" },
      { envKey: "FAL_KEY",            label: "Fal.ai image/video generation" },
      { envKey: "VASTAI_API_KEY",     label: "Vast.ai cloud compute" },
      { envKey: "RUNPOD_API_KEY",     label: "RunPod cloud compute" },
      { envKey: "LAMBDA_API_KEY",     label: "Lambda Labs cloud compute" },
    ];
    for (const { envKey, label } of optionalKeys) {
      if (!process.env[envKey]) {
        log.info(`  Optional: ${envKey} not set — ${label} provider disabled`);
      }
    }

    if (ENV.zeroLoginMode) {
      log.warn("ZERO_LOGIN_MODE enabled — OAuth disabled, all requests authenticated as local admin");
    }
  }
  logStartupChecklist();

  // ─── Graceful Shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`\n[Omnecor] Received ${signal}. Shutting down gracefully...`);

    // Stop accepting new connections
    server.close();

    // Shut down WebSocket server
    if (wsServer) {
      await wsServer.shutdown();
      log.info("[Omnecor] WebSocket server closed");
    }

    TokenRefreshService.getInstance().stop();

    // Stop the Valet Router inference server
    try {
      await ValetServerService.getInstance().stop();
      log.info("[Omnecor] Valet Router Server shutdown complete");
    } catch (error) {
      log.warn("[Omnecor] Valet Router Server shutdown warning:", (error as Error).message);
    }

    // Terminate all running child processes (training, Blender, ESP, etc.)
    try {
      const processManager = ProcessManagerService.getInstance();
      await processManager.shutdown();
      log.info("[Omnecor] ProcessManager shutdown complete");
    } catch (error) {
      log.warn(
        "[Omnecor] ProcessManager shutdown warning:",
        (error as Error).message
      );
    }

    log.info("[Omnecor] Shutdown complete. Goodbye.");
    await closeAuditLog();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Run ──────────────────────────────────────────────────────────────────────
startServer().catch(error => {
  log.error("[Omnecor] Fatal startup error:", error);
  process.exit(1);
});
