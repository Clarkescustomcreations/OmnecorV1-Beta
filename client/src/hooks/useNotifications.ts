/**
 * @file client/src/hooks/useNotifications.ts
 * @description Unified Notifications hook for the main GUI.
 *
 * Hydrates the notification feed from `notifications.list` and keeps it live by
 * subscribing to the "notifications" WebSocket channel (reusing the shared
 * Omnecor socket). On every pushed notification it invalidates the query so the
 * feed + nav badge stay authoritative (no client-side dedupe races). Exposes
 * read-state mutations used by the Notifications page and the nav badge.
 */

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useOmnecorSocket } from "@/hooks/useOmnecorSocket";

export function useNotifications() {
  const utils = trpc.useUtils();
  const listQuery = trpc.notifications.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const { subscribe, unsubscribe } = useOmnecorSocket({
    onEvent: type => {
      if (type === "notification") {
        // Authoritative refetch — covers every kind (chat/task/hitl/wallet/agent).
        utils.notifications.list.invalidate();
      }
    },
  });

  useEffect(() => {
    subscribe("notifications");
    return () => unsubscribe("notifications");
  }, [subscribe, unsubscribe]);

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });
  const clear = trpc.notifications.clear.useMutation({
    onSuccess: () => utils.notifications.list.invalidate(),
  });

  return {
    notifications: listQuery.data?.notifications ?? [],
    unread: listQuery.data?.unread ?? 0,
    isLoading: listQuery.isLoading,
    refetch: () => utils.notifications.list.invalidate(),
    markRead: (id: string) => markRead.mutate({ id }),
    markAllRead: () => markAllRead.mutate(),
    clear: () => clear.mutate(),
  };
}
