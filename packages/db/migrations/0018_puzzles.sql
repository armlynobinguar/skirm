CREATE TABLE "puzzle_bests" (
	"account_id" text NOT NULL,
	"puzzle_id" text NOT NULL,
	"score" integer NOT NULL,
	"ticks" integer NOT NULL,
	"medal" text,
	"run_id" text NOT NULL,
	"log_hash" text NOT NULL,
	"brain" text NOT NULL,
	"solves" integer DEFAULT 1 NOT NULL,
	"achieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_bests_account_id_puzzle_id_pk" PRIMARY KEY("account_id","puzzle_id")
);
--> statement-breakpoint
CREATE TABLE "puzzle_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"puzzle_id" text NOT NULL,
	"crew" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"brain" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "puzzle_runs_status_ck" CHECK ("puzzle_runs"."status" in ('queued', 'running', 'done', 'failed', 'insufficient_credits'))
);
--> statement-breakpoint
ALTER TABLE "puzzle_bests" ADD CONSTRAINT "puzzle_bests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_runs" ADD CONSTRAINT "puzzle_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "puzzle_bests_board_idx" ON "puzzle_bests" USING btree ("puzzle_id","score","achieved_at");--> statement-breakpoint
CREATE INDEX "puzzle_runs_account_idx" ON "puzzle_runs" USING btree ("account_id","created_at");