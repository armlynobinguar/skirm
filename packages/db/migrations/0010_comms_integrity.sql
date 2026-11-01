CREATE TABLE "match_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"tick" integer NOT NULL,
	"team" text NOT NULL,
	"agent_id" text,
	"agent_name" text,
	"channel" text NOT NULL,
	"text" varchar(120) NOT NULL,
	"heard_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overheard_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_messages_team_ck" CHECK ("match_messages"."team" in ('A', 'B')),
	CONSTRAINT "match_messages_channel_ck" CHECK ("match_messages"."channel" in ('say', 'team'))
);
--> statement-breakpoint
DROP INDEX "accounts_near_idx";--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "mint_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD COLUMN "practice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "match_messages" ADD CONSTRAINT "match_messages_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_messages_match_idx" ON "match_messages" USING btree ("match_id","tick","id");--> statement-breakpoint
-- Hand-written: one player per NEAR account. Older rows keep the link; later duplicates lose it.
UPDATE "accounts" SET "near_account_id" = NULL WHERE "near_account_id" IS NOT NULL AND "id" NOT IN (SELECT DISTINCT ON ("near_account_id") "id" FROM "accounts" WHERE "near_account_id" IS NOT NULL ORDER BY "near_account_id", "created_at", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_near_uq" ON "accounts" USING btree ("near_account_id") WHERE "accounts"."near_account_id" is not null;