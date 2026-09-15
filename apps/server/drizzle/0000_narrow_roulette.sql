CREATE TABLE `playback_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`profile_id` text,
	`provider_content_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text,
	`show_title` text,
	`season_number` integer,
	`episode_number` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`start_progress` real,
	`end_progress` real,
	`completed` integer DEFAULT false NOT NULL,
	`observation_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sess_provider_content_idx` ON `playback_sessions` (`provider`,`provider_content_id`);--> statement-breakpoint
CREATE TABLE `provider_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`provider` text NOT NULL,
	`profile_id` text,
	`provider_content_id` text NOT NULL,
	`media_type` text NOT NULL,
	`title` text,
	`show_title` text,
	`season_number` integer,
	`episode_number` integer,
	`progress` real,
	`position_seconds` real,
	`duration_seconds` real,
	`watched_at` integer,
	`observed_at` integer NOT NULL,
	`source` text NOT NULL,
	`raw` text NOT NULL,
	`parser_version` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_observations_fingerprint_unique` ON `provider_observations` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `obs_provider_content_idx` ON `provider_observations` (`provider`,`provider_content_id`);--> statement-breakpoint
CREATE INDEX `obs_observed_at_idx` ON `provider_observations` (`observed_at`);--> statement-breakpoint
CREATE INDEX `obs_watched_at_idx` ON `provider_observations` (`watched_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`provider` text PRIMARY KEY NOT NULL,
	`last_sync_at` integer,
	`last_success_at` integer,
	`last_sync_status` text,
	`last_error` text,
	`last_observation_count` integer
);
