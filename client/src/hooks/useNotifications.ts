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
        utils.notifications.list.invalidate();
        utils.notifications.unreadCount.invalidate();
      }
    },
  });

  useEffect(() => {
    subscribe("notifications");
    return () => unsubscribe("notifications");
  }, [subscribe, unsubscribe]);

  const invalidateAll = () => {
    utils.notifications.list.invalidate();
    utils.notifications.unreadCount.invalidate();
  };

  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: invalidateAll });
  const markAllRead = trpc.notifications.markAllRead.useMutation({ onSuccess: invalidateAll });
  const clear = trpc.notifications.clear.useMutation({ onSuccess: invalidateAll });

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
