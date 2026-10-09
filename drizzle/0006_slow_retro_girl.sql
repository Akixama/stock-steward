CREATE TABLE `chain_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`record_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chain_observations_owner_address_created_idx` ON `chain_observations` (`owner_ref`,`address`,`created_at`);--> statement-breakpoint
CREATE TABLE `chain_read_gates` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`next_available_at` text NOT NULL
);
