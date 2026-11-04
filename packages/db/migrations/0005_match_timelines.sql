CREATE TABLE "match_timelines" (
	"match_id" text NOT NULL,
	"team" text NOT NULL,
	"brain" text NOT NULL,
	"plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"moments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_timelines_match_id_team_pk" PRIMARY KEY("match_id","team"),
	CONSTRAINT "match_timelines_team_ck" CHECK ("match_timelines"."team" in ('A', 'B'))
);
--> statement-breakpoint
ALTER TABLE "match_timelines" ADD CONSTRAINT "match_timelines_match_id_v2_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."v2_matches"("id") ON DELETE cascade ON UPDATE no action;