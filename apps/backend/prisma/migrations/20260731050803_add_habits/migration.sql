-- CreateTable
CREATE TABLE "habits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rrule" TEXT NOT NULL,
    "preferred_time" TIME,
    "protected_duration_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_logs" (
    "id" TEXT NOT NULL,
    "habit_id" TEXT NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "habits_user_id_active_idx" ON "habits"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "habit_logs_habit_id_scheduled_date_key" ON "habit_logs"("habit_id", "scheduled_date");

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
