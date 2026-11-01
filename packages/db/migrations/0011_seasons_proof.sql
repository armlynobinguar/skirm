CREATE TYPE "public"."season_status" AS ENUM('open', 'locked', 'paid');--> statement-breakpoint
ALTER TYPE "public"."ledger_note" ADD VALUE 'cosmetic';--> statement-breakpoint
ALTER TYPE "public"."ledger_row_type" ADD VALUE 'spend';--> statement-breakpoint
CREATE TABLE "cosmetics_owned" (
	"account_id" text NOT NULL,
	"item_id" text NOT NULL,
	"source" text DEFAULT 'purchase' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cosmetics_owned_account_id_item_id_pk" PRIMARY KEY("account_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "match_skill_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"map_id" text NOT NULL,
	"team" text NOT NULL,
	"ranked" boolean NOT NULL,
	"outcome" text NOT NULL,
	"opponent_elo" integer,
	"opponent_skills" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_skill_stats_team_ck" CHECK ("match_skill_stats"."team" in ('A', 'B')),
	CONSTRAINT "match_skill_stats_outcome_ck" CHECK ("match_skill_stats"."outcome" in ('win', 'loss', 'draw'))
);
--> statement-breakpoint
CREATE TABLE "prize_payouts" (
	"season_id" text NOT NULL,
	"rank" integer NOT NULL,
	"account_id" text NOT NULL,
	"bps" integer NOT NULL,
	"amount_yocto" numeric(40, 0) NOT NULL,
	"status" text DEFAULT 'local' NOT NULL,
	"tx" text,
	CONSTRAINT "prize_payouts_season_id_rank_pk" PRIMARY KEY("season_id","rank"),
	CONSTRAINT "prize_payouts_status_ck" CHECK ("prize_payouts"."status" in ('local', 'claimable', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "season_standings" (
	"season_id" text NOT NULL,
	"account_id" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_standings_season_id_account_id_pk" PRIMARY KEY("season_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "season_status" DEFAULT 'open' NOT NULL,
	"funded_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"onchain_status" "registry_status" DEFAULT 'local' NOT NULL,
	"tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_window_ck" CHECK ("seasons"."ends_at" > "seasons"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "skill_benchmarks" (
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"brain" text,
	"seeds" jsonb,
	"matches" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"leaks" integer DEFAULT 0 NOT NULL,
	"manipulations" integer DEFAULT 0 NOT NULL,
	"score" real,
	"results" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "skill_benchmarks_skill_id_version_pk" PRIMARY KEY("skill_id","version"),
	CONSTRAINT "skill_benchmarks_status_ck" CHECK ("skill_benchmarks"."status" in ('queued', 'running', 'done', 'needs_model', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "skill_trials" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"agent_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "skill_trials_status_ck" CHECK ("skill_trials"."status" in ('queued', 'running', 'done', 'needs_model', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "v2_matches" ADD COLUMN "season_id" text;--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD CONSTRAINT "cosmetics_owned_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_skill_stats" ADD CONSTRAINT "match_skill_stats_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_payouts" ADD CONSTRAINT "prize_payouts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_payouts" ADD CONSTRAINT "prize_payouts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_benchmarks" ADD CONSTRAINT "skill_benchmarks_skill_id_version_skill_versions_skill_id_version_fk" FOREIGN KEY ("skill_id","version") REFERENCES "public"."skill_versions"("skill_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_trials" ADD CONSTRAINT "skill_trials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_skill_stats_uq" ON "match_skill_stats" USING btree ("match_id","skill_id","version","team");--> statement-breakpoint
CREATE INDEX "match_skill_stats_skill_idx" ON "match_skill_stats" USING btree ("skill_id","version","map_id");--> statement-breakpoint
CREATE INDEX "prize_payouts_account_idx" ON "prize_payouts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "season_standings_points_idx" ON "season_standings" USING btree ("season_id","points" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_number_uq" ON "seasons" USING btree ("number");--> statement-breakpoint
CREATE INDEX "seasons_window_idx" ON "seasons" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "skill_trials_buyer_idx" ON "skill_trials" USING btree ("account_id","skill_id","version");--> statement-breakpoint
ALTER TABLE "v2_matches" ADD CONSTRAINT "v2_matches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;