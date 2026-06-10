/**
 * @file server/routers.ts
 * @description Omnecor — Unified Application Router
 *
 * This is the SINGLE appRouter for the entire Omnecor backend.
 * All sub-routers are mounted here under a flat, discoverable namespace.
 *
 * Architecture Notes:
 *   Previously, Phase 2 routers were built against a separate tRPC instance
 *   with an incompatible context (OmnecorContext vs TrpcContext). This has
 *   been resolved: all routers now import from `_core/trpc.ts` and share
 *   the unified TrpcContext which provides both auth (req/res/user) and
 *   service singletons (ctx.services.*).
 *
 * Router Namespace:
 *   system      — Health, version, system info
 *   auth        — Session management (me, logout)
 *   jobs        — Unified Background Process Management
 *   knowledgeBase — VectorDB semantic search, directory ingestion, memory
 *   ai          — Ollama, OpenAI, Anthropic, Gemini
 *   voice       — Whisper transcription, TTS synthesis, RVC conversion
 *   training    — LoRA fine-tuning job control (start/stop/status)
 *   project     — File watcher, Neural Node-Tree, loop detector
 *   blender     — Specialized integration bridge
 *   kicad       — Specialized integration bridge
 *   esp         — Specialized integration bridge
 *   security    — File scanning, encryption, backup/restore
 *   mesh        — OMMESH distributed discovery
 *   wallet      — Per-project budget limits and spend tracking
 *   virtualCard — Optional Lithic virtual card issuance (opt-in, requires LITHIC_API_KEY)
 *   audit       — Immutable audit log (admin-only)
 */

import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { publicProcedure, router } from "./_core/trpc.js";

// ─── Unified Feature Routers ────────────────────────────────────────────────
import { knowledgeBaseRouter } from "./routers/knowledgeBase.js";
import { aiRouter } from "./routers/aiRouter.js";
import { aiProviderRouter } from "./phase2/routers/aiProviderRouter.js";
import { jobRouter } from "./routers/jobRouter.js";
import { blenderRouter } from "./routers/blenderRouter.js";
import { kicadRouter } from "./routers/kicadRouter.js";
import { espRouter } from "./routers/espRouter.js";
import { voiceRouter } from "./routers/voiceRouter.js";
import { podcastRouter } from "./routers/podcastRouter.js";
import { trainingRouter } from "./routers/trainingRouter.js";
import { projectRouter } from "./routers/projectRouter.js";
import { agentRouter } from "./phase2/routers/agentRouter.js";
import { modelMarketplaceRouter } from "./phase2/routers/modelMarketplaceRouter.js";
import { securityRouter } from "./routers/securityRouter.js";
import { ommeshRouter } from "./routers/ommesh.router.js";
import { pcbEditorRouter } from "./routers/pcbEditorRouter.js";
import { falRouter } from "./routers/falRouter.js";
import { comfyRouter } from "./routers/comfyRouter.js";
import { walletRouter } from "./routers/walletRouter.js";
import { virtualCardRouter } from "./routers/virtualCardRouter.js";
import { auditRouter } from "./routers/auditRouter.js";
import { valetRouter } from "./routers/valetRouter.js";
import { ollamaRouter } from "./routers/ollamaRouter.js";
import { modelManagementRouter } from "./routers/modelManagementRouter.js";
import { mcpRouter } from "./routers/mcpRouter.js";
import { pipelineRouter } from "./routers/pipelineRouter.js";
import { imageGenRouter } from "./routers/imageGenRouter.js";
import { cloudComputeRouter } from "./routers/cloudComputeRouter.js";
import { integrationsRouter } from "./routers/integrationsRouter.js";
import { honchoRouter } from "./routers/honchoRouter.js";
import { schedulingRouter } from "./routers/schedulingRouter.js";
import { curatorRouter } from "./routers/curatorRouter.js";
import { discoveryRouter } from "./routers/discoveryRouter.js";
import { platformsRouter } from "./routers/platformsRouter.js";
import { analyticsRouter } from "./routers/analyticsRouter.js";
import { agentSettingsRouter } from "./routers/agentSettingsRouter.js";
import { oauthRouter } from "./routers/oauthRouter.js";
import { attachmentsRouter } from "./routers/attachmentsRouter.js";
import { neuralMapsRouter } from "./routers/neuralMapsRouter.js";
import { personaRouter } from "./routers/personaRouter.js";
import { brainmapRouter } from "./routers/brainmapRouter.js";
import { integrationManagementRouter } from "./routers/integrationManagementRouter.js";

// ─────────────────────────────────────────────────────────────────────────────
// Unified App Router
// ─────────────────────────────────────────────────────────────────────────────

export const appRouter = router({
  // ─── Core System ──────────────────────────────────────────────────────────
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // ─── Jobs (Unified Background Process Management) ─────────────────────────
  jobs: jobRouter,

  // ─── Knowledge Base (VectorDB + MemoryArchitect) ──────────────────────────
  knowledgeBase: knowledgeBaseRouter,

  // ─── AI Providers (Ollama, OpenAI, Anthropic, Gemini) ─────────────────────
  ai: aiRouter,
  aiProvider: aiProviderRouter,

  // ─── Voice Services (Whisper + TTS + RVC FastAPI proxy) ───────────────────
  voice: voiceRouter,
  podcast: podcastRouter,

  // ─── Training (LoRA fine-tuning job control) ──────────────────────────────
  training: trainingRouter,

  // ─── Project Management (File Watcher + Neural Node-Tree + Loop Detector) ─
  project: projectRouter,

  // ─── Agent Orchestration (CrewAI + LiteAgent + n8n) ───────────────────────
  agent: agentRouter,

  // ─── Mesh Intelligence (OMMESH Node Discovery) ───────────────────────────
  ommesh: ommeshRouter,

  // ─── OpenArt AI (Video Clone / Character Gen) ─────────────────────────────
  fal: falRouter,

  // ─── ComfyUI Bridge ───────────────────────────────────────────────────────
  comfy: comfyRouter,

  // ─── Agentic Wallet (Budget + Spend Tracking) ─────────────────────────────
  wallet: walletRouter,

  // ─── Virtual Cards (Agentic Wallet opt-in) ────────────────────────────────
  virtualCard: virtualCardRouter,

  // ─── Hardware (Specialized integration bridges) ───────────────────────────
  blender: blenderRouter,
  kicad: kicadRouter,
  pcbEditor: pcbEditorRouter,
  esp: espRouter,

  // ─── Security (File scanning + Encryption + Backup/Restore) ───────────────
  security: securityRouter,

  // ─── Audit Log (Immutable event log, admin-only) ──────────────────────────
  audit: auditRouter,

  // ─── Valet Router (Multi-API intelligent routing) ─────────────────────────
  valet: valetRouter,

  // ─── Ollama (Local model management) ──────────────────────────────────────
  ollama: ollamaRouter,

  // ─── Model Marketplace (Curated model library with automated sync) ────────
  modelMarketplace: modelMarketplaceRouter,

  // ─── Model Management (Registry, versioning, lifecycle) ───────────────────
  modelManagement: modelManagementRouter,

  // ─── MCP Client (Model Context Protocol tool directory) ───────────────────
  mcp: mcpRouter,

  // ─── GodMode Pipeline Framework (Phase 28) ────────────────────────────────
  pipeline: pipelineRouter,

  // ─── Image Generation (ComfyUI / Fal / OpenArt) (Phase 30) ───────────────
  imageGen: imageGenRouter,

  // ─── Cloud Compute Rental (Vast.ai / RunPod / Lambda Labs) ───────────────
  cloudCompute: cloudComputeRouter,

  // ─── Third-Party Integrations (GitHub / Notion / Slack / Google Drive) ───
  integrations: integrationsRouter,

  // ─── Integration Management (Health checks, lifecycle, token refresh) ────
  integrationManagement: integrationManagementRouter,

  // ─── Honcho Memory Layer (User facts, long-term session memory) ───────────
  honcho: honchoRouter,

  // ─── Agent Networking (Social media automation) ──────────────────────────
  scheduling: schedulingRouter,
  curator: curatorRouter,
  discovery: discoveryRouter,
  platforms: platformsRouter,
  analytics: analyticsRouter,
  settings: agentSettingsRouter,
  oauth: oauthRouter,

  // ─── File Attachments (pre-upload before chat send) ───────────────────────
  attachments: attachmentsRouter,

  // ─── Neural Brain Maps (DB persistence) ──────────────────────────────────
  neuralMaps: neuralMapsRouter,

  // ─── Personas (DB persistence) ───────────────────────────────────────────
  personas: personaRouter,

  // ─── Brain Map (Layout preference persistence) ────────────────────────────
  brainmap: brainmapRouter,
});

export type AppRouter = typeof appRouter;
