ALTER TABLE "agents" ADD COLUMN "role" text DEFAULT 'Runner' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "vision" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "comms" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tier" text DEFAULT 'standard' NOT NULL;