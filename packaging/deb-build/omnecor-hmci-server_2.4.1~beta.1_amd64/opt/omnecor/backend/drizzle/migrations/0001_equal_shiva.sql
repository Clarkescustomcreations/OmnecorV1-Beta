CREATE TABLE `saved_scripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`code` text NOT NULL,
	`language` text DEFAULT 'python' NOT NULL,
	`project` text DEFAULT 'Default' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_scripts_user_id_idx` ON `saved_scripts` (`userId`);--> statement-breakpoint
CREATE INDEX `saved_scripts_user_project_idx` ON `saved_scripts` (`userId`,`project`);