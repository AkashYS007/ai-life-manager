/*
  Warnings:

  - A unique constraint covering the columns `[calendar_account_id,external_event_id]` on the table `calendar_events` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CalendarAccountProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'APPLE');

-- CreateEnum
CREATE TYPE "CalendarAccountStatus" AS ENUM ('ACTIVE', 'ERROR', 'REVOKED');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "calendar_account_id" TEXT,
ADD COLUMN     "external_event_id" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "calendar_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "CalendarAccountProvider" NOT NULL,
    "external_account_email" TEXT,
    "access_token_encrypted" BYTEA NOT NULL,
    "refresh_token_encrypted" BYTEA NOT NULL,
    "sync_token" TEXT,
    "status" "CalendarAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_accounts_user_id_provider_key" ON "calendar_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_calendar_account_id_external_event_id_key" ON "calendar_events"("calendar_account_id", "external_event_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_account_id_fkey" FOREIGN KEY ("calendar_account_id") REFERENCES "calendar_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
