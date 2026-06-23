CREATE TABLE `podcast_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`title` text NOT NULL,
	`audioUrl` text NOT NULL,
	`segmentCount` integer DEFAULT 0 NOT NULL,
	`durationSeconds` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `podcast_episodes_user_idx` ON `podcast_episodes` (`userId`);