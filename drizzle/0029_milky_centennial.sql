CREATE TABLE "role_skill_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"role" "task_role" NOT NULL,
	"skill_name" text NOT NULL,
	CONSTRAINT "role_skill_route_org_role_skill_uq" UNIQUE("org_id","role","skill_name")
);
--> statement-breakpoint
ALTER TABLE "role_skill_route" ADD CONSTRAINT "role_skill_route_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;