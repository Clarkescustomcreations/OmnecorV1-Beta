import { eq, asc, desc, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  chatSessions,
  chatMessages,
  auditLog,
  InsertChatSession,
  InsertChatMessage,
  InsertAuditLog,
} from "../drizzle/schema.js";
import { ENV } from "./_core/env.js";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
// Returns null when SQLite is the active backend (OMNECOR_DB=sqlite, or "auto"
// with no DATABASE_URL) — raw-drizzle callers null-guard and the high-level
// domain functions route through db.factory to the SQLite store instead.
export async function getDb() {
  if (ENV.dbMode === "sqlite") return null;
  if (!_db && ENV.databaseUrl) {
    try {
      _db = drizzle(ENV.databaseUrl);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Persistence (D1)
// ─────────────────────────────────────────────────────────────────────────────

export async function createChatSession(session: InsertChatSession) {
  const db = await getDb();
  if (!db) return;
  await db.insert(chatSessions).values(session);
}

export async function getChatSessions(projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.projectId, projectId))
    .orderBy(desc(chatSessions.createdAt));
}

export async function getChatSession(sessionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateChatSession(
  sessionId: string,
  updates: Partial<InsertChatSession>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(chatSessions)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));
}

export async function addChatMessage(message: InsertChatMessage) {
  const db = await getDb();
  if (!db) return;
  await db.insert(chatMessages).values(message);
}

export async function getChatMessages(sessionId: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));
}

// ---------------------------------------------------------------------------
// Audit log — append-only; the retention purge is the only deletion path
// ---------------------------------------------------------------------------

export async function auditInsert(entry: InsertAuditLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLog).values(entry);
}

/** Delete entries older than `cutoff`; returns the number of rows removed. */
export async function auditPurgeBefore(cutoff: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

export async function auditList(limit: number, offset: number) {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };
  const [entries, countRows] = await Promise.all([
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditLog),
  ]);
  return { entries, total: Number(countRows[0]?.count ?? 0) };
}

export async function auditListByActor(actorId: number, limit: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.actorId, actorId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

export async function auditStats(): Promise<{
  dbActive: boolean;
  entries: number;
  oldestEntryAt: string | null;
  approxBytes: number;
}> {
  const db = await getDb();
  if (!db) return { dbActive: false, entries: 0, oldestEntryAt: null, approxBytes: 0 };
  const [countRows, oldestRows, sizeRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(auditLog),
    db.select({ oldest: sql<Date | null>`min(${auditLog.createdAt})` }).from(auditLog),
    // information_schema gives real table+index size on MySQL; fall back to a
    // conservative per-row estimate if the query fails.
    db
      .execute(
        sql`SELECT (data_length + index_length) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'audit_log'`
      )
      .catch(() => null),
  ]);
  const entries = Number(countRows[0]?.count ?? 0);
  const oldestRaw = oldestRows[0]?.oldest ?? null;
  const oldestEntryAt = oldestRaw ? new Date(oldestRaw).toISOString() : null;
  let approxBytes = entries * 768;
  if (sizeRows) {
    const rows = (sizeRows as unknown as [Array<{ bytes?: number | string }>])[0];
    const bytes = Number(rows?.[0]?.bytes ?? 0);
    if (bytes > 0) approxBytes = bytes;
  }
  return { dbActive: true, entries, oldestEntryAt, approxBytes };
}
