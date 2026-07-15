import { z } from "zod";
import path from "path";
import os from "os";
import fsp from "fs/promises";
import { existsSync } from "fs";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, cloudProcedure, requirePermission } from "../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { AiProviderService } from "../core_services/services/AiProviderService.js";
import { LocalLlmRuntimeService } from "../core_services/services/LocalLlmRuntimeService.js";
import { ChatAgentRunner } from "../core_services/services/ChatAgentRunner.js";
import { ToolApprovalRegistry } from "../core_services/services/ToolApprovalRegistry.js";
import { DelegationService } from "../core_services/services/DelegationService.js";
import { ProcessManagerService } from "../core_services/services/ProcessManagerService.js";
import { AsyncJobService } from "../core_services/services/AsyncJobService.js";
import { validatePath } from "../_core/security.js";
import { injectMapRagContext } from "../_core/ragContext.js";
import { injectBrainContext } from "../_core/brainContext.js";
import { injectBlueprintContext } from "../_core/blueprintContext.js";
import { buildChatBlueprintTools } from "../core_services/blueprint/chatBlueprintTools.js";
import { assertProviderAllowedInMode, isSovereignMode } from "../_core/sovereign.js";
import { guardedEmit } from "../_core/streamEmit.js";
import { createLogger } from "../_core/logger.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";

const log = createLogger("aiProviderRouter");

/**
 * Tool-executing agentic endpoints (`agentChatStream`, `runCodeSnippet`) run
 * host commands / write-and-spawn code and therefore require the `agents:run`
 * capability — held by user/admin/owner and paired devices, but NOT the
 * read-only `viewer` role. Without this gate they were bare `protectedProcedure`
 * (any authenticated session), letting a viewer drive host code execution.
 */
const agentsRunProcedure = protectedProcedure.use(requirePermission("agents", "run"));

/**
 * Resolve the Python interpreter to run user code with. Prefers an explicit
 * `OMNECOR_PYTHON`, then the OS system Python (which carries system site-packages
 * like pygame), then whatever `python3`/`python` is on PATH — because the server's
 * PATH is dominated by `node_modules/.bin` + tool venvs that lack those packages.
 */
function pickPython(): string {
  const override = process.env.OMNECOR_PYTHON;
  if (override && existsSync(override)) return override;
  for (const c of ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"]) {
    if (existsSync(c)) return c;
  }
  return process.platform === "win32" ? "python" : "python3";
}

/**
 * True when a map root directory is a real, writable absolute filesystem path —
 * excludes decorative pseudo-roots like `github://…` / `integration://…`, which
 * would otherwise be rejected by `validatePath` (or be unwritable).
 */
export function isUsableFsRoot(dir: string): boolean {
  return path.isAbsolute(dir) && !dir.includes("://");
}

/** Map a fenced-code language tag to a runnable interpreter + file extension. */
export function resolveInterpreter(language: string): { command: string; ext: string } | null {
  switch (language.toLowerCase()) {
    case "python":
    case "py":
      return { command: pickPython(), ext: "py" };
    case "javascript":
    case "js":
    case "node":
      return { command: "node", ext: "js" };
    case "typescript":
    case "ts":
      return { command: "tsx", ext: "ts" };
    case "bash":
    case "sh":
    case "shell":
      return { command: "bash", ext: "sh" };
    default:
      return null;
  }
}

/** Reduce a caller-supplied filename to a safe basename (no path traversal). */
export function sanitizeFilename(name?: string): string | null {
  if (!name) return null;
  const base = path.basename(name).replace(/[^\w.\-]/g, "_").replace(/^\.+/, "");
  return base.length ? base : null;
}

const chatInputSchema = z.object({
  providerId: z.enum(["system", "ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
  modelId: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  /** Active neural map — when set (and its enableAIContext is on), the map's
   *  indexed knowledge is retrieved and injected as system context. */
  ragMapId: z.string().optional(),
  /** Attached Brain Packs — charters (always-on) + retrieved corpus injected
   *  as system context. Owner-scoped. See {@link injectBrainContext}. */
  brainIds: z.array(z.string().max(128)).max(16).optional(),
  /** Active persona — its durable `data.brains` are resolved server-side and
   *  unioned with `brainIds` (Brains-Upgrade Phase 4). Owner-scoped. */
  personaId: z.string().max(128).optional(),
  /** Model-Fabric Phase 2 — use native (structured) tool-calling instead of the
   *  text `<tool_call>` protocol for this turn. Curated per-model (Phase 3's
   *  unified catalog will set this automatically); defaults to the text
   *  protocol when the caller doesn't pass it. Only consulted by
   *  `agentChatStream` (plain `chatStream` never runs the tool loop). */
  supportsNativeTools: z.boolean().optional(),
  /** Model-Fabric Phase 5 — pin mesh routing to a specific OMMESH peer (the
   *  node id from a `mesh-peer` catalog entry the caller selected). Unset →
   *  the mesh auto-scorer picks a peer as before. */
  targetNodeId: z.string().optional(),
});

export const aiProviderRouter = router({
  getProviders: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.listProviders([]);
  }),

  discoverOllamaModels: publicProcedure.query(async ({ ctx }) => {
    return ctx.services.aiProvider.discoverOllamaModels();
  }),

  /**
   * Unified model catalog (Model-Fabric Phase 3) — every model this node can
   * currently run with full tool access: the Omnecor-owned local runtime,
   * optional local Ollama, OMMESH peers' advertised models, and any cloud
   * provider with a configured API key. Deduped + tagged with `location` +
   * `capabilities`. The phone/web pickers (Phase 5) merge the phone's
   * on-device models into this list client-side — the server never lists them.
   *
   * Not a blanket `cloudProcedure` — local/mesh models must stay visible to a
   * Sovereign user — so this is the same "mixed local+cloud, gate per-source"
   * shape as `chatStream`/`agentChatStream` below. `isSovereignMode` skips the
   * cloud source entirely (`ModelCatalogService.getCatalog`'s `isSovereign`
   * option) so an air-gapped user never triggers a live call to a cloud
   * provider's model-list endpoint.
   */
  catalog: protectedProcedure.query(async ({ ctx }) => {
    return ctx.services.modelCatalog.getCatalog({
      isSovereign: isSovereignMode(ctx.user?.executionMode),
    });
  }),

  /**
   * Pre-warm a specific Omnecor-runtime model (Model-Fabric Phase 8). The
   * picker calls this on selection so the hot-swap happens up front rather than
   * stalling the first chat message. **Non-blocking**: it kicks off the load
   * (which can take tens of seconds for a large GGUF) and returns immediately —
   * the picker reflects completion via the catalog's `loaded` flag rather than
   * holding an HTTP request open for the whole load. Idempotent — a no-op when
   * the model is already loaded. Local-only action, so `protectedProcedure`
   * (no Sovereign concern — nothing leaves the box).
   */
  loadLocalModel: protectedProcedure
    .input(z.object({ modelId: z.string().min(1) }))
    .mutation(({ input }) => {
      void LocalLlmRuntimeService.getInstance()
        .ensureModelLoaded(input.modelId)
        .catch((err) =>
          log.warn(`loadLocalModel(${input.modelId}) failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      return { started: true, modelId: input.modelId };
    }),

  chatStream: protectedProcedure
    .input(chatInputSchema)
    .subscription(({ ctx, input }) => {
      // Sovereign-mode gate: cloud providers blocked for air-gapped users. This
      // mixed local+cloud entry point can't be a blanket cloudProcedure without
      // killing local chat, so gate per-provider via the shared guard.
      assertProviderAllowedInMode(input.providerId, ctx.user?.executionMode);
      return observable<{ delta: string; done: boolean; totalTokens?: number }>(
        emit => {
          const svc = AiProviderService.getInstance();
          // Guard against emitting to a controller the client already closed
          // (disconnect / abort) — an unguarded late emit crashes the process.
          const g = guardedEmit(emit);
          (async () => {
            // Read-side map RAG: inject the active map's indexed knowledge before
            // streaming. Local retrieval, so it runs even in Sovereign mode.
            const rag = await injectMapRagContext({
              mapId: input.ragMapId,
              userId: ctx.user?.id,
              messages: input.messages,
              systemPrompt: input.systemPrompt,
            });
            const brain = await injectBrainContext({
              brainIds: input.brainIds,
              personaId: input.personaId,
              userId: ctx.user?.id,
              messages: rag.messages,
              systemPrompt: rag.systemPrompt,
            });
            // Blueprint sharing: fold the active Project's attached Build Plans in
            // as context (gated by the map's enableAIContext). Local read.
            const bp = await injectBlueprintContext({
              mapId: input.ragMapId,
              userId: ctx.user?.id,
              messages: brain.messages,
              systemPrompt: brain.systemPrompt,
            });
            for await (const chunk of svc.streamChat(
              input,
              bp.messages,
              bp.systemPrompt
            )) {
              if (g.closed) break; // client gone — stop pulling from the model
              g.next(chunk);
              if (chunk.done) {
                g.complete();
                break;
              }
            }
          })().catch(err => g.error(err));
          return () => g.close();
        }
      );
    }),

  /**
   * Agentic chat stream — the structured, tool-running counterpart to
   * `chatStream`. Emits an ordered `AgentStreamEvent` stream (prose deltas +
   * command/edit/job/mcp boxes) driven by `ChatAgentRunner`. Kept a
   * `protectedProcedure` with a per-provider sovereign gate (not a blanket
   * `cloudProcedure`) so local models still power agentic chat air-gapped —
   * exactly like `chatStream`. Command/edit actions are HITL-gated via
   * `resolveToolApproval`. Requires the `agents:run` capability (see
   * `agentsRunProcedure`) so a read-only viewer can't drive the tool loop.
   */
  agentChatStream: agentsRunProcedure
    .input(
      chatInputSchema.extend({
        /** Active neural map — file edits + command cwd are scoped to its roots. */
        mapId: z.string().optional(),
        rootDirectories: z.array(z.string()).optional(),
        /** Session "auto-approve within active map" toggle. */
        autoApprove: z.boolean().optional(),
        /** Conversation id, echoed to the async-job continuation path. */
        conversationId: z.string().optional(),
        /** Chat "Fabrication" toggle — exposes the Blueprint Studio toolset
         *  (create_blueprint + domain tools) in the main chat when on. */
        enableBlueprintTools: z.boolean().optional(),
      })
    )
    .subscription(({ ctx, input }) => {
      assertProviderAllowedInMode(input.providerId, ctx.user?.executionMode);
      return observable<AgentStreamEvent>((emit) => {
        const g = guardedEmit(emit);
        const controller = new AbortController();
        (async () => {
          const rag = await injectMapRagContext({
            mapId: input.ragMapId ?? input.mapId,
            userId: ctx.user?.id,
            messages: input.messages,
            systemPrompt: input.systemPrompt,
          });
          const brain = await injectBrainContext({
            brainIds: input.brainIds,
            personaId: input.personaId,
            userId: ctx.user?.id,
            messages: rag.messages,
            systemPrompt: rag.systemPrompt,
          });
          // Blueprint sharing: attached Build Plans become chat context (gated by
          // the map's enableAIContext) — independent of the Fabrication toggle
          // below (awareness always flows; the toggle only gates the tool loop).
          const bp = await injectBlueprintContext({
            mapId: input.ragMapId ?? input.mapId,
            userId: ctx.user?.id,
            messages: brain.messages,
            systemPrompt: brain.systemPrompt,
          });
          // Fabrication toggle: expose the Blueprint toolset in the main chat.
          // create_blueprint bootstraps a new Project when no map is active.
          const extraTools =
            input.enableBlueprintTools && ctx.user?.id
              ? buildChatBlueprintTools({
                  userId: ctx.user.id,
                  executionMode: ctx.user?.executionMode,
                  activeMapId: input.mapId,
                  signal: controller.signal,
                })
              : undefined;
          const runner = new ChatAgentRunner();
          for await (const event of runner.run({
            input: {
              providerId: input.providerId,
              modelId: input.modelId,
              apiKey: input.apiKey,
              baseUrl: input.baseUrl,
              messages: bp.messages,
              systemPrompt: bp.systemPrompt,
              maxTokens: input.maxTokens,
              supportsNativeTools: input.supportsNativeTools,
              targetNodeId: input.targetNodeId,
            },
            userId: ctx.user?.id,
            executionMode: ctx.user?.executionMode,
            conversationId: input.conversationId,
            mapId: input.mapId,
            rootDirectories: input.rootDirectories,
            autoApprove: input.autoApprove,
            extraTools,
            // Origin runs may delegate to mesh peers (Mesh-Delegation.md);
            // delegated runs themselves never get this (SubAgentHostService
            // doesn't set it), so delegation can't chain.
            allowDelegation: true,
            signal: controller.signal,
          })) {
            if (g.closed) break;
            g.next(event);
            if (event.type === "done" || event.type === "error") {
              g.complete();
              break;
            }
          }
        })().catch((err) => g.error(err));
        return () => {
          controller.abort();
          g.close();
        };
      });
    }),

  /**
   * Resolve a pending Human-in-the-Loop tool approval from the agentic stream.
   * The `id` is the awaiting block's own id. Ownership is enforced in the
   * registry — a user can only resolve their own pending action. Returns a
   * payload (never silent) indicating whether a matching request was settled.
   */
  resolveToolApproval: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        decision: z.enum(["approve", "deny"]),
        denyReason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const resolved = ToolApprovalRegistry.getInstance().resolve(
        input.id,
        ctx.user?.id,
        input.decision,
        input.denyReason
      );
      if (resolved) return { resolved };
      // Not a local approval — it may belong to a delegated run on a mesh peer
      // (Mesh-Delegation.md, Decision 1: full relay). The client can't tell the
      // difference by design; forward transparently when the block is known.
      const delegation = DelegationService.getInstance();
      if (delegation.isDelegatedBlock(input.id)) {
        return {
          resolved: await delegation.resolveApproval(input.id, ctx.user?.id, input.decision, input.denyReason),
        };
      }
      return { resolved: false };
    }),

  /**
   * Run a code snippet from the chat as a background job (the "Run" button on a
   * code block). Writes the snippet to a file — inside the active map's root when
   * one is set (path-validated), else a private scratch dir — and spawns it via
   * `ProcessManager`, tracked by `AsyncJobService` so its condensed result rides
   * the existing async-job → WebSocket path back into the conversation's job box.
   * User-initiated (the click is the approval), so there's no separate HITL gate
   * — but it does require the `agents:run` capability (see `agentsRunProcedure`),
   * so a read-only viewer session can't spawn host processes.
   * GUI programs (e.g. pygame) open a window on the host display; stdout/stderr
   * are captured for the box. HTML is not runnable here — use Live Preview.
   */
  runCodeSnippet: agentsRunProcedure
    .input(
      z.object({
        language: z.string(),
        code: z.string().min(1).max(500_000),
        filename: z.string().max(200).optional(),
        mapId: z.string().optional(),
        rootDirectories: z.array(z.string()).optional(),
        conversationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const interp = resolveInterpreter(input.language);
      if (!interp) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${input.language}" is not runnable here. Use Live Preview for HTML/markup.`,
        });
      }

      // Resolve a safe destination: the active map root (path-validated) or a
      // private scratch dir. Only a real absolute *filesystem* path counts as a
      // root — map roots can be decorative pseudo-URIs (github://, integration://)
      // that aren't writable, in which case we fall back to scratch.
      const root = input.rootDirectories?.find(isUsableFsRoot);
      const base = root ?? path.join(os.homedir(), ".omnecor", "scratch");
      await fsp.mkdir(base, { recursive: true });
      const safeName = sanitizeFilename(input.filename) ?? `snippet_${Date.now().toString(36)}.${interp.ext}`;
      const absolute = path.join(base, safeName);
      const resolved = root ? await validatePath(absolute, root) : absolute;
      await fsp.writeFile(resolved, input.code, "utf-8");

      const label = `run ${path.basename(resolved)}`;
      const jobId = await ProcessManagerService.getInstance().spawn({
        type: "custom",
        command: interp.command,
        args: [resolved],
        cwd: path.dirname(resolved),
        label,
        captureMode: "raw",
      });
      AsyncJobService.getInstance().track(jobId, {
        userId: ctx.user?.id,
        conversationId: input.conversationId,
        label,
        autoContinue: false, // a user Run is a test — show the result, don't re-prompt the AI
      });

      return {
        jobId,
        label,
        path: resolved,
        command: `${interp.command} ${path.basename(resolved)}`,
      };
    }),

  checkHealth: publicProcedure
    .input(
      z.object({
        providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
        modelId: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return AiProviderService.getInstance().checkHealth(input);
    }),

  discoverProviderModels: cloudProcedure
    .input(
      z.object({
        providerId: z.enum(["ollama", "anthropic", "openai", "gemini", "grok", "huggingface", "forge", "llamacpp"]),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.services.aiProvider.discoverProviderModels(input.providerId);
    }),
});
