CREATE TABLE "elo_decays" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"elo_before" integer NOT NULL,
	"elo_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elo_decays_lower_ck" CHECK ("elo_decays"."elo_after" < "elo_decays"."elo_before")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_ranked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "elo_decays" ADD CONSTRAINT "elo_decays_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "elo_decays_account_idx" ON "elo_decays" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "v2_matches_map_idx" ON "v2_matches" USING btree ("map_id","ended_at");--> statement-breakpoint
UPDATE "accounts" SET "last_ranked_at" = r."at" FROM (
	SELECT "account_id", max("ended_at") AS "at" FROM (
		SELECT "team_a_account_id" AS "account_id", "ended_at" FROM "v2_matches" WHERE "ranked" AND "status" = 'ended'
		UNION ALL
		SELECT "team_b_account_id", "ended_at" FROM "v2_matches" WHERE "ranked" AND "status" = 'ended'
	) s GROUP BY "account_id"
) r WHERE r."account_id" = "accounts"."id";