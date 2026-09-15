CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` text
);
--> statement-breakpoint
CREATE INDEX `job_logs_run_idx` ON `job_logs` (`run_id`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`queue_job_id` text,
	`name` text NOT NULL,
	`provider` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`summary` text,
	`error` text,
	`error_type` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_started_idx` ON `job_runs` (`started_at`);