import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { withSchedulerLock } from '../common/scheduler-lock';
import { RoutinesService } from '../routines/routines.service';
import { RoutineType } from '../routines/models/routine.model';
import { ReflectionService } from '../reflection/reflection.service';
import { HabitsService } from '../habits/habits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CalendarAccountsService } from '../integrations/google/calendar-accounts.service';
import { MicrosoftCalendarAccountsService } from '../integrations/microsoft/microsoft-calendar-accounts.service';
import { RecommendationsService } from '../recommendations/recommendations.service';

// Real-time calendar updates (webhooks) increment. Both providers cap how
// long a channel/subscription lasts before it needs renewing (Google: ~7
// days, this app's own requested lifetime — see calendar-accounts.service.ts;
// Microsoft: Graph's own hard 4230-minute/~2.94-day ceiling — see
// microsoft-calendar-accounts.service.ts). Renewing once a day, for
// anything expiring within the next 48 hours, comfortably covers both —
// wide enough that a single missed daily tick (a brief server restart, a
// transient failure on one account not blocking the sweep for others, same
// per-account try/catch discipline checkReminders already uses) still
// leaves a full day of margin before anything actually lapses.
const WEBHOOK_RENEWAL_LOOKAHEAD_HOURS = 48;

// Local-time windows a reminder can fire in, per person (their own
// timezone, not the server's) — narrow on purpose, same "a reminder should
// land near the moment it's actually useful, not any time before midnight"
// reasoning the Architecture Document gives for coupling notification
// timing to real state (§4.6). Each fixed-clock reminder gets a
// REMINDER_WINDOW_MINUTES-wide window starting at its hour; the habit
// reminder instead uses an offset *from* the habit's own preferredTime,
// since habits don't all share one clock time the way routines/reflection do.
//
// Configurable reminder windows/thresholds increment: these five are now
// just the fallback defaults, used whenever a person's User row has never
// set the matching `reminder*` column (i.e. still `null`) — the actual
// in-use values are resolved per user in resolveReminderSettings below.
// REMINDER_WINDOW_MINUTES itself stays fixed — an implementation detail of
// how wide the catch-window is, not a "when do I want this" preference the
// four hour/threshold constants below actually are.
const REMINDER_WINDOW_MINUTES = 30;
const DEFAULT_MORNING_ROUTINE_HOUR = 8;
const DEFAULT_EVENING_ROUTINE_HOUR = 20;
const DEFAULT_REFLECTION_HOUR = 21;
const DEFAULT_HABIT_REMINDER_MIN_OVERDUE_MINUTES = 15;
const DEFAULT_HABIT_REMINDER_MAX_OVERDUE_MINUTES = 120;

// Reminder escalation / second nudge increment: once a habit's own
// overdue window (above) has closed, the *original* behavior simply gave
// up for the day — see the loop below for how that "no second chance" gap
// used to look. This adds exactly one later checkpoint: if the person is
// still this far past the max-overdue ceiling *and* never opened the
// original reminder, send one more, more pointed notification. Kept as a
// fixed extra offset from the (already per-user-configurable) max rather
// than its own separate user setting — "how overdue before the *second*
// nudge" is a reasonable thing to eventually expose the same way the first
// window already is, but doubling the configurable-settings surface area
// wasn't asked for and isn't needed to close the actual gap named for this
// increment. HABIT_REMINDER_ESCALATION_MAX_OVERDUE_MINUTES is a sanity
// ceiling only, not a product decision — a habit that's still open a full
// day later gets a fresh occurrence (and a fresh overdue clock) once the
// day rolls over anyway, so nothing needs to escalate forever.
const HABIT_REMINDER_ESCALATION_EXTRA_MINUTES = 240;
const HABIT_REMINDER_ESCALATION_MAX_OVERDUE_MINUTES = 24 * 60;

// Periodic break/water reminders increment: a genuinely different shape
// from every other reminder in this file. Routine/reflection/habit
// reminders all ask "is there one specific thing due today that hasn't
// happened yet" and fire at most once (plus one escalation) per day.
// These two instead need to repeat all day long — a nudge to take a break
// every BREAK_REMINDER_INTERVAL_MINUTES, and to drink water every
// WATER_REMINDER_INTERVAL_MINUTES — with no "completion" concept at all to
// check against. Fixed daily window (not tied to quietHours or to the
// person's own Wake Up/Sleep habit times) — deliberately simple, matching
// what was actually asked for; NotificationsService.create's own
// quiet-hours deferral still applies underneath this as a second, separate
// safety net if the person has quiet hours configured.
const REMINDER_ACTIVE_START_HOUR = 8;
const REMINDER_ACTIVE_END_HOUR = 22;
const BREAK_REMINDER_INTERVAL_MINUTES = 60;
const WATER_REMINDER_INTERVAL_MINUTES = 30;

interface ReminderSettings {
  morningRoutineHour: number;
  eveningRoutineHour: number;
  reflectionHour: number;
  habitReminderMinOverdueMinutes: number;
  habitReminderMaxOverdueMinutes: number;
}

// Same `?? default` resolution as apps/web/src/app/focus/page.tsx's own
// per-user Pomodoro settings — just server-side here, since this feature
// has no client to resolve it in; every read of "when should this fire"
// goes through this one function so there's exactly one place the
// null-means-default rule lives.
function resolveReminderSettings(row: {
  reminderMorningRoutineHour?: number | null;
  reminderEveningRoutineHour?: number | null;
  reminderReflectionHour?: number | null;
  reminderHabitMinOverdueMinutes?: number | null;
  reminderHabitMaxOverdueMinutes?: number | null;
}): ReminderSettings {
  return {
    morningRoutineHour: row.reminderMorningRoutineHour ?? DEFAULT_MORNING_ROUTINE_HOUR,
    eveningRoutineHour: row.reminderEveningRoutineHour ?? DEFAULT_EVENING_ROUTINE_HOUR,
    reflectionHour: row.reminderReflectionHour ?? DEFAULT_REFLECTION_HOUR,
    habitReminderMinOverdueMinutes:
      row.reminderHabitMinOverdueMinutes ?? DEFAULT_HABIT_REMINDER_MIN_OVERDUE_MINUTES,
    habitReminderMaxOverdueMinutes:
      row.reminderHabitMaxOverdueMinutes ?? DEFAULT_HABIT_REMINDER_MAX_OVERDUE_MINUTES,
  };
}

function withinClockWindow(now: DateTime, hour: number): boolean {
  const start = now.set({ hour, minute: 0, second: 0, millisecond: 0 });
  const end = start.plus({ minutes: REMINDER_WINDOW_MINUTES });
  return now >= start && now < end;
}

// The scheduler/cron gap this closes: the Architecture Document's approved
// design (§4.3/§4.6) puts calendar sync, notification delivery, and the
// daily re-plan pipeline on Temporal (a managed durable-workflow service) —
// real infrastructure that doesn't exist anywhere in this project and would
// be a large, separate undertaking to stand up (its own cluster or a
// Temporal Cloud account, workflow definitions, worker processes). Same
// "simplest correct in-process equivalent" discipline the Smart
// notifications increment already applied to delivery itself: `@nestjs/
// schedule`'s `@Cron` decorator gives real, genuinely-repeating execution
// inside this same NestJS process — no new infrastructure, no new
// process — at the cost of exactly what Temporal would have bought: no
// durable retry/backoff across a server restart, no distributed
// scheduling if this ever runs on more than one instance, and (see the
// method below) an all-active-users-every-15-minutes sweep that's fine at
// this project's scale but wouldn't be the right shape past a few thousand
// users. All of that is a real, documented trade, not an oversight — see
// the README's "What's not built yet" for this increment.
//
// This is also scoped deliberately narrow: it closes the specific gap the
// README already named — "habit_reminder, a nudge to do your evening
// routine, a reminder to fill out today's reflection... need something to
// fire on a schedule" — not the separate, larger "automatic re-planning"
// gap (event-driven, triggered by a task completing or a calendar change,
// not by time passing), which stays open.
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  // Overlap guard — @nestjs/schedule's plain @Cron has no built-in
  // protection against a new tick starting while the previous invocation
  // of the same job is still running. `checkReminders` loops over every
  // user, doing real DB work plus (for anyone in their local morning hour)
  // a real Anthropic API call per person — at scale, or during a latency
  // spike, one sweep can plausibly run past the next 15-minute tick.
  // Originally (2026-08-24, backend audit Update 49 finding #7) this was a
  // plain in-process boolean; deployment-maturity performance pass
  // (2026-08-28, Update 64) replaced it with a real cross-instance lock
  // (common/scheduler-lock.ts) — see that file and NotificationsService's
  // matching comment for the full reasoning. See NotificationsService's own
  // `createLocks` for the other, deeper half of this same fix: even with
  // this guard, two *different* cron jobs (this one and
  // NotificationsService.deliverDueNotifications) or two unrelated callers
  // could still race into creating a duplicate notification for the same
  // person — that's closed at the point it's actually written, not just
  // here at the sweep level.

  constructor(
    private readonly prisma: PrismaService,
    private readonly routinesService: RoutinesService,
    private readonly reflectionService: ReflectionService,
    private readonly habitsService: HabitsService,
    private readonly notificationsService: NotificationsService,
    // Real-time calendar updates (webhooks) increment.
    private readonly calendarAccounts: CalendarAccountsService,
    private readonly microsoftCalendarAccounts: MicrosoftCalendarAccountsService,
    // Automatic daily AI recommendations increment.
    private readonly recommendationsService: RecommendationsService,
  ) {}

  // Real-time calendar updates (webhooks) increment. Once a day is plenty
  // for a job whose only purpose is "renew anything expiring soon" — unlike
  // checkReminders (which reacts to a real clock-time window a person is
  // waiting on), a missed webhook renewal degrades gracefully to "this one
  // account's real-time sync goes quiet until the next tick catches it,"
  // never a hard failure a person would notice immediately.
  @Cron('0 3 * * *')
  async renewCalendarWebhooks(): Promise<void> {
    // Overlap guard (deployment-maturity performance pass, 2026-08-28,
    // Update 64) — this job had none at all before this pass, unlike
    // checkReminders/deliverDueNotifications. Lower real risk day-to-day
    // (it only runs once a day, not every 15 minutes) but a large enough
    // sequential sweep of connected calendar accounts, each requiring 2-3
    // real Google/Microsoft API round trips, could in principle still be
    // running when the next day's 3am tick fires — this closes that gap
    // with the same real cross-instance lock the other two sweeps now use.
    await withSchedulerLock(this.prisma, 'renew-calendar-webhooks', async () => {
      const expiringBefore = new Date(Date.now() + WEBHOOK_RENEWAL_LOOKAHEAD_HOURS * 60 * 60 * 1000);
      const accounts = await this.prisma.calendarAccount.findMany({
        where: {
          provider: { in: ['GOOGLE', 'MICROSOFT'] },
          OR: [{ webhookExpiresAt: null }, { webhookExpiresAt: { lt: expiringBefore } }],
        },
        select: { id: true, provider: true },
      });

      for (const account of accounts) {
        try {
          if (account.provider === 'GOOGLE') {
            await this.calendarAccounts.renewWebhookIfNeeded(account.id);
          } else {
            await this.microsoftCalendarAccounts.renewWebhookIfNeeded(account.id);
          }
        } catch (error) {
          // One account's failed renewal (a real API error, a revoked token
          // that hasn't surfaced as CalendarAccountStatus.ERROR yet, and so
          // on) must never take down the sweep for everyone else, same
          // "isolate the failure, keep going" principle checkReminders
          // already applies above. Note: an account with BACKEND_PUBLIC_URL
          // simply never configured doesn't land here at all — registerWebhook's
          // own early return (see its own comment) makes that case a silent,
          // non-throwing no-op, not a caught error; this sweep re-selects
          // that account every single day for nothing until the operator
          // configures the var, which is harmless but worth knowing if this
          // job's own logs look suspiciously quiet for an otherwise-expected
          // renewal.
          this.logger.warn(`Calendar webhook renewal failed for account ${account.id} (${account.provider}): ${(error as Error).message}`);
        }
      }
    });
  }

  @Cron('*/15 * * * *')
  async checkReminders(): Promise<void> {
    // Overlap guard — see this class's own comment above on why this is a
    // real cross-instance lock, not an in-process boolean.
    await withSchedulerLock(this.prisma, 'check-reminders', async () => {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          timezone: true,
          reminderMorningRoutineHour: true,
          reminderEveningRoutineHour: true,
          reminderReflectionHour: true,
          reminderHabitMinOverdueMinutes: true,
          reminderHabitMaxOverdueMinutes: true,
        },
      });

      for (const user of users) {
        try {
          // Settings resolved here, from the same row already fetched for
          // this sweep, rather than letting checkRemindersForUser fetch them
          // itself again per user — avoids doubling this query for every
          // single user on every 15-minute tick.
          await this.checkRemindersForUser(user.id, user.timezone, resolveReminderSettings(user));
        } catch (error) {
          // One person's bad data (a malformed rrule, a missing routine row)
          // must never take down the sweep for everyone else — same
          // "isolate the failure, keep going" principle as every other
          // best-effort loop in this app (e.g. PlannerService.respondToPlanRun's
          // per-task ACCEPT loop).
          this.logger.warn(`Reminder check failed for user ${user.id}: ${(error as Error).message}`);
        }
      }
    });
  }

  // Public (not private) specifically so this can be exercised directly for
  // exactly one user — both by e2e tests (calling `checkReminders()` itself
  // would sweep every user left over from every other suite sharing this
  // Postgres instance, an unbounded, nondeterministic, slow thing to do in
  // a test) and as the natural seam for a future "remind me now" manual
  // trigger if one's ever wanted. `settings` is optional specifically so
  // every existing e2e call site (which only ever passes userId/timezone)
  // keeps working unchanged — when omitted, this fetches and resolves that
  // one user's own settings itself, same result, just one extra query.
  async checkRemindersForUser(userId: string, timezone: string, settings?: ReminderSettings): Promise<void> {
    const resolvedSettings = settings ?? (await this.getReminderSettingsForUser(userId));
    const now = DateTime.fromJSDate(new Date(), { zone: timezone });

    if (withinClockWindow(now, resolvedSettings.morningRoutineHour)) {
      const complete = await this.routinesService.isCompleteToday(userId, timezone, RoutineType.MORNING);
      if (complete === false) {
        await this.notificationsService.create(userId, timezone, 'morning_routine_reminder', {
          title: 'Morning routine waiting',
          body: "You haven't checked off today's morning routine yet.",
          deeplink: '/routines',
        });
      }
    }

    // Automatic daily AI recommendations increment: recommendations used to
    // only ever get generated by an explicit "Get recommendations" tap on
    // Today — nothing produced one on its own. Reuses the person's own
    // existing morningRoutineHour window rather than adding a brand new
    // "when do you want this" setting — for most people the start of their
    // day (already configured, already the same moment the morning-routine
    // check above fires) is exactly when a fresh recommendation is most
    // useful anyway. Guarded by getToday() first, not just left to
    // RecommendationsService.generate's own per-day upsert, specifically to
    // avoid calling the real Anthropic API twice in the same ~30-minute
    // window this cron's two ticks can both land inside (see
    // withinClockWindow) — generate() itself is safe to call more than once
    // a day (upserted by (userId, date)), but doing so here would still
    // burn a second real AI call for nothing. AI_NOT_CONFIGURED (no
    // ANTHROPIC_API_KEY yet) and any transient AI failure are caught and
    // logged, never allowed to break the rest of this person's sweep — same
    // "isolate the failure, keep going" principle as every other check in
    // this loop.
    if (withinClockWindow(now, resolvedSettings.morningRoutineHour)) {
      const existingRun = await this.recommendationsService.getToday(userId, timezone);
      if (!existingRun) {
        try {
          await this.recommendationsService.generate(userId, timezone);
        } catch (error) {
          this.logger.warn(`Auto recommendations generation failed for user ${userId}: ${(error as Error).message}`);
        }
      }
    }

    if (withinClockWindow(now, resolvedSettings.eveningRoutineHour)) {
      const complete = await this.routinesService.isCompleteToday(userId, timezone, RoutineType.EVENING);
      if (complete === false) {
        await this.notificationsService.create(userId, timezone, 'evening_routine_reminder', {
          title: 'Evening routine waiting',
          body: "You haven't checked off today's evening routine yet.",
          deeplink: '/routines',
        });
      }
    }

    if (withinClockWindow(now, resolvedSettings.reflectionHour)) {
      const reflection = await this.reflectionService.getToday(userId, timezone);
      if (!reflection) {
        await this.notificationsService.create(userId, timezone, 'reflection_reminder', {
          title: "Today's reflection is waiting",
          body: 'Three quick questions to close out your day.',
          deeplink: '/reflection',
        });
      }
    }

    // Periodic break/water reminders increment. Only inside the fixed daily
    // window, and only on the one 15-minute tick nearest each interval
    // boundary — the cron itself runs every 15 minutes in absolute time, and
    // real-world UTC offsets are always a multiple of 15 minutes, so a
    // person's local `now.minute` reliably lands on :00/:15/:30/:45 the same
    // way withinClockWindow above already assumes for its own 30-minute
    // window. Each notification's type is keyed by its own day+slot (the
    // hour for break, the half-hour slot for water) — a fresh, distinct type
    // every interval — so NotificationsService.create's same-type batching
    // (meant to collapse repeat calls about the *same* occurrence into one
    // row) never collapses two different intervals into one, while still
    // preventing a duplicate send if this same tick is ever re-processed.
    if (now.hour >= REMINDER_ACTIVE_START_HOUR && now.hour < REMINDER_ACTIVE_END_HOUR) {
      if (now.minute < 15) {
        await this.notificationsService.create(
          userId,
          timezone,
          `break_reminder:${now.toFormat('yyyy-LL-dd-HH')}`,
          {
            title: 'Time for a quick break',
            body: "You've been at it for a while — step away for a few minutes.",
            deeplink: '/today',
          },
        );
      }

      const minutesSinceMidnight = now.hour * 60 + now.minute;
      const waterSlot = Math.floor(minutesSinceMidnight / WATER_REMINDER_INTERVAL_MINUTES);
      if (minutesSinceMidnight % WATER_REMINDER_INTERVAL_MINUTES < 15) {
        await this.notificationsService.create(
          userId,
          timezone,
          `water_reminder:${now.toFormat('yyyy-LL-dd')}-${waterSlot}`,
          {
            title: 'Drink some water',
            body: 'Quick reminder to hydrate.',
            deeplink: '/today',
          },
        );
      }
    }

    const dueHabits = await this.habitsService.listDueToday(userId, timezone);
    for (const habit of dueHabits) {
      if (habit.todayCompleted || !habit.preferredTime) continue;

      const [hour, minute] = habit.preferredTime.split(':').map(Number);
      const scheduledAt = now.set({ hour, minute, second: 0, millisecond: 0 });
      const overdueMinutes = now.diff(scheduledAt, 'minutes').minutes;

      // Keyed by habit id, not just 'habit_reminder' — NotificationsService's
      // batching dedupes by (userId, type), so two different overdue habits
      // on the same day would otherwise collide into one notification and
      // silently overwrite each other's payload. This keeps each habit's
      // reminder independently tracked and batched, while a re-check of the
      // *same* habit 15 minutes later still correctly updates the one
      // existing unread notification instead of creating a second. The
      // escalation notification below reuses this same id-keyed base type
      // as the thing it's checking "is this still unread", so it has to be
      // computed once, up front, for both branches to share.
      const habitReminderType = `habit_reminder:${habit.id}`;

      if (
        overdueMinutes >= resolvedSettings.habitReminderMinOverdueMinutes &&
        overdueMinutes <= resolvedSettings.habitReminderMaxOverdueMinutes
      ) {
        await this.notificationsService.create(userId, timezone, habitReminderType, {
          title: 'Habit reminder',
          body: `"${habit.title}" was due at ${habit.preferredTime} and isn't checked off yet.`,
          deeplink: '/habits',
        });
        continue;
      }

      // The original overdue window has closed with nothing done about it —
      // used to be a dead end here. One later checkpoint: far enough past
      // that window, and only if the *first* reminder was never even opened
      // (someone who read it and just hasn't gotten to the habit yet
      // doesn't need to be told again — the unread check is what makes this
      // a genuinely different situation from the base reminder, not just a
      // repeat of it).
      const escalationThresholdMinutes =
        resolvedSettings.habitReminderMaxOverdueMinutes + HABIT_REMINDER_ESCALATION_EXTRA_MINUTES;
      if (
        overdueMinutes > escalationThresholdMinutes &&
        overdueMinutes <= HABIT_REMINDER_ESCALATION_MAX_OVERDUE_MINUTES
      ) {
        const originalStillUnread = await this.notificationsService.isUnreadType(userId, habitReminderType);
        if (originalStillUnread) {
          // A distinct type (not the same habitReminderType) — so this
          // escalation is independently batched from the original reminder
          // rather than overwriting it, and reading one doesn't silently
          // mark the other read too.
          await this.notificationsService.create(userId, timezone, `habit_reminder_escalation:${habit.id}`, {
            title: 'Still waiting on this one',
            body: `"${habit.title}" was due at ${habit.preferredTime}, and the earlier reminder about it is still unread.`,
            deeplink: '/habits',
          });
        }
      }
    }
  }

  // Only ever reached when checkRemindersForUser is called without its
  // optional third argument — the cron sweep above always passes settings
  // it already fetched, so this extra query only happens on the
  // single-user manual-call path (e2e tests, and the natural seam for a
  // future "remind me now" trigger).
  private async getReminderSettingsForUser(userId: string): Promise<ReminderSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        reminderMorningRoutineHour: true,
        reminderEveningRoutineHour: true,
        reminderReflectionHour: true,
        reminderHabitMinOverdueMinutes: true,
        reminderHabitMaxOverdueMinutes: true,
      },
    });
    return resolveReminderSettings(user ?? {});
  }
}
