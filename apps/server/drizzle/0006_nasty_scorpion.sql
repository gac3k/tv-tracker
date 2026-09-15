CREATE TABLE `tmdb_details` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`tmdb_type` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`poster_path` text,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`tmdb_type`, `tmdb_id`)
);
