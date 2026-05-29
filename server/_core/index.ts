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
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

// ─── Phase 2 Service Imports (for lifecycle management) ─────────────────────
import { OmnecorWebSocketServer } from "../phase2/websocket/WebSocketServer";
import { ProcessManagerService } from "../phase2/services/ProcessManagerService";
import { SecurityService } from "../phase2/services/SecurityService";
import { VectorDBService } from "../phase2/services/VectorDBService";
import { meshNode } from "../ommesh/core/MeshNode.js";

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

async function findAvailablePort(startPort: number = 3000): Promise<number> {
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
    console.log("[Omnecor] SecurityService initialized");
  } catch (error) {
    console.warn(
      "[Omnecor] SecurityService init warning:",
      (error as Error).message
    );
  }

  try {
    const vectorDB = VectorDBService.getInstance();
    await vectorDB.init();
    console.log(
      "[Omnecor] VectorDBService initialized (or degraded gracefully)"
    );
  } catch (error) {
    console.warn(
      "[Omnecor] VectorDBService init warning:",
      (error as Error).message
    );
  }

  // ─── Initialize OMMESH Node ─────────────────────────────────────────────
  try {
    await meshNode.start();
    console.log("[Omnecor] OMMESH Node started and broadcasting");
  } catch (error) {
    console.warn("[Omnecor] OMMESH init warning:", (error as Error).message);
  }

  // ─── Create Express App ─────────────────────────────────────────────────
  const app = express();
  const server = createServer(app);

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
  registerOAuthRoutes(app);

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
    console.log("[Omnecor] WebSocket server attached at /ws");
  } catch (error) {
    console.warn(
      "[Omnecor] WebSocket server init warning:",
      (error as Error).message
    );
  }

  // ─── Frontend (Vite dev or static production) ───────────────────────────
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ─── Start Listening ────────────────────────────────────────────────────
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(
      `[Omnecor] Port ${preferredPort} is busy, using port ${port} instead`
    );
  }

  server.listen(port, () => {
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log(
      "  ██████╗ ███╗   ███╗███╗   ██╗███████╗ ██████╗ ██████╗ ██████╗ "
    );
    console.log(
      " ██╔═══██╗████╗ ████║████╗  ██║██╔════╝██╔════╝██╔═══██╗██╔══██╗"
    );
    console.log(
      " ██║   ██║██╔████╔██║██╔██╗ ██║█████╗  ██║     ██║   ██║██████╔╝"
    );
    console.log(
      " ██║   ██║██║╚██╔╝██║██║╚██╗██║██╔══╝  ██║     ██║   ██║██╔══██╗"
    );
    console.log(
      " ╚██████╔╝██║ ╚═╝ ██║██║ ╚████║███████╗╚██████╗╚██████╔╝██║  ██║"
    );
    console.log(
      "  ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝"
    );
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log(`  Omnecor v2.1.0 — Context-Aware AI Infrastructure (Unified)`);
    console.log(`  HTTP:      http://localhost:${port}/`);
    console.log(`  tRPC API:  http://localhost:${port}/api/trpc`);
    console.log(`  WebSocket: ws://localhost:${port}/ws`);
    console.log(`  Health:    http://localhost:${port}/health`);
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Omnecor] Received ${signal}. Shutting down gracefully...`);

    // Stop accepting new connections
    server.close();

    // Shut down WebSocket server
    if (wsServer) {
      await wsServer.shutdown();
      console.log("[Omnecor] WebSocket server closed");
    }

    // Terminate all running child processes (training, Blender, ESP, etc.)
    try {
      const processManager = ProcessManagerService.getInstance();
      await processManager.shutdown();
      console.log("[Omnecor] ProcessManager shutdown complete");
    } catch (error) {
      console.warn(
        "[Omnecor] ProcessManager shutdown warning:",
        (error as Error).message
      );
    }

    console.log("[Omnecor] Shutdown complete. Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Run ──────────────────────────────────────────────────────────────────────
startServer().catch(error => {
  console.error("[Omnecor] Fatal startup error:", error);
  process.exit(1);
});
