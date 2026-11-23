CREATE TABLE "skill_auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_address" text NOT NULL,
	"chain_auction_id" numeric(78, 0) NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"seller_id" text NOT NULL,
	"skill_ref" text NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_address" text,
	"buyer_id" text,
	"price" numeric(40, 0),
	"sale_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "skill_auctions_status_ck" CHECK ("skill_auctions"."status" in ('open', 'won', 'granted', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "evm_address" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "currency" text DEFAULT 'near' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_auctions" ADD CONSTRAINT "skill_auctions_seller_id_accounts_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_auctions" ADD CONSTRAINT "skill_auctions_buyer_id_accounts_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_auctions" ADD CONSTRAINT "skill_auctions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_auctions_chain_uq" ON "skill_auctions" USING btree ("contract_address","chain_auction_id");--> statement-breakpoint
CREATE INDEX "skill_auctions_status_idx" ON "skill_auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "skill_auctions_skill_idx" ON "skill_auctions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_evm_uq" ON "accounts" USING btree ("evm_address") WHERE "accounts"."evm_address" is not null;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_currency_ck" CHECK ("sales"."currency" in ('near', 'cskirm'));