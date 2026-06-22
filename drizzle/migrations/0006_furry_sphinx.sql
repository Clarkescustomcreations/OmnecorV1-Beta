CREATE TABLE `moe_chain_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`chainType` text NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`projectPath` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `moe_chain_configs_user_type_idx` ON `moe_chain_configs` (`userId`,`chainType`);