CREATE TABLE `model_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`mapId` text,
	`designProjectId` integer,
	`name` text NOT NULL,
	`fileName` text NOT NULL,
	`format` text NOT NULL,
	`size` integer DEFAULT 0,
	`source` text DEFAULT 'upload' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`mapId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`designProjectId`) REFERENCES `design_projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_assets_user_file_unique` ON `model_assets` (`userId`,`fileName`);--> statement-breakpoint
CREATE INDEX `model_assets_map_id_idx` ON `model_assets` (`mapId`);--> statement-breakpoint
CREATE INDEX `model_assets_design_project_id_idx` ON `model_assets` (`designProjectId`);