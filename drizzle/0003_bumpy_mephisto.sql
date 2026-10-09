CREATE TABLE `account_order_gates` (
	`owner_ref` text NOT NULL,
	`account_ref` text NOT NULL,
	`active_receipt_id` text,
	`last_completed_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_ref`, `account_ref`)
);
