-- CreateEnum
CREATE TYPE "CalendarEventSource" AS ENUM ('NATIVE', 'GOOGLE', 'MICROSOFT', 'APPLE');

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "is_immovable" BOOLEAN NOT NULL DEFAULT false,
    "is_ai_focus_block" BOOLEAN NOT NULL DEFAULT false,
    "source" "CalendarEventSource" NOT NULL DEFAULT 'NATIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_user_id_start_time_end_time_idx" ON "calendar_events"("user_id", "start_time", "end_time");
