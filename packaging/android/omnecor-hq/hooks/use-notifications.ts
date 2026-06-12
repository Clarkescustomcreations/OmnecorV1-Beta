/**
 * useNotifications — unified alert feed for the phone.
 *
 * Read path:  initial snapshot via `notifications.list`, then live "notification"
 *             events pushed on the "notifications" WS channel.
 * Write path: `notifications.markRead` / `markAllRead` / `clear` mutations.
 *
 * Mirrors the OmnecorNotification shape from OmnecorV1-Beta/shared/notifications.ts.
 */
import { useState, useEffect, useCallback } from "react";
import { trpcQuery, trpcMutate } from "@/lib/_core/trpc-fetch";
import { subscribeChannel } from "@/lib/_core/ws-channels";
import { isServerConfigured } from "@/lib/_core/server-config";

export type NotificationKind = "chat" | "task" | "hitl" | "wallet" | "agent" | "system";

export interface OmnecorNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  href?: string;
  data?: Record<string, unknown>;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<OmnecorNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isServerConfigured()) {
      setError("No server configured");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await trpcQuery<{ notifications: OmnecorNotification[]; unread: number }>(
        "notifications.list"
      );
      setNotifications(res?.notifications ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeChannel("notifications", (data: OmnecorNotification) => {
      if (!data?.id) return;
      setNotifications((prev) =>
        prev.some((n) => n.id === data.id) ? prev : [data, ...prev]
      );
    });
    return unsub;
  }, [refresh]);

  const unread = notifications.reduce((n, x) => (x.read ? n : n + 1), 0);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await trpcMutate("notifications.markRead", { id });
    } catch {
      refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await trpcMutate("notifications.markAllRead");
    } catch {
      refresh();
    }
  }, [refresh]);

  const clear = useCallback(async () => {
    setNotifications([]);
    try {
      await trpcMutate("notifications.clear");
    } catch {
      refresh();
    }
  }, [refresh]);

  return { notifications, unread, loading, error, refresh, markRead, markAllRead, clear };
}
