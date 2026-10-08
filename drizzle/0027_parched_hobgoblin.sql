CREATE TYPE "public"."connection_kind" AS ENUM('slack_webhook', 'github_pat', 'custom_mcp');--> statement-breakpoint
CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"kind" "connection_kind" NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"ciphertext" text,
	"secret_hint" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"verified_at" timestamp,
	CONSTRAINT "connection_org_kind_label_uq" UNIQUE("org_id","kind","label")
);
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;