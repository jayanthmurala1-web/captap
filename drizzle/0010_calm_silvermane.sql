CREATE TYPE "public"."worktree_status" AS ENUM('active', 'submitted', 'merged', 'pruned');--> statement-breakpoint
CREATE TABLE "task_worktree" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"branch" text NOT NULL,
	"worktree_path" text NOT NULL,
	"base_ref" text DEFAULT 'main' NOT NULL,
	"status" "worktree_status" DEFAULT 'active' NOT NULL,
	"pr_number" integer,
	"pr_url" text,
	"pr_state" text,
	"allocated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_worktree" ADD CONSTRAINT "task_worktree_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_worktree" ADD CONSTRAINT "task_worktree_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_worktree" ADD CONSTRAINT "task_worktree_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_worktree" ADD CONSTRAINT "task_worktree_allocated_by_user_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_worktree_task_idx" ON "task_worktree" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_worktree_project_idx" ON "task_worktree" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_worktree_status_idx" ON "task_worktree" USING btree ("status");