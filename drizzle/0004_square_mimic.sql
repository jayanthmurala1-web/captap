ALTER TABLE "project" ADD COLUMN "github_repo" text;--> statement-breakpoint
ALTER TABLE "task_submission" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_submission" ADD COLUMN "verification_details" jsonb;