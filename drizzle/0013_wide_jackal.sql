CREATE TABLE `goal_plans` (
	`owner_ref` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`plan_json` text NOT NULL,
	`updated_at` text NOT NULL
);
