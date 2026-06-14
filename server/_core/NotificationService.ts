/**
 * @file server/_core/NotificationService.ts
 * @description Omnecor — Unified Notification Service.
 *
 * A single in-memory, process-wide store of {@link OmnecorNotification}s plus an
 * EventEmitter so the WebSocket layer can push them to connected clients in real
 * time. This mirrors the in-memory pattern used by HITLApprovalService — alerts
 * are ephemeral by design (they survive only for the life of the server
 * process), which keeps Notifications working identically in both the MySQL and
 * zero-infra SQLite (Sovereign) backends without a schema migration.
 *
 * Any Omnecor process the user would wait on funnels through {@link notify}:
 * new chat replies, task/job completion, HITL approvals, agentic-wallet spend,
 * and Agent Messenger messages. The WebSocketServer relays the "notification"
 * event to all clients on the "notifications" channel.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  OmnecorNotification,
  NotificationKind,
} from "../../shared/notifications.js";
import { getSetting } from "../phase2/services/SettingsService.js";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  data?: Record<string, unknown>;
}

/** Max notifications retained in the ring buffer. */
const MAX_NOTIFICATIONS = 250;

export class NotificationService extends EventEmitter {
  private static instance: NotificationService | null = null;

  /** Newest-first ring buffer. */
  private store: OmnecorNotification[] = [];

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Create, store and broadcast a notification.
   * Emits "notification" with the created record; WebSocketServer relays it.
   */
  notify(input: NotifyInput): OmnecorNotification {
    const notification: OmnecorNotification = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 2000),
      read: false,
      createdAt: new Date().toISOString(),
      href: input.href,
      data: input.data,
    };

    this.store.unshift(notification);
    if (this.store.length > MAX_NOTIFICATIONS) {
      this.store.length = MAX_NOTIFICATIONS;
    }

    // Settings → General "Notifications": when disabled, the record is still
    // stored (visible in the feed) but not actively pushed/broadcast so the
    // user isn't interrupted with live toasts.
    if (getSetting<boolean>("notifications", true)) {
      this.emit("notification", notification);
    }
    return notification;
  }

  /** All notifications, newest-first. */
  list(): OmnecorNotification[] {
    return this.store;
  }

  /** Count of unread notifications. */
  unreadCount(): number {
    let n = 0;
    for (const x of this.store) if (!x.read) n++;
    return n;
  }

  /** Mark a single notification read. Returns true if it existed. */
  markRead(id: string): boolean {
    const found = this.store.find(n => n.id === id);
    if (!found) return false;
    found.read = true;
    return true;
  }

  /** Mark every notification read. Returns the number flipped. */
  markAllRead(): number {
    let n = 0;
    for (const x of this.store) {
      if (!x.read) {
        x.read = true;
        n++;
      }
    }
    return n;
  }

  /** Remove all notifications. */
  clear(): void {
    this.store = [];
  }
}
