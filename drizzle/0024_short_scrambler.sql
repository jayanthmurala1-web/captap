CREATE TABLE "ai_provider_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"key_hint" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"last_error" text,
	CONSTRAINT "ai_provider_key_org_provider_uq" UNIQUE("org_id","provider")
);
--> statement-breakpoint
CREATE TABLE "org_ai_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"default_provider" text,
	"default_model" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ALTER COLUMN "agent_name" SET DEFAULT 'consult';--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ALTER COLUMN "model_name" SET DEFAULT 'openai/gpt-oss-120b';--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ADD COLUMN "key_source" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ADD COLUMN "purpose" text DEFAULT 'consult' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_key" ADD CONSTRAINT "ai_provider_key_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_key" ADD CONSTRAINT "ai_provider_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_ai_settings" ADD CONSTRAINT "org_ai_settings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_ai_settings" ADD CONSTRAINT "org_ai_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Spec 021: everyone who could chat before keeps chatting; only owner/admin manage provider keys.
UPDATE "org_role" SET "capabilities" = array_append("capabilities", 'use_ai')
WHERE NOT ('use_ai' = ANY("capabilities"));
--> statement-breakpoint
UPDATE "org_role" SET "capabilities" = array_append("capabilities", 'manage_ai_keys')
WHERE "slug" IN ('owner', 'admin') AND NOT ('manage_ai_keys' = ANY("capabilities"));
