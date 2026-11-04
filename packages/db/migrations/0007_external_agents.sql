CREATE TABLE "external_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text,
	"name" text NOT NULL,
	"webhook_url" text,
	"secret_sha256" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"secret_auth_tag" "bytea" NOT NULL,
	"secret_wrapped_key" "bytea" NOT NULL,
	"secret_key_id" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"misses" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_seen_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_agents_name_ck" CHECK (char_length("external_agents"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "external_agents" ADD CONSTRAINT "external_agents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_agents" ADD CONSTRAINT "external_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_agents_account_idx" ON "external_agents" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_agents_agent_uq" ON "external_agents" USING btree ("agent_id");