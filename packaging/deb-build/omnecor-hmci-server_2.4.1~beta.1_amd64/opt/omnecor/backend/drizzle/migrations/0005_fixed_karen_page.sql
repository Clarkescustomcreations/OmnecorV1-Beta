CREATE TABLE `paired_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deviceId` text NOT NULL,
	`openId` text NOT NULL,
	`name` text DEFAULT 'Phone' NOT NULL,
	`pairMethod` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	`revokedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paired_devices_deviceId_unique` ON `paired_devices` (`deviceId`);--> statement-breakpoint
CREATE INDEX `paired_devices_openId_idx` ON `paired_devices` (`openId`);