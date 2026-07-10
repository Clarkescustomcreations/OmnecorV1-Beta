/**
 * Self-contained AppRouter type for the mobile tRPC React client.
 *
 * Why this exists
 * ---------------
 * Omnecor HQ is a *client* of the desktop Omnecor server — it never runs a
 * backend of its own. The desktop's real `AppRouter` (40+ routers) cannot be
 * imported here: the mobile tsconfig is stricter and would try to type-check
 * the entire server source tree (express, drizzle, node-only APIs), which
 * explodes. The old `server/` + `drizzle/` template scaffolding that used to
 * provide this type has been removed.
 *
 * At runtime every real PC call goes through the untyped HTTP helpers in
 * `trpc-fetch.ts` (`trpcQuery` / `trpcMutate`), so connection stability does
 * not depend on this type at all. This minimal router only exists to give the
 * mounted `trpc.Provider` (see `app/_layout.tsx`) a valid, self-contained
 * `AppRouter` shape with no server dependencies.
 *
 * The `aiProvider` sub-router below is the exception that earns its typing: the
 * agentic chat stream (`agentChatStream`) is a real tRPC **subscription** the
 * mobile app consumes over a WebSocket link (see `getAgentTrpc` in `trpc.ts`),
 * and imperative `.subscribe()` needs the router type to infer the streamed
 * `AgentStreamEvent`. The input schema + yielded type mirror the desktop
 * `server/routers/aiProviderRouter.ts` exactly (the shared event contract keeps
 * them from drifting); the async-generator body is a type-only stub — the real
 * tool loop runs on the desktop server.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import type { AgentStreamEvent } from "@/lib/_core/agent-blocks";

// Transformer must match the client (`createTRPCClient` in trpc.ts) so the
// inferred router type lines up with the superjson-configured httpBatchLink.
const t = initTRPC.create({ transformer: superjson });

/** Mirrors `chatInputSchema.extend({...})` on the desktop `agentChatStream`. */
const agentChatStreamInput = z.object({
  providerId: z.string(),
  modelId: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    }),
  ),
  systemPrompt: z.string().optional(),
  maxTokens: z.number().optional(),
  ragMapId: z.string().optional(),
  mapId: z.string().optional(),
  rootDirectories: z.array(z.string()).optional(),
  autoApprove: z.boolean().optional(),
  conversationId: z.string().optional(),
  /** Model-Fabric Phase 2 — native tool-calling opt-in (mirrors the desktop's
   *  chatInputSchema field, was missing from this mirror before Phase 5). */
  supportsNativeTools: z.boolean().optional(),
  /** Model-Fabric Phase 5 — pin mesh routing to a specific OMMESH peer. */
  targetNodeId: z.string().optional(),
});

const appRouter = t.router({
  system: t.router({
    health: t.procedure.query(() => ({ ok: true })),
  }),
  auth: t.router({
    me: t.procedure.query(() => null as unknown),
    logout: t.procedure.mutation(() => ({ success: true as const })),
  }),
  aiProvider: t.router({
    /** Streamed agentic tool loop. Consumed via the WebSocket link. */
    agentChatStream: t.procedure
      .input(agentChatStreamInput)
      .subscription(async function* (): AsyncGenerator<AgentStreamEvent> {
        // Type-only stub: the real streaming loop runs on the desktop server.
      }),
    /** Resolve a pending Human-in-the-Loop tool approval (approve / deny). */
    resolveToolApproval: t.procedure
      .input(
        z.object({
          id: z.string().min(1),
          decision: z.enum(["approve", "deny"]),
          denyReason: z.string().max(2000).optional(),
        }),
      )
      .mutation((): { resolved: boolean } => ({ resolved: false })),
    /** Run a fenced code block as a background job on the desktop (the ▶ button). */
    runCodeSnippet: t.procedure
      .input(
        z.object({
          language: z.string(),
          code: z.string().min(1),
          filename: z.string().optional(),
          mapId: z.string().optional(),
          rootDirectories: z.array(z.string()).optional(),
          conversationId: z.string().optional(),
        }),
      )
      .mutation((): { jobId: string; label: string } => ({ jobId: "", label: "" })),
  }),
  /**
   * Mesh sub-agent delegation (Mesh-Delegation.md). Managed sub-agent chats
   * stream their relayed `AgentStreamEvent`s over the WebSocket link (`stream`);
   * follow-up turns + cancel are ordinary mutations. Mirrors the desktop
   * `server/routers/delegationRouter.ts`.
   */
  delegation: t.router({
    /** Live stream of a managed chat's current turn (replay + follow). */
    stream: t.procedure
      .input(z.object({ conversationId: z.string().min(1) }))
      .subscription(async function* (): AsyncGenerator<AgentStreamEvent> {
        // Type-only stub: the real stream is relayed by the desktop server.
      }),
    /** Between-turn user follow-up into the managed chat. */
    sendTurn: t.procedure
      .input(z.object({ conversationId: z.string().min(1), content: z.string().min(1).max(100_000) }))
      .mutation((): { ok: boolean } => ({ ok: true })),
    /** Cancel the delegated run. */
    cancel: t.procedure
      .input(z.object({ conversationId: z.string().min(1) }))
      .mutation((): { ok: boolean } => ({ ok: true })),
    /** Origin-side status snapshot for a managed chat. */
    status: t.procedure
      .input(z.object({ conversationId: z.string().min(1) }))
      .query((): { status: string; taskId: string; nodeId: string } => ({ status: "idle", taskId: "", nodeId: "" })),
  }),
});

export type AppRouter = typeof appRouter;
