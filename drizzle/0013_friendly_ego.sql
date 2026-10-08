CREATE TYPE "public"."preview_deployment_status" AS ENUM('pending', 'building', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."project_autonomy_level" AS ENUM('L0', 'L1', 'L2', 'L3', 'L4');--> statement-breakpoint
CREATE TABLE "preview_deployment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"worktree_id" uuid,
	"branch" text NOT NULL,
	"commit_sha" text,
	"url" text NOT NULL,
	"status" "preview_deployment_status" DEFAULT 'building' NOT NULL,
	"logs" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "autonomy_level" "project_autonomy_level" DEFAULT 'L2' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "auto_approval_policy" jsonb;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_deployment" ADD CONSTRAINT "preview_deployment_worktree_id_task_worktree_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."task_worktree"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_deployment_org_idx" ON "preview_deployment" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "preview_deployment_project_idx" ON "preview_deployment" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "preview_deployment_task_idx" ON "preview_deployment" USING btree ("task_id");