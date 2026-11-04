CREATE TABLE "achievements_unlocked" (
	"account_id" text NOT NULL,
	"achievement_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"badge_status" text DEFAULT 'none' NOT NULL,
	"badge_token_id" text,
	"badge_tx" text,
	"badge_owner" text,
	"badge_at" timestamp with time zone,
	CONSTRAINT "achievements_unlocked_account_id_achievement_id_pk" PRIMARY KEY("account_id","achievement_id"),
	CONSTRAINT "achievements_badge_status_ck" CHECK ("achievements_unlocked"."badge_status" in ('none', 'pending', 'minted', 'local', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "quest_claims" (
	"account_id" text NOT NULL,
	"quest_id" text NOT NULL,
	"period" text NOT NULL,
	"period_key" text NOT NULL,
	"reward_credits" integer NOT NULL,
	"credited" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_claims_account_id_quest_id_period_key_pk" PRIMARY KEY("account_id","quest_id","period_key"),
	CONSTRAINT "quest_claims_period_ck" CHECK ("quest_claims"."period" in ('daily', 'weekly'))
);
--> statement-breakpoint
ALTER TABLE "achievements_unlocked" ADD CONSTRAINT "achievements_unlocked_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_claims" ADD CONSTRAINT "quest_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;