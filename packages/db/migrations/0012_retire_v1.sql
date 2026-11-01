-- Hand-ordered: v1 runs, Race matches and survival badges retire. Tables go in FK order (badges and
-- run_skill_stats reference runs), so no CASCADE can drop anything else by accident.
DROP TABLE "badges";--> statement-breakpoint
DROP TABLE "run_skill_stats";--> statement-breakpoint
DROP TABLE "runs";--> statement-breakpoint
DROP TABLE "matches";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "tutorial_runs_left";--> statement-breakpoint
DROP TYPE "public"."match_mode";--> statement-breakpoint
DROP TYPE "public"."match_result";--> statement-breakpoint
DROP TYPE "public"."run_lifecycle";--> statement-breakpoint
DROP TYPE "public"."run_mode";--> statement-breakpoint
DROP TYPE "public"."run_result";
