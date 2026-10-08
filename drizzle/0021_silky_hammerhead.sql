ALTER TABLE "epic" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "story" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "epic" CASCADE;--> statement-breakpoint
DROP TABLE "story" CASCADE;--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_epic_id_epic_id_fk";
--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_story_id_story_id_fk";
--> statement-breakpoint
DROP INDEX "task_epic_id_idx";--> statement-breakpoint
DROP INDEX "task_story_id_idx";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "epic_seq";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "story_seq";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "epic_id";--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN "story_id";--> statement-breakpoint
DROP TYPE "public"."epic_status";--> statement-breakpoint
DROP TYPE "public"."story_status";