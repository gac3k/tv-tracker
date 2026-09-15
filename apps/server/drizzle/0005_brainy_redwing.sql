CREATE TABLE `export_marks` (
	`sink` text NOT NULL,
	`content_key` text NOT NULL,
	`remote_id` text NOT NULL,
	`exported_at` integer NOT NULL,
	PRIMARY KEY(`sink`, `content_key`)
);
