CREATE TABLE "v2_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"map_id" text NOT NULL,
	"ranked" boolean NOT NULL,
	"status" "match_status" DEFAULT 'live' NOT NULL,
	"team_a_account_id" text NOT NULL,
	"team_b_account_id" text NOT NULL,
	"crews" jsonb,
	"winner" text,
	"reason" text,
	"decided_by" text,
	"fault" text,
	"score_a" integer,
	"score_b" integer,
	"ticks" integer,
	"elo_deltas" jsonb,
	"stats" jsonb,
	"log" jsonb,
	"log_hash" text,
	"registry_status" "registry_status" DEFAULT 'none' NOT NULL,
	"registry_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "elo" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "ranked_matches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "losses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "draws" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD CONSTRAINT "v2_matches_team_a_account_id_accounts_id_fk" FOREIGN KEY ("team_a_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD CONSTRAINT "v2_matches_team_b_account_id_accounts_id_fk" FOREIGN KEY ("team_b_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "v2_matches_status_idx" ON "v2_matches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "v2_matches_team_a_idx" ON "v2_matches" USING btree ("team_a_account_id","created_at");--> statement-breakpoint
CREATE INDEX "v2_matches_team_b_idx" ON "v2_matches" USING btree ("team_b_account_id","created_at");--> statement-breakpoint
CREATE INDEX "accounts_elo_idx" ON "accounts" USING btree ("elo");