ALTER TYPE "public"."ledger_note" ADD VALUE 'prize_pool';--> statement-breakpoint
ALTER TYPE "public"."ledger_note" ADD VALUE 'prize';--> statement-breakpoint
CREATE TABLE "lobbies" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"host_id" text NOT NULL,
	"guest_id" text,
	"map_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"talk" text DEFAULT 'any' NOT NULL,
	"crew_size" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"match_id" text,
	"winner_id" text,
	"tournament_id" text,
	"round" integer,
	"slot" integer,
	"host_ready_at" timestamp with time zone,
	"guest_ready_at" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lobbies_status_ck" CHECK ("lobbies"."status" in ('open', 'playing', 'done', 'cancelled')),
	CONSTRAINT "lobbies_talk_ck" CHECK ("lobbies"."talk" in ('any', 'quiet', 'standard', 'open')),
	CONSTRAINT "lobbies_crew_ck" CHECK ("lobbies"."crew_size" between 1 and 3),
	CONSTRAINT "lobbies_players_ck" CHECK ("lobbies"."guest_id" is null or "lobbies"."guest_id" <> "lobbies"."host_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"tournament_id" text NOT NULL,
	"account_id" text NOT NULL,
	"seed" integer,
	"elo" integer,
	"place" integer,
	"prize" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_entries_tournament_id_account_id_pk" PRIMARY KEY("tournament_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"creator_id" text NOT NULL,
	"size" integer NOT NULL,
	"map_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"talk" text DEFAULT 'any' NOT NULL,
	"crew_size" integer DEFAULT 3 NOT NULL,
	"prize_pool" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"champion_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "tournaments_status_ck" CHECK ("tournaments"."status" in ('open', 'running', 'done', 'cancelled')),
	CONSTRAINT "tournaments_size_ck" CHECK ("tournaments"."size" in (4, 8, 16)),
	CONSTRAINT "tournaments_talk_ck" CHECK ("tournaments"."talk" in ('any', 'quiet', 'standard', 'open')),
	CONSTRAINT "tournaments_crew_ck" CHECK ("tournaments"."crew_size" between 1 and 3),
	CONSTRAINT "tournaments_pool_ck" CHECK ("tournaments"."prize_pool" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_host_id_accounts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_guest_id_accounts_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_winner_id_accounts_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_creator_id_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_champion_id_accounts_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_code_uq" ON "lobbies" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_bracket_uq" ON "lobbies" USING btree ("tournament_id","round","slot");--> statement-breakpoint
CREATE INDEX "lobbies_host_idx" ON "lobbies" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "lobbies_guest_idx" ON "lobbies" USING btree ("guest_id","created_at");--> statement-breakpoint
CREATE INDEX "lobbies_match_idx" ON "lobbies" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "lobbies_status_idx" ON "lobbies" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "tournament_entries_account_idx" ON "tournament_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "tournaments_status_idx" ON "tournaments" USING btree ("status","created_at");