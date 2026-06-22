ALTER TABLE `curatedPosts` ADD `createdByUserId` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `curated_posts_user_idx` ON `curatedPosts` (`createdByUserId`);