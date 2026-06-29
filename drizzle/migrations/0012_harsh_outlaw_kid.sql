CREATE TABLE `curated_training_examples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` text,
	`datasetItemId` integer,
	`createdByUserId` integer,
	`instruction` text NOT NULL,
	`input` text,
	`output` text NOT NULL,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`datasetItemId`) REFERENCES `discovered_dataset_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `curated_training_examples_project_idx` ON `curated_training_examples` (`projectId`);--> statement-breakpoint
CREATE INDEX `curated_training_examples_user_idx` ON `curated_training_examples` (`createdByUserId`);--> statement-breakpoint
CREATE TABLE `discovered_dataset_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` text,
	`sourceType` text NOT NULL,
	`sourceName` text NOT NULL,
	`content` text NOT NULL,
	`isProcessed` integer DEFAULT 0,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discovered_dataset_items_project_idx` ON `discovered_dataset_items` (`projectId`);