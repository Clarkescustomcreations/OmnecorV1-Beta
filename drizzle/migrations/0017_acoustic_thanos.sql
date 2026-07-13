ALTER TABLE `blueprint_files` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `blueprint_files` ADD `supersedesId` text;--> statement-breakpoint
ALTER TABLE `blueprint_files` ADD `isLatest` integer DEFAULT true NOT NULL;