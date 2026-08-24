-- User FK enforcement increment (2026-08-24). Adds a real Postgres foreign
-- key from user_id to users(id), with ON DELETE CASCADE, on the 17 tables
-- that never had one — see schema.prisma's own comment on the User model's
-- new relation fields for the full reasoning. Naming/CASCADE convention
-- matches every existing FK already in this schema (e.g. notifications_user_id_fkey).
--
-- Safety note: this will fail if any of these tables currently contain a
-- user_id value that doesn't exist in users(id) (orphaned rows — e.g. from
-- old test data or a prior hard-delete that predates User.deletedAt's soft
-- delete). Before running this against production, verify with:
--
--   SELECT 'goals' t, count(*) FROM goals g WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id)
--   UNION ALL SELECT 'tasks', count(*) FROM tasks t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id)
--   UNION ALL SELECT 'calendar_events', count(*) FROM calendar_events c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
--   UNION ALL SELECT 'calendar_accounts', count(*) FROM calendar_accounts c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id)
--   UNION ALL SELECT 'habits', count(*) FROM habits h WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = h.user_id)
--   UNION ALL SELECT 'mood_entries', count(*) FROM mood_entries m WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id)
--   UNION ALL SELECT 'energy_entries', count(*) FROM energy_entries e WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.user_id)
--   UNION ALL SELECT 'sleep_entries', count(*) FROM sleep_entries s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)
--   UNION ALL SELECT 'ai_plan_runs', count(*) FROM ai_plan_runs a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
--   UNION ALL SELECT 'ai_recommendation_runs', count(*) FROM ai_recommendation_runs a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
--   UNION ALL SELECT 'ai_conversations', count(*) FROM ai_conversations a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
--   UNION ALL SELECT 'ai_memory_facts', count(*) FROM ai_memory_facts a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)
--   UNION ALL SELECT 'journal_entries', count(*) FROM journal_entries j WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = j.user_id)
--   UNION ALL SELECT 'daily_reflections', count(*) FROM daily_reflections d WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = d.user_id)
--   UNION ALL SELECT 'routines', count(*) FROM routines r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)
--   UNION ALL SELECT 'focus_sessions', count(*) FROM focus_sessions f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.user_id)
--   UNION ALL SELECT 'tags', count(*) FROM tags g WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = g.user_id);
--
-- Every row should read 0. If any row is nonzero, either backfill/repoint
-- those rows to a real user or delete them before applying this migration —
-- adding the constraint against orphaned data will fail outright.

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_accounts" ADD CONSTRAINT "calendar_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mood_entries" ADD CONSTRAINT "mood_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_entries" ADD CONSTRAINT "energy_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_entries" ADD CONSTRAINT "sleep_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_plan_runs" ADD CONSTRAINT "ai_plan_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendation_runs" ADD CONSTRAINT "ai_recommendation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_memory_facts" ADD CONSTRAINT "ai_memory_facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reflections" ADD CONSTRAINT "daily_reflections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
