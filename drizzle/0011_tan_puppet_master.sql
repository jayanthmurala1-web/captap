CREATE TYPE "public"."webhook_event_type" AS ENUM('task.created', 'task.claimed', 'task.submitted', 'task.approved', 'task.rejected', 'task.handoff', 'worktree.provisioned', 'pr.synthesized', 'doc.published', 'ping');--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_subscription_id_webhook_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_delivery_subscription_idx" ON "webhook_delivery" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_delivered_at_idx" ON "webhook_delivery" USING btree ("delivered_at");--> statement-breakpoint
CREATE INDEX "webhook_subscription_org_idx" ON "webhook_subscription" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "webhook_subscription_project_idx" ON "webhook_subscription" USING btree ("project_id");