CREATE TABLE `wallet_ownership` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`challenge_id` text NOT NULL,
	`message` text NOT NULL,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`method` text
);
