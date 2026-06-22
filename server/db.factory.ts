/**
 * Database access — single unified backend (libSQL / SQLite).
 *
 * Omnecor standardized on one engine, so this module is now a thin re-export of
 * `db.ts`. It is kept as the canonical import path (`db.factory`) so existing
 * callers are unchanged. `getDb()` always returns a live drizzle instance in
 * every mode (local file by default, remote libsql/Turso when configured).
 */

import { eq } from "drizzle-orm";
import { getDb, getMigrationStatus } from "./db.js";
import { users } from "../drizzle/schema.js";

export {
  getDb,
  getMigrationStatus,
  upsertUser,
  getUserByOpenId,
  publicUser,
  createChatSession,
  getChatSessions,
  getChatSession,
  updateChatSession,
  addChatMessage,
  getChatMessages,
  auditInsert,
  auditPurgeBefore,
  auditList,
  auditListByActor,
  auditStats,
} from "./db.js";

export async function updateUserExecutionMode(
  userId: number,
  mode: "sovereign" | "scrapper" | "big_spender",
) {
  const db = await getDb();
  await db.update(users).set({ executionMode: mode }).where(eq(users.id, userId));
}
