-- Wake-up alarm increment (2026-09-02). Adds a real "wake up time"
-- preference, separate from quietHoursEnd/quietHoursStart — see
-- schema.prisma's own comment on User.wakeUpTime for why it isn't just
-- reused from quiet hours. Nullable, no default: existing accounts get
-- "no wake-up alarm configured" (same as they have today), same
-- opt-in-only treatment quietHoursStart/End already got when it shipped.
ALTER TABLE "users" ADD COLUMN "wake_up_time" TEXT;
