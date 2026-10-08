CREATE TABLE "org_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_role_org_slug_uq" UNIQUE("org_id","slug")
);
--> statement-breakpoint
ALTER TABLE "project_member" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "project_member" ALTER COLUMN "role" SET DEFAULT 'developer';--> statement-breakpoint
ALTER TABLE "org_role" ADD CONSTRAINT "org_role_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."project_role";
--> statement-breakpoint
-- Spec 016: seed the system roles for every existing org. Existing member.role / project_member.role
-- values (owner, admin, member, developer, qa, devops, product, lead) are already valid slugs.
INSERT INTO "org_role" ("org_id", "slug", "name", "capabilities", "is_system")
SELECT o."id", r.slug, r.name, r.caps, true
FROM "organization" o
CROSS JOIN (VALUES
  ('owner',     'Owner',     ARRAY['invite_members','manage_roles','create_projects','manage_org_settings','access_all_projects','approve_tasks','manage_tasks','manage_documents','share_with_client','manage_project_settings']),
  ('admin',     'Admin',     ARRAY['invite_members','manage_roles','create_projects','manage_org_settings','access_all_projects','approve_tasks','manage_tasks','manage_documents','share_with_client','manage_project_settings']),
  ('member',    'Member',    ARRAY[]::text[]),
  ('lead',      'Lead',      ARRAY['approve_tasks','manage_tasks','manage_documents','share_with_client','manage_project_settings']),
  ('qa',        'QA',        ARRAY['approve_tasks']),
  ('product',   'Product',   ARRAY['approve_tasks']),
  ('developer', 'Developer', ARRAY[]::text[]),
  ('devops',    'DevOps',    ARRAY[]::text[])
) AS r(slug, name, caps)
ON CONFLICT ("org_id", "slug") DO NOTHING;
