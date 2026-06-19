DROP INDEX "ai_reviews_save_id_idx";--> statement-breakpoint
DROP INDEX "ai_reviews_user_id_idx";--> statement-breakpoint
DROP INDEX "audit_log_created_at_idx";--> statement-breakpoint
DROP INDEX "component_library_user_id_idx";--> statement-breakpoint
DROP INDEX "component_library_id_idx";--> statement-breakpoint
DROP INDEX "design_exports_save_id_idx";--> statement-breakpoint
DROP INDEX "design_exports_user_id_idx";--> statement-breakpoint
DROP INDEX "design_projects_user_id_idx";--> statement-breakpoint
DROP INDEX "design_saves_project_id_idx";--> statement-breakpoint
DROP INDEX "design_saves_user_id_idx";--> statement-breakpoint
DROP INDEX "discoveredArticles_url_unique";--> statement-breakpoint
DROP INDEX "discoveredArticles_urlHash_unique";--> statement-breakpoint
DROP INDEX "messenger_messages_user_persona_idx";--> statement-breakpoint
DROP INDEX "neural_maps_user_id_idx";--> statement-breakpoint
DROP INDEX "personas_user_id_idx";--> statement-breakpoint
DROP INDEX "saved_scripts_user_id_idx";--> statement-breakpoint
DROP INDEX "saved_scripts_user_project_idx";--> statement-breakpoint
DROP INDEX "users_openId_unique";--> statement-breakpoint
DROP INDEX "virtual_cards_token_unique";--> statement-breakpoint
DROP INDEX "virtual_cards_user_id_idx";--> statement-breakpoint
DROP INDEX "virtual_cards_project_id_idx";--> statement-breakpoint
ALTER TABLE `chat_sessions` ALTER COLUMN "projectId" TO "projectId" text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `ai_reviews_save_id_idx` ON `ai_design_reviews` (`designSaveId`);--> statement-breakpoint
CREATE INDEX `ai_reviews_user_id_idx` ON `ai_design_reviews` (`userId`);--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `component_library_user_id_idx` ON `component_library_items` (`userId`);--> statement-breakpoint
CREATE INDEX `component_library_id_idx` ON `component_library_items` (`componentId`);--> statement-breakpoint
CREATE INDEX `design_exports_save_id_idx` ON `design_exports` (`designSaveId`);--> statement-breakpoint
CREATE INDEX `design_exports_user_id_idx` ON `design_exports` (`userId`);--> statement-breakpoint
CREATE INDEX `design_projects_user_id_idx` ON `design_projects` (`userId`);--> statement-breakpoint
CREATE INDEX `design_saves_project_id_idx` ON `design_saves` (`projectId`);--> statement-breakpoint
CREATE INDEX `design_saves_user_id_idx` ON `design_saves` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `discoveredArticles_url_unique` ON `discoveredArticles` (`url`);--> statement-breakpoint
CREATE UNIQUE INDEX `discoveredArticles_urlHash_unique` ON `discoveredArticles` (`urlHash`);--> statement-breakpoint
CREATE INDEX `messenger_messages_user_persona_idx` ON `messenger_messages` (`userId`,`personaId`);--> statement-breakpoint
CREATE INDEX `neural_maps_user_id_idx` ON `neural_maps` (`userId`);--> statement-breakpoint
CREATE INDEX `personas_user_id_idx` ON `personas` (`userId`);--> statement-breakpoint
CREATE INDEX `saved_scripts_user_id_idx` ON `saved_scripts` (`userId`);--> statement-breakpoint
CREATE INDEX `saved_scripts_user_project_idx` ON `saved_scripts` (`userId`,`project`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);--> statement-breakpoint
CREATE UNIQUE INDEX `virtual_cards_token_unique` ON `virtual_cards` (`token`);--> statement-breakpoint
CREATE INDEX `virtual_cards_user_id_idx` ON `virtual_cards` (`userId`);--> statement-breakpoint
CREATE INDEX `virtual_cards_project_id_idx` ON `virtual_cards` (`projectId`);--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `userId` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `messenger_messages` ADD `read` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `chat_sessions` SET `userId` = (SELECT id FROM users WHERE openId IN ('local:owner', 'local-zero-login') ORDER BY id LIMIT 1) WHERE `userId` IS NULL;--> statement-breakpoint
UPDATE `messenger_messages` SET `read` = true WHERE `sender` = 'agent';