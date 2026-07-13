CREATE TABLE `blueprint_bom_items` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`kind` text DEFAULT 'material' NOT NULL,
	`name` text NOT NULL,
	`materialKey` text,
	`spec` text DEFAULT '' NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`unitCost` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`supplier` text,
	`url` text,
	`notes` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `blueprint_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_bom_items_plan_idx` ON `blueprint_bom_items` (`planId`);--> statement-breakpoint
CREATE TABLE `blueprint_cut_items` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`partLabel` text NOT NULL,
	`stockName` text DEFAULT '' NOT NULL,
	`materialKey` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`lengthMm` real,
	`widthMm` real,
	`thicknessMm` real,
	`miter1Deg` real,
	`bevel1Deg` real,
	`miter2Deg` real,
	`bevel2Deg` real,
	`notes` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `blueprint_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_cut_items_plan_idx` ON `blueprint_cut_items` (`planId`);--> statement-breakpoint
CREATE TABLE `blueprint_files` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mimeType` text DEFAULT 'application/octet-stream' NOT NULL,
	`sizeBytes` integer,
	`meta` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `blueprint_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_files_plan_idx` ON `blueprint_files` (`planId`);--> statement-breakpoint
CREATE TABLE `blueprint_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`blocks` text,
	`tokenCount` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `blueprint_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_messages_plan_idx` ON `blueprint_messages` (`planId`);--> statement-breakpoint
CREATE TABLE `blueprint_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`mapId` text,
	`title` text NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`units` text DEFAULT 'imperial' NOT NULL,
	`cadEngine` text DEFAULT 'jscad' NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`assemblySteps` text,
	`safetyNotes` text DEFAULT '' NOT NULL,
	`metadata` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mapId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `blueprint_plans_user_idx` ON `blueprint_plans` (`userId`);--> statement-breakpoint
CREATE INDEX `blueprint_plans_map_idx` ON `blueprint_plans` (`mapId`);--> statement-breakpoint
CREATE TABLE `blueprint_sim_results` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`inputs` text,
	`results` text,
	`jobId` text,
	`fileId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `blueprint_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blueprint_sim_results_plan_idx` ON `blueprint_sim_results` (`planId`);