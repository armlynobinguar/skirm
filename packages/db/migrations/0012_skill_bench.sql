CREATE TABLE "skill_bench_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"map_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"prompt_sha256" text,
	"ciphertext" "bytea",
	"iv" "bytea",
	"auth_tag" "bytea",
	"wrapped_key" "bytea",
	"key_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"brain" text,
	"credits" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "skill_bench_runs_status_ck" CHECK ("skill_bench_runs"."status" in ('queued', 'running', 'done', 'failed', 'insufficient_credits'))
);
--> statement-breakpoint
ALTER TABLE "skill_bench_runs" ADD CONSTRAINT "skill_bench_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_bench_runs" ADD CONSTRAINT "skill_bench_runs_skill_id_version_skill_versions_skill_id_version_fk" FOREIGN KEY ("skill_id","version") REFERENCES "public"."skill_versions"("skill_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_bench_runs_account_idx" ON "skill_bench_runs" USING btree ("account_id","created_at");