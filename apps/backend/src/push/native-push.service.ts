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
          // Bug fix (2026-08-20, confirmed via a live manual FCM send from
          // the Railway console): this used to omit the top-level
          // `notification` key on the theory that the native Capacitor Push
          // Notifications plugin's own local-notification fallback would
          // still surface a system notification for a data-only message
          // (see git history for the original comment's full reasoning).
          // That fallback only runs inside the app's own JS — which never
          // gets a chance to execute once Android has actually killed the
          // WebView process (confirmed happens well within a 5-minute
          // locked-screen test), so on a real phone, in the real "reminder
          // fires while the app isn't open" case this feature exists for,
          // nothing ever displayed. A manual admin.messaging().send() with
          // a real top-level `notification` block, sent to this exact same
          // registered token, displayed correctly with sound — same
          // WhatsApp/Instagram-style behavior the person asked to match —
          // proving that's what was missing. Setting both `notification`
          // (so the OS auto-displays it, with sound/vibration/banner, the
          // moment the app is backgrounded or fully killed — no app JS
          // required to run at all) and `data` (still delivered alongside
          // it to any listener that IS running, e.g. a foregrounded app,
          // for deeplink navigation on tap) keeps both cases working; only
          // the "OS displays nothing at all when the app is closed" gap is
          // what's fixed here.
          await admin.messaging().send({
            token: row.token,
            notification: { title: payload.title, body: payload.body },
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
