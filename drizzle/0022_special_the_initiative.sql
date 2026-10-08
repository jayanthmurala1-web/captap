CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid,
	"actor_id" text,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_label" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_org_created_idx" ON "audit_event" USING btree ("org_id","created_at");
--> statement-breakpoint
-- Spec 018: append-only. Rejects every UPDATE and DELETE, except the cascade when the whole organization is deleted.
CREATE FUNCTION "audit_event_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "organization" WHERE "id" = OLD."org_id") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_event_no_change" BEFORE UPDATE OR DELETE ON "audit_event"
FOR EACH ROW EXECUTE FUNCTION "audit_event_immutable"();
--> statement-breakpoint
-- New capability for the roles that could already see everything.
UPDATE "org_role" SET "capabilities" = array_append("capabilities", 'view_audit_log')
WHERE "slug" IN ('owner', 'admin') AND NOT ('view_audit_log' = ANY("capabilities"));
