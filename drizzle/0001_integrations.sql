CREATE TABLE `ai_queries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`user_id` integer,
	`question` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`mode` text NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_queries_org_created` ON `ai_queries` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scope` text DEFAULT 'read' NOT NULL,
	`created_by` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_org` ON `api_keys` (`org_id`);--> statement-breakpoint
CREATE TABLE `calendar_feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_hash_unique` ON `calendar_feeds` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_org_user` ON `calendar_feeds` (`org_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `invoice_payment_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`invoice_id` integer NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`payment_ref` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_payment_links_invoice` ON `invoice_payment_links` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_payment_links_ext` ON `invoice_payment_links` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_provider_subject` ON `oauth_accounts` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `oauth_user` ON `oauth_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `org_integrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`provider` text NOT NULL,
	`config_enc` text NOT NULL,
	`hint` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_integrations_org_provider` ON `org_integrations` (`org_id`,`provider`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`endpoint_id` integer NOT NULL,
	`event` text NOT NULL,
	`event_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`response_body` text,
	`next_attempt_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_endpoint` ON `webhook_deliveries` (`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_retry` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`kind` text DEFAULT 'webhook' NOT NULL,
	`name` text NOT NULL,
	`url_enc` text NOT NULL,
	`url_hint` text NOT NULL,
	`secret_enc` text,
	`events` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_delivery_at` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoints_org` ON `webhook_endpoints` (`org_id`);