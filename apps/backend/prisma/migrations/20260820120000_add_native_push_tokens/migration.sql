-- CreateTable
CREATE TABLE "native_push_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ANDROID',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "native_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "native_push_tokens_token_key" ON "native_push_tokens"("token");

-- CreateIndex
CREATE INDEX "native_push_tokens_user_id_idx" ON "native_push_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
