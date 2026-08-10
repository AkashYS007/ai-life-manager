-- CreateEnum
CREATE TYPE "EnergySource" AS ENUM ('MANUAL', 'INFERRED');

-- CreateEnum
CREATE TYPE "SleepSource" AS ENUM ('MANUAL', 'HEALTHKIT', 'HEALTH_CONNECT', 'OURA', 'WHOOP');

-- CreateTable
CREATE TABLE "mood_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mood_score" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mood_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "energy_score" INTEGER NOT NULL,
    "source" "EnergySource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleep_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sleep_date" DATE NOT NULL,
    "bedtime" TIMESTAMP(3),
    "wake_time" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "quality_score" INTEGER,
    "source" "SleepSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleep_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mood_entries_user_id_logged_at_idx" ON "mood_entries"("user_id", "logged_at");

-- CreateIndex
CREATE INDEX "energy_entries_user_id_logged_at_idx" ON "energy_entries"("user_id", "logged_at");

-- CreateIndex
CREATE UNIQUE INDEX "sleep_entries_user_id_sleep_date_key" ON "sleep_entries"("user_id", "sleep_date");
