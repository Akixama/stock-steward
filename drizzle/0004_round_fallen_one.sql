CREATE TABLE `data_deletion_requests` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`requested_at` text NOT NULL,
	`state` text DEFAULT 'requested' NOT NULL
);
