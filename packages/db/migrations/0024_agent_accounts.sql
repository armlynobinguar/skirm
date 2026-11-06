CREATE TABLE "agent_account_spends" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_yocto" numeric(40, 0) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"offer_id" text,
	"rental_id" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "agent_account_spends_kind_ck" CHECK ("agent_account_spends"."kind" in ('rent', 'withdraw')),
	CONSTRAINT "agent_account_spends_status_ck" CHECK ("agent_account_spends"."status" in ('pending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "agent_account_spends_amount_ck" CHECK ("agent_account_spends"."amount_yocto" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_accounts" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"near_account_id" text NOT NULL,
	"public_key" text NOT NULL,
	"key_ciphertext" "bytea" NOT NULL,
	"key_iv" "bytea" NOT NULL,
	"key_auth_tag" "bytea" NOT NULL,
	"key_wrapped" "bytea" NOT NULL,
	"key_key_id" text NOT NULL,
	"cap_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_accounts_cap_ck" CHECK ("agent_accounts"."cap_yocto" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_account_spends" ADD CONSTRAINT "agent_account_spends_agent_id_agent_accounts_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_accounts"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_spends" ADD CONSTRAINT "agent_account_spends_offer_id_rental_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."rental_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_spends" ADD CONSTRAINT "agent_account_spends_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_account_spends_agent_idx" ON "agent_account_spends" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_accounts_near_uq" ON "agent_accounts" USING btree ("near_account_id");--> statement-breakpoint
CREATE INDEX "agent_accounts_owner_idx" ON "agent_accounts" USING btree ("owner_id");