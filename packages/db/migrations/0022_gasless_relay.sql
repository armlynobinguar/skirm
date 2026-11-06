CREATE TABLE "relayed_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"near_account_id" text NOT NULL,
	"receiver_id" text NOT NULL,
	"methods" text NOT NULL,
	"delegate_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relayed_txs_status_ck" CHECK ("relayed_txs"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "relayed_txs" ADD CONSTRAINT "relayed_txs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relayed_txs_delegate_uq" ON "relayed_txs" USING btree ("delegate_hash");--> statement-breakpoint
CREATE INDEX "relayed_txs_account_idx" ON "relayed_txs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "relayed_txs_near_idx" ON "relayed_txs" USING btree ("near_account_id");