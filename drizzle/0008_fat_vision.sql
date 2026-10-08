CREATE TYPE "public"."learned_rule_source" AS ENUM('human_critique', 'persona_review', 'manual');--> statement-breakpoint
CREATE TABLE "project_learned_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"skill_name" text DEFAULT 'code-review' NOT NULL,
	"rule" text NOT NULL,
	"source" "learned_rule_source" DEFAULT 'human_critique' NOT NULL,
	"source_task_id" uuid,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_learned_rule" ADD CONSTRAINT "project_learned_rule_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_learned_rule" ADD CONSTRAINT "project_learned_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_learned_rule" ADD CONSTRAINT "project_learned_rule_source_task_id_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_learned_rule" ADD CONSTRAINT "project_learned_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_learned_rule_project_skill_idx" ON "project_learned_rule" USING btree ("project_id","skill_name");--> statement-breakpoint
CREATE INDEX "project_learned_rule_project_created_idx" ON "project_learned_rule" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_learned_rule_task_idx" ON "project_learned_rule" USING btree ("source_task_id");