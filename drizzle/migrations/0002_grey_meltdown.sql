CREATE TABLE `messenger_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`personaId` text NOT NULL,
	`sender` text NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messenger_messages_user_persona_idx` ON `messenger_messages` (`userId`,`personaId`);--> statement-breakpoint
CREATE TABLE `virtual_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`projectId` text,
	`token` text NOT NULL,
	`memo` text NOT NULL,
	`lastFour` text NOT NULL,
	`expMonth` integer NOT NULL,
	`expYear` integer NOT NULL,
	`encryptedCredentials` text NOT NULL,
	`ivHex` text NOT NULL,
	`authTagHex` text NOT NULL,
	`spendLimitCents` integer NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `neural_maps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `virtual_cards_token_unique` ON `virtual_cards` (`token`);--> statement-breakpoint
CREATE INDEX `virtual_cards_user_id_idx` ON `virtual_cards` (`userId`);--> statement-breakpoint
CREATE INDEX `virtual_cards_project_id_idx` ON `virtual_cards` (`projectId`);--> statement-breakpoint
ALTER TABLE `curatedPosts` ADD `projectId` text REFERENCES neural_maps(id);--> statement-breakpoint
ALTER TABLE `discoveredArticles` ADD `projectId` text REFERENCES neural_maps(id);--> statement-breakpoint
ALTER TABLE `scheduledPosts` ADD `projectId` text REFERENCES neural_maps(id);