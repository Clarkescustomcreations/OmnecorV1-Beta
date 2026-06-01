/**
 * Database factory — selects MySQL or SQLite at startup.
 *
 * MySQL is used when DATABASE_URL is set (production / development with a DB).
 * SQLite is used when DATABASE_URL is absent (Sovereign Mode offline operation).
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

const isMySql = Boolean(ENV.databaseUrl);

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
