CREATE TABLE "daily_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"date" text NOT NULL,
	"seed" text NOT NULL,
	"map_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"twist" text NOT NULL,
	"crew" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"brain" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"points" integer,
	"outcome" text,
	"ticks" integer,
	"log_hash" text,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "daily_attempts_status_ck" CHECK ("daily_attempts"."status" in ('queued', 'running', 'done', 'failed', 'insufficient_credits'))
);
--> statement-breakpoint
ALTER TABLE "daily_attempts" ADD CONSTRAINT "daily_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_attempts_account_idx" ON "daily_attempts" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "daily_attempts_board_idx" ON "daily_attempts" USING btree ("date","points");