CREATE TABLE "playbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"text_sha256" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playbooks_owner_idx" ON "playbooks" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playbooks_selected_uq" ON "playbooks" USING btree ("owner_id") WHERE "playbooks"."selected";