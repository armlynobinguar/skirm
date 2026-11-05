ALTER TABLE "agents" ADD COLUMN "xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "traits" jsonb DEFAULT '[]'::jsonb NOT NULL;