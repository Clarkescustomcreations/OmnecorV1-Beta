import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Integrations table to store OAuth and API integration data.
 */
export const integrations = mysqlTable("integrations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  provider: varchar("provider", { length: 64 }).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: timestamp("expiresAt"),
  tokenIv: varchar("tokenIv", { length: 64 }),
  tokenTag: varchar("tokenTag", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;

/**
 * Chat Sessions (D1 - Chat Persistence)
 * Represents a conversation thread with an AI provider.
 */
export const chatSessions = mysqlTable("chat_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  projectId: varchar("projectId", { length: 64 }).notNull(),
  title: text("title").notNull(),
  providerId: varchar("providerId", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 64 }).notNull(),
  systemPrompt: text("systemPrompt"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * Chat Messages (D1 - Chat Persistence)
 * Represents an individual message within a chat session.
 */
export const chatMessages = mysqlTable("chat_messages", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  sessionId: varchar("sessionId", { length: 36 })
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", [
    "system",
    "user",
    "assistant",
    "tool",
    "function",
  ]).notNull(),
  content: text("content").notNull(), // text content or JSON representation of tool calls
  tokenCount: int("tokenCount"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;
