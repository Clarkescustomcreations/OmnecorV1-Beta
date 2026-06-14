CREATE TABLE `ai_design_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`designSaveId` integer NOT NULL,
	`userId` integer NOT NULL,
	`prompt` text NOT NULL,
	`response` text NOT NULL,
	`componentCount` integer,
	`connectionCount` integer,
	`mode` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_reviews_save_id_idx` ON `ai_design_reviews` (`designSaveId`);--> statement-breakpoint
CREATE INDEX `ai_reviews_user_id_idx` ON `ai_design_reviews` (`userId`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`eventType` text NOT NULL,
	`actorId` integer,
	`actorType` text DEFAULT 'user' NOT NULL,
	`procedure` text,
	`args` text,
	`result` text,
	`ipAddress` text,
	`sessionId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tokenCount` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`title` text NOT NULL,
	`providerId` text NOT NULL,
	`modelId` text NOT NULL,
	`systemPrompt` text,
	`metadata` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_compute_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`projectId` text NOT NULL,
	`provider` text NOT NULL,
	`externalSessionId` text,
	`planId` text NOT NULL,
	`instanceLabel` text NOT NULL,
	`billingUnit` text DEFAULT 'hour' NOT NULL,
	`ratePerUnitMicrocents` integer NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`startedAt` integer NOT NULL,
	`stoppedAt` integer,
	`totalCostMicrocents` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_compute_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`provider` text NOT NULL,
	`planName` text NOT NULL,
	`monthlyCents` integer DEFAULT 0 NOT NULL,
	`renewalDate` integer,
	`isActive` integer DEFAULT 1 NOT NULL,
	`apiKeyHint` text,
	`notes` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `component_library_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`componentId` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`symbolSvg` text,
	`footprintSvg` text,
	`properties` text NOT NULL,
	`handles` text NOT NULL,
	`manufacturer` text,
	`partNumber` text,
	`datasheet` text,
	`tags` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `component_library_user_id_idx` ON `component_library_items` (`userId`);--> statement-breakpoint
CREATE INDEX `component_library_id_idx` ON `component_library_items` (`componentId`);--> statement-breakpoint
CREATE TABLE `curatedPosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`articleId` integer,
	`platform` text NOT NULL,
	`content` text,
	`metadata` text,
	`status` text DEFAULT 'draft',
	`approvalNotes` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `design_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`designSaveId` integer NOT NULL,
	`userId` integer NOT NULL,
	`format` text NOT NULL,
	`fileUrl` text NOT NULL,
	`fileSize` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `design_exports_save_id_idx` ON `design_exports` (`designSaveId`);--> statement-breakpoint
CREATE INDEX `design_exports_user_id_idx` ON `design_exports` (`userId`);--> statement-breakpoint
CREATE TABLE `design_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`mode` text DEFAULT 'schematic' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `design_projects_user_id_idx` ON `design_projects` (`userId`);--> statement-breakpoint
CREATE TABLE `design_saves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` integer NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`canvasData` text NOT NULL,
	`componentCount` integer DEFAULT 0,
	`connectionCount` integer DEFAULT 0,
	`version` integer DEFAULT 1,
	`isLatest` integer DEFAULT 1,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `design_saves_project_id_idx` ON `design_saves` (`projectId`);--> statement-breakpoint
CREATE INDEX `design_saves_user_id_idx` ON `design_saves` (`userId`);--> statement-breakpoint
CREATE TABLE `discoveredArticles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text,
	`url` text,
	`urlHash` text,
	`source` text,
	`content` text,
	`summary` text,
	`publishedAt` integer,
	`fetchedAt` integer,
	`isProcessed` integer DEFAULT 0,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discoveredArticles_url_unique` ON `discoveredArticles` (`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `discoveredArticles_urlHash_unique` ON `discoveredArticles` (`urlHash`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text,
	`expiresAt` integer,
	`tokenIv` text,
	`tokenTag` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `neural_maps` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`mode` text DEFAULT 'standard' NOT NULL,
	`rootDirectories` text NOT NULL,
	`projectContext` text,
	`labelOverrides` text,
	`settings` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `neural_maps_user_id_idx` ON `neural_maps` (`userId`);--> statement-breakpoint
CREATE TABLE `oauthStates` (
	`state` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`userId` integer NOT NULL,
	`codeVerifier` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'self_clone' NOT NULL,
	`alwaysOn` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personas_user_id_idx` ON `personas` (`userId`);--> statement-breakpoint
CREATE TABLE `pipeline_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`pipelineId` text NOT NULL,
	`phase` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`inputText` text,
	`outputText` text,
	`approvedBy` integer,
	`approvedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pipelines` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`currentPhase` text DEFAULT 'DEFINE' NOT NULL,
	`ownerId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `platformAccounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`platform` text NOT NULL,
	`accountName` text,
	`oauthToken` text NOT NULL,
	`oauthRefreshToken` text,
	`tokenExpiresAt` integer,
	`accountMetadata` text,
	`isActive` integer DEFAULT 1,
	`lastSyncedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `postAnalytics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheduledPostId` integer NOT NULL,
	`impressions` integer DEFAULT 0,
	`reach` integer DEFAULT 0,
	`likes` integer DEFAULT 0,
	`shares` integer DEFAULT 0,
	`comments` integer DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`engagementRate` text,
	`lastUpdatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `postingScheduleConfig` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`platform` text NOT NULL,
	`postsPerDay` integer DEFAULT 1,
	`autoApprove` integer DEFAULT 0,
	`optimalPostingTimes` text,
	`timezone` text DEFAULT 'UTC',
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`limitCents` integer DEFAULT 0 NOT NULL,
	`alertThreshold` integer DEFAULT 80 NOT NULL,
	`mode` text DEFAULT 'soft' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduledPosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`curatedPostId` integer NOT NULL,
	`platformAccountId` integer NOT NULL,
	`scheduledAt` integer,
	`publishedAt` integer,
	`status` text DEFAULT 'scheduled',
	`errorMessage` text,
	`platformPostId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spend_log` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`provider` text NOT NULL,
	`modelId` text NOT NULL,
	`promptTokens` integer DEFAULT 0 NOT NULL,
	`completionTokens` integer DEFAULT 0 NOT NULL,
	`estimatedCostMicrocents` integer DEFAULT 0 NOT NULL,
	`sessionId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openId` text NOT NULL,
	`name` text,
	`email` text,
	`loginMethod` text,
	`passwordHash` text,
	`role` text DEFAULT 'user' NOT NULL,
	`executionMode` text DEFAULT 'scrapper' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`lastSignedIn` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);