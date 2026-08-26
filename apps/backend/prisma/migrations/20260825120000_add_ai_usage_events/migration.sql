-- AI cost telemetry increment (2026-08-25). One row per real Anthropic API
-- call, recording the exact input/output token counts Anthropic's own
-- response reports plus a best-effort estimated USD cost (nullable — a
-- model not yet in the app's pricing table gets real tokens, no fabricated
-- cost). See schema.prisma's own comment on AiUsageEvent for the full
-- reasoning, including why this is one row per call, not an aggregate.
--
-- user_id is nullable (unlike most user-owned tables) and ON DELETE SET
-- NULL, not CASCADE: a usage event is a fact about a real API call that
-- happened and (if pricing is known) real money that was spent — that
-- remains true even after the user who triggered it deletes their account,
-- and losing it on every account deletion would quietly understate this
-- app's own historical AI spend. The row survives with user_id cleared,
-- the same "keep the fact, drop the identity" choice most audit/ledger
-- tables make, deliberately different from every other user_id FK in this
-- schema (all CASCADE, all rows meaningless once their owner is gone).

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "estimated_cost_usd" DECIMAL(10,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_feature_created_at_idx" ON "ai_usage_events"("feature", "created_at");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
