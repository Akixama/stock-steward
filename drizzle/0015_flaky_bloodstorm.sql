CREATE TABLE `push_subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_ref` text NOT NULL,
  `endpoint` text NOT NULL,
  `p256dh` text NOT NULL,
  `auth` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_owner` ON `push_subscriptions` (`owner_ref`);
--> statement-breakpoint
CREATE TABLE `push_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_ref` text NOT NULL,
  `alert_id` text NOT NULL,
  `subscription_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `claimed_at` text,
  `sent_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_push_deliveries_status` ON `push_deliveries` (`status`,`claimed_at`);
