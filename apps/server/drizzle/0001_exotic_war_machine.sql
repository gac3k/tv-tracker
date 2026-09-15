CREATE TABLE `artwork` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`tmdb_id` integer,
	`tmdb_type` text,
	`title` text,
	`year` integer,
	`poster_path` text,
	`backdrop_path` text,
	`still_path` text,
	`runtime_seconds` real,
	`not_found` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
