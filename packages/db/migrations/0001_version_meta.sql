-- Each skill version keeps the public name and summary it was published with (Spec §9: versions
-- are immutable). Existing versions are backfilled from the skill's current name and summary.
ALTER TABLE "skill_versions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "summary" text;--> statement-breakpoint
UPDATE "skill_versions" SET "name" = "skills"."name", "summary" = "skills"."summary" FROM "skills" WHERE "skills"."id" = "skill_versions"."skill_id";--> statement-breakpoint
ALTER TABLE "skill_versions" ALTER COLUMN "name" SET NOT NULL;
