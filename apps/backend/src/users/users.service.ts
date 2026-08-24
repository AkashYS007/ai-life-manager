import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from '../auth/auth-context';

// Duck-typed unique-constraint check, not `error instanceof
// Prisma.PrismaClientKnownRequestError` — caught live by actually running
// this file's own test suite (2026-08-24): this repo's generated
// `@prisma/client` doesn't re-export `PrismaClientKnownRequestError` off
// the `Prisma` namespace object at all (confirmed directly: `Object.keys(
// require('@prisma/client').Prisma)` has no Error-suffixed entries in this
// install), so `Prisma.PrismaClientKnownRequestError` is `undefined` and
// the `instanceof` check would silently always be `false` — the exact
// "never actually verified, would have shipped broken" mistake this
// backend audit round is specifically trying to avoid. Every Prisma known
// request error carries a real `.code` string regardless of which class it
// is or how it's exported, so checking that directly needs no import at
// all and can't be broken by a client-generation quirk like this one.
function isPrismaUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002';
}

// This is the JIT-provisioning use case named in the Architecture Document's
// identity flow: the first time a verified identity (Clerk or dev-auth) is
// seen, we create the local `users` row (and a default Free subscription,
// PRD §13) rather than requiring a separate signup-sync webhook — simpler,
// and correct even if a webhook is ever missed or delayed.
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getOrCreateFromAuth(auth: AuthContext) {
    const existing = await this.prisma.user.findUnique({
      where: { authProviderId: auth.authProviderId },
      include: { subscription: true },
    });
    if (existing) {
      // Editable email increment: `email` was only ever written once, at
      // the moment this row was first created — nothing in this codebase
      // ever touched it again before now, so if someone changed their real
      // login email afterward (the only place that can safely happen is
      // Clerk's own account UI — see Settings' "Change email" entry, which
      // opens it), this column would go stale forever. `auth.email` is
      // re-derived fresh from the verified session on every single request
      // (see AuthGuard), so comparing it here costs nothing and catches
      // drift the moment it happens — the same "detect drift, quietly
      // correct it" pattern TimezoneSync already uses on the frontend for
      // timezone, just on the backend for email. Best-effort: `email` is
      // `@unique`, so a resync could theoretically fail (extremely
      // unlikely — two different verified identities landing on the exact
      // same email is something Clerk itself already prevents), and this
      // one query is depended on by almost every resolver in the app, so a
      // failed resync must never break it.
      if (existing.email !== auth.email) {
        try {
          return await this.prisma.user.update({
            where: { id: existing.id },
            data: { email: auth.email },
            include: { subscription: true },
          });
        } catch {
          return existing;
        }
      }
      return existing;
    }

    // Race-condition fix (2026-08-24, backend audit Update 49 finding #3,
    // high severity): this used to be a bare `create()` with no error
    // handling — this method is called (via getOrCreateFromAuth) from 90+
    // places across nearly every resolver in the app, and a brand-new
    // user's very first authenticated page load routinely fires several
    // GraphQL operations in parallel (`me` + `today` + `tasks` +
    // `notifications`, etc.). Each one independently sees `existing ===
    // null` and races to create the same row; the first `create()` wins,
    // every other one used to throw an unhandled Prisma P2002
    // unique-constraint error (on the `authProviderId` unique index)
    // straight out to the caller instead of falling back to the row that
    // just landed. Now: a P2002 here is treated the same way a genuine
    // race should be treated — someone else already finished the very
    // thing this call was trying to do — so it re-fetches and returns that
    // row instead of failing the request. Any other error still propagates
    // unchanged.
    try {
      return await this.prisma.user.create({
        data: {
          email: auth.email,
          authProviderId: auth.authProviderId,
          timezone: 'UTC',
          subscription: {
            create: {
              tier: 'FREE',
              status: 'ACTIVE',
            },
          },
        },
        include: { subscription: true },
      });
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        const winner = await this.prisma.user.findUnique({
          where: { authProviderId: auth.authProviderId },
          include: { subscription: true },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  // Real billing/subscription management increment. Honest about what this
  // is: there is no Stripe integration anywhere in this project (`Subscription.
  // stripeCustomerId`/`stripeSubscriptionId` are real columns, reserved for
  // when one exists, but nothing here ever populates them), so this
  // deliberately does not simulate a payment form or collect fake card
  // details — doing that would look like a real charge is happening when
  // nothing is. What this does do for real: change the actual `tier` and
  // `status` a real Subscription row holds, the same row every other part
  // of this app already reads (the Plan card, and anywhere a future
  // feature might gate on tier). Downgrading to FREE clears
  // `currentPeriodEnd` (a free plan has no renewal date); moving to PLUS or
  // PRO sets one 30 days out, simulating what a real monthly billing cycle
  // would leave behind — a real, consistent state change, just not a real
  // charge. `status` is always left at ACTIVE here — PAST_DUE/CANCELED are
  // states a real payment failure or real cancellation flow would produce,
  // neither of which exists in this mock.
  async changeSubscriptionTier(auth: AuthContext, tier: string) {
    // Temporary demo-safety switch (2026-08-18) — see PAID_TIERS_ENABLED's
    // own comment in env.validation.ts. Free is always allowed (that's a
    // downgrade, not a paid-tier switch); PLUS/PRO are rejected while the
    // flag is off, same as the real Stripe Checkout path.
    if (tier !== 'FREE' && this.config.get<boolean>('PAID_TIERS_ENABLED') === false) {
      throw new Error('PAID_TIERS_DISABLED');
    }
    const user = await this.getOrCreateFromAuth(auth);
    const currentPeriodEnd = tier === 'FREE' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.subscription.update({
      where: { userId: user.id },
      data: {
        tier: tier as any,
        status: 'ACTIVE',
        currentPeriodEnd,
      },
    });
    return this.prisma.user.findUnique({
      where: { id: user.id },
      include: { subscription: true },
    });
  }

  async updateProfile(
    auth: AuthContext,
    input: {
      displayName?: string;
      timezone?: string;
      timezoneManual?: boolean;
      chronotype?: string;
      workHoursStart?: string;
      workHoursEnd?: string;
      pomodoroWorkMinutes?: number;
      pomodoroShortBreakMinutes?: number;
      pomodoroLongBreakMinutes?: number;
      pomodoroCyclesBeforeLongBreak?: number;
      reminderMorningRoutineHour?: number;
      reminderEveningRoutineHour?: number;
      reminderReflectionHour?: number;
      reminderHabitMinOverdueMinutes?: number;
      reminderHabitMaxOverdueMinutes?: number;
      reflectionWentWellLabel?: string;
      reflectionChallengingLabel?: string;
      reflectionCarryForwardLabel?: string;
    },
  ) {
    const user = await this.getOrCreateFromAuth(auth);

    // TimezoneSync.tsx's own silent browser-detection write calls this same
    // mutation with only `timezone` set (never `timezoneManual`), on every
    // page load, including /settings itself — racing against a person who's
    // in the middle of deliberately setting their timezone by hand there. If
    // that background call's response lands after the person's own manual
    // save, blindly writing `input.timezone` here would silently overwrite
    // their choice a few seconds after they made it, even though
    // timezoneManual itself would still correctly read true. TimezoneSync
    // already intends to never do this (see its own "backs off entirely
    // once timezoneManual is set" comment) but only checks that at the
    // moment its effect fires, using whatever `timezoneManual` value was
    // true at that point in time — which can't see a manual save that's
    // still in flight. Enforcing the same rule here, against the real
    // current value at write time, closes that race regardless of timing:
    // only an explicit `timezoneManual` in the input (the real Settings
    // page always sends one) can touch `timezone` once manual mode is
    // already on.
    const suppressAutoTimezone =
      input.timezone !== undefined && input.timezoneManual === undefined && user.timezoneManual === true;

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: input.displayName,
        timezone: suppressAutoTimezone ? undefined : input.timezone,
        timezoneManual: input.timezoneManual,
        chronotype: input.chronotype as any,
        workHoursStart: input.workHoursStart,
        workHoursEnd: input.workHoursEnd,
        // Configurable Pomodoro durations increment — same "undefined
        // leaves the column alone, explicit null clears it back to the
        // fixed default" Prisma behavior every other nullable field on this
        // input already relies on.
        pomodoroWorkMinutes: input.pomodoroWorkMinutes,
        pomodoroShortBreakMinutes: input.pomodoroShortBreakMinutes,
        pomodoroLongBreakMinutes: input.pomodoroLongBreakMinutes,
        pomodoroCyclesBeforeLongBreak: input.pomodoroCyclesBeforeLongBreak,
        // Configurable reminder windows/thresholds increment — same
        // undefined-leaves-alone/explicit-null-clears convention as every
        // other nullable field on this input.
        reminderMorningRoutineHour: input.reminderMorningRoutineHour,
        reminderEveningRoutineHour: input.reminderEveningRoutineHour,
        reminderReflectionHour: input.reminderReflectionHour,
        reminderHabitMinOverdueMinutes: input.reminderHabitMinOverdueMinutes,
        reminderHabitMaxOverdueMinutes: input.reminderHabitMaxOverdueMinutes,
        // Configurable daily reflection questions increment — same
        // undefined-leaves-alone/explicit-null-clears convention as every
        // other nullable field on this input.
        reflectionWentWellLabel: input.reflectionWentWellLabel,
        reflectionChallengingLabel: input.reflectionChallengingLabel,
        reflectionCarryForwardLabel: input.reflectionCarryForwardLabel,
      } as any,
      include: { subscription: true },
    });
  }

  // Account deletion increment. Originally written when `User` only
  // declared a real Prisma relation (a real foreign key, with
  // `onDelete: Cascade`) to three tables — Subscription, Notification,
  // PushSubscription — leaving every other user-owned table with a plain
  // `userId` column and no declared relation, which is why the explicit
  // per-table `deleteMany` calls below exist at all.
  //
  // Corrected 2026-08-24 (backend audit Update 49 finding #11, low
  // severity — a doc/reality mismatch, not a behavior bug): the Update 48
  // FK migration added a real `onDelete: Cascade` relation for all 21
  // user-owned tables, so every `deleteMany` call below is now redundant
  // with what a plain `user.delete()` would already cascade on its own —
  // harmless to keep (defense-in-depth, and this method predates that
  // migration), but the *reason* originally written here ("these tables
  // have no FK, so a hard delete would orphan them") is no longer true and
  // was actively misleading about what happens if a future edit ever
  // removed one of these lines. `User.deletedAt` already exists and is
  // already respected by SchedulerService's own user-selection query,
  // which made a soft delete tempting — rejected on purpose: soft-deleting
  // only the `users` row while leaving all of the above fully intact would
  // be a worse half measure than either a real hard delete or a real
  // soft-delete-everywhere design, and nothing else in this codebase needs
  // the softer behavior yet. Child rows one level down (HabitLog,
  // RoutineLog, AiChatMessage, TaskTag) aren't listed explicitly — they
  // cascade automatically once their real parent (Habit/Routine/
  // AiConversation/Task) is deleted here, same as before.
  //
  // Never actually run against a live database in this sandbox (no
  // Postgres available) — verified by reading the schema relation-by-
  // relation, not by executing it.
  async deleteAccount(auth: AuthContext): Promise<{ deleted: boolean }> {
    const user = await this.getOrCreateFromAuth(auth);
    const userId = user.id;

    await this.prisma.$transaction([
      this.prisma.calendarEvent.deleteMany({ where: { userId } }),
      this.prisma.calendarAccount.deleteMany({ where: { userId } }),
      this.prisma.focusSession.deleteMany({ where: { userId } }),
      this.prisma.task.deleteMany({ where: { userId } }),
      this.prisma.goal.deleteMany({ where: { userId } }),
      this.prisma.tag.deleteMany({ where: { userId } }),
      this.prisma.habit.deleteMany({ where: { userId } }),
      this.prisma.moodEntry.deleteMany({ where: { userId } }),
      this.prisma.energyEntry.deleteMany({ where: { userId } }),
      this.prisma.sleepEntry.deleteMany({ where: { userId } }),
      this.prisma.aiPlanRun.deleteMany({ where: { userId } }),
      this.prisma.aiRecommendationRun.deleteMany({ where: { userId } }),
      this.prisma.aiConversation.deleteMany({ where: { userId } }),
      this.prisma.aiMemoryFact.deleteMany({ where: { userId } }),
      this.prisma.journalEntry.deleteMany({ where: { userId } }),
      this.prisma.dailyReflection.deleteMany({ where: { userId } }),
      this.prisma.routine.deleteMany({ where: { userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);

    return { deleted: true };
  }
}
