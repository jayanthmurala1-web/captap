CREATE TYPE "public"."swarm_stage" AS ENUM('build', 'test', 'review', 'approval');--> statement-breakpoint
CREATE TABLE "task_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"stage" "swarm_stage" NOT NULL,
	"from_agent" text NOT NULL,
	"from_role" "task_role" NOT NULL,
	"to_role" "task_role" NOT NULL,
	"to_agent" text,
	"note" text DEFAULT '' NOT NULL,
	"artifacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_handoff" ADD CONSTRAINT "task_handoff_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_handoff_task_idx" ON "task_handoff" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_handoff_created_at_idx" ON "task_handoff" USING btree ("created_at");