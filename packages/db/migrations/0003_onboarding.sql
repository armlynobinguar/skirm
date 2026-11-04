CREATE TABLE "onboarding_progress" (
	"account_id" text PRIMARY KEY NOT NULL,
	"tutorial_step" integer DEFAULT 0 NOT NULL,
	"tutorial_completed_at" timestamp with time zone,
	"tutorial_skipped_at" timestamp with time zone,
	"checklist_dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;