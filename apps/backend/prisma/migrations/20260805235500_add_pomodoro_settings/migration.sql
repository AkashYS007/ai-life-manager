-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pomodoro_work_minutes" INTEGER,
ADD COLUMN     "pomodoro_short_break_minutes" INTEGER,
ADD COLUMN     "pomodoro_long_break_minutes" INTEGER,
ADD COLUMN     "pomodoro_cycles_before_long_break" INTEGER;
