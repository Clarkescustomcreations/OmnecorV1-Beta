CREATE TABLE `brain_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brainId` text NOT NULL,
	`chunkId` text NOT NULL,
	`text` text NOT NULL,
	`metadata` text,
	`embedding` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`brainId`) REFERENCES `brains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `brain_chunks_brain_id_idx` ON `brain_chunks` (`brainId`);--> statement-breakpoint
CREATE UNIQUE INDEX `brain_chunks_brain_chunk_uq` ON `brain_chunks` (`brainId`,`chunkId`);--> statement-breakpoint
CREATE TABLE `brains` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`domain` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`charter` text DEFAULT '' NOT NULL,
	`charterSha256` text NOT NULL,
	`embedderId` text NOT NULL,
	`embedderDim` integer NOT NULL,
	`embedderMatch` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`collectionName` text NOT NULL,
	`chunkCount` integer DEFAULT 0 NOT NULL,
	`provenance` text,
	`builtin` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brains_user_id_idx` ON `brains` (`userId`);--> statement-breakpoint
CREATE INDEX `brains_user_domain_idx` ON `brains` (`userId`,`domain`);