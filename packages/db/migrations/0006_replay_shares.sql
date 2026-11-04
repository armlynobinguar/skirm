CREATE TABLE "replay_casts" (
	"match_id" text PRIMARY KEY NOT NULL,
	"highlights" jsonb NOT NULL,
	"caster" text NOT NULL,
	"model" text,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"account_id" text NOT NULL,
	"start_tick" integer,
	"end_tick" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "replay_shares_clip_ck" CHECK (("replay_shares"."start_tick" is null and "replay_shares"."end_tick" is null) or ("replay_shares"."start_tick" >= 0 and "replay_shares"."end_tick" > "replay_shares"."start_tick"))
);
--> statement-breakpoint
ALTER TABLE "replay_casts" ADD CONSTRAINT "replay_casts_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_shares" ADD CONSTRAINT "replay_shares_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_shares" ADD CONSTRAINT "replay_shares_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replay_shares_match_idx" ON "replay_shares" USING btree ("match_id","account_id");