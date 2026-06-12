/**
 * Database factory — selects MySQL or SQLite at startup.
 *
 * Default ("auto"): MySQL when DATABASE_URL is set, else the local SQLite store
 * (Sovereign Mode offline operation). Set OMNECOR_DB=mysql|sqlite to force one.
 *
 * Callers that need the raw drizzle instance via getDb() will receive null in
 * SQLite mode — those callers already null-guard and degrade gracefully. The
 * higher-level functions (upsertUser, getChatSessions, etc.) work in both modes.
 */

import { ENV } from "./_core/env.js";

// ---------------------------------------------------------------------------
// getDb — raw drizzle instance (MySQL only; null in SQLite mode)
// ---------------------------------------------------------------------------

export { getDb } from "./db.js";

// ---------------------------------------------------------------------------
// High-level domain functions — route to the right implementation
// ---------------------------------------------------------------------------

const isMySql =
  ENV.dbMode === "mysql"
    ? true
    : ENV.dbMode === "sqlite"
      ? false
      : Boolean(ENV.databaseUrl); // "auto": MySQL when a URL is configured

// Lazy-require so the TS import doesn't force both backends to load at once
type DbModule = typeof import("./db.js");
type SqliteModule = typeof import("./db.sqlite.js");

let _mysql: DbModule | undefined;
let _sqlite: SqliteModule | undefined;

async function mysql(): Promise<DbModule> {
  if (!_mysql) _mysql = await import("./db.js");
  return _mysql;
}

async function sqlite(): Promise<SqliteModule> {
  if (!_sqlite) _sqlite = await import("./db.sqlite.js");
  return _sqlite;
}

// ---------------------------------------------------------------------------
// Exported functions — delegate to the active backend
// ---------------------------------------------------------------------------

export async function upsertUser(...args: Parameters<DbModule["upsertUser"]>) {
  if (isMySql) return (await mysql()).upsertUser(...args);
  return (await sqlite()).upsertUser(...args);
}

export async function getUserByOpenId(...args: Parameters<DbModule["getUserByOpenId"]>): ReturnType<DbModule["getUserByOpenId"]> {
  if (isMySql) return (await mysql()).getUserByOpenId(...args);
  const r = await (await sqlite()).getUserByOpenId(...args);
  // SQLite result shape is compatible with MySQL result shape for callers
  return r as Awaited<ReturnType<DbModule["getUserByOpenId"]>>;
}

export async function createChatSession(...args: Parameters<DbModule["createChatSession"]>) {
  if (isMySql) return (await mysql()).createChatSession(...args);
  return (await sqlite()).createChatSession(...args);
}

export async function getChatSessions(...args: Parameters<DbModule["getChatSessions"]>) {
  if (isMySql) return (await mysql()).getChatSessions(...args);
  const rows = await (await sqlite()).getChatSessions(...args);
  return rows as Awaited<ReturnType<DbModule["getChatSessions"]>>;
}

export async function getChatSession(...args: Parameters<DbModule["getChatSession"]>) {
  if (isMySql) return (await mysql()).getChatSession(...args);
  const row = await (await sqlite()).getChatSession(...args);
  return row as Awaited<ReturnType<DbModule["getChatSession"]>>;
}

export async function updateChatSession(...args: Parameters<DbModule["updateChatSession"]>) {
  if (isMySql) return (await mysql()).updateChatSession(...args);
  return (await sqlite()).updateChatSession(...args as Parameters<SqliteModule["updateChatSession"]>);
}

export async function addChatMessage(...args: Parameters<DbModule["addChatMessage"]>) {
  if (isMySql) return (await mysql()).addChatMessage(...args);
  return (await sqlite()).addChatMessage(...args);
}

export async function getChatMessages(...args: Parameters<DbModule["getChatMessages"]>) {
  if (isMySql) return (await mysql()).getChatMessages(...args);
  const rows = await (await sqlite()).getChatMessages(...args);
  return rows as Awaited<ReturnType<DbModule["getChatMessages"]>>;
}

// ---------------------------------------------------------------------------
// Audit log — append-only with retention purge; identical contract in both
// backends so the retention schedule applies equally in Sovereign/SQLite mode.
// ---------------------------------------------------------------------------

export async function auditInsert(...args: Parameters<DbModule["auditInsert"]>) {
  if (isMySql) return (await mysql()).auditInsert(...args);
  return (await sqlite()).auditInsert(...args as Parameters<SqliteModule["auditInsert"]>);
}

export async function auditPurgeBefore(...args: Parameters<DbModule["auditPurgeBefore"]>) {
  if (isMySql) return (await mysql()).auditPurgeBefore(...args);
  return (await sqlite()).auditPurgeBefore(...args);
}

export async function auditList(...args: Parameters<DbModule["auditList"]>) {
  if (isMySql) return (await mysql()).auditList(...args);
  const r = await (await sqlite()).auditList(...args);
  return r as Awaited<ReturnType<DbModule["auditList"]>>;
}

export async function auditListByActor(...args: Parameters<DbModule["auditListByActor"]>) {
  if (isMySql) return (await mysql()).auditListByActor(...args);
  const rows = await (await sqlite()).auditListByActor(...args);
  return rows as Awaited<ReturnType<DbModule["auditListByActor"]>>;
}

export async function auditStats(): ReturnType<DbModule["auditStats"]> {
  if (isMySql) return (await mysql()).auditStats();
  return (await sqlite()).auditStats();
}

export async function updateUserExecutionMode(userId: number, mode: "sovereign" | "scrapper" | "big_spender") {
  const { eq } = await import("drizzle-orm");
  if (isMySql) {
    const db = await (await mysql()).getDb();
    if (db) {
      const { users } = await import("../drizzle/schema.js");
      await db.update(users).set({ executionMode: mode }).where(eq(users.id, userId));
    }
  } else {
    const db = (await sqlite()).getSqliteDb();
    const { users } = await import("./db.sqlite.js");
    await db.update(users).set({ executionMode: mode }).where(eq(users.id, userId as any));
  }
}

