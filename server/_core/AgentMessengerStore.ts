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
import { eq, and, sql, inArray } from "drizzle-orm";

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

  /**
   * Batched latest-message lookup for many personas in 2 queries (vs. one per
   * persona). `id` is autoincrement → monotonic with insert order, so MAX(id)
   * per persona is the latest row. Returns a personaId → message map.
   */
  async lastMessagesByPersona(userId: number, personaIds: string[]): Promise<Map<string, AgentMessage>> {
    const result = new Map<string, AgentMessage>();
    if (personaIds.length === 0) return result;
    const db = await getDb();
    const latest = await db
      .select({ personaId: messengerMessages.personaId, maxId: sql<number>`max(${messengerMessages.id})` })
      .from(messengerMessages)
      .where(and(
        eq(messengerMessages.userId, userId),
        inArray(messengerMessages.personaId, personaIds),
      ))
      .groupBy(messengerMessages.personaId);
    const ids = latest.map(r => r.maxId).filter((n): n is number => n != null);
    if (ids.length === 0) return result;
    const rows = await db.select().from(messengerMessages).where(inArray(messengerMessages.id, ids));
    for (const r of rows) {
      result.set(r.personaId, {
        id: String(r.id),
        personaId: r.personaId,
        role: r.sender === "agent" ? "agent" : "user",
        content: r.content,
        createdAt: r.createdAt.toISOString(),
      });
    }
    return result;
  }

  /** Batched unread agent-message counts for many personas in one grouped query. */
  async unreadCountsByPersona(userId: number, personaIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (personaIds.length === 0) return result;
    const db = await getDb();
    const rows = await db
      .select({ personaId: messengerMessages.personaId, count: sql<number>`count(*)` })
      .from(messengerMessages)
      .where(and(
        eq(messengerMessages.userId, userId),
        inArray(messengerMessages.personaId, personaIds),
        eq(messengerMessages.sender, "agent"),
        eq(messengerMessages.read, false),
      ))
      .groupBy(messengerMessages.personaId);
    for (const r of rows) result.set(r.personaId, Number(r.count));
    return result;
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
