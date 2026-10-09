CREATE TABLE `price_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`triggered_at` text,
	`observed_price_cents` integer
);
--> statement-breakpoint
CREATE INDEX `idx_price_alerts_owner` ON `price_alerts` (`owner_ref`,`status`);