/**
 * @file services/ToolApprovalRegistry.ts
 * @description Server-side Human-in-the-Loop approval broker for the agentic chat.
 *
 * The `ChatAgentRunner` runs a real tool loop inside a tRPC subscription. When it
 * wants to run a command or apply a file edit it pauses and waits for the user's
 * approval — but a subscription is one-directional (server → client), so the
 * decision must arrive on a separate channel: the `aiProvider.resolveToolApproval`
 * mutation. This registry is the rendezvous between the two.
 *
 * Flow:
 *   1. Runner emits a `block_update` with the tool box in `pending_approval` and
 *      calls `waitFor(blockId, userId)` → gets a Promise it awaits.
 *   2. The client renders approve/deny and calls `resolveToolApproval({ id, … })`.
 *   3. The mutation calls `resolve(blockId, userId, decision)` which settles the
 *      Promise, unblocking the runner.
 *
 * Ownership is enforced: only the user who created a pending approval can resolve
 * it. Entries carry a TTL so an abandoned turn (client navigated away without the
 * runner's teardown firing) cannot leak a dangling Promise forever.
 */

import { createLogger } from "../../_core/logger.js";

const log = createLogger("ToolApproval");

/** Outcome delivered back to the runner once the user (or a timeout) decides. */
export interface ToolApprovalOutcome {
  approved: boolean;
  /** Reason surfaced back to the agent when denied. */
  denyReason?: string;
}

interface PendingApproval {
  userId: number | undefined;
  settle: (outcome: ToolApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Default lifetime of a pending approval before it auto-denies (10 minutes). */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class ToolApprovalRegistry {
  private static instance: ToolApprovalRegistry | null = null;
  private readonly pending = new Map<string, PendingApproval>();

  static getInstance(): ToolApprovalRegistry {
    if (!ToolApprovalRegistry.instance) {
      ToolApprovalRegistry.instance = new ToolApprovalRegistry();
    }
    return ToolApprovalRegistry.instance;
  }

  /**
   * Register a pending approval for `id` and return a Promise that settles when
   * the owning user resolves it (or the TTL elapses → auto-deny). A second
   * `waitFor` on the same id supersedes the first (the earlier waiter is denied)
   * so a retried block id can never wedge.
   */
  waitFor(id: string, userId: number | undefined, ttlMs = DEFAULT_TTL_MS): Promise<ToolApprovalOutcome> {
    // Supersede any existing waiter for this id.
    const existing = this.pending.get(id);
    if (existing) {
      clearTimeout(existing.timer);
      existing.settle({ approved: false, denyReason: "Superseded by a newer approval request." });
      this.pending.delete(id);
    }

    return new Promise<ToolApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          log.warn("Tool approval timed out — auto-denying", { id });
          resolve({ approved: false, denyReason: "Approval timed out." });
        }
      }, ttlMs);
      // Node timers keep the event loop alive; don't hold the process open for a
      // pending human decision.
      if (typeof timer.unref === "function") timer.unref();

      this.pending.set(id, { userId, settle: resolve, timer });
    });
  }

  /**
   * Resolve a pending approval. Returns `true` when a matching, owned entry was
   * settled; `false` when the id is unknown (already resolved / expired) or owned
   * by a different user — callers should surface that as a not-found.
   */
  resolve(id: string, userId: number | undefined, decision: "approve" | "deny", denyReason?: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    // Ownership check — a user may only resolve their own pending action.
    if (entry.userId !== userId) {
      log.warn("Rejected cross-user tool-approval resolve", { id, byUser: userId, ownedBy: entry.userId });
      return false;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.settle({
      approved: decision === "approve",
      denyReason: decision === "deny" ? (denyReason ?? "Rejected by reviewer.") : undefined,
    });
    return true;
  }

  /**
   * Cancel a pending approval without a user decision (called from the runner's
   * teardown when the client disconnects). Settles as denied so any awaiting
   * loop unblocks and unwinds cleanly.
   */
  cancel(id: string, reason = "Chat stream closed."): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.settle({ approved: false, denyReason: reason });
  }

  /** Test/introspection helper — number of in-flight approvals. */
  get size(): number {
    return this.pending.size;
  }
}
