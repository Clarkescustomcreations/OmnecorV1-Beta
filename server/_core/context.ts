/**
 * @file server/_core/context.ts
 * @description Omnecor — Unified tRPC Context
 *
 * This is the SINGLE source of truth for the tRPC context across the entire
 * Omnecor backend. It merges:
 *   - Express request/response objects (for auth, cookies, headers)
 *   - User session (resolved via SDK authentication)
 *   - Omnecor service singletons (for Phase 2+ backend operations)
 *
 * Architecture Notes:
 *   Previously, two incompatible contexts existed:
 *     1. TrpcContext (req, res, user) — used by the main appRouter
 *     2. OmnecorContext (services: {...}) — used by Phase 2 sub-routers
 *   This unified context combines both, allowing all routers to coexist
 *   under a single tRPC instance with a single Express middleware.
 *
 *   Service singletons are resolved lazily at request time via getInstance().
 *   This ensures services are initialized once and shared across all requests.
 *   Services that may be offline (e.g., ChromaDB) degrade gracefully.
 */

import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

// ─── Phase 2 Service Imports ────────────────────────────────────────────────
// These are the singleton services from the Phase 2 backend.
// They are imported here to provide type information and getInstance() access.
import { FileSystemWatcherService } from "../phase2/services/FileSystemWatcherService.js";
import { HashTrackerService } from "../phase2/services/HashTrackerService.js";
import { VectorDBService } from "../phase2/services/VectorDBService.js";
import { ProcessManagerService } from "../phase2/services/ProcessManagerService.js";
import { AgentService } from "../phase2/services/AgentService.js";
import { VoiceService } from "../phase2/services/VoiceService.js";
import { AiProviderService } from "../phase2/services/AiProviderService.js";
import { MemoryArchitectService } from "../phase2/services/MemoryArchitectService.js";
import { SecurityService } from "../phase2/services/SecurityService.js";
import { BlenderBridge } from "../phase2/services/BlenderService.js";
import { KiCadBridge } from "../phase2/services/KiCadService.js";
import { ESPToolBridge } from "../phase2/services/ESPToolService.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";
import { MeshDiscoveryService } from "../phase2/services/MeshDiscoveryService.js";
import { FalApiService } from "../phase2/services/FalApiService.js";
import { ComfyService } from "../phase2/services/ComfyService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Unified Context Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The unified tRPC context available to ALL procedures across the application.
 *
 * - `req` / `res`: Express HTTP objects (for cookies, headers, auth)
 * - `user`: Authenticated user or null (resolved from session cookie)
 * - `services`: Omnecor backend service singletons (Phase 2+)
 *
 * Routers that only need auth can use `ctx.user`.
 * Routers that need backend services use `ctx.services.*`.
 * Both are always available on every request.
 */
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  services: {
    fileWatcher: FileSystemWatcherService;
    hashTracker: HashTrackerService;
    vectorDB: VectorDBService;
    processManager: ProcessManagerService;
    agent: AgentService;
    voice: VoiceService;
    aiProvider: AiProviderService;
    memoryArchitect: MemoryArchitectService;
    security: SecurityService;
    blender: BlenderBridge;
    kicad: KiCadBridge;
    esp: ESPToolBridge;
    hitl: HITLApprovalService;
    mesh: MeshDiscoveryService;
    fal: FalApiService;
    comfy: ComfyService;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Context Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the unified tRPC context for each incoming request.
 * Called by the Express tRPC adapter on every HTTP request to /api/trpc.
 *
 * - Authentication is optional (public procedures don't require a user)
 * - Service singletons are resolved from their static getInstance() methods
 * - Services that fail to initialize will throw on first use (not here)
 */
export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    services: {
      fileWatcher: FileSystemWatcherService.getInstance(),
      hashTracker: HashTrackerService.getInstance(),
      vectorDB: VectorDBService.getInstance(),
      processManager: ProcessManagerService.getInstance(),
      agent: AgentService.getInstance(),
      voice: VoiceService.getInstance(),
      aiProvider: AiProviderService.getInstance(),
      memoryArchitect: MemoryArchitectService.getInstance(),
      security: SecurityService.getInstance(),
      blender: BlenderBridge.getInstance(),
      kicad: KiCadBridge.getInstance(),
      esp: ESPToolBridge.getInstance(),
      hitl: HITLApprovalService.getInstance(),
      mesh: MeshDiscoveryService.getInstance(),
      fal: FalApiService.getInstance(),
      comfy: ComfyService.getInstance(),
    },
  };
}
