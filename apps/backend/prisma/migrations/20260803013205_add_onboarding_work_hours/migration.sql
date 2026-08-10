-- CreateEnum
CREATE TYPE "PlanScope" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "RecommendationCategory" AS ENUM ('BREAK', 'WORKOUT', 'MEAL');

-- CreateEnum
CREATE TYPE "RoutineType" AS ENUM ('MORNING', 'EVENING');

-- CreateEnum
CREATE TYPE "FocusSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- DropIndex
DROP INDEX "ai_plan_runs_user_id_generated_at_idx";

-- AlterTable
ALTER TABLE "ai_plan_runs" ADD COLUMN     "scope" "PlanScope" NOT NULL DEFAULT 'DAY';

-- AlterTable
ALTER TABLE "calendar_accounts" ADD COLUMN     "calendar_url" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "push_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quiet_hours_end" TEXT,
ADD COLUMN     "quiet_hours_start" TEXT,
ADD COLUMN     "sms_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "work_hours_end" TEXT,
ADD COLUMN     "work_hours_start" TEXT;

-- CreateTable
CREATE TABLE "ai_recommendation_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "recommendations" JSONB NOT NULL,
    "model_used" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_recommendation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sentiment_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reflections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "answers" JSONB NOT NULL,
    "ai_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reflections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routines" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "RoutineType" NOT NULL,
    "checklist" JSONB NOT NULL,
    "ai_sequenced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_logs" (
    "id" TEXT NOT NULL,
    "routine_id" TEXT NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "completed_step_ids" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focus_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "planned_duration_minutes" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "status" "FocusSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'PUSH',
    "payload" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_recommendation_runs_user_id_date_key" ON "ai_recommendation_runs"("user_id", "date");

-- CreateIndex
CREATE INDEX "journal_entries_user_id_created_at_idx" ON "journal_entries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reflections_user_id_date_key" ON "daily_reflections"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "routines_user_id_type_key" ON "routines"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "routine_logs_routine_id_scheduled_date_key" ON "routine_logs"("routine_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_started_at_idx" ON "focus_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_scheduled_for_idx" ON "notifications"("user_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "ai_plan_runs_user_id_scope_generated_at_idx" ON "ai_plan_runs"("user_id", "scope", "generated_at");

-- AddForeignKey
ALTER TABLE "routine_logs" ADD CONSTRAINT "routine_logs_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
