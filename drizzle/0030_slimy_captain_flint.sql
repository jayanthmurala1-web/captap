ALTER TABLE "sprint" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "sprint" CASCADE;--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_sprint_id_sprint_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "task_sprint_id_idx";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "sprint_id";--> statement-breakpoint
DROP TYPE "public"."sprint_status";