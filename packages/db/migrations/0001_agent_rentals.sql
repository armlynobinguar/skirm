CREATE TABLE "rental_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"price_yocto" numeric(40, 0) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_offers_price_ck" CHECK ("rental_offers"."price_yocto" > 0)
);
--> statement-breakpoint
CREATE TABLE "rentals" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"renter_id" text NOT NULL,
	"price_yocto" numeric(40, 0) NOT NULL,
	"fee_yocto" numeric(40, 0) NOT NULL,
	"owner_proceeds_yocto" numeric(40, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"match_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "rentals_owner_renter_ck" CHECK ("rentals"."owner_id" <> "rentals"."renter_id")
);
--> statement-breakpoint
ALTER TABLE "rental_offers" ADD CONSTRAINT "rental_offers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_offers" ADD CONSTRAINT "rental_offers_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_offer_id_rental_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."rental_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_renter_id_accounts_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rental_offers_agent_active_uq" ON "rental_offers" USING btree ("agent_id") WHERE "rental_offers"."active";--> statement-breakpoint
CREATE INDEX "rental_offers_owner_idx" ON "rental_offers" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rentals_tx_uq" ON "rentals" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "rentals_renter_idx" ON "rentals" USING btree ("renter_id","agent_id");--> statement-breakpoint
CREATE INDEX "rentals_owner_idx" ON "rentals" USING btree ("owner_id");