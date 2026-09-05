import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { PlannerService } from './planner.service';
import { PlanScope } from './models/ai-plan-run.model';

// Morning plan auto-apply increment (2026-09-05, explicit user request):
// "my AI generated week plan should be notified in voice text every
// morning and it can select the accept plan by itself... even the alarm
// should be recurring by itself." This closes the plan-narration/auto-apply
// half of that request (the alarm half is a real Android/Clock-app
// limitation — see notifications/page.tsx's own comment and the reply
// given when this was asked, not something this service touches).
//
// Deliberately a new, time-driven trigger source, distinct from
// PlannerAutoReplanListener's *event*-driven auto-replan (task completed, a
// calendar change, etc.) — those only ever fire in reaction to something
// the person just did, so on a quiet morning where nothing has happened yet
// they'd never produce a fresh plan at all. This one runs on a real clock,
// every morning, regardless of activity — the same "time-driven vs.
// event-driven" split SchedulerService's own top comment already draws for
// reminders vs. re-planning.
//
// Deliberately its own file/service (not folded into PlanGenerationService
// or SchedulerService directly) since it has a genuinely different
// responsibility from both: PlanGenerationService knows how to generate one
// plan given a scope; SchedulerService knows when a person's local clock
// says "it's morning"; this is the policy layer connecting the two — once a
// day for DAY scope, once a week (Mondays) for WEEK scope, each gated by
// its own "did this already happen today/this week" check so a person
// whose morning window spans two 15-minute cron ticks doesn't get charged
// for two real Anthropic calls. Injected into SchedulerService via
// SchedulerModule importing PlannerModule (which already exports
// PlannerService for ChatModule's own use) — see both modules' own comments.
@Injectable()
export class MorningPlanService {
  private readonly logger = new Logger(MorningPlanService.name);

  // DAY plans are reviewed against a fast-moving day — an hour is enough
  // time to notice the morning notification and make a change before it's
  // too late to matter for most of the day's schedule. WEEK plans affect
  // days that haven't started yet, so there's no real urgency forcing a
  // short window — three hours gives a fuller chance to actually look at
  // it (e.g. over a first coffee) before it locks in. Both are
  // deliberately fixed, not user-configurable, matching this project's
  // established "ship the simple default; add a setting only once someone
  // actually needs a different one" discipline (see e.g. the fixed
  // break/water reminder intervals in scheduler.service.ts).
  private static readonly AUTO_APPLY_DELAY_MINUTES: Partial<Record<PlanScope, number>> = {
    [PlanScope.DAY]: 60,
    [PlanScope.WEEK]: 180,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly plannerService: PlannerService,
  ) {}

  // Called once per user per checkReminders tick, from inside the same
  // "is it this person's local morning yet" window SchedulerService already
  // uses for the morning-routine reminder and the automatic daily
  // recommendations job — see that file's own withinClockWindow usage. Both
  // scope attempts are independently try/caught so one failing (or a
  // NOTHING_TO_PLAN no-op, a completely normal outcome for an account with
  // no open tasks) never blocks the other.
  async maybeGenerateMorningPlans(
    userId: string,
    timezone: string,
    autoApplyMorningPlanEnabled: boolean,
  ): Promise<void> {
    const now = DateTime.fromJSDate(new Date(), { zone: timezone });
    const dayDelay = autoApplyMorningPlanEnabled ? MorningPlanService.AUTO_APPLY_DELAY_MINUTES[PlanScope.DAY] : undefined;

    await this.generateIfNotAlready(userId, timezone, PlanScope.DAY, now, 'day', dayDelay);

    // ISO weekday: 1 = Monday. Only the first morning of the week attempts
    // a WEEK plan — every other day's tick skips this branch entirely via
    // the same guard, no extra query spent finding out "already did this
    // week" on a Tuesday.
    if (now.weekday === 1) {
      const weekDelay = autoApplyMorningPlanEnabled ? MorningPlanService.AUTO_APPLY_DELAY_MINUTES[PlanScope.WEEK] : undefined;
      await this.generateIfNotAlready(userId, timezone, PlanScope.WEEK, now, 'week', weekDelay);
    }
  }

  private async generateIfNotAlready(
    userId: string,
    timezone: string,
    scope: PlanScope,
    now: DateTime,
    unit: 'day' | 'week',
    autoApplyDelayMinutes: number | undefined,
  ): Promise<void> {
    const latest = await this.prisma.aiPlanRun.findFirst({
      where: { userId, scope: scope as any },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true },
    });
    // A plan of this scope already generated today (or, for WEEK, already
    // this same calendar week) — whether it was this morning's own earlier
    // tick, an event-driven auto-replan, or a manual "Generate plan" tap —
    // means there's nothing new to trigger. This intentionally doesn't
    // distinguish *how* that plan was generated: a person who manually
    // regenerated their day plan at 9am shouldn't also get a second,
    // separate morning-trigger plan minutes later.
    if (latest && DateTime.fromJSDate(latest.generatedAt, { zone: timezone }).hasSame(now, unit)) {
      return;
    }

    try {
      await this.plannerService.requestReplan(userId, timezone, scope, 'auto_morning_scheduled', autoApplyDelayMinutes);
    } catch (error) {
      // NOTHING_TO_PLAN is a normal, silent outcome (an account with no
      // open tasks that morning) — same treatment PlannerAutoReplanListener
      // already gives it, not a warning-worthy failure.
      if ((error as Error).message === 'NOTHING_TO_PLAN') return;
      this.logger.warn(`Morning ${scope} plan generation failed for user ${userId}: ${(error as Error).message}`);
    }
  }
}
