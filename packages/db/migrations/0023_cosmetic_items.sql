CREATE TABLE "agent_cosmetics" (
	"agent_id" text NOT NULL,
	"slot" text NOT NULL,
	"item_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_cosmetics_agent_id_slot_pk" PRIMARY KEY("agent_id","slot"),
	CONSTRAINT "agent_cosmetics_slot_ck" CHECK ("agent_cosmetics"."slot" in ('skin', 'trail', 'nameplate'))
);
--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD COLUMN "mint_status" text;--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD COLUMN "mint_tx" text;--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD COLUMN "minted_to" text;--> statement-breakpoint
ALTER TABLE "agent_cosmetics" ADD CONSTRAINT "agent_cosmetics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD CONSTRAINT "cosmetics_owned_mint_status_ck" CHECK ("cosmetics_owned"."mint_status" is null or "cosmetics_owned"."mint_status" in ('pending', 'minted', 'failed'));