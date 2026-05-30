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
import { trainingRouter } from "./routers/trainingRouter.js";
import { projectRouter } from "./routers/projectRouter.js";
import { agentRouter } from "./phase2/routers/agentRouter.js";
import { securityRouter } from "./routers/securityRouter.js";
import { ommeshRouter } from "./routers/ommesh.router.js";
import { falRouter } from "./routers/falRouter.js";
import { comfyRouter } from "./routers/comfyRouter.js";

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

  // ─── Training (LoRA fine-tuning job control) ──────────────────────────────
  training: trainingRouter,

  // ─── Project Management (File Watcher + Neural Node-Tree + Loop Detector) ─
  project: projectRouter,

  // ─── Agent Orchestration (CrewAI + LiteAgent + n8n) ───────────────────────
  agent: agentRouter,

  // ─── Mesh Intelligence (OMMESH Node Discovery) ───────────────────────────
  mesh: ommeshRouter,

  // ─── OpenArt AI (Video Clone / Character Gen) ─────────────────────────────
  fal: falRouter,

  // ─── ComfyUI Bridge ───────────────────────────────────────────────────────
  comfy: comfyRouter,

  // ─── Hardware (Specialized integration bridges) ───────────────────────────
  blender: blenderRouter,
  kicad: kicadRouter,
  esp: espRouter,

  // ─── Security (File scanning + Encryption + Backup/Restore) ───────────────
  security: securityRouter,
});

export type AppRouter = typeof appRouter;
