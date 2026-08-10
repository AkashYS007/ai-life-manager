-- AlterTable
ALTER TABLE "calendar_accounts" ADD COLUMN     "webhook_channel_id" TEXT,
ADD COLUMN     "webhook_resource_id" TEXT,
ADD COLUMN     "webhook_verification_token" TEXT,
ADD COLUMN     "webhook_expires_at" TIMESTAMP(3);
