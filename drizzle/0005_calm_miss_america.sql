CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`account_ref` text NOT NULL,
	`record_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `observations_owner_created_idx` ON `observations` (`owner_ref`,`created_at`);