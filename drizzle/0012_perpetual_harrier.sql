CREATE TABLE `practice_sessions` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`session_json` text NOT NULL,
	`background` integer NOT NULL,
	`next_due_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `practice_sessions_due_idx` ON `practice_sessions` (`background`,`next_due_at`);