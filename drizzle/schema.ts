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
  real,
  index,
  uniqueIndex,
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
  // "device" is never written to a user row — it is applied at auth time to a
  // paired-phone token (see sdk.authenticateRequest). It is listed here only so
  // the inferred User["role"] type accommodates the auth-time cap. SQLite text
  // enums are a TS-level constraint (no CHECK is emitted), so this is type-only.
  role: text("role", { enum: ["viewer", "user", "admin", "owner", "device"] }).default("user").notNull(),
  executionMode: text("executionMode", { enum: ["sovereign", "scrapper", "big_spender"] }).notNull().default("scrapper"),
  tosAcceptedAt: integer("tosAcceptedAt", { mode: "timestamp" }),
  // Which ToS version the user accepted (shared/tos.ts TOS_VERSION). Compared
  // against the current version to re-prompt acceptance after the terms change.
  tosAcceptedVersion: text("tosAcceptedVersion"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Paired mobile devices (Omnecor HQ APK) — persistent record of phones paired to
 * this PC via a one-time pairing code or OMMESH auto-pair. The minted session JWT
 * carries `deviceId`; setting `revokedAt` invalidates that phone's token. This
 * survives PC restarts, so a paired phone never has to re-pair.
 */
export const pairedDevices = sqliteTable("paired_devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("deviceId").notNull().unique(), // random id minted at pair time, embedded in the JWT
  openId: text("openId").notNull(),              // the desktop user this device is paired to
  name: text("name").notNull().default("Phone"), // friendly device name reported by the APK
  pairMethod: text("pairMethod", { enum: ["code", "ommesh"] }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  lastSeenAt: integer("lastSeenAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  revokedAt: integer("revokedAt", { mode: "timestamp" }), // non-null = revoked
}, (t) => ({
  openIdIdx: index("paired_devices_openId_idx").on(t.openId),
}));

export type PairedDevice = typeof pairedDevices.$inferSelect;
export type InsertPairedDevice = typeof pairedDevices.$inferInsert;

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
  // Nullable: this column is added to an existing table via ALTER (migration
  // 0003), and SQLite cannot ALTER-ADD a NOT NULL + FK column. New rows always
  // set userId (chatRouter scopes by ctx.user.id); legacy rows are backfilled.
  userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
  projectId: text("projectId").notNull().default(""),
  title: text("title").notNull(),
  providerId: text("providerId").notNull(),
  modelId: text("modelId").notNull(),
  systemPrompt: text("systemPrompt"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
}, (t) => [
  index("chat_sessions_user_idx").on(t.userId),
]);

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
}, (t) => [
  index("chat_messages_session_idx").on(t.sessionId),
]);

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
  projectId: text("projectId"),
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
}, (t) => [
  index("cloud_compute_sessions_user_idx").on(t.userId),
  index("cloud_compute_sessions_project_idx").on(t.projectId),
]);

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
}, (t) => [
  index("platform_accounts_user_idx").on(t.userId),
]);

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
  projectId: text("projectId").references(() => neuralMaps.id, { onDelete: "cascade" }),
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
}, (t) => [
  index("discovered_articles_project_idx").on(t.projectId),
]);

export type DiscoveredArticle = typeof discoveredArticles.$inferSelect;
export type InsertDiscoveredArticle = typeof discoveredArticles.$inferInsert;

/**
 * Curated Posts (LLM-generated content for platforms)
 */
export const curatedPosts = sqliteTable("curatedPosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("projectId").references(() => neuralMaps.id, { onDelete: "cascade" }),
  articleId: integer("articleId"),
  createdByUserId: integer("createdByUserId").references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  content: text("content"),
  metadata: text("metadata", { mode: "json" }),
  status: text("status", { enum: ["draft", "pending_review", "approved", "scheduled", "published", "failed"] }).default("draft"),
  approvalNotes: text("approvalNotes"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
}, (t) => [
  index("curated_posts_project_idx").on(t.projectId),
  index("curated_posts_user_idx").on(t.createdByUserId),
]);

export type CuratedPost = typeof curatedPosts.$inferSelect;
export type InsertCuratedPost = typeof curatedPosts.$inferInsert;

/**
 * Scheduled Posts
 */
export const scheduledPosts = sqliteTable("scheduledPosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("projectId").references(() => neuralMaps.id, { onDelete: "cascade" }),
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
    mapId: text("mapId").references(() => neuralMaps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    mode: text("mode").notNull().default("schematic"), // 'schematic' or 'pcb'
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("design_projects_user_id_idx").on(t.userId),
    index("design_projects_map_id_idx").on(t.mapId),
  ]
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
    mapId: text("mapId").references(() => neuralMaps.id, { onDelete: "cascade" }),
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
    index("design_saves_map_id_idx").on(t.mapId),
  ]
);

export type DesignSave = typeof designSaves.$inferSelect;
export type InsertDesignSave = typeof designSaves.$inferInsert;

/**
 * Model Assets Table (3D model library)
 *
 * A DB registry for the .glb/.gltf files that live in the shared model library
 * (PATHS.models). Files on disk are the payload; this row is the *association* —
 * it binds a mesh to a neural map (mapId null = global/all-maps) and can further
 * link it to a specific PCB/schematic design project. That linkage is what lets
 * the assistant see a project's 3D housing and its PCB/schematic together: both
 * hang off the same map, and a mesh can point at the exact design it encloses.
 */
export const modelAssets = sqliteTable(
  "model_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull(),
    // null mapId = global asset, visible in every map.
    mapId: text("mapId").references(() => neuralMaps.id, { onDelete: "cascade" }),
    // Optional hard link to the PCB/schematic project this mesh belongs with.
    // set null on delete so removing the PCB project only unlinks the housing.
    designProjectId: integer("designProjectId").references(() => designProjects.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(), // display name
    // basename in the shared PATHS.models library. The library is a shared file
    // namespace (every user sees every file via listModels); a model_assets row
    // is one user's *association metadata* over a shared file, so the uniqueness
    // that matters is (userId, fileName) — two users must each be able to link
    // the same shared mesh to their own map/project independently.
    fileName: text("fileName").notNull(),
    format: text("format", { enum: ["glb", "gltf"] }).notNull(),
    size: integer("size").default(0),
    source: text("source", { enum: ["blender", "comfy", "upload"] }).notNull().default("upload"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    // Per-user association metadata: one row per (owner, file). A global unique
    // on fileName would let one user's registration clobber another's row.
    uniqueIndex("model_assets_user_file_unique").on(t.userId, t.fileName),
    index("model_assets_map_id_idx").on(t.mapId),
    index("model_assets_design_project_id_idx").on(t.designProjectId),
  ]
);

export type ModelAsset = typeof modelAssets.$inferSelect;
export type InsertModelAsset = typeof modelAssets.$inferInsert;

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

/**
 * Brain Packs — portable, curated, versioned external "brains" a local model
 * attaches at inference time (Brains-Upgrade Phase 2). Distinct from personal
 * writable neural maps: a brain is read-only, model-agnostic, and imported from
 * a self-contained `.obp` package.
 *
 * The corpus chunks live in {@link brainChunks} (the durable, backend-agnostic
 * source of truth); their vectors are also loaded into the pluggable vector
 * store for retrieval. `embedderMatch` records whether the pack's embedder
 * matches the running one — a mismatch means the corpus is NOT loaded into the
 * vector index (it would be mis-queried), so the pack is flagged as
 * `incompatible` rather than silently returning garbage.
 */
export const brains = sqliteTable(
  "brains",
  {
    id: text("id").primaryKey(), // stable pack id (slug/UUID) from the manifest
    userId: integer("userId").notNull(), // importer / owner (scoping key)
    name: text("name").notNull(),
    version: text("version").notNull(),
    domain: text("domain").notNull(),
    description: text("description").notNull().default(""),
    /** Always-on skill/rules text prepended to prompts. */
    charter: text("charter").notNull().default(""),
    charterSha256: text("charterSha256").notNull(),
    /** Embedder the pack's vectors were built with. */
    embedderId: text("embedderId").notNull(),
    embedderDim: integer("embedderDim").notNull(),
    /** Whether the pack's embedder matches the running one (corpus queryable). */
    embedderMatch: integer("embedderMatch").notNull().default(1), // boolean as int
    /** Lifecycle: ready (queryable) | incompatible (embedder mismatch) | error. */
    status: text("status", { enum: ["ready", "incompatible", "error"] })
      .notNull()
      .default("ready"),
    /** Vector store collection holding this brain's corpus. */
    collectionName: text("collectionName").notNull(),
    chunkCount: integer("chunkCount").notNull().default(0),
    /** Provenance record (source, builtBy, model, license, …). */
    provenance: text("provenance", { mode: "json" }).$type<Record<string, unknown>>(),
    /** True when shipped in-repo as a built-in (vs. user-imported). */
    builtin: integer("builtin").notNull().default(0), // boolean as int
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("brains_user_id_idx").on(t.userId),
    index("brains_user_domain_idx").on(t.userId, t.domain),
  ]
);

export type BrainRow = typeof brains.$inferSelect;
export type InsertBrain = typeof brains.$inferInsert;

/**
 * Brain Pack corpus chunks — the durable, vector-backend-agnostic source of
 * truth for a brain's retrieved knowledge. Each row keeps the chunk text,
 * metadata, and its prebuilt embedding (base64 little-endian Float32) so the
 * vector index can be rebuilt on demand (e.g. after a backend switch) and the
 * brain can be re-exported to a `.obp` without loss.
 */
export const brainChunks = sqliteTable(
  "brain_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brainId: text("brainId")
      .notNull()
      .references(() => brains.id, { onDelete: "cascade" }),
    /** Stable id within the pack — mirrored as the vector store doc_id. */
    chunkId: text("chunkId").notNull(),
    text: text("text").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Prebuilt embedding, base64 little-endian Float32. */
    embedding: text("embedding").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("brain_chunks_brain_id_idx").on(t.brainId),
    uniqueIndex("brain_chunks_brain_chunk_uq").on(t.brainId, t.chunkId),
  ]
);

export type BrainChunkRow = typeof brainChunks.$inferSelect;
export type InsertBrainChunk = typeof brainChunks.$inferInsert;

/**
 * Saved Scripts library.
 *
 * Python tools/scripts the AI generates in chat, saved per-user so they are
 * reusable across sessions, devices and projects (replaces the old
 * localStorage-only store which was trapped on a single browser). The `project`
 * field is a free-text folder/tag; an empty/"Default" project means the script
 * is global and selectable from any project.
 */
export const savedScripts = sqliteTable(
  "saved_scripts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull(),
    mapId: text("mapId").references(() => neuralMaps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    code: text("code").notNull(),
    language: text("language").notNull().default("python"),
    project: text("project").notNull().default("Default"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("saved_scripts_user_id_idx").on(t.userId),
    index("saved_scripts_user_project_idx").on(t.userId, t.project),
    index("saved_scripts_map_id_idx").on(t.mapId),
  ]
);

export type SavedScriptRow = typeof savedScripts.$inferSelect;
export type InsertSavedScript = typeof savedScripts.$inferInsert;

/**
 * Virtual Cards issued via Lithic.
 */
export const virtualCards = sqliteTable(
  "virtual_cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: text("projectId").references(() => neuralMaps.id, { onDelete: "cascade" }),
    token: text("token").unique().notNull(),
    memo: text("memo").notNull(),
    lastFour: text("lastFour").notNull(),
    expMonth: integer("expMonth").notNull(),
    expYear: integer("expYear").notNull(),
    encryptedCredentials: text("encryptedCredentials").notNull(),
    ivHex: text("ivHex").notNull(),
    authTagHex: text("authTagHex").notNull(),
    spendLimitCents: integer("spendLimitCents").notNull(),
    status: text("status").notNull().default("OPEN"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("virtual_cards_user_id_idx").on(t.userId),
    index("virtual_cards_project_id_idx").on(t.projectId),
  ]
);

export type VirtualCard = typeof virtualCards.$inferSelect;
export type InsertVirtualCard = typeof virtualCards.$inferInsert;

/**
 * Persisted Agent Messenger Messages.
 */
export const messengerMessages = sqliteTable(
  "messenger_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    personaId: text("personaId").notNull(),
    sender: text("sender").notNull(), // "user" | "agent"
    content: text("content").notNull(),
    // Read-state for unread badges; persisted so counts survive restarts.
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("messenger_messages_user_persona_idx").on(t.userId, t.personaId),
  ]
);

export type MessengerMessage = typeof messengerMessages.$inferSelect;
export type InsertMessengerMessage = typeof messengerMessages.$inferInsert;

/**
 * Async Job Tracking — persists ProcessManagerService and AsyncJobService state
 * across restarts. Replaces in-memory Map<string, ManagedProcess/AsyncJobContext>.
 */
export const asyncJobTracking = sqliteTable("async_job_tracking", {
  jobId:          text("job_id").primaryKey(),
  userId:         text("user_id"),
  conversationId: text("conversation_id"),
  label:          text("label"),
  jobType:        text("job_type"),
  status:         text("status", { enum: ["pending", "running", "completed", "failed", "cancelled"] }).notNull().default("pending"),
  result:         text("result", { mode: "json" }).$type<unknown>(),
  failReason:     text("fail_reason"),
  createdAt:      integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt:      integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
}, (t) => [
  index("async_job_tracking_status_idx").on(t.status),
  index("async_job_tracking_user_idx").on(t.userId),
]);

export type AsyncJobRecord = typeof asyncJobTracking.$inferSelect;
export type InsertAsyncJobRecord = typeof asyncJobTracking.$inferInsert;

/**
 * HITL Pending Actions — persists HITLApprovalService.pendingActions across
 * restarts. In-flight approvals are surfaced as timed_out in UI after restart.
 */
export const hitlPendingActions = sqliteTable("hitl_pending_actions", {
  actionId:   text("action_id").primaryKey(),
  toolName:   text("tool_name").notNull(),
  args:       text("args", { mode: "json" }).$type<Record<string, unknown>>(),
  category:   text("category", { enum: ["command", "file", "internet", "financial"] }),
  status:     text("status", { enum: ["pending", "approved", "rejected", "timed_out"] }).notNull().default("pending"),
  reason:     text("reason"),
  createdAt:  integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
}, (t) => [
  index("hitl_pending_actions_status_idx").on(t.status),
]);

export type HitlPendingAction = typeof hitlPendingActions.$inferSelect;
export type InsertHitlPendingAction = typeof hitlPendingActions.$inferInsert;

/**
 * MCP Server Configs — persists MCPClientService.configs across restarts so
 * connected MCP servers are automatically restored on boot.
 */
export const mcpServerConfigs = sqliteTable("mcp_server_configs", {
  id:        text("id").primaryKey(),
  name:      text("name").notNull(),
  transport: text("transport", { enum: ["stdio", "websocket"] }).notNull(),
  command:   text("command"),
  args:      text("args", { mode: "json" }).$type<string[]>(),
  url:       text("url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type McpServerConfig = typeof mcpServerConfigs.$inferSelect;
export type InsertMcpServerConfig = typeof mcpServerConfigs.$inferInsert;

/**
 * File Watcher Registrations — persists FileSystemWatcherService.watchers
 * across restarts so chokidar watches are restored on boot.
 */
export const fileWatcherRegistrations = sqliteTable("file_watcher_registrations", {
  projectId:  text("project_id").primaryKey(),
  rootDir:    text("root_dir").notNull(),
  debounceMs: integer("debounce_ms").notNull().default(300),
  isActive:   integer("is_active").notNull().default(1),
  createdAt:  integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type FileWatcherRegistration = typeof fileWatcherRegistrations.$inferSelect;
export type InsertFileWatcherRegistration = typeof fileWatcherRegistrations.$inferInsert;

/**
 * OMMESH Trusted Peers — persists SecurityManager.trustedFingerprints so mTLS
 * peer approvals survive server restarts.
 */
export const ommeshTrustedPeers = sqliteTable("ommesh_trusted_peers", {
  fingerprint: text("fingerprint").primaryKey(),
  nodeId:      text("node_id"),
  approvedAt:  integer("approved_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export type OmmeshTrustedPeer = typeof ommeshTrustedPeers.$inferSelect;
export type InsertOmmeshTrustedPeer = typeof ommeshTrustedPeers.$inferInsert;

/**
 * Wallet Alert Log — persists AiProviderService.walletAlertsSent so duplicate
 * budget alerts are suppressed across restarts.
 */
export const walletAlertLog = sqliteTable("wallet_alert_log", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull(),
  alertType: text("alert_type", { enum: ["threshold", "over"] }).notNull(),
  sentAt:    integer("sent_at", { mode: "timestamp" }).notNull().$defaultFn(now),
}, (t) => [
  index("wallet_alert_log_user_idx").on(t.userId),
  index("wallet_alert_log_sent_at_idx").on(t.sentAt),
]);

export type WalletAlertLogEntry = typeof walletAlertLog.$inferSelect;
export type InsertWalletAlertLogEntry = typeof walletAlertLog.$inferInsert;

/**
 * Agent Sessions — provides per-agent Honcho session isolation. Each agent
 * invocation (runCrew / runLiteAgent / runRecursiveMAS) creates a row here
 * and uses sessionId as the Honcho session key, preventing cross-agent memory bleed.
 */
export const agentSessions = sqliteTable("agent_sessions", {
  sessionId:  text("session_id").primaryKey(),
  userId:     text("user_id"),
  agentType:  text("agent_type"),
  createdAt:  integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
}, (t) => [
  index("agent_sessions_user_idx").on(t.userId),
]);

export type AgentSession = typeof agentSessions.$inferSelect;
export type InsertAgentSession = typeof agentSessions.$inferInsert;

/**
 * MoE Chain Step — one specialist in the chain.
 * taskCategories: if empty the step always runs; otherwise it is skipped when the
 * Valet's task classification doesn't match any listed category.
 */
export interface MoeChainStep {
  order: number;
  label: string;
  taskCategories: string[];
  // Local chain fields
  modelPath?: string;
  ggufFile?: string;
  // Cloud chain fields
  providerId?: string;
  modelId?: string;
  enabled: boolean;
}

/**
 * MoE Chain Configs — stores ordered pipeline configs for /MOE-Chain L (local
 * GGUF specialists) and /MOE-Chain C (cloud provider specialists) per user.
 * One row per userId × chainType; upserted on save.
 */
export const moeChainConfigs = sqliteTable(
  "moe_chain_configs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    chainType: text("chainType", { enum: ["local", "cloud"] }).notNull(),
    steps: text("steps", { mode: "json" }).$type<MoeChainStep[]>().notNull().default([]),
    projectPath: text("projectPath"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("moe_chain_configs_user_type_idx").on(t.userId, t.chainType),
  ]
);

export type MoeChainConfig = typeof moeChainConfigs.$inferSelect;
export type InsertMoeChainConfig = typeof moeChainConfigs.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Relational definitions (Drizzle relational query API)
// ─────────────────────────────────────────────────────────────────────────────

export const moeChainConfigsRelations = relations(moeChainConfigs, ({ one }) => ({
  user: one(users, {
    fields: [moeChainConfigs.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  platformAccounts: many(platformAccounts),
  cloudComputeSessions: many(cloudComputeSessions),
  moeChainConfigs: many(moeChainConfigs),
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
  virtualCards: many(virtualCards),
  messengerMessages: many(messengerMessages),
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

export const discoveredArticlesRelations = relations(discoveredArticles, ({ many, one }) => ({
  curatedPosts: many(curatedPosts),
  project: one(neuralMaps, {
    fields: [discoveredArticles.projectId],
    references: [neuralMaps.id],
  }),
}));

export const curatedPostsRelations = relations(curatedPosts, ({ one, many }) => ({
  article: one(discoveredArticles, {
    fields: [curatedPosts.articleId],
    references: [discoveredArticles.id],
  }),
  scheduledPosts: many(scheduledPosts),
  project: one(neuralMaps, {
    fields: [curatedPosts.projectId],
    references: [neuralMaps.id],
  }),
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
  project: one(neuralMaps, {
    fields: [scheduledPosts.projectId],
    references: [neuralMaps.id],
  }),
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

export const neuralMapsRelations = relations(neuralMaps, ({ one, many }) => ({
  user: one(users, {
    fields: [neuralMaps.userId],
    references: [users.id],
  }),
  discoveredArticles: many(discoveredArticles),
  curatedPosts: many(curatedPosts),
  scheduledPosts: many(scheduledPosts),
  virtualCards: many(virtualCards),
  discoveredDatasetItems: many(discoveredDatasetItems),
  curatedTrainingExamples: many(curatedTrainingExamples),
}));

export const personasRelations = relations(personas, ({ one }) => ({
  user: one(users, {
    fields: [personas.userId],
    references: [users.id],
  }),
}));

export const brainsRelations = relations(brains, ({ one, many }) => ({
  user: one(users, {
    fields: [brains.userId],
    references: [users.id],
  }),
  chunks: many(brainChunks),
}));

export const brainChunksRelations = relations(brainChunks, ({ one }) => ({
  brain: one(brains, {
    fields: [brainChunks.brainId],
    references: [brains.id],
  }),
}));

export const virtualCardsRelations = relations(virtualCards, ({ one }) => ({
  user: one(users, {
    fields: [virtualCards.userId],
    references: [users.id],
  }),
  project: one(neuralMaps, {
    fields: [virtualCards.projectId],
    references: [neuralMaps.id],
  }),
}));

export const messengerMessagesRelations = relations(messengerMessages, ({ one }) => ({
  user: one(users, {
    fields: [messengerMessages.userId],
    references: [users.id],
  }),
}));

/**
 * Podcast Episodes — server-backed history of generated podcast episodes (TD-026).
 * Replaces the prior `localStorage`-only history so episodes survive a cache
 * clear and follow the user across browsers/devices. The audio itself is written
 * to disk under `~/.omnecor/podcasts/<id>/` and served by a range-capable URL
 * stored in `audioUrl`; this table holds only the episode metadata. `id` matches
 * the generation `jobId` (a UUID), so re-recording the same job is an idempotent
 * upsert rather than a duplicate.
 */
export const podcastEpisodes = sqliteTable("podcast_episodes", {
  id: text("id").primaryKey(), // UUID — matches the generation jobId
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  audioUrl: text("audioUrl").notNull(),
  segmentCount: integer("segmentCount").notNull().default(0),
  durationSeconds: integer("durationSeconds").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
}, (t) => [
  index("podcast_episodes_user_idx").on(t.userId),
]);

export type PodcastEpisode = typeof podcastEpisodes.$inferSelect;
export type InsertPodcastEpisode = typeof podcastEpisodes.$inferInsert;

/**
 * Discovered Dataset Items (raw text chunks from files or search queries for custom model training curation)
 */
export const discoveredDatasetItems = sqliteTable("discovered_dataset_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("projectId").references(() => neuralMaps.id, { onDelete: "cascade" }),
  sourceType: text("sourceType", { enum: ["local", "online_search"] }).notNull(),
  sourceName: text("sourceName").notNull(),
  content: text("content").notNull(),
  isProcessed: integer("isProcessed").default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
}, (t) => [
  index("discovered_dataset_items_project_idx").on(t.projectId),
]);

export type DiscoveredDatasetItem = typeof discoveredDatasetItems.$inferSelect;
export type InsertDiscoveredDatasetItem = typeof discoveredDatasetItems.$inferInsert;

/**
 * Curated Training Examples (Instruction, Input, Output instruction-tuning pairs)
 */
export const curatedTrainingExamples = sqliteTable("curated_training_examples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("projectId").references(() => neuralMaps.id, { onDelete: "cascade" }),
  datasetItemId: integer("datasetItemId").references(() => discoveredDatasetItems.id, { onDelete: "cascade" }),
  createdByUserId: integer("createdByUserId").references(() => users.id, { onDelete: "cascade" }),
  instruction: text("instruction").notNull(),
  input: text("input"),
  output: text("output").notNull(),
  status: text("status", { enum: ["pending_review", "approved", "rejected"] }).default("pending_review").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
}, (t) => [
  index("curated_training_examples_project_idx").on(t.projectId),
  index("curated_training_examples_user_idx").on(t.createdByUserId),
]);

export type CuratedTrainingExample = typeof curatedTrainingExamples.$inferSelect;
export type InsertCuratedTrainingExample = typeof curatedTrainingExamples.$inferInsert;

export const discoveredDatasetItemsRelations = relations(discoveredDatasetItems, ({ many, one }) => ({
  curatedExamples: many(curatedTrainingExamples),
  project: one(neuralMaps, {
    fields: [discoveredDatasetItems.projectId],
    references: [neuralMaps.id],
  }),
}));

export const curatedTrainingExamplesRelations = relations(curatedTrainingExamples, ({ one }) => ({
  datasetItem: one(discoveredDatasetItems, {
    fields: [curatedTrainingExamples.datasetItemId],
    references: [discoveredDatasetItems.id],
  }),
  user: one(users, {
    fields: [curatedTrainingExamples.createdByUserId],
    references: [users.id],
  }),
  project: one(neuralMaps, {
    fields: [curatedTrainingExamples.projectId],
    references: [neuralMaps.id],
  }),
}));

/**
 * ── Blueprint Studio (AI-assisted fabrication planning) ─────────────────────
 *
 * A blueprint plan is the persistent "Build Plan" document produced by the
 * Blueprint Studio agentic session: overview + assembly steps on the plan row,
 * with BOM items, cut-list items, generated files (CAD source, meshes,
 * drawings, patterns, concept renders, FEA results) and simulation results in
 * child tables. Dimensions are stored canonically in millimeters (`*Mm`) and
 * converted to the plan's display `units` in the UI/agent layer.
 */
export const blueprintPlans = sqliteTable(
  "blueprint_plans",
  {
    id: text("id").primaryKey(), // UUID
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Attached Project/Neural Map. Nullable so a plan survives its map being
    // deleted (set null) and can exist before a map is chosen.
    mapId: text("mapId").references(() => neuralMaps.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** The user's plain-language project description — the planning brief. */
    brief: text("brief").notNull().default(""),
    category: text("category", {
      enum: ["carpentry", "metal_fab", "structure", "vehicle", "printing", "costume", "mixed", "other"],
    })
      .notNull()
      .default("other"),
    status: text("status", { enum: ["draft", "planning", "ready", "building", "complete"] })
      .notNull()
      .default("draft"),
    units: text("units", { enum: ["imperial", "metric"] }).notNull().default("imperial"),
    /** Parametric CAD engine for this plan — JSCAD is built-in; OpenSCAD is the
     *  optional external binary (Settings → Advanced, like Blender/KiCad). */
    cadEngine: text("cadEngine", { enum: ["jscad", "openscad"] }).notNull().default("jscad"),
    /** Markdown overview of the design (what/why/approach). */
    overview: text("overview").notNull().default(""),
    /** Ordered assembly instructions. */
    assemblySteps: text("assemblySteps", { mode: "json" }).$type<
      { title: string; detail: string; parts?: string[]; tools?: string[] }[]
    >(),
    /** Markdown safety notes + engineering disclaimers for the build. */
    safetyNotes: text("safetyNotes").notNull().default(""),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().$defaultFn(now).$onUpdate(now),
  },
  (t) => [
    index("blueprint_plans_user_idx").on(t.userId),
    index("blueprint_plans_map_idx").on(t.mapId),
  ]
);

export type BlueprintPlan = typeof blueprintPlans.$inferSelect;
export type InsertBlueprintPlan = typeof blueprintPlans.$inferInsert;

/** Bill-of-materials line item (materials, hardware, tools, consumables). */
export const blueprintBomItems = sqliteTable(
  "blueprint_bom_items",
  {
    id: text("id").primaryKey(), // UUID
    planId: text("planId")
      .notNull()
      .references(() => blueprintPlans.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["material", "hardware", "tool", "consumable"] })
      .notNull()
      .default("material"),
    name: text("name").notNull(),
    /** Catalog key when the item came from the built-in materials database. */
    materialKey: text("materialKey"),
    /** Free-form spec, e.g. "2×4 SPF, 96 in" or "M8×40 hex bolt, grade 8.8". */
    spec: text("spec").notNull().default(""),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit").notNull().default("pcs"),
    unitCost: real("unitCost"),
    currency: text("currency").notNull().default("USD"),
    supplier: text("supplier"),
    url: text("url"),
    notes: text("notes"),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("blueprint_bom_items_plan_idx").on(t.planId)]
);

export type BlueprintBomItem = typeof blueprintBomItems.$inferSelect;
export type InsertBlueprintBomItem = typeof blueprintBomItems.$inferInsert;

/** Cut-list line item — exact member dimensions and end-cut angles. */
export const blueprintCutItems = sqliteTable(
  "blueprint_cut_items",
  {
    id: text("id").primaryKey(), // UUID
    planId: text("planId")
      .notNull()
      .references(() => blueprintPlans.id, { onDelete: "cascade" }),
    /** Part name, e.g. "Left rear leg", "Rafter A". */
    partLabel: text("partLabel").notNull(),
    /** Which stock it is cut from, e.g. "2×4 SPF 96 in" — ties back to a BOM line. */
    stockName: text("stockName").notNull().default(""),
    materialKey: text("materialKey"),
    quantity: integer("quantity").notNull().default(1),
    lengthMm: real("lengthMm"),
    widthMm: real("widthMm"),
    thicknessMm: real("thicknessMm"),
    /** End-cut geometry (degrees): miter = in-plane angle, bevel = through-thickness tilt. */
    miter1Deg: real("miter1Deg"),
    bevel1Deg: real("bevel1Deg"),
    miter2Deg: real("miter2Deg"),
    bevel2Deg: real("bevel2Deg"),
    notes: text("notes"),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("blueprint_cut_items_plan_idx").on(t.planId)]
);

export type BlueprintCutItem = typeof blueprintCutItems.$inferSelect;
export type InsertBlueprintCutItem = typeof blueprintCutItems.$inferInsert;

/** A generated artifact on disk (under the data dir's blueprints/ tree). */
export const blueprintFiles = sqliteTable(
  "blueprint_files",
  {
    id: text("id").primaryKey(), // UUID
    planId: text("planId")
      .notNull()
      .references(() => blueprintPlans.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "cad_source",
        "mesh_json",
        "stl",
        "drawing_svg",
        "drawing_dxf",
        "pattern_svg",
        "pattern_pdf",
        "concept_image",
        "fea_result",
        "plan_pdf",
      ],
    }).notNull(),
    name: text("name").notNull(),
    /** Absolute path under resolveDataPath("blueprints") — validated on read. */
    path: text("path").notNull(),
    mimeType: text("mimeType").notNull().default("application/octet-stream"),
    sizeBytes: integer("sizeBytes"),
    /** e.g. { partLabel, engine, boundsMm, volumeMm3, massG, sourceFileId }. */
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Revision lineage: recompiling a part supersedes its prior file rather
     *  than piling up. `version` bumps per (planId, kind, name); `supersedesId`
     *  points at the file this one replaced; only the newest per part carries
     *  `isLatest` (drawings/3D/PDF read the latest, older stay downloadable). */
    version: integer("version").notNull().default(1),
    supersedesId: text("supersedesId"),
    isLatest: integer("isLatest", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("blueprint_files_plan_idx").on(t.planId)]
);

export type BlueprintFile = typeof blueprintFiles.$inferSelect;
export type InsertBlueprintFile = typeof blueprintFiles.$inferInsert;

/** A structural verification run — deterministic calc or FEA job. */
export const blueprintSimResults = sqliteTable(
  "blueprint_sim_results",
  {
    id: text("id").primaryKey(), // UUID
    planId: text("planId")
      .notNull()
      .references(() => blueprintPlans.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["calc", "fea"] }).notNull(),
    /** Human title, e.g. "Shelf mid-span deflection @ 60 kg". */
    name: text("name").notNull(),
    status: text("status", { enum: ["pending", "running", "completed", "failed"] })
      .notNull()
      .default("completed"),
    inputs: text("inputs", { mode: "json" }).$type<Record<string, unknown>>(),
    results: text("results", { mode: "json" }).$type<Record<string, unknown>>(),
    /** AsyncJobService job id for FEA runs. */
    jobId: text("jobId"),
    /** Result artifact (mesh/field data) in blueprint_files, when produced. */
    fileId: text("fileId"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("blueprint_sim_results_plan_idx").on(t.planId)]
);

export type BlueprintSimResult = typeof blueprintSimResults.$inferSelect;
export type InsertBlueprintSimResult = typeof blueprintSimResults.$inferInsert;

/** Blueprint planning conversation — one thread per plan. */
export const blueprintMessages = sqliteTable(
  "blueprint_messages",
  {
    id: text("id").primaryKey(), // UUID
    planId: text("planId")
      .notNull()
      .references(() => blueprintPlans.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    /** Flattened text (persistence/copy/export). */
    content: text("content").notNull(),
    /** Ordered AssistantBlock[] — the agentic render source of truth. */
    blocks: text("blocks", { mode: "json" }).$type<unknown[]>(),
    tokenCount: integer("tokenCount"),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().$defaultFn(now),
  },
  (t) => [index("blueprint_messages_plan_idx").on(t.planId)]
);

export type BlueprintMessage = typeof blueprintMessages.$inferSelect;
export type InsertBlueprintMessage = typeof blueprintMessages.$inferInsert;

export const blueprintPlansRelations = relations(blueprintPlans, ({ one, many }) => ({
  user: one(users, { fields: [blueprintPlans.userId], references: [users.id] }),
  map: one(neuralMaps, { fields: [blueprintPlans.mapId], references: [neuralMaps.id] }),
  bomItems: many(blueprintBomItems),
  cutItems: many(blueprintCutItems),
  files: many(blueprintFiles),
  simResults: many(blueprintSimResults),
  messages: many(blueprintMessages),
}));

export const blueprintBomItemsRelations = relations(blueprintBomItems, ({ one }) => ({
  plan: one(blueprintPlans, { fields: [blueprintBomItems.planId], references: [blueprintPlans.id] }),
}));

export const blueprintCutItemsRelations = relations(blueprintCutItems, ({ one }) => ({
  plan: one(blueprintPlans, { fields: [blueprintCutItems.planId], references: [blueprintPlans.id] }),
}));

export const blueprintFilesRelations = relations(blueprintFiles, ({ one }) => ({
  plan: one(blueprintPlans, { fields: [blueprintFiles.planId], references: [blueprintPlans.id] }),
}));

export const blueprintSimResultsRelations = relations(blueprintSimResults, ({ one }) => ({
  plan: one(blueprintPlans, { fields: [blueprintSimResults.planId], references: [blueprintPlans.id] }),
}));

export const blueprintMessagesRelations = relations(blueprintMessages, ({ one }) => ({
  plan: one(blueprintPlans, { fields: [blueprintMessages.planId], references: [blueprintPlans.id] }),
}));


