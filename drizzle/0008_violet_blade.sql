CREATE TABLE `autonomy_schedules` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`interval_minutes` integer NOT NULL,
	`enabled` integer NOT NULL,
	`revision` integer NOT NULL,
	`next_due_at` text NOT NULL,
	`lease_token` text,
	`lease_until` text,
	`last_attempt_at` text,
	`last_success_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `autonomy_worker_health` (
	`id` text PRIMARY KEY NOT NULL,
	`lease_until` text,
	`lease_token` text,
	`last_started_at` text,
	`last_completed_at` text,
	`last_summary` text
);
--> statement-breakpoint
CREATE TABLE `autonomy_worker_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`revision` integer NOT NULL,
	`due_at` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`attempt_token` text NOT NULL,
	`attempts` integer NOT NULL,
	`observation_id` text,
	`receipt_id` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `autonomy_worker_runs_owner_started_idx` ON `autonomy_worker_runs` (`owner_ref`,`started_at`);--> statement-breakpoint
CREATE TABLE `chain_transaction_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`record_json` text NOT NULL,
	`created_at` text NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chain_transaction_watches_owner_checked_idx` ON `chain_transaction_watches` (`owner_ref`,`checked_at`);