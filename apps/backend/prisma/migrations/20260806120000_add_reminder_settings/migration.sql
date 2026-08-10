-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reminder_morning_routine_hour" INTEGER,
ADD COLUMN     "reminder_evening_routine_hour" INTEGER,
ADD COLUMN     "reminder_reflection_hour" INTEGER,
ADD COLUMN     "reminder_habit_min_overdue_minutes" INTEGER,
ADD COLUMN     "reminder_habit_max_overdue_minutes" INTEGER;
