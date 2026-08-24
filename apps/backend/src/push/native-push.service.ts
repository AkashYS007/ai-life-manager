import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { withRetry } from '../common/retry';

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
          // Voice + reliable-banner notifications increment (2026-08-20,
          // second revision — see git history for the two earlier shapes
          // tried here and why each one was replaced). This is back to a
          // pure data-only message (no top-level `notification`, no
          // `android.notification` override) — but for a different, more
          // deliberate reason than the original implementation had: any
          // message that includes a `notification` payload gets
          // auto-displayed by the OS *instead of* calling this app's
          // FirebaseMessagingService.onMessageReceived() whenever the app
          // isn't in the foreground — confirmed via a live manual FCM send
          // from the Railway console that a `notification` payload does
          // reliably show a banner, but that finding cuts the other way
          // once voice read-out entered scope: it also means real native
          // code (AiLifeManagerMessagingService, see
          // scripts/apply_native_notifications.py) never gets a chance to
          // run when the app is backgrounded or killed, which is exactly
          // when a voice reminder is most needed. A pure data-only message
          // is the one shape where onMessageReceived() is *always* called,
          // in every app state — that native class is what now owns
          // showing the banner (so the "OS displays nothing when the app is
          // closed" gap this whole increment started from stays fixed) and
          // speaking the reminder out loud, both together, from one place
          // that's guaranteed to actually run.
          // Delivery retry increment (backend review follow-up,
          // 2026-08-24 — see common/retry.ts and WebPushService.sendToUser's
          // matching comment). Same 3-attempts/~500ms-backoff shape;
          // `shouldRetry` fails fast on FCM's two "this token is gone for
          // good" codes so the prune branch below still runs immediately
          // on those, same as before.
          await withRetry(
            () =>
              admin.messaging().send({
                token: row.token,
                data: { title: payload.title, body: payload.body, deeplink: payload.deeplink },
                android: { priority: 'high' },
              }),
            {
              attempts: 3,
              baseDelayMs: 500,
              shouldRetry: (error) => {
                const code = (error as { code?: string }).code;
                return code !== 'messaging/registration-token-not-registered' && code !== 'messaging/invalid-registration-token';
              },
            },
          );
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
