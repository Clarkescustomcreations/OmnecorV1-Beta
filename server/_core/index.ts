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
import { registerOAuthRoutes, registerGoogleOAuthRoutes, registerMicrosoftOAuthRoutes, registerSocialMediaOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { TokenRefreshService } from "../phase2/services/TokenRefreshService.js";
import { createLogger, closeAuditLog } from "./logger.js";
import { SERVER_CONFIG } from "../phase2/config/index.js";
import { ENV } from "./env.js";

const log = createLogger("core");

// ─── Phase 2 Service Imports (for lifecycle management) ─────────────────────
import { OmnecorWebSocketServer, setWsInstance } from "../phase2/websocket/WebSocketServer";
import { ProcessManagerService } from "../phase2/services/ProcessManagerService";
import { SecurityService } from "../phase2/services/SecurityService";
import { VectorDBService } from "../phase2/services/VectorDBService";
import { meshNode } from "../ommesh/core/MeshNode.js";
import { ValetServerService } from "../phase2/services/ValetServerService.js";

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
  // ─── Initialize Phase 2 Services ────────────────────────────────────────
  // These services are singletons. Calling getInstance() here ensures they
  // are ready before any tRPC request arrives.
  try {
    const security = SecurityService.getInstance();
    await security.initialize();
    log.info("[Omnecor] SecurityService initialized");
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

  // ─── Auto-start Valet Router Inference Server ───────────────────────────
  // Spawns valet_router_inference.py when models/valet-router/current.json
  // reports status="ready". No-op when no artifact is registered.
  try {
    await ValetServerService.getInstance().start();
  } catch (error) {
    log.warn("[Omnecor] Valet Router Server init warning:", (error as Error).message);
  }

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

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
  });

  app.use(limiter);

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
    });
  });

  // ─── Storage & OAuth ────────────────────────────────────────────────────
  registerStorageProxy(app);
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
    })
  );

  // ─── WebSocket Server (Neural Node-Tree + Training Progress) ────────────
  // Attaches to the same HTTP server on the /ws path.
  // The WebSocket server listens for service events and broadcasts to clients.
  let wsServer: OmnecorWebSocketServer | null = null;
  try {
    wsServer = new OmnecorWebSocketServer(server);
    setWsInstance(wsServer);
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
