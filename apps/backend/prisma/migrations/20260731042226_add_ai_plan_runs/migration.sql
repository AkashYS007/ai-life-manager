-- CreateEnum
CREATE TYPE "PlanRunStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlanChangeType" AS ENUM ('MOVE', 'CREATE', 'DELETE', 'RESIZE');

-- CreateTable
CREATE TABLE "ai_plan_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "status" "PlanRunStatus" NOT NULL DEFAULT 'PROPOSED',
    "diff" JSONB NOT NULL,
    "model_used" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "ai_plan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_plan_runs_user_id_generated_at_idx" ON "ai_plan_runs"("user_id", "generated_at");
