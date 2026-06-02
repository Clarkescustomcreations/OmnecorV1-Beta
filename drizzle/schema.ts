import {
  bigint,
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
  role: mysqlEnum("role", ["viewer", "user", "admin", "owner"]).default("user").notNull(),
  executionMode: mysqlEnum("executionMode", ["sovereign", "scrapper", "big_spender"]).notNull().default("scrapper"),
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

/**
 * Project Budget — per-project spend limit and alert configuration.
 * Agentic Wallet Phase 13.
 */
export const projectBudgets = mysqlTable("project_budgets", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  projectId: varchar("projectId", { length: 64 }).notNull(),
  limitCents: int("limitCents").notNull().default(0), // 0 = unlimited
  alertThreshold: int("alertThreshold").notNull().default(80), // percent
  mode: mysqlEnum("mode", ["soft", "hard"]).notNull().default("soft"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectBudget = typeof projectBudgets.$inferSelect;
export type InsertProjectBudget = typeof projectBudgets.$inferInsert;

/**
 * Spend Log — immutable insert-only record of every AI API call cost.
 * Never update or delete rows from this table.
 * Agentic Wallet Phase 13.
 */
export const spendLog = mysqlTable("spend_log", {
  id: varchar("id", { length: 36 }).primaryKey(), // UUID
  projectId: varchar("projectId", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 64 }).notNull(),
  promptTokens: int("promptTokens").notNull().default(0),
  completionTokens: int("completionTokens").notNull().default(0),
  estimatedCostMicrocents: bigint("estimatedCostMicrocents", { mode: "number" }).notNull().default(0),
  sessionId: varchar("sessionId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SpendLogEntry = typeof spendLog.$inferSelect;
export type InsertSpendLog = typeof spendLog.$inferInsert;

/**
 * Audit Log — immutable insert-only record of every privileged action.
 * Never update or delete rows from this table.
 * Immutable Audit Log Phase 20.
 */
export const auditLog = mysqlTable("audit_log", {
  id: varchar("id", { length: 36 }).primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  actorId: int("actorId"),
  actorType: varchar("actorType", { length: 32 }).notNull().default("user"),
  procedure: varchar("procedure", { length: 128 }),
  args: json("args"),
  result: json("result"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  sessionId: varchar("sessionId", { length: 36 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

/**
 * Pipelines — GodMode 5-phase gated pipeline records.
 * Phase 28.
 */
export const pipelines = mysqlTable("pipelines", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  goal: text("goal").notNull(),
  status: mysqlEnum("status", ["pending", "running", "paused", "complete", "aborted"]).notNull().default("pending"),
  currentPhase: mysqlEnum("currentPhase", ["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP", "DONE"]).notNull().default("DEFINE"),
  ownerId: int("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Pipeline = typeof pipelines.$inferSelect;
export type InsertPipeline = typeof pipelines.$inferInsert;

export const pipelinePhases = mysqlTable("pipeline_phases", {
  id: varchar("id", { length: 36 }).primaryKey(),
  pipelineId: varchar("pipelineId", { length: 36 }).notNull(),
  phase: mysqlEnum("phase", ["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP"]).notNull(),
  status: mysqlEnum("status", ["pending", "awaiting_approval", "approved", "rejected", "complete"]).notNull().default("pending"),
  inputText: text("inputText"),
  outputText: text("outputText"),
  approvedBy: int("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PipelinePhase = typeof pipelinePhases.$inferSelect;
export type InsertPipelinePhase = typeof pipelinePhases.$inferInsert;

/**
 * Cloud Compute Sessions — tracks rented GPU/compute sessions across providers.
 * Integrates with the Agentic Wallet spend log on session stop.
 */
export const cloudComputeSessions = mysqlTable("cloud_compute_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(), // "vastai" | "runpod" | "lambda"
  externalSessionId: varchar("externalSessionId", { length: 128 }),
  planId: varchar("planId", { length: 64 }).notNull(),
  instanceLabel: varchar("instanceLabel", { length: 128 }).notNull(),
  billingUnit: mysqlEnum("billingUnit", ["minute", "hour"]).notNull().default("hour"),
  ratePerUnitMicrocents: bigint("ratePerUnitMicrocents", { mode: "number" }).notNull(),
  status: mysqlEnum("status", ["starting", "running", "stopped", "error"]).notNull().default("starting"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  stoppedAt: timestamp("stoppedAt"),
  totalCostMicrocents: bigint("totalCostMicrocents", { mode: "number" }).notNull().default(0),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CloudComputeSession = typeof cloudComputeSessions.$inferSelect;
export type InsertCloudComputeSession = typeof cloudComputeSessions.$inferInsert;

/**
 * Cloud Compute Subscriptions — tracks monthly subscription plans a user has
 * with cloud compute providers (e.g. a RunPod monthly credit pack).
 */
export const cloudComputeSubscriptions = mysqlTable("cloud_compute_subscriptions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  planName: varchar("planName", { length: 128 }).notNull(),
  monthlyCents: int("monthlyCents").notNull().default(0),
  renewalDate: timestamp("renewalDate"),
  isActive: int("isActive").notNull().default(1),
  apiKeyHint: varchar("apiKeyHint", { length: 32 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CloudComputeSubscription = typeof cloudComputeSubscriptions.$inferSelect;
export type InsertCloudComputeSubscription = typeof cloudComputeSubscriptions.$inferInsert;
