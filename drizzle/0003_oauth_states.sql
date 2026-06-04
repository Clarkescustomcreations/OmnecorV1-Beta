CREATE TABLE `oauthStates` (
	`state` varchar(128) NOT NULL,
	`platform` varchar(50) NOT NULL,
	`userId` int NOT NULL,
	`codeVerifier` varchar(256),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauthStates_state` PRIMARY KEY(`state`)
);
--> statement-breakpoint
CREATE INDEX `expiresAtIdx` ON `oauthStates` (`expiresAt`);
