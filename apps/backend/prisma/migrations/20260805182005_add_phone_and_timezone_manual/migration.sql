-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "timezone_manual" BOOLEAN NOT NULL DEFAULT false;
