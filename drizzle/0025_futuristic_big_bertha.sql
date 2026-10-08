CREATE TABLE "marketplace_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text,
	"publisher_label" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"pitch" text NOT NULL,
	"github_repo" text,
	"kind" "skill_kind" DEFAULT 'guide' NOT NULL,
	"source" text NOT NULL,
	"published_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_skill_org_name_uq" UNIQUE NULLS NOT DISTINCT("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "marketplace_skill" ADD CONSTRAINT "marketplace_skill_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_skill" ADD CONSTRAINT "marketplace_skill_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;