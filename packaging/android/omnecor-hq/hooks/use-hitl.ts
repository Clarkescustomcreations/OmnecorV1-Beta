/**
 * useHitl — live Human-in-the-Loop approval queue.
 *
 * Read path:  initial snapshot via `hitl.getPending`, then live `actionPending`
 *             events pushed on the "hitl:pending" WS channel.
 * Write path: `hitl.resolve` mutation (direct fetch) approves/rejects an action,
 *             which resolves the suspended agent call on the PC.
 *
 * Mirrors the CriticalAction shape from OmnecorV1-Beta/shared/hitl.ts.
 */
import { useState, useEffect, useCallback } from "react";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { subscribeChannel } from "@/lib/_core/ws-channels";
import { isServerConfigured } from "@/lib/_core/server-config";

export interface CriticalAction {
  id: string;
  toolName: string;
  args: any;
  status: "pending" | "approved" | "rejected";
  timestamp: string;
}

export function useHitl() {
  const [actions, setActions] = useState<CriticalAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isServerConfigured()) {
      setError("No server configured");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery<{ actions: CriticalAction[] }>("hitl.getPending");
      setActions(res?.actions ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeChannel("hitl:pending", (data: CriticalAction) => {
      if (!data?.id) return;
      setActions((prev) => (prev.some((a) => a.id === data.id) ? prev : [data, ...prev]));
    });
    return unsub;
  }, [refresh]);

  const resolve = useCallback(async (id: string, approved: boolean) => {
    // Optimistic removal — the PC drops it from the pending set on resolve.
    setActions((prev) => prev.filter((a) => a.id !== id));
    try {
      await trpcMutate("hitl.resolve", { id, approved });
    } catch (e) {
      setError(String(e));
      refresh(); // reconcile if the call failed
    }
  }, [refresh]);

  return { actions, loading, error, refresh, resolve };
}
