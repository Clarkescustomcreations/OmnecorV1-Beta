/**
 * @file server/routers/notificationRouter.ts
 * @description Omnecor — Unified Notifications tRPC Router.
 *
 * Backs the Notifications tab in both the main GUI and the Android APK. Reads
 * from the in-memory {@link NotificationService}; live pushes arrive separately
 * over the "notifications" WebSocket channel (wired in WebSocketServer). This
 * endpoint set is for hydration + read-state management.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc.js";
import { NotificationService } from "../_core/NotificationService.js";

const notificationKind = z.enum(["chat", "task", "hitl", "wallet", "agent", "system"]);

export const notificationRouter = router({
  /** All notifications, newest-first, plus the unread count. */
  list: protectedProcedure.query(() => {
    const svc = NotificationService.getInstance();
    return {
      notifications: svc.list(),
      unread: svc.unreadCount(),
    };
  }),

  /** Just the unread count — cheap polling fallback for the nav badge. */
  unreadCount: protectedProcedure.query(() => {
    return { unread: NotificationService.getInstance().unreadCount() };
  }),

  /** Mark a single notification read. */
  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const ok = NotificationService.getInstance().markRead(input.id);
      return { success: ok };
    }),

  /** Mark every notification read. */
  markAllRead: protectedProcedure.mutation(() => {
    const flipped = NotificationService.getInstance().markAllRead();
    return { success: true, flipped };
  }),

  /** Remove all notifications. */
  clear: protectedProcedure.mutation(() => {
    NotificationService.getInstance().clear();
    return { success: true };
  }),

  /**
   * Manually create a notification. Primarily used by internal callers/tests
   * and the "send test alert" affordance in the UI, but any process can push
   * here to surface an alert to the user.
   */
  create: protectedProcedure
    .input(
      z.object({
        kind: notificationKind,
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(2000),
        href: z.string().max(512).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input }) => {
      const notification = NotificationService.getInstance().notify(input);
      return { notification };
    }),
});
