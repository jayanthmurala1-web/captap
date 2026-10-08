CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TABLE "document_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"approver_name" text NOT NULL,
	"approver_email" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "document_share_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "document_approval" ADD CONSTRAINT "document_approval_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_share" ADD CONSTRAINT "document_share_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_share" ADD CONSTRAINT "document_share_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_approval_document_id_idx" ON "document_approval" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_share_document_id_idx" ON "document_share" USING btree ("document_id");