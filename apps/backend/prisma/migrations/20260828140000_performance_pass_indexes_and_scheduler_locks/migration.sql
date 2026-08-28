-- Deployment-maturity performance pass (2026-08-28, Update 64). Three
-- independent, additive schema changes bundled into one migration since
-- they all came out of the same fact-check pass:
--
-- 1. focus_sessions(user_id, task_id): closes a real missing index found
--    while fact-checking the app's own performance scorecard.
--    FocusService.getCompletedMinutesForTask filters by
--    (userId, taskId, status, kind) — a real, live query hit every time a
--    task's actual-time-spent is looked up — but the only existing index
--    on this table was (user_id, started_at), which doesn't help that
--    query at all, and Prisma doesn't auto-index foreign-key columns.
--
-- 2. notifications(created_at): supports the new notification-retention
--    cleanup job (NotificationsService.pruneOldNotifications, added this
--    same pass) — without this, its delete-by-age query would scan the
--    entire table on every run.
--
-- 3. scheduler_locks: a small new table backing a real cross-instance
--    lock for the app's three periodic sweeps (the two 15-minute cron
--    jobs plus the daily calendar-webhook-renewal job), replacing the
--    in-process boolean overlap guards those jobs used before — see
--    schema.prisma's own comment on the SchedulerLock model for why this
--    is a plain atomic UPSERT-with-TTL lease rather than Postgres's own
--    pg_advisory_lock.
CREATE INDEX "focus_sessions_user_id_task_id_idx" ON "focus_sessions"("user_id", "task_id");

CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

CREATE TABLE "scheduler_locks" (
    "id" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduler_locks_pkey" PRIMARY KEY ("id")
);
