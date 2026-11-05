ALTER TYPE "public"."ledger_note" ADD VALUE 'backing';--> statement-breakpoint
CREATE TABLE "backing_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"sale_id" text,
	"tx_hash" text,
	"royalty_yocto" numeric(40, 0) NOT NULL,
	"to_backers_yocto" numeric(40, 0) NOT NULL,
	"to_writer_yocto" numeric(40, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backing_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"writer_id" text NOT NULL,
	"skill_id" text,
	"share_bps" integer NOT NULL,
	"cap_multiple_bps" integer NOT NULL,
	"max_raise_yocto" numeric(40, 0) NOT NULL,
	"raised_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"backers" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mode" text NOT NULL,
	"chain_round_id" text,
	"royalties_in_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"backers_earned_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "backing_rounds_status_ck" CHECK ("backing_rounds"."status" in ('open', 'closed', 'cancelled')),
	CONSTRAINT "backing_rounds_mode_ck" CHECK ("backing_rounds"."mode" in ('credits', 'near')),
	CONSTRAINT "backing_rounds_share_ck" CHECK ("backing_rounds"."share_bps" between 1 and 5000),
	CONSTRAINT "backing_rounds_cap_ck" CHECK ("backing_rounds"."cap_multiple_bps" between 10000 and 100000)
);
--> statement-breakpoint
CREATE TABLE "backings" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"backer_id" text NOT NULL,
	"stake_yocto" numeric(40, 0) NOT NULL,
	"claimed_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backing_payouts" ADD CONSTRAINT "backing_payouts_round_id_backing_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."backing_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backing_rounds" ADD CONSTRAINT "backing_rounds_writer_id_accounts_id_fk" FOREIGN KEY ("writer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backing_rounds" ADD CONSTRAINT "backing_rounds_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backings" ADD CONSTRAINT "backings_round_id_backing_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."backing_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backings" ADD CONSTRAINT "backings_backer_id_accounts_id_fk" FOREIGN KEY ("backer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backing_payouts_round_idx" ON "backing_payouts" USING btree ("round_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backing_payouts_sale_uq" ON "backing_payouts" USING btree ("round_id","sale_id") WHERE "backing_payouts"."sale_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "backing_payouts_tx_uq" ON "backing_payouts" USING btree ("tx_hash") WHERE "backing_payouts"."tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "backing_rounds_writer_idx" ON "backing_rounds" USING btree ("writer_id","created_at");--> statement-breakpoint
CREATE INDEX "backing_rounds_status_idx" ON "backing_rounds" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backing_rounds_chain_uq" ON "backing_rounds" USING btree ("chain_round_id") WHERE "backing_rounds"."chain_round_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "backings_round_backer_uq" ON "backings" USING btree ("round_id","backer_id");--> statement-breakpoint
CREATE INDEX "backings_backer_idx" ON "backings" USING btree ("backer_id");