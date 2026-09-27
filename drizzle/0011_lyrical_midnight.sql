CREATE TABLE `strategy_ai_usage` (
	`scope` text NOT NULL,
	`day` text NOT NULL,
	`requests` integer NOT NULL,
	`next_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `day`)
);
