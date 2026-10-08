ALTER TABLE "marketplace_skill" DROP CONSTRAINT "marketplace_skill_published_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "marketplace_skill" ALTER COLUMN "published_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_skill" ADD CONSTRAINT "marketplace_skill_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;