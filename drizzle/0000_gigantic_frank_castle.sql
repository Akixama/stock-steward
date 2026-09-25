CREATE TABLE `decision_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`account_ref` text NOT NULL,
	`policy_version` integer NOT NULL,
	`status` text NOT NULL,
	`receipt_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decision_receipts_owner_created_idx` ON `decision_receipts` (`owner_ref`,`created_at`);--> statement-breakpoint
CREATE TABLE `mandates` (
	`owner_ref` text NOT NULL,
	`version` integer NOT NULL,
	`policy_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_ref`, `version`)
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`receipt_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`owner_ref` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`receipt_id`, `sequence`)
);
