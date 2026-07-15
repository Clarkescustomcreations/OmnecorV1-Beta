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
import { ENV } from "./env.js";
import { getUserByOpenId, upsertUser, getDb } from "../db.factory.js";
import type { Db } from "../db.js";

// ─── Phase 2 Service Imports ────────────────────────────────────────────────
// These are the singleton services from the Phase 2 backend.
// They are imported here to provide type information and getInstance() access.
import { FileSystemWatcherService } from "../core_services/services/FileSystemWatcherService.js";
import { HashTrackerService } from "../core_services/services/HashTrackerService.js";
import { getVectorStore, type IVectorStore } from "../core_services/services/VectorStore.js";
import { ProcessManagerService } from "../core_services/services/ProcessManagerService.js";
import { AgentService } from "../core_services/services/AgentService.js";
import { VoiceService } from "../core_services/services/VoiceService.js";
import { AiProviderService } from "../core_services/services/AiProviderService.js";
import { MemoryArchitectService } from "../core_services/services/MemoryArchitectService.js";
import { SecurityService } from "../core_services/services/SecurityService.js";
import { BlenderBridge } from "../core_services/services/BlenderService.js";
import { KiCadBridge } from "../core_services/services/KiCadService.js";
import { ESPToolBridge } from "../core_services/services/ESPToolService.js";
import { HITLApprovalService } from "../core_services/services/HITLApprovalService.js";
import { MeshDiscoveryService } from "../core_services/services/MeshDiscoveryService.js";
import { FalApiService } from "../core_services/services/FalApiService.js";
import { ComfyService } from "../core_services/services/ComfyService.js";
import { ScraperService } from "../core_services/services/ScraperService.js";
import { CodingContextService } from "../core_services/services/CodingContextService.js";
import { DockerService } from "../core_services/services/DockerService.js";
import { PromptSanitizer } from "../core_services/services/PromptSanitizer.js";
import { ElevenLabsService } from "../core_services/services/ElevenLabsService.js";
import { MCPClientService } from "../core_services/services/MCPClientService.js";
import { PipelineEngineService } from "../core_services/services/PipelineEngineService.js";
import { AuditLogService } from "../core_services/services/AuditLogService.js";
import { DatasetDiscoveryService } from "../core_services/services/DatasetDiscoveryService.js";
import { DatasetCurationService } from "../core_services/services/DatasetCurationService.js";
import { PCBWayService } from "../core_services/services/PCBWayService.js";
import { ModelManagementService } from "../core_services/services/ModelManagementService.js";
import { VirtualCardService } from "../core_services/services/VirtualCardService.js";
import { ValetRouterService } from "../core_services/services/ValetRouterService.js";
import { NotificationService } from "./NotificationService.js";
import { SettingsService } from "../core_services/services/SettingsService.js";
import { OpenArtService } from "../core_services/services/OpenArtService.js";
import { AsyncJobService } from "../core_services/services/AsyncJobService.js";
import { ModelCatalogService } from "../core_services/services/ModelCatalogService.js";
// Unified Context Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The unified tRPC context available to ALL procedures across the application.
 *
 * - `req` / `res`: Express HTTP objects (for cookies, headers, auth)
 * - `user`: Authenticated user or null (resolved from session cookie)
 * - `db`: Drizzle ORM instance (always a live connection; never null)
 * - `services`: Omnecor backend service singletons (Phase 2+)
 *
 * Routers that only need auth can use `ctx.user`.
 * Routers that need backend services use `ctx.services.*`.
 * Routers that need database access use `ctx.db` (always live).
 * All are always available on every request.
 */
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  db: Db; // Drizzle ORM instance (always live; never null)
  services: {
    fileWatcher: FileSystemWatcherService;
    hashTracker: HashTrackerService;
    vectorDB: IVectorStore;
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
    scraper: ScraperService;
    codingContext: CodingContextService;
    docker: DockerService;
    promptSanitizer: PromptSanitizer;
    elevenLabs: ElevenLabsService;
    mcpClient: MCPClientService;
    pipeline: PipelineEngineService;
    auditLog: AuditLogService;
    datasetDiscovery: DatasetDiscoveryService;
    datasetCuration: DatasetCurationService;
    pcbWay: PCBWayService;
    modelManagement: ModelManagementService;
    virtualCard: VirtualCardService;
    valetRouter: ValetRouterService;
    notification: NotificationService;
    settings: SettingsService;
    openArt: OpenArtService;
    asyncJob: AsyncJobService;
    modelCatalog: ModelCatalogService;
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

  if (ENV.zeroLoginMode) {
    const defaultMode = ENV.zeroLoginExecutionMode;
    let dbUser = await getUserByOpenId("local-zero-login");
    if (!dbUser) {
      await upsertUser({
        openId: "local-zero-login",
        name: "Local Admin",
        role: "admin",
        executionMode: defaultMode,
      });
      dbUser = await getUserByOpenId("local-zero-login");
      if (!dbUser) {
        throw new Error("Failed to create zero-login user: row not found after upsert");
      }
    }
    const executionMode = dbUser.executionMode;
    user = {
      id: dbUser.id,
      openId: "local-zero-login",
      name: "Local Admin",
      email: null,
      loginMethod: "zero-login",
      passwordHash: null,
      role: "admin",
      executionMode,
      tosAcceptedAt: dbUser.tosAcceptedAt ?? null,
      tosAcceptedVersion: dbUser.tosAcceptedVersion ?? null,
      createdAt: dbUser.createdAt ?? new Date(),
      updatedAt: dbUser.updatedAt ?? new Date(),
      lastSignedIn: dbUser.lastSignedIn ?? new Date(),
    } satisfies User;
  } else {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      user = null;
    }
  }

  // SOVEREIGN_MODE=true is a global operator override — force every user into
  // sovereign execution regardless of what their DB record says. This lets an
  // air-gapped deployment block cloud inference for all accounts at once.
  if (ENV.sovereignMode && user) {
    user = { ...user, executionMode: "sovereign" };
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    db: await getDb(),
    services: {
      fileWatcher: FileSystemWatcherService.getInstance(),
      hashTracker: HashTrackerService.getInstance(),
      vectorDB: getVectorStore(),
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
      scraper: ScraperService.getInstance(),
      codingContext: CodingContextService.getInstance(),
      docker: DockerService.getInstance(),
      promptSanitizer: PromptSanitizer.getInstance(),
      elevenLabs: ElevenLabsService.getInstance(),
      mcpClient: MCPClientService.getInstance(),
      pipeline: PipelineEngineService.getInstance(),
      auditLog: AuditLogService.getInstance(),
      datasetDiscovery: DatasetDiscoveryService.getInstance(),
      datasetCuration: DatasetCurationService.getInstance(),
      pcbWay: PCBWayService.getInstance(),
      modelManagement: ModelManagementService.getInstance(),
      virtualCard: VirtualCardService.getInstance(),
      valetRouter: ValetRouterService.getInstance(),
      notification: NotificationService.getInstance(),
      settings: SettingsService.getInstance(),
      openArt: OpenArtService.getInstance(),
      asyncJob: AsyncJobService.getInstance(),
      modelCatalog: ModelCatalogService.getInstance(),
    },
  };
}
