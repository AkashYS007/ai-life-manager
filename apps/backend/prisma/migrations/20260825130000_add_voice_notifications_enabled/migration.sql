-- Notification controls increment (2026-08-25). Adds a real per-user toggle
-- for voice-read notifications — see schema.prisma's own comment on
-- User.voiceNotificationsEnabled for the full reasoning. Defaults to true
-- (`DEFAULT true` backfills every existing row) so this migration itself
-- changes nobody's actual behavior — voice notifications were already
-- unconditionally on for everyone; this just makes that a real, visible,
-- turn-off-able preference instead of a hardcoded always-on.
ALTER TABLE "users" ADD COLUMN "voice_notifications_enabled" BOOLEAN NOT NULL DEFAULT true;
