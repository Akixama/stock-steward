CREATE TABLE `broker_connections` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`broker` text NOT NULL,
	`account_ref` text NOT NULL,
	`environment` text NOT NULL,
	`token_iv` text NOT NULL,
	`token_ciphertext` text NOT NULL,
	`connected_at` text NOT NULL
);
