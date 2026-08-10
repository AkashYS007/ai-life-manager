-- AlterTable
ALTER TABLE "habits" ADD COLUMN     "goal_id" TEXT;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
