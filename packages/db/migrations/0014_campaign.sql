CREATE TABLE "campaign_progress" (
	"account_id" text NOT NULL,
	"mission_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cleared_at" timestamp with time zone,
	"best_ticks" integer,
	"last_match_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_progress_account_id_mission_id_pk" PRIMARY KEY("account_id","mission_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_rewards" (
	"account_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"cosmetic_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_rewards_account_id_chapter_id_pk" PRIMARY KEY("account_id","chapter_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_progress" ADD CONSTRAINT "campaign_progress_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_rewards" ADD CONSTRAINT "campaign_rewards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;