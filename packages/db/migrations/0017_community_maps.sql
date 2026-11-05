CREATE TABLE "community_map_likes" (
	"map_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_map_likes_map_id_account_id_pk" PRIMARY KEY("map_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "community_maps" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"name" text NOT NULL,
	"theme" text NOT NULL,
	"map" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"plays" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"balance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "community_maps_status_ck" CHECK ("community_maps"."status" in ('draft', 'published'))
);
--> statement-breakpoint
ALTER TABLE "community_map_likes" ADD CONSTRAINT "community_map_likes_map_id_community_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."community_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_map_likes" ADD CONSTRAINT "community_map_likes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_maps" ADD CONSTRAINT "community_maps_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_maps_author_idx" ON "community_maps" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "community_maps_published_idx" ON "community_maps" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_maps_name_uq" ON "community_maps" USING btree (lower("name")) WHERE "community_maps"."status" = 'published';