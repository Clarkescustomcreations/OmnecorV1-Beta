/**
 * @file server/_core/AgentMessengerStore.ts
 * @description SQLite-persisted message store for the Agent Messenger.
 *
 * The Agent Messenger is a WhatsApp/Discord-style thread per agent/persona,
 * separate from regular project chats. Always-on agents can be messaged back and forth here.
 *
 * Threads are persisted in the SQLite database to survive service restarts.
 */

import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentMessageRole } from "../../shared/notifications.js";
import { getDb } from "../db.factory.js";
import { messengerMessages } from "../../drizzle/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

export class AgentMessengerStore {
  private static instance: AgentMessengerStore | null = null;

  static getInstance(): AgentMessengerStore {
    if (!AgentMessengerStore.instance) {
      AgentMessengerStore.instance = new AgentMessengerStore();
    }
    return AgentMessengerStore.instance;
  }

  /** Append a message to a persona thread and return the stored record. */
  async append(userId: number, personaId: string, role: AgentMessageRole, content: string): Promise<AgentMessage> {
    const db = await getDb();
    const inserted = await db.insert(messengerMessages).values({
      userId,
      personaId,
      sender: role === "agent" ? "agent" : "user",
      content,
    }).returning({ id: messengerMessages.id, createdAt: messengerMessages.createdAt });

    const msgId = inserted[0]?.id ? String(inserted[0].id) : randomUUID();
    const message: AgentMessage = {
      id: msgId,
      personaId,
      role,
      content,
      createdAt: (inserted[0]?.createdAt ?? new Date()).toISOString(),
    };

    // Agent messages persist with read=false (column default); the unread count
    // is derived from the DB so it survives restarts.
    return message;
  }

  /** Full ordered thread for a persona (oldest-first). */
  async getMessages(userId: number, personaId: string): Promise<AgentMessage[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(messengerMessages)
      .where(
        and(
          eq(messengerMessages.userId, userId),
          eq(messengerMessages.personaId, personaId)
        )
      )
      .orderBy(messengerMessages.createdAt);

    return rows.map(r => ({
      id: String(r.id),
      personaId: r.personaId,
      role: r.sender === "agent" ? "agent" : "user",
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Last message in a persona thread, if any. */
  async lastMessage(userId: number, personaId: string): Promise<AgentMessage | undefined> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(messengerMessages)
      .where(
        and(
          eq(messengerMessages.userId, userId),
          eq(messengerMessages.personaId, personaId)
        )
      )
      .orderBy(desc(messengerMessages.createdAt))
      .limit(1);

    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: String(r.id),
      personaId: r.personaId,
      role: r.sender === "agent" ? "agent" : "user",
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Unread agent-message count for a persona (persisted; survives restarts). */
  async unreadCount(userId: number, personaId: string): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(messengerMessages)
      .where(
        and(
          eq(messengerMessages.userId, userId),
          eq(messengerMessages.personaId, personaId),
          eq(messengerMessages.sender, "agent"),
          eq(messengerMessages.read, false)
        )
      );
    return Number(rows[0]?.count ?? 0);
  }

  /** Mark a persona thread's agent messages as read by the user. */
  async markRead(userId: number, personaId: string): Promise<void> {
    const db = await getDb();
    await db
      .update(messengerMessages)
      .set({ read: true })
      .where(
        and(
          eq(messengerMessages.userId, userId),
          eq(messengerMessages.personaId, personaId),
          eq(messengerMessages.sender, "agent"),
          eq(messengerMessages.read, false)
        )
      );
  }
}
