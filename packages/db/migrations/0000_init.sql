CREATE TYPE "public"."credit_source" AS ENUM('paid', 'free');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('held', 'settled', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."ledger_note" AS ENUM('entry_fee', 'reversal', 'expired', 'cosmetic');--> statement-breakpoint
CREATE TYPE "public"."ledger_row_type" AS ENUM('topup', 'hold', 'charge', 'refund', 'free', 'spend');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('live', 'ended', 'void');--> statement-breakpoint
CREATE TYPE "public"."registry_status" AS ENUM('none', 'pending', 'recorded', 'failed', 'local');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('open', 'locked', 'paid');--> statement-breakpoint
CREATE TYPE "public"."skill_status" AS ENUM('draft', 'minted', 'listed');--> statement-breakpoint
CREATE TYPE "public"."unlock_kind" AS ENUM('builder', 'digger', 'firefighter');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"privy_did" text,
	"near_account_id" text,
	"system" boolean DEFAULT false NOT NULL,
	"elo" integer DEFAULT 1200 NOT NULL,
	"ranked_matches" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"agent_id" text NOT NULL,
	"slot" integer NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "agent_skills_agent_id_slot_pk" PRIMARY KEY("agent_id","slot"),
	CONSTRAINT "agent_skills_slot_ck" CHECK ("agent_skills"."slot" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"elo" integer DEFAULT 1200 NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"role" text DEFAULT 'Runner' NOT NULL,
	"vision" integer DEFAULT 3 NOT NULL,
	"comms" integer DEFAULT 3 NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"system_prompt" text,
	"appearance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_system_prompt_ck" CHECK (char_length("agents"."system_prompt") <= 600)
);
--> statement-breakpoint
CREATE TABLE "cosmetics_owned" (
	"account_id" text NOT NULL,
	"item_id" text NOT NULL,
	"source" text DEFAULT 'purchase' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cosmetics_owned_account_id_item_id_pk" PRIMARY KEY("account_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "free_budget_days" (
	"day" text PRIMARY KEY NOT NULL,
	"used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"account_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"allowance_left" integer DEFAULT 60 NOT NULL,
	"allowance_day" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"type" "ledger_row_type" NOT NULL,
	"amount" integer NOT NULL,
	"source" "credit_source" NOT NULL,
	"note" "ledger_note",
	"run_id" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"token_id" text,
	"seller_id" text NOT NULL,
	"price_yocto" numeric(40, 0) NOT NULL,
	"tx_hash" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
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
CREATE TABLE "run_holds" (
	"run_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"status" "hold_status" NOT NULL,
	"day" text NOT NULL,
	"agents" integer NOT NULL,
	"step_limit" integer NOT NULL,
	"hold" integer NOT NULL,
	"free_held" integer NOT NULL,
	"paid_held" integer NOT NULL,
	"entry_fee" integer DEFAULT 0 NOT NULL,
	"charges_turns" boolean DEFAULT true NOT NULL,
	"ticks" jsonb NOT NULL,
	"lost" jsonb NOT NULL,
	"turns_charged" integer DEFAULT 0 NOT NULL,
	"charged_free" integer DEFAULT 0 NOT NULL,
	"charged_paid" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"token_id" text,
	"listing_id" text,
	"seller_id" text,
	"buyer_id" text NOT NULL,
	"price_yocto" numeric(40, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "skill_ownership" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"token_id" text,
	"owner_id" text,
	"owner_near" text,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "skill_versions" (
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"requires_actions" jsonb NOT NULL,
	"handles_tags" jsonb NOT NULL,
	"royalty_bps" integer DEFAULT 500 NOT NULL,
	"prompt_sha256" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"status" "skill_status" DEFAULT 'draft' NOT NULL,
	"token_id" text,
	"minted_at" timestamp with time zone,
	"mint_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_skill_id_version_pk" PRIMARY KEY("skill_id","version"),
	CONSTRAINT "skill_versions_royalty_ck" CHECK ("skill_versions"."royalty_bps" between 0 and 1000),
	CONSTRAINT "skill_versions_version_ck" CHECK ("skill_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"account_bound" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unlock_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" "unlock_kind" NOT NULL,
	"attached_agent_id" text,
	"source" text DEFAULT 'starter' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"map_id" text NOT NULL,
	"ranked" boolean NOT NULL,
	"practice" boolean DEFAULT false NOT NULL,
	"difficulty" text,
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
	"debriefs" jsonb,
	"log" jsonb,
	"log_hash" text,
	"registry_status" "registry_status" DEFAULT 'none' NOT NULL,
	"registry_tx" text,
	"season_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD CONSTRAINT "cosmetics_owned_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_rows" ADD CONSTRAINT "ledger_rows_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_messages" ADD CONSTRAINT "match_messages_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_skill_stats" ADD CONSTRAINT "match_skill_stats_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_payouts" ADD CONSTRAINT "prize_payouts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_payouts" ADD CONSTRAINT "prize_payouts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_holds" ADD CONSTRAINT "run_holds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_buyer_id_accounts_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_benchmarks" ADD CONSTRAINT "skill_benchmarks_skill_id_version_skill_versions_skill_id_version_fk" FOREIGN KEY ("skill_id","version") REFERENCES "public"."skill_versions"("skill_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ownership" ADD CONSTRAINT "skill_ownership_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_trials" ADD CONSTRAINT "skill_trials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_creator_id_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_items" ADD CONSTRAINT "unlock_items_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_items" ADD CONSTRAINT "unlock_items_attached_agent_id_agents_id_fk" FOREIGN KEY ("attached_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD CONSTRAINT "v2_matches_team_a_account_id_accounts_id_fk" FOREIGN KEY ("team_a_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD CONSTRAINT "v2_matches_team_b_account_id_accounts_id_fk" FOREIGN KEY ("team_b_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2_matches" ADD CONSTRAINT "v2_matches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_elo_idx" ON "accounts" USING btree ("elo");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_handle_uq" ON "accounts" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_privy_did_uq" ON "accounts" USING btree ("privy_did");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_near_uq" ON "accounts" USING btree ("near_account_id") WHERE "accounts"."near_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skills_skill_uq" ON "agent_skills" USING btree ("agent_id","skill_id");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_elo_idx" ON "agents" USING btree ("elo");--> statement-breakpoint
CREATE INDEX "ledger_rows_account_idx" ON "ledger_rows" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "ledger_rows_run_idx" ON "ledger_rows" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_rows_receipt_uq" ON "ledger_rows" USING btree ("tx_hash") WHERE "ledger_rows"."type" = 'topup' and "ledger_rows"."tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "listings_skill_idx" ON "listings" USING btree ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_active_uq" ON "listings" USING btree ("skill_id","version","seller_id") WHERE "listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "match_messages_match_idx" ON "match_messages" USING btree ("match_id","tick","id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_skill_stats_uq" ON "match_skill_stats" USING btree ("match_id","skill_id","version","team");--> statement-breakpoint
CREATE INDEX "match_skill_stats_skill_idx" ON "match_skill_stats" USING btree ("skill_id","version","map_id");--> statement-breakpoint
CREATE INDEX "prize_payouts_account_idx" ON "prize_payouts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "run_holds_account_idx" ON "run_holds" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tx_uq" ON "sales" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "sales_skill_idx" ON "sales" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "season_standings_points_idx" ON "season_standings" USING btree ("season_id","points" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_number_uq" ON "seasons" USING btree ("number");--> statement-breakpoint
CREATE INDEX "seasons_window_idx" ON "seasons" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_ownership_owner_uq" ON "skill_ownership" USING btree ("skill_id","version","owner_id");--> statement-breakpoint
CREATE INDEX "skill_ownership_token_idx" ON "skill_ownership" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "skill_ownership_owner_idx" ON "skill_ownership" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "skill_trials_buyer_idx" ON "skill_trials" USING btree ("account_id","skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_token_uq" ON "skill_versions" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "skills_creator_idx" ON "skills" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "unlock_items_owner_idx" ON "unlock_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "unlock_items_agent_idx" ON "unlock_items" USING btree ("attached_agent_id");--> statement-breakpoint
CREATE INDEX "v2_matches_status_idx" ON "v2_matches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "v2_matches_team_a_idx" ON "v2_matches" USING btree ("team_a_account_id","created_at");--> statement-breakpoint
CREATE INDEX "v2_matches_team_b_idx" ON "v2_matches" USING btree ("team_b_account_id","created_at");