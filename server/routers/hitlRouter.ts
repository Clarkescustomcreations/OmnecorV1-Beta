/**
 * @file server/routers/hitlRouter.ts
 * @description Omnecor — Human-in-the-Loop (HITL) tRPC Router
 *
 * Exposes the HITLApprovalService via tRPC so the UI can:
 *  - Query all currently pending critical actions
 *  - Approve or reject a specific action by ID
 *
 * Real-time pushes use the WebSocket broadcast already wired in
 * WebSocketServer.wireServiceEvents() on the "hitl:pending" channel.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { HITLApprovalService } from "../phase2/services/HITLApprovalService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Router Definition
// ─────────────────────────────────────────────────────────────────────────────

export const hitlRouter = router({
  /**
   * Return all currently pending HITL actions.
   * The client should subscribe to "hitl:pending" over WebSocket to receive
   * live pushes as new actions arrive; this endpoint is for initial hydration.
   */
  getPending: protectedProcedure.query(() => {
    return {
      actions: HITLApprovalService.getInstance().getPendingActions(),
    };
  }),

  /**
   * Approve or reject a pending HITL action.
   * Resolves the internal Promise that is suspending the agent.
   */
  resolve: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        approved: z.boolean(),
      })
    )
    .mutation(({ input }) => {
      HITLApprovalService.getInstance().approveAction(input.id, input.approved);
      return { success: true } as const;
    }),
});
