CREATE TABLE `chat_messages` (
	`id` varchar(36) NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`role` enum('system','user','assistant','tool','function') NOT NULL,
	`content` text NOT NULL,
	`tokenCount` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(64) NOT NULL,
	`title` text NOT NULL,
	`providerId` varchar(64) NOT NULL,
	`modelId` varchar(64) NOT NULL,
	`systemPrompt` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` varchar(36) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text,
	`expiresAt` timestamp,
	`tokenIv` varchar(64),
	`tokenTag` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_budgets` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(64) NOT NULL,
	`limitCents` int NOT NULL DEFAULT 0,
	`alertThreshold` int NOT NULL DEFAULT 80,
	`mode` enum('soft','hard') NOT NULL DEFAULT 'soft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_budgets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spend_log` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`modelId` varchar(64) NOT NULL,
	`promptTokens` int NOT NULL DEFAULT 0,
	`completionTokens` int NOT NULL DEFAULT 0,
	`estimatedCostMicrocents` bigint NOT NULL DEFAULT 0,
	`sessionId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spend_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_sessionId_chat_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE cascade ON UPDATE no action;