ALTER TABLE "agents" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD COLUMN "debriefs" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_system_prompt_ck" CHECK (char_length("agents"."system_prompt") <= 600);