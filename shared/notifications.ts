/**
 * @file shared/notifications.ts
 * @description Shared notification + Agent Messenger types used by both the
 * server (NotificationService, routers) and the clients (main GUI + Android APK).
 *
 * Notifications are the unified alert feed surfaced in the Notifications tab.
 * They originate from any Omnecor process the user would wait on:
 *   - chat   → a new chat message / assistant reply arrived
 *   - task   → a background job / task completed (or failed)
 *   - hitl   → a Human-in-the-Loop action is awaiting approval
 *   - wallet → an agentic-wallet spend / budget event
 *   - agent  → an always-on agent/persona sent a message (Agent Messenger)
 *   - system → generic system event
 */

export type NotificationKind =
  | "chat"
  | "task"
  | "hitl"
  | "wallet"
  | "agent"
  | "system";

export interface OmnecorNotification {
  /** UUID. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Whether the user has seen/acknowledged this notification. */
  read: boolean;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /**
   * Optional deep-link the client can navigate to when the notification is
   * tapped (e.g. "/chat", "/wallet", "/notifications?persona=<id>").
   */
  href?: string;
  /** Free-form structured payload (e.g. personaId, jobId, actionId). */
  data?: Record<string, unknown>;
}

/** WebSocket envelope broadcast on the "notifications" channel. */
export interface NotificationWsMessage {
  type: "notification";
  channel: "notifications";
  data: OmnecorNotification;
  timestamp: string;
}

// ─── Agent Messenger ─────────────────────────────────────────────────────────

export type AgentMessageRole = "user" | "agent";

export interface AgentMessage {
  id: string;
  /** Persona/agent this message belongs to. */
  personaId: string;
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

/** A messenger thread — one per agent/persona, WhatsApp/Discord style. */
export interface AgentConversation {
  personaId: string;
  name: string;
  /** Persona type, e.g. "self_clone", "planner", "assistant". */
  type: string;
  alwaysOn: boolean;
  lastMessage?: string;
  lastMessageAt?: string;
  unread: number;
}
