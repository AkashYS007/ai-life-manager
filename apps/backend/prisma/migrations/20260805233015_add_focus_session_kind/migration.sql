-- CreateEnum
CREATE TYPE "FocusSessionKind" AS ENUM ('WORK', 'BREAK');

-- AlterTable
ALTER TABLE "focus_sessions" ADD COLUMN     "kind" "FocusSessionKind" NOT NULL DEFAULT 'WORK';
