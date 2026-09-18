CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`username` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_export_marks` (
	`user_id` text DEFAULT 'admin' NOT NULL,
	`sink` text NOT NULL,
	`content_key` text NOT NULL,
	`remote_id` text NOT NULL,
	`exported_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `sink`, `content_key`)
);
--> statement-breakpoint
INSERT INTO `__new_export_marks`("user_id", "sink", "content_key", "remote_id", "exported_at") SELECT 'admin', "sink", "content_key", "remote_id", "exported_at" FROM `export_marks`;--> statement-breakpoint
DROP TABLE `export_marks`;--> statement-breakpoint
ALTER TABLE `__new_export_marks` RENAME TO `export_marks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_watchlist` (
	`user_id` text DEFAULT 'admin' NOT NULL,
	`tmdb_type` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`poster_path` text,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `tmdb_type`, `tmdb_id`)
);
--> statement-breakpoint
INSERT INTO `__new_watchlist`("user_id", "tmdb_type", "tmdb_id", "title", "poster_path", "added_at") SELECT 'admin', "tmdb_type", "tmdb_id", "title", "poster_path", "added_at" FROM `watchlist`;--> statement-breakpoint
DROP TABLE `watchlist`;--> statement-breakpoint
ALTER TABLE `__new_watchlist` RENAME TO `watchlist`;--> statement-breakpoint
CREATE TABLE `__new_library_overrides` (
	`user_id` text DEFAULT 'admin' NOT NULL,
	`key` text NOT NULL,
	`action` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_library_overrides`("user_id", "key", "action", "updated_at") SELECT 'admin', "key", "action", "updated_at" FROM `library_overrides`;--> statement-breakpoint
DROP TABLE `library_overrides`;--> statement-breakpoint
ALTER TABLE `__new_library_overrides` RENAME TO `library_overrides`;--> statement-breakpoint
ALTER TABLE `playback_sessions` ADD `user_id` text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_observations` ADD `user_id` text DEFAULT 'admin' NOT NULL;