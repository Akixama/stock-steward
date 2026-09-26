CREATE TABLE `autonomy_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`receipt_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autonomy_runs_owner_created_idx` ON `autonomy_runs` (`owner_ref`,`created_at`);--> statement-breakpoint
CREATE TABLE `autonomy_spends` (
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`execution_day` text NOT NULL,
	`intent_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_ref`, `address`, `intent_id`)
);
--> statement-breakpoint
CREATE INDEX `autonomy_spends_daily_idx` ON `autonomy_spends` (`owner_ref`,`address`,`execution_day`);