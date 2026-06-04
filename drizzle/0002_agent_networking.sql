CREATE TABLE `platformAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`accountName` varchar(255),
	`oauthToken` text NOT NULL,
	`oauthRefreshToken` text,
	`tokenExpiresAt` timestamp,
	`accountMetadata` json,
	`isActive` int DEFAULT 1,
	`lastSyncedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platformAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `discoveredArticles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(500),
	`url` varchar(2048) UNIQUE,
	`urlHash` varchar(64) UNIQUE,
	`source` varchar(100),
	`content` text,
	`summary` text,
	`publishedAt` timestamp,
	`fetchedAt` timestamp NOT NULL DEFAULT (now()),
	`isProcessed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `discoveredArticles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `curatedPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`articleId` int,
	`platform` varchar(50) NOT NULL,
	`content` text,
	`metadata` json,
	`status` enum('draft','pending_review','approved','scheduled','published','failed') NOT NULL DEFAULT 'draft',
	`approvalNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `curatedPosts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduledPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`curatedPostId` int NOT NULL,
	`platformAccountId` int NOT NULL,
	`scheduledAt` timestamp,
	`publishedAt` timestamp,
	`status` enum('scheduled','published','failed','cancelled') NOT NULL DEFAULT 'scheduled',
	`errorMessage` text,
	`platformPostId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledPosts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `postAnalytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduledPostId` int NOT NULL,
	`impressions` int DEFAULT 0,
	`reach` int DEFAULT 0,
	`likes` int DEFAULT 0,
	`shares` int DEFAULT 0,
	`comments` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`engagementRate` varchar(10),
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `postAnalytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `postingScheduleConfig` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`postsPerDay` int DEFAULT 1,
	`autoApprove` int DEFAULT 0,
	`optimalPostingTimes` json,
	`timezone` varchar(50) DEFAULT 'UTC',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `postingScheduleConfig_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `userIdIdx` ON `platformAccounts` (`userId`);
--> statement-breakpoint
CREATE INDEX `platformIdx` ON `platformAccounts` (`platform`);
--> statement-breakpoint
CREATE INDEX `urlHashIdx` ON `discoveredArticles` (`urlHash`);
--> statement-breakpoint
CREATE INDEX `sourceIdx` ON `discoveredArticles` (`source`);
--> statement-breakpoint
CREATE INDEX `isProcessedIdx` ON `discoveredArticles` (`isProcessed`);
--> statement-breakpoint
CREATE INDEX `articleIdIdx` ON `curatedPosts` (`articleId`);
--> statement-breakpoint
CREATE INDEX `platformIdx_cp` ON `curatedPosts` (`platform`);
--> statement-breakpoint
CREATE INDEX `statusIdx` ON `curatedPosts` (`status`);
--> statement-breakpoint
CREATE INDEX `curatedPostIdIdx` ON `scheduledPosts` (`curatedPostId`);
--> statement-breakpoint
CREATE INDEX `platformAccountIdIdx` ON `scheduledPosts` (`platformAccountId`);
--> statement-breakpoint
CREATE INDEX `scheduledAtIdx` ON `scheduledPosts` (`scheduledAt`);
--> statement-breakpoint
CREATE INDEX `statusIdx_sp` ON `scheduledPosts` (`status`);
--> statement-breakpoint
CREATE INDEX `scheduledPostIdIdx` ON `postAnalytics` (`scheduledPostId`);
--> statement-breakpoint
CREATE INDEX `userIdIdx_psc` ON `postingScheduleConfig` (`userId`);
--> statement-breakpoint
CREATE INDEX `platformIdx_psc` ON `postingScheduleConfig` (`platform`);
