import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterPushSubscriptionInput } from './dto/register-push-subscription.input';
import { withRetry } from '../common/retry';

interface PushPayload {
  title: string;
  body: string;
  deeplink: string;
}

// Real notification delivery increment (PRD §7.1's "Smart notifications"
// P0 row — "delivery" used to mean nothing more than opening the app).
// Web Push (RFC 8030 + the VAPID application-server-identification scheme)
// rather than a native FCM/APNs SDK: it's the one push mechanism a plain
// browser-based PWA can use with no per-platform app-store account or
// native SDK at all, matching this project's actual shipped platform (see
// the PWA + offline support increment) — a real FCM/APNs integration would
// still be needed for an eventual native app, but doesn't exist yet
// because no native app does either.
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly configured: boolean;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:support@example.com';
    this.configured = !!publicKey && !!privateKey;
    if (this.configured) {
      webpush.setVapidDetails(subject, publicKey!, privateKey!);
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  // Exposed so the frontend can request the *public* key it needs to call
  // `PushManager.subscribe({ applicationServerKey: ... })` — never the
  // private key, which never leaves this service at all.
  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  async register(userId: string, input: RegisterPushSubscriptionInput): Promise<void> {
    // Upserted by `endpoint` (globally unique per the schema, not scoped by
    // userId) — the same browser subscription re-registering (e.g. after a
    // silent key rotation the Push API can trigger) should update its row
    // in place, not create a duplicate.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: { userId, p256dh: input.p256dh, auth: input.auth },
      create: { userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth },
    });
  }

  // Exposed so a caller (the sendTestNotification mutation) can tell "sent,
  // but nobody was listening" apart from "genuinely delivered" — sendToUser
  // itself intentionally stays silent either way (a best-effort side effect
  // should never surface *whether* anyone received it back to the action
  // that triggered it), but a person explicitly asking to test their own
  // push setup needs exactly that distinction to make sense of the result.
  async subscriptionCount(userId: string): Promise<number> {
    return this.prisma.pushSubscription.count({ where: { userId } });
  }

  async unregister(userId: string, endpoint: string): Promise<void> {
    // Scoped by userId as well as endpoint — same "never let one person's
    // request affect another's row" ownership discipline every other
    // mutation in this app already follows, even though endpoint alone
    // would already usually be enough to find the right row.
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  // Best-effort, one subscription at a time — a dead/expired subscription
  // (revoked permission, uninstalled PWA, cleared browser storage) must
  // never block delivery to this same person's other devices, and must
  // never propagate up to break whatever real action triggered this
  // notification (same "an enhancement must never break the action in
  // progress" principle as every other best-effort side effect in this
  // codebase — e.g. PlannerService's plan_ready notification creation).
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          // Delivery retry increment (backend review follow-up,
          // 2026-08-24 — see common/retry.ts's own comment for the full
          // reasoning). 3 attempts total, ~500ms/~1000ms backoff — a
          // transient failure from the push service now gets two real
          // extra tries within this same call before falling through to
          // the same log-and-move-on behavior this catch always had.
          // `shouldRetry` fails fast on 404/410 (the push service saying
          // this subscription is gone for good) so the prune branch below
          // still runs on the very first such response, exactly as before.
          await withRetry(
            () =>
              webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify(payload),
              ),
            {
              attempts: 3,
              baseDelayMs: 500,
              shouldRetry: (error) => {
                const statusCode = (error as { statusCode?: number }).statusCode;
                return statusCode !== 404 && statusCode !== 410;
              },
            },
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // The push service itself says this subscription is gone —
            // pruning it here is what keeps this table from silently
            // accumulating dead rows forever.
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            this.logger.warn(`Web push failed for subscription ${sub.id}: ${(error as Error).message}`);
          }
        }
      }),
    );
  }
}
