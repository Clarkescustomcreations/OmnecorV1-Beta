CREATE TABLE `agent_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`agent_type` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_user_idx` ON `agent_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `async_job_tracking` (
	`job_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`conversation_id` text,
	`label` text,
	`job_type` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`fail_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `async_job_tracking_status_idx` ON `async_job_tracking` (`status`);--> statement-breakpoint
CREATE INDEX `async_job_tracking_user_idx` ON `async_job_tracking` (`user_id`);--> statement-breakpoint
CREATE TABLE `file_watcher_registrations` (
	`project_id` text PRIMARY KEY NOT NULL,
	`root_dir` text NOT NULL,
	`debounce_ms` integer DEFAULT 300 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hitl_pending_actions` (
	`action_id` text PRIMARY KEY NOT NULL,
	`tool_name` text NOT NULL,
	`args` text,
	`category` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `hitl_pending_actions_status_idx` ON `hitl_pending_actions` (`status`);--> statement-breakpoint
CREATE TABLE `mcp_server_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`command` text,
	`args` text,
	`url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ommesh_trusted_peers` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`node_id` text,
	`approved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_alert_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`alert_type` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_alert_log_user_idx` ON `wallet_alert_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `wallet_alert_log_sent_at_idx` ON `wallet_alert_log` (`sent_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_session_idx` ON `chat_messages` (`sessionId`);--> statement-breakpoint
CREATE INDEX `chat_sessions_user_idx` ON `chat_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `cloud_compute_sessions_user_idx` ON `cloud_compute_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `cloud_compute_sessions_project_idx` ON `cloud_compute_sessions` (`projectId`);--> statement-breakpoint
CREATE INDEX `curated_posts_project_idx` ON `curatedPosts` (`projectId`);--> statement-breakpoint
CREATE INDEX `discovered_articles_project_idx` ON `discoveredArticles` (`projectId`);--> statement-breakpoint
CREATE INDEX `platform_accounts_user_idx` ON `platformAccounts` (`userId`);