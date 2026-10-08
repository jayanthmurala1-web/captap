ALTER TABLE "document" ADD COLUMN "doc_type" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "visibility" text DEFAULT 'published' NOT NULL;