/**
 * @file server/_core/AgentMessengerStore.ts
 * @description In-memory message store for the Agent Messenger.
 *
 * The Agent Messenger is a WhatsApp/Discord-style thread per agent/persona,
 * separate from regular project chats. Always-on agents (planner, assistant,
 * self-clone, neural-map retriever, …) can be messaged back and forth here.
 *
 * Like {@link NotificationService}, threads live in process memory so the
 * feature works identically across MySQL and SQLite without a migration.
 * Reply generation + persistence is driven by agentMessengerRouter.
 */

import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentMessageRole } from "../../shared/notifications.js";

/** Max messages retained per persona thread. */
const MAX_PER_THREAD = 500;

export class AgentMessengerStore {
  private static instance: AgentMessengerStore | null = null;

  /** personaId → newest-last list of messages. */
  private threads = new Map<string, AgentMessage[]>();
  /** personaId → count of agent messages not yet read by the user. */
  private unread = new Map<string, number>();

  static getInstance(): AgentMessengerStore {
    if (!AgentMessengerStore.instance) {
      AgentMessengerStore.instance = new AgentMessengerStore();
    }
    return AgentMessengerStore.instance;
  }

  /** Append a message to a persona thread and return the stored record. */
  append(personaId: string, role: AgentMessageRole, content: string): AgentMessage {
    const message: AgentMessage = {
      id: randomUUID(),
      personaId,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    const thread = this.threads.get(personaId) ?? [];
    thread.push(message);
    if (thread.length > MAX_PER_THREAD) thread.splice(0, thread.length - MAX_PER_THREAD);
    this.threads.set(personaId, thread);

    if (role === "agent") {
      this.unread.set(personaId, (this.unread.get(personaId) ?? 0) + 1);
    }
    return message;
  }

  /** Full ordered thread for a persona (oldest-first). */
  getMessages(personaId: string): AgentMessage[] {
    return this.threads.get(personaId) ?? [];
  }

  /** Last message in a persona thread, if any. */
  lastMessage(personaId: string): AgentMessage | undefined {
    const thread = this.threads.get(personaId);
    return thread && thread.length > 0 ? thread[thread.length - 1] : undefined;
  }

  /** Unread agent-message count for a persona. */
  unreadCount(personaId: string): number {
    return this.unread.get(personaId) ?? 0;
  }

  /** Mark a persona thread as read by the user. */
  markRead(personaId: string): void {
    this.unread.set(personaId, 0);
  }
}
