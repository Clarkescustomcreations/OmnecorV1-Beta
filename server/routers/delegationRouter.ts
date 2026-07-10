/**
 * Mesh sub-agent delegation — the client-facing surface of the managed chat
 * (Mesh-Delegation.md). The heavy lifting lives in `DelegationService`; these
 * procedures are thin, ownership-scoped adapters:
 *
 *  - `stream`   — live `AgentStreamEvent` subscription for a managed chat
 *                 (replays the in-progress turn, then follows live). Finished
 *                 turns are ordinary `chatMessages` rows loaded via chatRouter.
 *  - `sendTurn` — between-turn follow-up (Decision 5): persists the user
 *                 message and runs the next turn on the same peer + task.
 *  - `cancel`   — abort the delegated run (peer-side AbortSignal + local mark).
 *  - `status`   — origin-side run status snapshot.
 *
 * HITL approvals for delegated blocks do NOT live here — the ordinary
 * `aiProvider.resolveToolApproval` mutation forwards them transparently (the
 * client can't tell a delegated approval from a local one, by design).
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { observable } from "@trpc/server/observable";
import { guardedEmit } from "../_core/streamEmit.js";
import { DelegationService } from "../core_services/services/DelegationService.js";
import type { AgentStreamEvent } from "@shared/chatAgentEvents";

const conversationInput = z.object({ conversationId: z.string().min(1) });

export const delegationRouter = router({
  /** Live stream of a managed chat's current turn (replay + follow). */
  stream: protectedProcedure.input(conversationInput).subscription(({ ctx, input }) => {
    return observable<AgentStreamEvent>((emit) => {
      const g = guardedEmit(emit);
      let unsubscribe: (() => void) | null = null;
      let closed = false;
      (async () => {
        const sub = await DelegationService.getInstance().subscribe(
          input.conversationId,
          ctx.user?.id,
          (ev) => {
            if (!g.closed) g.next(ev);
          },
        );
        if (closed) {
          sub.unsubscribe();
          return;
        }
        unsubscribe = sub.unsubscribe;
        for (const ev of sub.replay) {
          if (g.closed) break;
          g.next(ev);
        }
      })().catch((err) => g.error(err));
      return () => {
        closed = true;
        unsubscribe?.();
        g.close();
      };
    });
  }),

  /** Between-turn user follow-up into the managed chat. */
  sendTurn: protectedProcedure
    .input(conversationInput.extend({ content: z.string().min(1).max(100_000) }))
    .mutation(async ({ ctx, input }) => {
      await DelegationService.getInstance().sendUserTurn(
        input.conversationId,
        ctx.user?.id,
        input.content,
        ctx.user?.executionMode,
      );
      return { ok: true };
    }),

  /** Cancel the delegated run. */
  cancel: protectedProcedure.input(conversationInput).mutation(async ({ ctx, input }) => {
    await DelegationService.getInstance().cancel(input.conversationId, ctx.user?.id);
    return { ok: true };
  }),

  /** Origin-side status snapshot for a managed chat. */
  status: protectedProcedure.input(conversationInput).query(async ({ ctx, input }) => {
    return DelegationService.getInstance().status(input.conversationId, ctx.user?.id);
  }),
});
