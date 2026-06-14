/**
 * Unified database schema (sqlite-core / libSQL).
 *
 * Single source of truth for ALL tables. Omnecor standardized on one engine:
 * libSQL/SQLite — embedded & zero-infra for local Sovereign mode, and scalable
 * to networked/multi-node via a Turso URL or embedded replicas. This replaced
 * the previous split (mysql-core schema + a partial hand-mirrored sqlite
 * schema) which left ~13 routers non-functional in the default local mode.
 *
 * Type mapping chosen so inferred TS types match the prior MySQL types:
 *   timestamp        → integer(mode:"timestamp")  → Date
 *   json             → text(mode:"json")          → object (with $type)
 *   mysqlEnum        → text({ enum: [...] })       → string union
 *   int / bigint     → integer                     → number
 *   varchar / text   → text                        → string
 */
import {
  sqliteTable,
  integer,
  text,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const now = () => new Date();

/**
 * Core user table backing auth flow.
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  passwordHash: text("passwordHash"),
  role: text("role", { enum: ["viewer", "user", "admin", "owner"] }).default("user").notNull(),
  executionMode: text("executionMode", { enum: ["sovereign", "scrapper", "big_spender"] }).notNull().default("scrapper"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Integrations table to store OAuth and API integration data.
 */
export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  tokenIv: text("tokenIv"),
  tokenTag: text("tokenTag"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;

/**
 * Chat Sessions — a conversation thread with an AI provider.
 */
export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(), // UUID
  projectId: text("projectId").notNull(),
  title: text("title").notNull(),
  providerId: text("providerId").notNull(),
  modelId: text("modelId").notNull(),
  systemPrompt: text("systemPrompt"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * Chat Messages — an individual message within a chat session.
 */
export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(), // UUID
  sessionId: text("sessionId")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["system", "user", "assistant", "tool", "function"] }).notNull(),
  content: text("content").notNull(),
  tokenCount: integer("tokenCount"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Project Budget — per-project spend limit and alert configuration.
 */
export const projectBudgets = sqliteTable("project_budgets", {
  id: text("id").primaryKey(), // UUID
  projectId: text("projectId").notNull(),
  limitCents: integer("limitCents").notNull().default(0), // 0 = unlimited
  alertThreshold: integer("alertThreshold").notNull().default(80), // percent
  mode: text("mode", { enum: ["soft", "hard"] }).notNull().default("soft"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type ProjectBudget = typeof projectBudgets.$inferSelect;
export type InsertProjectBudget = typeof projectBudgets.$inferInsert;

/**
 * Spend Log — immutable insert-only record of every AI API call cost.
 */
export const spendLog = sqliteTable("spend_log", {
  id: text("id").primaryKey(), // UUID
  projectId: text("projectId").notNull(),
  provider: text("provider").notNull(),
  modelId: text("modelId").notNull(),
  promptTokens: integer("promptTokens").notNull().default(0),
  completionTokens: integer("completionTokens").notNull().default(0),
  estimatedCostMicrocents: integer("estimatedCostMicrocents").notNull().default(0),
  sessionId: text("sessionId"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type SpendLogEntry = typeof spendLog.$inferSelect;
export type InsertSpendLog = typeof spendLog.$inferInsert;

/**
 * Audit Log — immutable insert-only record of every privileged action.
 */
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  eventType: text("eventType").notNull(),
  actorId: integer("actorId"),
  actorType: text("actorType").notNull().default("user"),
  procedure: text("procedure"),
  args: text("args", { mode: "json" }),
  result: text("result", { mode: "json" }),
  ipAddress: text("ipAddress"),
  sessionId: text("sessionId"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
}, (t) => [
  index("audit_log_created_at_idx").on(t.createdAt),
]);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

/**
 * Pipelines — GodMode 5-phase gated pipeline records.
 */
export const pipelines = sqliteTable("pipelines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  status: text("status", { enum: ["pending", "running", "paused", "complete", "aborted"] }).notNull().default("pending"),
  currentPhase: text("currentPhase", { enum: ["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP", "DONE"] }).notNull().default("DEFINE"),
  ownerId: integer("ownerId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});
export type Pipeline = typeof pipelines.$inferSelect;
export type InsertPipeline = typeof pipelines.$inferInsert;

export const pipelinePhases = sqliteTable("pipeline_phases", {
  id: text("id").primaryKey(),
  pipelineId: text("pipelineId").notNull(),
  phase: text("phase", { enum: ["DEFINE", "PLAN", "EXECUTE", "REVIEW", "SHIP"] }).notNull(),
  status: text("status", { enum: ["pending", "awaiting_approval", "approved", "rejected", "complete"] }).notNull().default("pending"),
  inputText: text("inputText"),
  outputText: text("outputText"),
  approvedBy: integer("approvedBy"),
  approvedAt: integer("approvedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});
export type PipelinePhase = typeof pipelinePhases.$inferSelect;
export type InsertPipelinePhase = typeof pipelinePhases.$inferInsert;

/**
 * Cloud Compute Sessions — tracks rented GPU/compute sessions across providers.
 */
export const cloudComputeSessions = sqliteTable("cloud_compute_sessions", {
  id: text("id").primaryKey(),
  userId: integer("userId").notNull(),
  projectId: text("projectId").notNull(),
  provider: text("provider").notNull(),
  externalSessionId: text("externalSessionId"),
  planId: text("planId").notNull(),
  instanceLabel: text("instanceLabel").notNull(),
  billingUnit: text("billingUnit", { enum: ["minute", "hour"] }).notNull().default("hour"),
  ratePerUnitMicrocents: integer("ratePerUnitMicrocents").notNull(),
  status: text("status", { enum: ["starting", "running", "stopped", "error"] }).notNull().default("starting"),
  startedAt: integer("startedAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  stoppedAt: integer("stoppedAt", { mode: "timestamp" }),
  totalCostMicrocents: integer("totalCostMicrocents").notNull().default(0),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type CloudComputeSession = typeof cloudComputeSessions.$inferSelect;
export type InsertCloudComputeSession = typeof cloudComputeSessions.$inferInsert;

/**
 * Cloud Compute Subscriptions — monthly subscription plans with providers.
 */
export const cloudComputeSubscriptions = sqliteTable("cloud_compute_subscriptions", {
  id: text("id").primaryKey(),
  userId: integer("userId").notNull(),
  provider: text("provider").notNull(),
  planName: text("planName").notNull(),
  monthlyCents: integer("monthlyCents").notNull().default(0),
  renewalDate: integer("renewalDate", { mode: "timestamp" }),
  isActive: integer("isActive").notNull().default(1),
  apiKeyHint: text("apiKeyHint"),
  notes: text("notes"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type CloudComputeSubscription = typeof cloudComputeSubscriptions.$inferSelect;
export type InsertCloudComputeSubscription = typeof cloudComputeSubscriptions.$inferInsert;

/**
 * Platform Accounts (OAuth tokens for social media)
 */
export const platformAccounts = sqliteTable("platformAccounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId").notNull(),
  platform: text("platform").notNull(),
  accountName: text("accountName"),
  oauthToken: text("oauthToken").notNull(),
  oauthRefreshToken: text("oauthRefreshToken"),
  tokenExpiresAt: integer("tokenExpiresAt", { mode: "timestamp" }),
  accountMetadata: text("accountMetadata", { mode: "json" }),
  isActive: integer("isActive").default(1),
  lastSyncedAt: integer("lastSyncedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type InsertPlatformAccount = typeof platformAccounts.$inferInsert;

/**
 * Transient OAuth state for the social-media connect flow (CSRF + PKCE).
 */
export const oauthStates = sqliteTable("oauthStates", {
  state: text("state").primaryKey(),
  platform: text("platform").notNull(),
  userId: integer("userId").notNull(),
  codeVerifier: text("codeVerifier"),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type OAuthState = typeof oauthStates.$inferSelect;
export type InsertOAuthState = typeof oauthStates.$inferInsert;

/**
 * Discovered Articles (content to be curated)
 */
export const discoveredArticles = sqliteTable("discoveredArticles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title"),
  url: text("url").unique(),
  urlHash: text("urlHash").unique(),
  source: text("source"),
  content: text("content"),
  summary: text("summary"),
  publishedAt: integer("publishedAt", { mode: "timestamp" }),
  fetchedAt: integer("fetchedAt", { mode: "timestamp" }).$defaultFn(now),
  isProcessed: integer("isProcessed").default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type DiscoveredArticle = typeof discoveredArticles.$inferSelect;
export type InsertDiscoveredArticle = typeof discoveredArticles.$inferInsert;

/**
 * Curated Posts (LLM-generated content for platforms)
 */
export const curatedPosts = sqliteTable("curatedPosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("articleId"),
  platform: text("platform").notNull(),
  content: text("content"),
  metadata: text("metadata", { mode: "json" }),
  status: text("status", { enum: ["draft", "pending_review", "approved", "scheduled", "published", "failed"] }).default("draft"),
  approvalNotes: text("approvalNotes"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type CuratedPost = typeof curatedPosts.$inferSelect;
export type InsertCuratedPost = typeof curatedPosts.$inferInsert;

/**
 * Scheduled Posts
 */
export const scheduledPosts = sqliteTable("scheduledPosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  curatedPostId: integer("curatedPostId").notNull(),
  platformAccountId: integer("platformAccountId").notNull(),
  scheduledAt: integer("scheduledAt", { mode: "timestamp" }),
  publishedAt: integer("publishedAt", { mode: "timestamp" }),
  status: text("status", { enum: ["scheduled", "published", "failed", "cancelled"] }).default("scheduled"),
  errorMessage: text("errorMessage"),
  platformPostId: text("platformPostId"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type InsertScheduledPost = typeof scheduledPosts.$inferInsert;

/**
 * Post Analytics
 */
export const postAnalytics = sqliteTable("postAnalytics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduledPostId: integer("scheduledPostId").notNull(),
  impressions: integer("impressions").default(0),
  reach: integer("reach").default(0),
  likes: integer("likes").default(0),
  shares: integer("shares").default(0),
  comments: integer("comments").default(0),
  clicks: integer("clicks").default(0),
  engagementRate: text("engagementRate"),
  lastUpdatedAt: integer("lastUpdatedAt", { mode: "timestamp" }).$defaultFn(now).$onUpdate(now),
});

export type PostAnalytic = typeof postAnalytics.$inferSelect;
export type InsertPostAnalytic = typeof postAnalytics.$inferInsert;

/**
 * Posting Schedule Configuration
 */
export const postingScheduleConfig = sqliteTable("postingScheduleConfig", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId").notNull(),
  platform: text("platform").notNull(),
  postsPerDay: integer("postsPerDay").default(1),
  autoApprove: integer("autoApprove").default(0),
  optimalPostingTimes: text("optimalPostingTimes", { mode: "json" }),
  timezone: text("timezone").default("UTC"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
});

export type PostingScheduleConfig = typeof postingScheduleConfig.$inferSelect;
export type InsertPostingScheduleConfig = typeof postingScheduleConfig.$inferInsert;

/**
 * Design Projects Table (PCB Editor)
 */
export const designProjects = sqliteTable(
  "design_projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    mode: text("mode").notNull().default("schematic"), // 'schematic' or 'pcb'
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [index("design_projects_user_id_idx").on(t.userId)]
);

export type DesignProject = typeof designProjects.$inferSelect;
export type InsertDesignProject = typeof designProjects.$inferInsert;

/**
 * Design Saves Table (PCB Editor)
 */
export const designSaves = sqliteTable(
  "design_saves",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("projectId").notNull(),
    userId: integer("userId").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    canvasData: text("canvasData", { mode: "json" }).notNull(),
    componentCount: integer("componentCount").default(0),
    connectionCount: integer("connectionCount").default(0),
    version: integer("version").default(1),
    isLatest: integer("isLatest").default(1),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("design_saves_project_id_idx").on(t.projectId),
    index("design_saves_user_id_idx").on(t.userId),
  ]
);

export type DesignSave = typeof designSaves.$inferSelect;
export type InsertDesignSave = typeof designSaves.$inferInsert;

/**
 * Component Library Table (PCB Editor)
 */
export const componentLibraryItems = sqliteTable(
  "component_library_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull(),
    componentId: text("componentId").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    symbolSvg: text("symbolSvg"),
    footprintSvg: text("footprintSvg"),
    properties: text("properties", { mode: "json" }).notNull(),
    handles: text("handles", { mode: "json" }).notNull(),
    manufacturer: text("manufacturer"),
    partNumber: text("partNumber"),
    datasheet: text("datasheet"),
    tags: text("tags", { mode: "json" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("component_library_user_id_idx").on(t.userId),
    index("component_library_id_idx").on(t.componentId),
  ]
);

export type ComponentLibraryItem = typeof componentLibraryItems.$inferSelect;
export type InsertComponentLibraryItem = typeof componentLibraryItems.$inferInsert;

/**
 * Design Exports Table (PCB Editor)
 */
export const designExports = sqliteTable(
  "design_exports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    designSaveId: integer("designSaveId").notNull(),
    userId: integer("userId").notNull(),
    format: text("format").notNull(),
    fileUrl: text("fileUrl").notNull(),
    fileSize: integer("fileSize"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("design_exports_save_id_idx").on(t.designSaveId),
    index("design_exports_user_id_idx").on(t.userId),
  ]
);

export type DesignExport = typeof designExports.$inferSelect;
export type InsertDesignExport = typeof designExports.$inferInsert;

/**
 * AI Design Reviews Table (PCB Editor)
 */
export const aiDesignReviews = sqliteTable(
  "ai_design_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    designSaveId: integer("designSaveId").notNull(),
    userId: integer("userId").notNull(),
    prompt: text("prompt").notNull(),
    response: text("response").notNull(),
    componentCount: integer("componentCount"),
    connectionCount: integer("connectionCount"),
    mode: text("mode"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("ai_reviews_save_id_idx").on(t.designSaveId),
    index("ai_reviews_user_id_idx").on(t.userId),
  ]
);

export type AIDesignReview = typeof aiDesignReviews.$inferSelect;
export type InsertAIDesignReview = typeof aiDesignReviews.$inferInsert;

/**
 * Neural Brain Maps — persistent storage for user-created neural maps.
 */
export const neuralMaps = sqliteTable(
  "neural_maps",
  {
    id: text("id").primaryKey(), // UUID from client
    userId: integer("userId").notNull(),
    name: text("name").notNull(),
    mode: text("mode").notNull().default("standard"),
    rootDirectories: text("rootDirectories", { mode: "json" }).$type<string[]>().notNull(),
    projectContext: text("projectContext", { mode: "json" }).$type<Record<string, unknown>>(),
    labelOverrides: text("labelOverrides", { mode: "json" }).$type<Record<string, string>>(),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [index("neural_maps_user_id_idx").on(t.userId)]
);

export type NeuralMapRow = typeof neuralMaps.$inferSelect;
export type InsertNeuralMap = typeof neuralMaps.$inferInsert;

/**
 * Personas — persistent storage for user-created AI personas.
 */
export const personas = sqliteTable(
  "personas",
  {
    id: text("id").primaryKey(), // UUID from client
    userId: integer("userId").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("self_clone"),
    alwaysOn: integer("alwaysOn").notNull().default(0), // boolean as int
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [index("personas_user_id_idx").on(t.userId)]
);

export type PersonaRow = typeof personas.$inferSelect;
export type InsertPersona = typeof personas.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Relational definitions (Drizzle relational query API)
// ─────────────────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  platformAccounts: many(platformAccounts),
  cloudComputeSessions: many(cloudComputeSessions),
  cloudComputeSubscriptions: many(cloudComputeSubscriptions),
  postingScheduleConfigs: many(postingScheduleConfig),
  neuralMaps: many(neuralMaps),
  personas: many(personas),
  designProjects: many(designProjects),
  designSaves: many(designSaves),
  componentLibraryItems: many(componentLibraryItems),
  designExports: many(designExports),
  aiDesignReviews: many(aiDesignReviews),
  pipelines: many(pipelines),
  oauthStates: many(oauthStates),
}));

export const chatSessionsRelations = relations(chatSessions, ({ many }) => ({
  messages: many(chatMessages),
  spendLogs: many(spendLog),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

export const spendLogRelations = relations(spendLog, ({ one }) => ({
  session: one(chatSessions, {
    fields: [spendLog.sessionId],
    references: [chatSessions.id],
  }),
}));

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  owner: one(users, {
    fields: [pipelines.ownerId],
    references: [users.id],
  }),
  phases: many(pipelinePhases),
}));

export const pipelinePhasesRelations = relations(pipelinePhases, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [pipelinePhases.pipelineId],
    references: [pipelines.id],
  }),
}));

export const platformAccountsRelations = relations(platformAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [platformAccounts.userId],
    references: [users.id],
  }),
  scheduledPosts: many(scheduledPosts),
}));

export const oauthStatesRelations = relations(oauthStates, ({ one }) => ({
  user: one(users, {
    fields: [oauthStates.userId],
    references: [users.id],
  }),
}));

export const discoveredArticlesRelations = relations(discoveredArticles, ({ many }) => ({
  curatedPosts: many(curatedPosts),
}));

export const curatedPostsRelations = relations(curatedPosts, ({ one, many }) => ({
  article: one(discoveredArticles, {
    fields: [curatedPosts.articleId],
    references: [discoveredArticles.id],
  }),
  scheduledPosts: many(scheduledPosts),
}));

export const scheduledPostsRelations = relations(scheduledPosts, ({ one, many }) => ({
  curatedPost: one(curatedPosts, {
    fields: [scheduledPosts.curatedPostId],
    references: [curatedPosts.id],
  }),
  platformAccount: one(platformAccounts, {
    fields: [scheduledPosts.platformAccountId],
    references: [platformAccounts.id],
  }),
  analytics: many(postAnalytics),
}));

export const postAnalyticsRelations = relations(postAnalytics, ({ one }) => ({
  scheduledPost: one(scheduledPosts, {
    fields: [postAnalytics.scheduledPostId],
    references: [scheduledPosts.id],
  }),
}));

export const postingScheduleConfigRelations = relations(postingScheduleConfig, ({ one }) => ({
  user: one(users, {
    fields: [postingScheduleConfig.userId],
    references: [users.id],
  }),
}));

export const cloudComputeSessionsRelations = relations(cloudComputeSessions, ({ one }) => ({
  user: one(users, {
    fields: [cloudComputeSessions.userId],
    references: [users.id],
  }),
}));

export const cloudComputeSubscriptionsRelations = relations(cloudComputeSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [cloudComputeSubscriptions.userId],
    references: [users.id],
  }),
}));

export const designProjectsRelations = relations(designProjects, ({ one, many }) => ({
  user: one(users, {
    fields: [designProjects.userId],
    references: [users.id],
  }),
  saves: many(designSaves),
}));

export const designSavesRelations = relations(designSaves, ({ one, many }) => ({
  project: one(designProjects, {
    fields: [designSaves.projectId],
    references: [designProjects.id],
  }),
  user: one(users, {
    fields: [designSaves.userId],
    references: [users.id],
  }),
  exports: many(designExports),
  aiReviews: many(aiDesignReviews),
}));

export const designExportsRelations = relations(designExports, ({ one }) => ({
  designSave: one(designSaves, {
    fields: [designExports.designSaveId],
    references: [designSaves.id],
  }),
  user: one(users, {
    fields: [designExports.userId],
    references: [users.id],
  }),
}));

export const aiDesignReviewsRelations = relations(aiDesignReviews, ({ one }) => ({
  designSave: one(designSaves, {
    fields: [aiDesignReviews.designSaveId],
    references: [designSaves.id],
  }),
  user: one(users, {
    fields: [aiDesignReviews.userId],
    references: [users.id],
  }),
}));

export const componentLibraryItemsRelations = relations(componentLibraryItems, ({ one }) => ({
  user: one(users, {
    fields: [componentLibraryItems.userId],
    references: [users.id],
  }),
}));

export const neuralMapsRelations = relations(neuralMaps, ({ one }) => ({
  user: one(users, {
    fields: [neuralMaps.userId],
    references: [users.id],
  }),
}));

export const personasRelations = relations(personas, ({ one }) => ({
  user: one(users, {
    fields: [personas.userId],
    references: [users.id],
  }),
}));
