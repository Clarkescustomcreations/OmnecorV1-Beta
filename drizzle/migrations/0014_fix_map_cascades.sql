CREATE TABLE `__new_saved_scripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`mapId` text,
	`name` text NOT NULL,
	`description` text NOT NULL DEFAULT '',
	`code` text NOT NULL,
	`language` text NOT NULL DEFAULT 'python',
	`project` text NOT NULL DEFAULT 'Default',
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`mapId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_saved_scripts`(`id`, `userId`, `mapId`, `name`, `description`, `code`, `language`, `project`, `createdAt`, `updatedAt`) SELECT `id`, `userId`, `mapId`, `name`, `description`, `code`, `language`, `project`, `createdAt`, `updatedAt` FROM `saved_scripts`;
--> statement-breakpoint
DROP TABLE `saved_scripts`;
--> statement-breakpoint
ALTER TABLE `__new_saved_scripts` RENAME TO `saved_scripts`;
--> statement-breakpoint
CREATE INDEX `saved_scripts_user_id_idx` ON `saved_scripts` (`userId`);
--> statement-breakpoint
CREATE INDEX `saved_scripts_user_project_idx` ON `saved_scripts` (`userId`,`project`);
--> statement-breakpoint
CREATE INDEX `saved_scripts_map_id_idx` ON `saved_scripts` (`mapId`);
--> statement-breakpoint
CREATE TABLE `__new_design_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`mapId` text,
	`name` text NOT NULL,
	`description` text,
	`mode` text NOT NULL DEFAULT 'schematic',
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`mapId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_design_projects`(`id`, `userId`, `mapId`, `name`, `description`, `mode`, `createdAt`, `updatedAt`) SELECT `id`, `userId`, `mapId`, `name`, `description`, `mode`, `createdAt`, `updatedAt` FROM `design_projects`;
--> statement-breakpoint
DROP TABLE `design_projects`;
--> statement-breakpoint
ALTER TABLE `__new_design_projects` RENAME TO `design_projects`;
--> statement-breakpoint
CREATE INDEX `design_projects_user_id_idx` ON `design_projects` (`userId`);
--> statement-breakpoint
CREATE INDEX `design_projects_map_id_idx` ON `design_projects` (`mapId`);
--> statement-breakpoint
CREATE TABLE `__new_design_saves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` integer NOT NULL,
	`userId` integer NOT NULL,
	`mapId` text,
	`name` text NOT NULL,
	`description` text,
	`canvasData` text NOT NULL,
	`componentCount` integer DEFAULT 0,
	`connectionCount` integer DEFAULT 0,
	`version` integer DEFAULT 1,
	`isLatest` integer DEFAULT 1,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`mapId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_design_saves`(`id`, `projectId`, `userId`, `mapId`, `name`, `description`, `canvasData`, `componentCount`, `connectionCount`, `version`, `isLatest`, `createdAt`, `updatedAt`) SELECT `id`, `projectId`, `userId`, `mapId`, `name`, `description`, `canvasData`, `componentCount`, `connectionCount`, `version`, `isLatest`, `createdAt`, `updatedAt` FROM `design_saves`;
--> statement-breakpoint
DROP TABLE `design_saves`;
--> statement-breakpoint
ALTER TABLE `__new_design_saves` RENAME TO `design_saves`;
--> statement-breakpoint
CREATE INDEX `design_saves_project_id_idx` ON `design_saves` (`projectId`);
--> statement-breakpoint
CREATE INDEX `design_saves_user_id_idx` ON `design_saves` (`userId`);
--> statement-breakpoint
CREATE INDEX `design_saves_map_id_idx` ON `design_saves` (`mapId`);
--> statement-breakpoint
CREATE TABLE `__new_curatedPosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` text,
	`articleId` integer,
	`createdByUserId` integer,
	`platform` text NOT NULL,
	`content` text,
	`metadata` text,
	`status` text DEFAULT 'draft',
	`approvalNotes` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_curatedPosts`(`id`, `projectId`, `articleId`, `createdByUserId`, `platform`, `content`, `metadata`, `status`, `approvalNotes`, `createdAt`, `updatedAt`) SELECT `id`, `projectId`, `articleId`, `createdByUserId`, `platform`, `content`, `metadata`, `status`, `approvalNotes`, `createdAt`, `updatedAt` FROM `curatedPosts`;
--> statement-breakpoint
DROP TABLE `curatedPosts`;
--> statement-breakpoint
ALTER TABLE `__new_curatedPosts` RENAME TO `curatedPosts`;
--> statement-breakpoint
CREATE INDEX `curated_posts_project_idx` ON `curatedPosts` (`projectId`);
--> statement-breakpoint
CREATE INDEX `curated_posts_user_idx` ON `curatedPosts` (`createdByUserId`);
--> statement-breakpoint
CREATE TABLE `__new_discoveredArticles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` text,
	`title` text,
	`url` text,
	`urlHash` text,
	`source` text,
	`content` text,
	`summary` text,
	`publishedAt` integer,
	`fetchedAt` integer,
	`isProcessed` integer DEFAULT 0,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_discoveredArticles`(`id`, `projectId`, `title`, `url`, `urlHash`, `source`, `content`, `summary`, `publishedAt`, `fetchedAt`, `isProcessed`, `createdAt`) SELECT `id`, `projectId`, `title`, `url`, `urlHash`, `source`, `content`, `summary`, `publishedAt`, `fetchedAt`, `isProcessed`, `createdAt` FROM `discoveredArticles`;
--> statement-breakpoint
DROP TABLE `discoveredArticles`;
--> statement-breakpoint
ALTER TABLE `__new_discoveredArticles` RENAME TO `discoveredArticles`;
--> statement-breakpoint
CREATE UNIQUE INDEX `discoveredArticles_url_unique` ON `discoveredArticles` (`url`);
--> statement-breakpoint
CREATE UNIQUE INDEX `discoveredArticles_urlHash_unique` ON `discoveredArticles` (`urlHash`);
--> statement-breakpoint
CREATE INDEX `discovered_articles_project_idx` ON `discoveredArticles` (`projectId`);
--> statement-breakpoint
CREATE TABLE `__new_scheduledPosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` text,
	`curatedPostId` integer NOT NULL,
	`platformAccountId` integer NOT NULL,
	`scheduledAt` integer,
	`publishedAt` integer,
	`status` text DEFAULT 'scheduled',
	`errorMessage` text,
	`platformPostId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_scheduledPosts`(`id`, `projectId`, `curatedPostId`, `platformAccountId`, `scheduledAt`, `publishedAt`, `status`, `errorMessage`, `platformPostId`, `createdAt`, `updatedAt`) SELECT `id`, `projectId`, `curatedPostId`, `platformAccountId`, `scheduledAt`, `publishedAt`, `status`, `errorMessage`, `platformPostId`, `createdAt`, `updatedAt` FROM `scheduledPosts`;
--> statement-breakpoint
DROP TABLE `scheduledPosts`;
--> statement-breakpoint
ALTER TABLE `__new_scheduledPosts` RENAME TO `scheduledPosts`;
