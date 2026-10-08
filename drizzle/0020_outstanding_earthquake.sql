CREATE TABLE "requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"removed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_document_key_uq" UNIQUE("document_id","key")
);
--> statement-breakpoint
CREATE TABLE "task_requirement" (
	"task_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	CONSTRAINT "task_requirement_task_id_requirement_id_pk" PRIMARY KEY("task_id","requirement_id")
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "prd_document_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "legacy_group" text;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirement" ADD CONSTRAINT "task_requirement_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_requirement" ADD CONSTRAINT "task_requirement_requirement_id_requirement_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requirement_project_id_idx" ON "requirement" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_requirement_requirement_id_idx" ON "task_requirement" USING btree ("requirement_id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_prd_document_id_document_id_fk" FOREIGN KEY ("prd_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_prd_document_id_idx" ON "task" USING btree ("prd_document_id");
--> statement-breakpoint
-- Spec 017 data migration. Epics with a PRD hand it to their tasks; every old Epic/Story title is kept on
-- the task as a muted label. We do not invent PRDs for epics that had none.
UPDATE "task" SET "prd_document_id" = e."prd_document_id"
FROM "epic" e
WHERE "task"."epic_id" = e."id" AND e."prd_document_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "task" SET "legacy_group" = NULLIF(concat_ws(' › ',
  (SELECT 'E-' || e."number" || ' ' || e."title" FROM "epic" e WHERE e."id" = "task"."epic_id"),
  (SELECT 'S-' || s."number" || ' ' || s."title" FROM "story" s WHERE s."id" = "task"."story_id")
), '')
WHERE "epic_id" IS NOT NULL OR "story_id" IS NOT NULL;
