-- Morning plan auto-apply increment (2026-09-05, explicit user request):
-- every morning, the day's (and on Mondays, the week's) AI plan is now
-- generated automatically and narrated aloud, and — unless the user turns
-- this off — auto-applies to real tasks after a short review window if
-- they haven't reviewed it themselves first. See schema.prisma's own
-- comments on User.autoApplyMorningPlanEnabled and AiPlanRun.autoApplyAt
-- for the full reasoning.
--
-- Both new columns are additive and safe for existing rows: the boolean
-- defaults to true (matching the explicit choice made when this was
-- built — there's no pre-existing behavior to avoid changing, since this
-- whole feature is new), and the nullable timestamp defaults to NULL for
-- every plan run that already exists, meaning "never auto-apply" — exactly
-- today's behavior, preserved for every plan generated before this shipped.
ALTER TABLE "users" ADD COLUMN "auto_apply_morning_plan_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_plan_runs" ADD COLUMN "auto_apply_at" TIMESTAMP(3);

CREATE INDEX "ai_plan_runs_status_auto_apply_at_idx" ON "ai_plan_runs"("status", "auto_apply_at");
