CREATE TYPE "public"."epic_status" AS ENUM('open', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('open', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "epic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "epic_status" DEFAULT 'open' NOT NULL,
	"color" text DEFAULT 'indigo' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "epic_project_number_uq" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "story" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"epic_id" uuid,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"acceptance_criteria" text DEFAULT '' NOT NULL,
	"status" "story_status" DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_project_number_uq" UNIQUE("project_id","number")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "epic_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "story_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "epic_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "story_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "output_contract" text;--> statement-breakpoint
ALTER TABLE "epic" ADD CONSTRAINT "epic_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epic" ADD CONSTRAINT "epic_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epic" ADD CONSTRAINT "epic_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_epic_id_epic_id_fk" FOREIGN KEY ("epic_id") REFERENCES "public"."epic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epic_project_id_idx" ON "epic" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_project_id_idx" ON "story" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_epic_id_idx" ON "story" USING btree ("epic_id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_epic_id_epic_id_fk" FOREIGN KEY ("epic_id") REFERENCES "public"."epic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_epic_id_idx" ON "task" USING btree ("epic_id");--> statement-breakpoint
CREATE INDEX "task_story_id_idx" ON "task" USING btree ("story_id");