/**
 * @file server/phase2/index.ts
 * @description Omnecor Phase 2 Backend — Service & Bridge Exports
 *
 * This module exports all Phase 2 services, bridges, and the WebSocket server
 * for use by the unified main server (server/_core/index.ts).
 *
 * IMPORTANT: Phase 2 routers are NO LONGER composed here. They are mounted
 * directly in server/routers.ts under the unified appRouter. The standalone
 * Phase 2 Express server (app.ts) has been deprecated and removed.
 *
 * Usage:
 *   import { OmnecorWebSocketServer } from './phase2';
 *   // Attach to the main HTTP server for real-time events
 */

// ─── Services ────────────────────────────────────────────────────────────────
export { FileSystemWatcherService } from "./services/FileSystemWatcherService";
export { HashTrackerService } from "./services/HashTrackerService";
export { VectorDBService } from "./services/VectorDBService";
export { ProcessManagerService } from "./services/ProcessManagerService";
export { AgentService } from "./services/AgentService";
export { VoiceService } from "./services/VoiceService";
export { SecurityService } from "./services/SecurityService";

// ─── Bridges ─────────────────────────────────────────────────────────────────
export { BlenderBridge } from "./services/BlenderService";
export { KiCadBridge } from "./services/KiCadService";
export { ESPToolBridge } from "./services/ESPToolService";

// ─── WebSocket ───────────────────────────────────────────────────────────────
export { OmnecorWebSocketServer } from "./websocket/WebSocketServer";

// ─── Configuration ───────────────────────────────────────────────────────────
export * from "./config/index";
