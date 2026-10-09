CREATE TABLE `session_signers` (
	`owner_ref` text NOT NULL,
	`address` text NOT NULL,
	`signer_iv` text NOT NULL,
	`signer_ciphertext` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_ref`, `address`)
);
