import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

interface PushPayload {
  title: string;
  body: string;
  deeplink: string;
}

// Native app shell increment (2026-08-20). See the schema comment on
// NativePushToken for why this is a separate model/service rather than an
// extension of WebPushService — the short version: Android's WebView (what
// the Capacitor app actually renders through) has no Push API at all, so
// the browser-push mechanism WebPushService uses is structurally unable to
// reach the native app, with or without a VAPID key. Firebase Cloud
// Messaging is the real, OS-level equivalent — same "one delivery channel,
// one focused service" shape as WebPushService/EmailService/SmsService.
@Injectable()
export class NativePushService {
  private readonly logger = new Logger(NativePushService.name);
  private readonly configured: boolean;

  constructor(private readonly prisma: PrismaService) {
    // Mirrors WebPushService's own isConfigured() gate — this app must run
    // (and its other delivery channels must keep working) in any
    // environment that hasn't set up Firebase yet, local dev included.
    // Accepts the service account JSON as a single base64-encoded env var
    // (FIREBASE_SERVICE_ACCOUNT_BASE64) rather than a mounted file path —
    // this app's one other credential-shaped secret, VAPID, is also plain
    // env vars, and Railway (this app's host) has no per-service file mount
    // primitive, only env vars.
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    this.configured = !!encoded && admin.apps.length === 0;
    if (encoded && admin.apps.length === 0) {
      try {
        const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        this.configured = true;
      } catch (error) {
        this.logger.error(`Failed to initialize Firebase Admin SDK: ${(error as Error).message}`);
        this.configured = false;
      }
    } else if (admin.apps.length > 0) {
      this.configured = true;
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async register(userId: string, token: string, platform: string): Promise<void> {
    // Upserted by `token`, same reasoning as WebPushService.register's
    // upsert-by-endpoint — FCM tokens rotate (app reinstall, Play Services
    // update, `PushNotifications.register()` called again), and the same
    // physical device re-registering should update its existing row, not
    // accumulate duplicates that would each get a separate, redundant send.
    await this.prisma.nativePushToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  async subscriptionCount(userId: string): Promise<number> {
    return this.prisma.nativePushToken.count({ where: { userId } });
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.nativePushToken.deleteMany({ where: { userId, token } });
  }

  // Best-effort, one token at a time — same "a dead token on one device
  // must never block delivery to this person's other devices, or bubble up
  // and break whatever real action triggered the notification" discipline
  // as WebPushService.sendToUser.
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const tokens = await this.prisma.nativePushToken.findMany({ where: { userId } });
    if (tokens.length === 0) return;

    await Promise.all(
      tokens.map(async (row) => {
        try {
          // A data-only message (no top-level `notification` key) rather
          // than a notification message — a notification message is
          // displayed and consumed by the OS automatically while the app is
          // backgrounded/killed, but never reaches the app's own JS at all
          // in that state, which is exactly the gap this increment exists
          // to close (see NativePushRegistration.tsx's foreground listener
          // and the README note on the still-unbuilt background-voice
          // follow-up, which will need this same data-only shape to get a
          // chance to run any code on receipt). The native Capacitor Push
          // Notifications plugin still surfaces a system notification for a
          // data-only message via its own local-notification fallback when
          // the payload carries title/body, so this doesn't trade away
          // visible delivery to gain background wake-up.
          await admin.messaging().send({
            token: row.token,
            data: { title: payload.title, body: payload.body, deeplink: payload.deeplink },
            android: {
              priority: 'high',
              notification: { title: payload.title, body: payload.body, channelId: 'reminders' },
            },
          });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            // Same pruning discipline as WebPushService's 404/410 handling
            // — FCM's own way of saying "this token is gone for good."
            await this.prisma.nativePushToken.delete({ where: { id: row.id } }).catch(() => {});
          } else {
            this.logger.warn(`Native push failed for token ${row.id}: ${(error as Error).message}`);
          }
        }
      }),
    );
  }
}
