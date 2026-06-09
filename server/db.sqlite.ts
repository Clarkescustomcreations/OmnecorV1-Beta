/**
 * SQLite fallback layer for Sovereign Mode (offline / air-gapped deployments).
 *
 * Activated automatically when DATABASE_URL is unset. Provides the same
 * high-level function exports as db.ts so callers are unaffected.
 *
 * Limitations vs MySQL mode:
 *  - Pipelines, audit log, spend tracking, virtual cards, and integrations
 *    are not persisted in SQLite — callers that use getDb() directly will
 *    receive null and should already handle that gracefully.
 *  - No onDuplicateKeyUpdate support — upserts use insert-or-replace.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, asc, desc } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
} from "drizzle-orm/sqlite-core";
import path from "path";
import fs from "fs";
import { createLogger } from "./_core/logger.js";
import { PATHS } from "./_core/paths.js";

const log = createLogger("db:sqlite");

// ---------------------------------------------------------------------------
// Schema — mirrors MySQL schema using SQLite-compatible types
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role", { enum: ["viewer", "user", "admin", "owner"] }).notNull().default("user"),
  executionMode: text("executionMode", { enum: ["sovereign", "scrapper", "big_spender"] }).notNull().default("scrapper"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

type SqliteInsertUser = typeof users.$inferInsert;

const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  projectId: text("projectId").notNull(),
  title: text("title").notNull(),
  providerId: text("providerId").notNull(),
  modelId: text("modelId").notNull(),
  systemPrompt: text("systemPrompt"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

type SqliteInsertChatSession = typeof chatSessions.$inferInsert;

const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("sessionId").notNull(),
  role: text("role", { enum: ["system", "user", "assistant", "tool", "function"] }).notNull(),
  content: text("content").notNull(),
  tokenCount: integer("tokenCount"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

type SqliteInsertChatMessage = typeof chatMessages.$inferInsert;

// ---------------------------------------------------------------------------
// Connection — lazy singleton
// ---------------------------------------------------------------------------

let _sqliteDb: ReturnType<typeof drizzle> | null = null;

const SQLITE_PATH = process.env.SQLITE_PATH ?? PATHS.sqlite;

export function getSqliteDb(): ReturnType<typeof drizzle> {
  if (_sqliteDb) return _sqliteDb;

  const dir = path.dirname(SQLITE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const raw = new Database(SQLITE_PATH);

  // Enable WAL mode for better concurrent read performance
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  _sqliteDb = drizzle(raw, { schema: { users, chatSessions, chatMessages } });

  // Create tables if they don't exist (lightweight migration substitute)
  raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      openId TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      loginMethod TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      executionMode TEXT NOT NULL DEFAULT 'scrapper',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastSignedIn INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      providerId TEXT NOT NULL,
      modelId TEXT NOT NULL,
      systemPrompt TEXT,
      metadata TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tokenCount INTEGER,
      createdAt INTEGER NOT NULL
    );
  `);

  log.info("SQLite database opened", { path: SQLITE_PATH });
  return _sqliteDb;
}

// ---------------------------------------------------------------------------
// Domain functions — same signatures as db.ts
// ---------------------------------------------------------------------------

export async function upsertUser(user: SqliteInsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = getSqliteDb();
  const now = new Date();

  const existing = await db.select().from(users).where(eq(users.openId, user.openId)).limit(1);

  if (existing.length > 0) {
    const update: Partial<SqliteInsertUser> = { updatedAt: now, lastSignedIn: now };
    if (user.name !== undefined) update.name = user.name;
    if (user.email !== undefined) update.email = user.email;
    if (user.loginMethod !== undefined) update.loginMethod = user.loginMethod;
    if (user.role !== undefined) update.role = user.role;
    if (user.lastSignedIn !== undefined) update.lastSignedIn = user.lastSignedIn;

    await db.update(users).set(update).where(eq(users.openId, user.openId));
  } else {
    await db.insert(users).values({
      ...user,
      createdAt: user.createdAt ?? now,
      updatedAt: now,
      lastSignedIn: user.lastSignedIn ?? now,
    });
  }
}

export async function getUserByOpenId(openId: string) {
  const db = getSqliteDb();
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createChatSession(session: SqliteInsertChatSession) {
  const db = getSqliteDb();
  await db.insert(chatSessions).values(session);
}

export async function getChatSessions(projectId: string) {
  const db = getSqliteDb();
  return db.select().from(chatSessions).where(eq(chatSessions.projectId, projectId)).orderBy(desc(chatSessions.createdAt));
}

export async function getChatSession(sessionId: string) {
  const db = getSqliteDb();
  const result = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateChatSession(sessionId: string, updates: Partial<SqliteInsertChatSession>) {
  const db = getSqliteDb();
  await db.update(chatSessions).set({ ...updates, updatedAt: new Date() }).where(eq(chatSessions.id, sessionId));
}

export async function addChatMessage(message: SqliteInsertChatMessage) {
  const db = getSqliteDb();
  await db.insert(chatMessages).values(message);
}

export async function getChatMessages(sessionId: string) {
  const db = getSqliteDb();
  return db.select().from(chatMessages).where(eq(chatMessages.sessionId, sessionId)).orderBy(asc(chatMessages.createdAt));
}
