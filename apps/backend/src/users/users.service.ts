import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from '../auth/auth-context';

// This is the JIT-provisioning use case named in the Architecture Document's
// identity flow: the first time a verified identity (Clerk or dev-auth) is
// seen, we create the local `users` row (and a default Free subscription,
// PRD §13) rather than requiring a separate signup-sync webhook — simpler,
// and correct even if a webhook is ever missed or delayed.
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.user.create({
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
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: input.displayName,
        timezone: input.timezone,
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

  // Account deletion increment. A real gap surfaced while surveying for
  // this: `User` only ever declared a Prisma relation (a real foreign key,
  // with `onDelete: Cascade`) to three tables — Subscription, Notification,
  // PushSubscription. Every other user-owned table (tasks, goals, habits,
  // calendar events/accounts, mood/energy/sleep entries, AI plan runs, AI
  // recommendation runs, AI conversations, AI memory facts, journal
  // entries, daily reflections, routines, focus sessions, tags) only ever
  // has a plain `userId` column with no declared relation at all — so
  // deleting the `users` row itself would silently leave every one of
  // those rows behind as orphaned data, not fail and not clean up.
  // `User.deletedAt` already exists and is already respected by
  // SchedulerService's own user-selection query, which made a soft delete
  // tempting — rejected on purpose: soft-deleting only the `users` row
  // while leaving all of the above fully intact would be a worse half
  // measure than either a real hard delete or a real soft-delete-
  // everywhere design, and nothing else in this codebase needs the softer
  // behavior yet. So: a real hard delete, one explicit `deleteMany({
  // where: { userId } })` per table with no declared relation (in one
  // transaction, so a mid-way failure leaves nothing partially deleted),
  // then the `users` row itself — whose own real Cascade relations clean up
  // Subscription/Notification/PushSubscription for free. Child rows one
  // level down (HabitLog, RoutineLog, AiChatMessage, TaskTag) aren't listed
  // explicitly — they cascade automatically once their real parent (Habit/
  // Routine/AiConversation/Task) is deleted here.
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
