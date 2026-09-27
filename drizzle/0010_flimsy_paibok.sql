CREATE TABLE `execution_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`intent_digest` text NOT NULL,
	`mandate_version` integer NOT NULL,
	`execution_day` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`state` text NOT NULL,
	`plan_json` text NOT NULL,
	`transaction_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `execution_attempts_owner_created_idx` ON `execution_attempts` (`owner_ref`,`created_at`);