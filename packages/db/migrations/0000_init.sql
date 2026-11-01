CREATE TYPE "public"."credit_source" AS ENUM('paid', 'free');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('held', 'settled', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."ledger_note" AS ENUM('entry_fee', 'reversal', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ledger_row_type" AS ENUM('topup', 'hold', 'charge', 'refund', 'free');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."match_mode" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "public"."match_result" AS ENUM('A', 'B', 'draw', 'void');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('live', 'ended', 'void');--> statement-breakpoint
CREATE TYPE "public"."registry_status" AS ENUM('none', 'pending', 'recorded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_lifecycle" AS ENUM('queued', 'credit_check', 'planning', 'ticking', 'replanning', 'ended', 'aborted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."run_mode" AS ENUM('solo', 'tutorial', 'test', 'race');--> statement-breakpoint
CREATE TYPE "public"."run_result" AS ENUM('clear', 'fail_out_of_steps', 'fail_all_agents_lost', 'fail_goal_flooded', 'fail_not_enough_collectibles');--> statement-breakpoint
CREATE TYPE "public"."skill_status" AS ENUM('draft', 'minted', 'listed');--> statement-breakpoint
CREATE TYPE "public"."unlock_kind" AS ENUM('builder', 'digger', 'firefighter');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"privy_did" text,
	"near_account_id" text,
	"system" boolean DEFAULT false NOT NULL,
	"tutorial_runs_left" integer DEFAULT 3 NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"map_id" text NOT NULL,
	"map_version" integer NOT NULL,
	"mode" "match_mode" NOT NULL,
	"status" "match_status" DEFAULT 'live' NOT NULL,
	"side_a_account_id" text NOT NULL,
	"side_b_account_id" text NOT NULL,
	"side_a_agents" jsonb NOT NULL,
	"side_b_agents" jsonb NOT NULL,
	"side_a_score" integer,
	"side_b_score" integer,
	"result" "match_result",
	"elo_deltas" jsonb,
	"replay_uri" text,
	"replay_sha256" text,
	"registry_status" "registry_status" DEFAULT 'none' NOT NULL,
	"registry_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
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
CREATE TABLE "run_skill_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"tag" text NOT NULL,
	"map_id" text NOT NULL,
	"cleared" boolean NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"crew_size" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"mode" "run_mode" NOT NULL,
	"map_id" text NOT NULL,
	"map_version" integer NOT NULL,
	"map_sha256" text NOT NULL,
	"crew" jsonb NOT NULL,
	"crew_size" integer NOT NULL,
	"test_skill_id" text,
	"test_skill_version" integer,
	"status" "run_lifecycle" DEFAULT 'queued' NOT NULL,
	"result_status" "run_result",
	"error_code" text,
	"ticks" integer,
	"score" integer,
	"agents" integer,
	"skills_equipped" integer,
	"upkeep" integer,
	"turns_charged" integer,
	"hold" integer DEFAULT 0 NOT NULL,
	"used" integer,
	"returned" integer,
	"replay_uri" text,
	"replay_sha256" text,
	"registry_status" "registry_status" DEFAULT 'none' NOT NULL,
	"registry_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
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
CREATE TABLE "skill_versions" (
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
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
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_rows" ADD CONSTRAINT "ledger_rows_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_side_a_account_id_accounts_id_fk" FOREIGN KEY ("side_a_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_side_b_account_id_accounts_id_fk" FOREIGN KEY ("side_b_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_holds" ADD CONSTRAINT "run_holds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_skill_stats" ADD CONSTRAINT "run_skill_stats_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_buyer_id_accounts_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ownership" ADD CONSTRAINT "skill_ownership_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_creator_id_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_items" ADD CONSTRAINT "unlock_items_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlock_items" ADD CONSTRAINT "unlock_items_attached_agent_id_agents_id_fk" FOREIGN KEY ("attached_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_handle_uq" ON "accounts" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_privy_did_uq" ON "accounts" USING btree ("privy_did");--> statement-breakpoint
CREATE INDEX "accounts_near_idx" ON "accounts" USING btree ("near_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skills_skill_uq" ON "agent_skills" USING btree ("agent_id","skill_id");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_elo_idx" ON "agents" USING btree ("elo");--> statement-breakpoint
CREATE INDEX "ledger_rows_account_idx" ON "ledger_rows" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "ledger_rows_run_idx" ON "ledger_rows" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_rows_receipt_uq" ON "ledger_rows" USING btree ("tx_hash") WHERE "ledger_rows"."type" = 'topup' and "ledger_rows"."tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "listings_skill_idx" ON "listings" USING btree ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_active_uq" ON "listings" USING btree ("skill_id","version","seller_id") WHERE "listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "run_holds_account_idx" ON "run_holds" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "run_skill_stats_uq" ON "run_skill_stats" USING btree ("run_id","skill_id","version","tag");--> statement-breakpoint
CREATE INDEX "run_skill_stats_skill_idx" ON "run_skill_stats" USING btree ("skill_id","version","tag");--> statement-breakpoint
CREATE INDEX "run_skill_stats_tag_idx" ON "run_skill_stats" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "runs_account_idx" ON "runs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_map_idx" ON "runs" USING btree ("map_id","crew_size","score");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tx_uq" ON "sales" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "sales_skill_idx" ON "sales" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_ownership_owner_uq" ON "skill_ownership" USING btree ("skill_id","version","owner_id");--> statement-breakpoint
CREATE INDEX "skill_ownership_token_idx" ON "skill_ownership" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "skill_ownership_owner_idx" ON "skill_ownership" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_token_uq" ON "skill_versions" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "skills_creator_idx" ON "skills" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "unlock_items_owner_idx" ON "unlock_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "unlock_items_agent_idx" ON "unlock_items" USING btree ("attached_agent_id");