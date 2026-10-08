CREATE TABLE "agent_execution_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"agent_name" text DEFAULT 'copilot-agent' NOT NULL,
	"model_provider" text DEFAULT 'groq' NOT NULL,
	"model_name" text DEFAULT 'llama-3.3-70b-versatile' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" text DEFAULT '0.000000' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ADD CONSTRAINT "agent_execution_telemetry_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ADD CONSTRAINT "agent_execution_telemetry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_telemetry" ADD CONSTRAINT "agent_execution_telemetry_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_telemetry_org_idx" ON "agent_execution_telemetry" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agent_telemetry_project_idx" ON "agent_execution_telemetry" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_telemetry_task_idx" ON "agent_execution_telemetry" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_telemetry_created_at_idx" ON "agent_execution_telemetry" USING btree ("created_at");