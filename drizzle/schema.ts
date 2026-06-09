import {
  bigint,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  index,
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

/**
 * Platform Accounts (OAuth tokens for social media)
 */
export const platformAccounts = mysqlTable("platformAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  platform: varchar("platform", { length: 50 }).notNull(),
  accountName: varchar("accountName", { length: 255 }),
  oauthToken: text("oauthToken").notNull(),
  oauthRefreshToken: text("oauthRefreshToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  accountMetadata: json("accountMetadata"),
  isActive: int("isActive").default(1),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type InsertPlatformAccount = typeof platformAccounts.$inferInsert;

/**
 * Transient OAuth state for the social-media connect flow (CSRF token + PKCE
 * verifier). Persisted so the flow survives server restarts and works across
 * multiple instances behind a load balancer. Rows are single-use and expire;
 * `expiresAt` is enforced on read and old rows are swept opportunistically.
 */
export const oauthStates = mysqlTable("oauthStates", {
  /** The opaque state token (also the CSRF nonce). */
  state: varchar("state", { length: 128 }).primaryKey(),
  platform: varchar("platform", { length: 50 }).notNull(),
  userId: int("userId").notNull(),
  /** PKCE code_verifier, when the provider flow uses PKCE. */
  codeVerifier: varchar("codeVerifier", { length: 256 }),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OAuthState = typeof oauthStates.$inferSelect;
export type InsertOAuthState = typeof oauthStates.$inferInsert;

/**
 * Discovered Articles (content to be curated)
 */
export const discoveredArticles = mysqlTable("discoveredArticles", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 500 }),
  url: varchar("url", { length: 2048 }).unique(),
  urlHash: varchar("urlHash", { length: 64 }).unique(),
  source: varchar("source", { length: 100 }),
  content: text("content"),
  summary: text("summary"),
  publishedAt: timestamp("publishedAt"),
  fetchedAt: timestamp("fetchedAt").defaultNow(),
  isProcessed: int("isProcessed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DiscoveredArticle = typeof discoveredArticles.$inferSelect;
export type InsertDiscoveredArticle = typeof discoveredArticles.$inferInsert;

/**
 * Curated Posts (LLM-generated content for platforms)
 */
export const curatedPosts = mysqlTable("curatedPosts", {
  id: int("id").autoincrement().primaryKey(),
  articleId: int("articleId"),
  platform: varchar("platform", { length: 50 }).notNull(),
  content: text("content"),
  metadata: json("metadata"),
  status: mysqlEnum("status", ["draft", "pending_review", "approved", "scheduled", "published", "failed"]).default("draft"),
  approvalNotes: text("approvalNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CuratedPost = typeof curatedPosts.$inferSelect;
export type InsertCuratedPost = typeof curatedPosts.$inferInsert;

/**
 * Scheduled Posts
 */
export const scheduledPosts = mysqlTable("scheduledPosts", {
  id: int("id").autoincrement().primaryKey(),
  curatedPostId: int("curatedPostId").notNull(),
  platformAccountId: int("platformAccountId").notNull(),
  scheduledAt: timestamp("scheduledAt"),
  publishedAt: timestamp("publishedAt"),
  status: mysqlEnum("status", ["scheduled", "published", "failed", "cancelled"]).default("scheduled"),
  errorMessage: text("errorMessage"),
  platformPostId: varchar("platformPostId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type InsertScheduledPost = typeof scheduledPosts.$inferInsert;

/**
 * Post Analytics
 */
export const postAnalytics = mysqlTable("postAnalytics", {
  id: int("id").autoincrement().primaryKey(),
  scheduledPostId: int("scheduledPostId").notNull(),
  impressions: int("impressions").default(0),
  reach: int("reach").default(0),
  likes: int("likes").default(0),
  shares: int("shares").default(0),
  comments: int("comments").default(0),
  clicks: int("clicks").default(0),
  engagementRate: varchar("engagementRate", { length: 10 }),
  lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().onUpdateNow(),
});

export type PostAnalytic = typeof postAnalytics.$inferSelect;
export type InsertPostAnalytic = typeof postAnalytics.$inferInsert;

/**
 * Posting Schedule Configuration
 */
export const postingScheduleConfig = mysqlTable("postingScheduleConfig", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  platform: varchar("platform", { length: 50 }).notNull(),
  postsPerDay: int("postsPerDay").default(1),
  autoApprove: int("autoApprove").default(0),
  optimalPostingTimes: json("optimalPostingTimes"),
  timezone: varchar("timezone", { length: 50 }).default("UTC"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PostingScheduleConfig = typeof postingScheduleConfig.$inferSelect;
export type InsertPostingScheduleConfig = typeof postingScheduleConfig.$inferInsert;

/**
 * Design Projects Table (PCB Editor)
 */
export const designProjects = mysqlTable(
  "design_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    mode: varchar("mode", { length: 20 }).notNull().default("schematic"), // 'schematic' or 'pcb'
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("design_projects_user_id_idx").on(table.userId),
  })
);

export type DesignProject = typeof designProjects.$inferSelect;
export type InsertDesignProject = typeof designProjects.$inferInsert;

/**
 * Design Saves Table (PCB Editor)
 */
export const designSaves = mysqlTable(
  "design_saves",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    canvasData: json("canvasData").notNull(),
    componentCount: int("componentCount").default(0),
    connectionCount: int("connectionCount").default(0),
    version: int("version").default(1),
    isLatest: int("isLatest").default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    projectIdIdx: index("design_saves_project_id_idx").on(table.projectId),
    userIdIdx: index("design_saves_user_id_idx").on(table.userId),
  })
);

export type DesignSave = typeof designSaves.$inferSelect;
export type InsertDesignSave = typeof designSaves.$inferInsert;

/**
 * Component Library Table (PCB Editor)
 */
export const componentLibraryItems = mysqlTable(
  "component_library_items",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    componentId: varchar("componentId", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    description: text("description"),
    symbolSvg: text("symbolSvg"),
    footprintSvg: text("footprintSvg"),
    properties: json("properties").notNull(),
    handles: json("handles").notNull(),
    manufacturer: varchar("manufacturer", { length: 255 }),
    partNumber: varchar("partNumber", { length: 255 }),
    datasheet: varchar("datasheet", { length: 512 }),
    tags: json("tags").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("component_library_user_id_idx").on(table.userId),
    componentIdIdx: index("component_library_id_idx").on(table.componentId),
  })
);

export type ComponentLibraryItem = typeof componentLibraryItems.$inferSelect;
export type InsertComponentLibraryItem = typeof componentLibraryItems.$inferInsert;

/**
 * Design Exports Table (PCB Editor)
 */
export const designExports = mysqlTable(
  "design_exports",
  {
    id: int("id").autoincrement().primaryKey(),
    designSaveId: int("designSaveId").notNull(),
    userId: int("userId").notNull(),
    format: varchar("format", { length: 20 }).notNull(),
    fileUrl: varchar("fileUrl", { length: 512 }).notNull(),
    fileSize: int("fileSize"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    designSaveIdIdx: index("design_exports_save_id_idx").on(table.designSaveId),
    userIdIdx: index("design_exports_user_id_idx").on(table.userId),
  })
);

export type DesignExport = typeof designExports.$inferSelect;
export type InsertDesignExport = typeof designExports.$inferInsert;

/**
 * AI Design Reviews Table (PCB Editor)
 */
export const aiDesignReviews = mysqlTable(
  "ai_design_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    designSaveId: int("designSaveId").notNull(),
    userId: int("userId").notNull(),
    prompt: text("prompt").notNull(),
    response: text("response").notNull(),
    componentCount: int("componentCount"),
    connectionCount: int("connectionCount"),
    mode: varchar("mode", { length: 20 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    designSaveIdIdx: index("ai_reviews_save_id_idx").on(table.designSaveId),
    userIdIdx: index("ai_reviews_user_id_idx").on(table.userId),
  })
);

export type AIDesignReview = typeof aiDesignReviews.$inferSelect;
export type InsertAIDesignReview = typeof aiDesignReviews.$inferInsert;

/**
 * Neural Brain Maps — persistent storage for user-created neural maps.
 * Replaces localStorage as the canonical store; localStorage remains a fast cache.
 */
export const neuralMaps = mysqlTable(
  "neural_maps",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // UUID from client
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    mode: varchar("mode", { length: 50 }).notNull().default("standard"),
    rootDirectories: json("rootDirectories").$type<string[]>().notNull(),
    projectContext: json("projectContext").$type<Record<string, unknown>>(),
    labelOverrides: json("labelOverrides").$type<Record<string, string>>(),
    settings: json("settings").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("neural_maps_user_id_idx").on(table.userId),
  })
);

export type NeuralMapRow = typeof neuralMaps.$inferSelect;
export type InsertNeuralMap = typeof neuralMaps.$inferInsert;

/**
 * Personas — persistent storage for user-created AI personas.
 * Full Persona JSON stored in the `data` column; key fields indexed for queries.
 */
export const personas = mysqlTable(
  "personas",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // UUID from client
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    type: varchar("type", { length: 50 }).notNull().default("self_clone"),
    alwaysOn: int("alwaysOn").notNull().default(0), // MySQL boolean as int
    data: json("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("personas_user_id_idx").on(table.userId),
  })
);

export type PersonaRow = typeof personas.$inferSelect;
export type InsertPersona = typeof personas.$inferInsert;
