import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { Notification } from './models/notification.model';
import { UpdateNotificationPreferencesInput } from './dto/update-notification-preferences.input';
import { WebPushService } from '../push/web-push.service';
import { NativePushService } from '../push/native-push.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';

interface StoredPayload {
  title: string;
  body: string;
  deeplink: string;
}

const RECENT_SAMPLE_SIZE = 20;
// A repeat notification of the same type within this many hours updates the
// existing unread row instead of creating a second one — the "batched, not
// spammy" half of the PRD requirement (§7.1), done without any real
// batching infrastructure: generating a plan twice in an afternoon should
// refresh one "your plan is ready" notification, not stack two.
const BATCH_WINDOW_HOURS = 12;

function toGraphNotification(record: any): Notification {
  const payload = record.payload as StoredPayload;
  return {
    id: record.id,
    type: record.type,
    title: payload.title,
    body: payload.body,
    deeplink: payload.deeplink,
    read: !!record.readAt,
    createdAt: record.createdAt,
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // Overlap/race fixes (2026-08-24, backend audit Update 49 finding #7,
  // medium severity). Two related but distinct problems, two distinct
  // guards:
  //
  // 1. `deliverDueRunning` — @nestjs/schedule's plain @Cron has no
  //    built-in protection against a new tick starting while the previous
  //    invocation of the *same* cron method is still running. Cheap,
  //    in-process, single-instance-only (fine here — this app runs as one
  //    Railway service, confirmed during the Update 48 deploy work; a
  //    multi-instance deployment would need a real distributed lock
  //    instead).
  //
  // 2. `createLocks` — the deeper fix, and the one that actually closes
  //    the race regardless of *what* triggers it. `create()`'s own
  //    find-then-branch (below) is a classic check-then-act: two calls for
  //    the same (userId, type) — from an overlapping cron tick, or from
  //    two entirely unrelated callers (e.g. SchedulerService and
  //    RecommendationsService both reacting to the same moment) — can both
  //    see "no recent unread row" and both `create()`, each independently
  //    triggering a real push/email/SMS for what should be one deduped
  //    notification. A per-(userId, type) in-process queue serializes just
  //    that decision+write, so the second caller always sees the first
  //    one's already-created row before deciding what to do — a would-be
  //    duplicate becomes a batched update instead, this file's own
  //    documented intent.
  private deliverDueRunning = false;
  private readonly createLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly webPushService: WebPushService,
    private readonly nativePushService: NativePushService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
  ) {}

  // Runs `fn` after every prior call queued under the same `key` has
  // settled, regardless of whether that prior call succeeded or threw —
  // otherwise one failed `create()` for a given (userId, type) would wedge
  // every future call for that same key behind a permanently-rejected
  // promise.
  private withCreateLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.createLocks.get(key) ?? Promise.resolve();
    const run = prior.then(fn, fn);
    this.createLocks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  // Best-effort real delivery for one already-created/updated notification
  // row — web push and native push are both always attempted (each service
  // no-ops on its own if unconfigured or the person has no registered
  // subscription/token for that specific channel — a native-app user has no
  // web subscription and vice versa, so both must be tried unconditionally
  // rather than picking one), email only when the person has actually
  // opted in via emailNotificationsEnabled, and SMS (SMS delivery
  // increment) only when smsNotificationsEnabled is on *and* a real
  // phoneNumber is on file — the one existing preference field that
  // toggled nothing at all until this increment finally gave it real
  // behavior, same "opted in but nothing configured to send to yet" gap
  // emailNotificationsEnabled itself used to have before EmailService
  // existed. Wrapped so a delivery failure can never surface back to
  // whatever action triggered the notification in the first place — same
  // principle as every other best-effort side effect already in this
  // codebase.
  private async attemptDelivery(userId: string, notificationId: string, payload: StoredPayload): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const deliveries: Promise<void>[] = [
        this.webPushService.sendToUser(userId, payload),
        this.nativePushService.sendToUser(userId, payload),
      ];
      if (user?.emailNotificationsEnabled && user.email) {
        deliveries.push(this.emailService.send({ to: user.email, subject: payload.title, body: payload.body }));
      }
      if (user?.smsNotificationsEnabled && user.phoneNumber) {
        // SMS has no separate subject line the way email does — the title
        // and body are combined into one plain message instead of sending
        // only one or the other.
        deliveries.push(this.smsService.send({ to: user.phoneNumber, body: `${payload.title}: ${payload.body}` }));
      }
      await Promise.all(deliveries);
    } catch (error) {
      this.logger.warn(`Delivery attempt failed for notification ${notificationId}: ${(error as Error).message}`);
    } finally {
      // Marked attempted regardless of outcome — a permanently-broken
      // subscription or a down email provider must never cause the
      // scheduled sweep below to retry this same row forever; the
      // in-app list (NotificationsService.listRecent) is always the
      // fallback of last resort no matter what happened here.
      await this.prisma.notification.update({ where: { id: notificationId }, data: { deliveredAt: new Date() } });
    }
  }

  // Catches exactly the notifications create() couldn't deliver immediately
  // because they were deferred past the person's quiet hours — once
  // scheduledFor actually arrives, this is what finally attempts delivery,
  // on the same 15-minute cadence SchedulerService already established for
  // every other time-driven check in this app (see that file's own comment
  // for why `@Cron` in-process is the deliberate, documented stand-in for
  // the Architecture Document's Temporal-based design).
  @Cron('*/15 * * * *')
  async deliverDueNotifications(): Promise<void> {
    // Overlap guard — see this class's own comment on `deliverDueRunning`.
    if (this.deliverDueRunning) {
      this.logger.warn('deliverDueNotifications sweep skipped — the previous invocation is still running.');
      return;
    }
    this.deliverDueRunning = true;
    try {
      const due = await this.prisma.notification.findMany({
        where: { scheduledFor: { lte: new Date() }, deliveredAt: null },
        take: 200,
      });

      for (const notification of due) {
        try {
          await this.attemptDelivery(notification.userId, notification.id, notification.payload as unknown as StoredPayload);
        } catch (error) {
          // Isolate one bad row from the rest of the sweep — same "keep going"
          // discipline as SchedulerService.checkReminders' per-user try/catch.
          this.logger.warn(`Sweep delivery failed for notification ${notification.id}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.deliverDueRunning = false;
    }
  }

  // Computes when a notification should actually become visible, pushing it
  // past the user's configured quiet hours if "now" falls inside them.
  // Handles the overnight-wraparound case (e.g. 22:00-07:00) explicitly —
  // a plain string/number comparison would get this wrong the moment the
  // window crosses midnight, the same reason RoutinesService's habit-time
  // helpers never do a naive compare either.
  private resolveScheduledFor(now: DateTime, quietHoursStart: string | null, quietHoursEnd: string | null): Date {
    if (!quietHoursStart || !quietHoursEnd) return now.toJSDate();

    const [startHour, startMinute] = quietHoursStart.split(':').map(Number);
    const [endHour, endMinute] = quietHoursEnd.split(':').map(Number);
    const start = now.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
    const end = now.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });

    const wrapsOvernight = end <= start;
    if (wrapsOvernight) {
      const inQuietHours = now >= start || now < end;
      if (!inQuietHours) return now.toJSDate();
      // Past midnight, still before `end`: the window ends later today.
      // Otherwise (evening, before midnight): it ends tomorrow morning.
      return now < end ? end.toJSDate() : end.plus({ days: 1 }).toJSDate();
    }

    const inQuietHours = now >= start && now < end;
    return inQuietHours ? end.toJSDate() : now.toJSDate();
  }

  // Called best-effort from other services (PlannerService,
  // RecommendationsService) right when something worth telling the person
  // about actually happens — never on a schedule, since there's no
  // scheduler/dispatcher in this app to run one (see the schema comment on
  // the Notification model for the full explanation of that simplification).
  async create(userId: string, timezone: string, type: string, payload: StoredPayload): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // pushNotificationsEnabled is the one preference that actually controls
    // real behavior this pass, since PUSH (delivered in-app) is the only
    // channel with anything behind it — see the Notification model comment.
    if (!user || !user.pushNotificationsEnabled) return;

    const now = DateTime.fromJSDate(new Date(), { zone: timezone });
    const scheduledFor = this.resolveScheduledFor(now, user.quietHoursStart, user.quietHoursEnd);

    // Race-condition fix (2026-08-24, backend audit Update 49 finding #7,
    // medium severity) — see this class's own comment on `createLocks` for
    // the full reasoning. Serializing on `${userId}:${type}` means a second
    // concurrent call for the exact same person+type always waits for the
    // first to finish deciding create-vs-update before making its own
    // decision, so the two can never both see "no recent row" and both
    // create one.
    await this.withCreateLock(`${userId}:${type}`, async () => {
      const recentSameType = await this.prisma.notification.findFirst({
        where: {
          userId,
          type,
          readAt: null,
          createdAt: { gte: now.minus({ hours: BATCH_WINDOW_HOURS }).toJSDate() },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Repeat-delivery fix: batching a same-type row (below) must refresh
      // what's *shown* — payload, scheduledFor, status — without re-sending a
      // real push every time it's refreshed. Before this fix, an update also
      // reset `deliveredAt: null`, and the immediate-delivery call further
      // down fired unconditionally whenever `scheduledFor <= now` — true on
      // essentially every re-check of an already-overdue reminder (e.g.
      // SchedulerService.checkRemindersForUser re-calling create() for the
      // same still-overdue habit on every 15-minute tick). The result: one
      // real web push per tick for as long as the habit stayed in its overdue
      // window (up to 8 in a row), which is exactly the "batched, not spammy"
      // guarantee this file's own BATCH_WINDOW_HOURS comment promises but
      // didn't actually deliver on. Now: `deliveredAt` is left untouched on
      // an update (so an already-delivered row can't be picked up again by
      // this method or by deliverDueNotifications' sweep), and the immediate
      // delivery attempt only ever runs for a genuinely new row — a batched
      // update to an existing unread notification never re-triggers real
      // delivery, no matter how many times create() is called for it before
      // it's read or the batch window closes.
      let notificationId: string;
      let isNewNotification: boolean;
      if (recentSameType) {
        const updated = await this.prisma.notification.update({
          where: { id: recentSameType.id },
          data: { payload: payload as any, scheduledFor, status: 'PENDING' },
        });
        notificationId = updated.id;
        isNewNotification = false;
      } else {
        const created = await this.prisma.notification.create({
          data: { userId, type, channel: 'PUSH', payload: payload as any, scheduledFor, status: 'PENDING' },
        });
        notificationId = created.id;
        isNewNotification = true;
      }

      // Not deferred by quiet hours (scheduledFor is now, not later): attempt
      // real delivery immediately rather than waiting up to 15 minutes for the
      // next sweep. A quiet-hours-deferred row is deliberately left
      // undelivered here — deliverDueNotifications() picks it up the moment
      // its scheduledFor actually arrives. Gated to new rows only — see the
      // comment above.
      if (isNewNotification && scheduledFor.getTime() <= Date.now()) {
        await this.attemptDelivery(userId, notificationId, payload);
      }
    });
  }

  // The only read path — and, per the schema comment, the closest thing
  // this pass has to a dispatcher: any PENDING row whose scheduledFor has
  // already passed is flipped to SENT right here, the moment it's actually
  // fetched, since "the app is foregrounded and shows it" is this pass's
  // entire delivery mechanism.
  async listRecent(userId: string, first = RECENT_SAMPLE_SIZE): Promise<Notification[]> {
    const now = new Date();
    const due = await this.prisma.notification.findMany({
      where: { userId, scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'desc' },
      take: first,
    });

    const pendingIds = due.filter((n) => n.status === 'PENDING').map((n) => n.id);
    if (pendingIds.length > 0) {
      await this.prisma.notification.updateMany({
        where: { id: { in: pendingIds } },
        data: { status: 'SENT', sentAt: now },
      });
    }

    return due.map((n) => toGraphNotification(n));
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, scheduledFor: { lte: new Date() }, readAt: null },
    });
  }

  // Reminder escalation increment: the one new read SchedulerService needs
  // to decide whether a "second nudge" is warranted — "is the most recent
  // notification of this exact type still sitting there unread". Deliberately
  // looks at the single latest row for the type rather than "any unread row
  // ever", since create()'s own batching already guarantees at most one
  // unread row per (userId, type) exists at a time — the same invariant this
  // just reads back out instead of re-deriving.
  async isUnreadType(userId: string, type: string): Promise<boolean> {
    const record = await this.prisma.notification.findFirst({
      where: { userId, type },
      orderBy: { createdAt: 'desc' },
    });
    return !!record && record.readAt === null;
  }

  private async requireOwnedNotification(userId: string, id: string) {
    const record = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!record) {
      throw new NotFoundException('Notification not found');
    }
    return record;
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    await this.requireOwnedNotification(userId, id);
    const updated = await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return toGraphNotification(updated);
  }

  async updatePreferences(userId: string, input: UpdateNotificationPreferencesInput) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        quietHoursStart: input.quietHoursStart,
        quietHoursEnd: input.quietHoursEnd,
        pushNotificationsEnabled: input.pushNotificationsEnabled,
        emailNotificationsEnabled: input.emailNotificationsEnabled,
        smsNotificationsEnabled: input.smsNotificationsEnabled,
        phoneNumber: input.phoneNumber,
        voiceNotificationsEnabled: input.voiceNotificationsEnabled,
      },
      include: { subscription: true },
    });
  }
}
