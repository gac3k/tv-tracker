CREATE TABLE `provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`include_data` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
