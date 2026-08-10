-- CreateTable
CREATE TABLE "ai_memory_facts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fact_type" TEXT NOT NULL DEFAULT 'preference',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_memory_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_memory_facts_user_id_fact_type_key_key" ON "ai_memory_facts"("user_id", "fact_type", "key");
