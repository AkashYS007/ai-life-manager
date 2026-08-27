import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicClient } from './anthropic-client';
import { PlanScope } from './models/ai-plan-run.model';
import { PlanGenerationService } from './plan-generation.service';

// planner.service.ts modularization increment (2026-08-26): the
// event-listener cluster (~110 of the original file's 1,146 lines, per the
// mapping in project update 59) — every `@nestjs/event-emitter` `@OnEvent`
// handler that used to live directly on PlannerService, plus the shared
// `maybeAutoReplan` gate they all funnel through. This is a real,
// independently-registered NestJS provider, not a helper class someone
// else calls into — `@OnEvent` only fires on methods belonging to an
// instance NestJS's DI container actually holds, so it has to be its own
// `@Injectable()` listed in PlannerModule's `providers`, same as
// PlannerService itself. PlannerService.maybeAutoReplan (kept on that
// class specifically because the e2e suite calls
// `moduleRef.get(PlannerService).maybeAutoReplan(...)` directly) is a
// one-line delegate to this class's own `maybeAutoReplan` — behaviorally
// identical either way, so nothing outside PlannerModule needed to change.
@Injectable()
export class PlannerAutoReplanListener {
  private readonly logger = new Logger(PlannerAutoReplanListener.name);

  // Automatic AI re-planning increment, extended by the WEEK/MONTH
  // auto-replanning increment to cover all three scopes, not just DAY: how
  // long to wait after any plan of a given scope (auto-triggered or manual)
  // before another auto-trigger of that *same* scope is allowed to fire —
  // completing five tasks in the space of a minute should produce one fresh
  // DAY plan, not five AI calls. Each scope gets its own, independent
  // cooldown and its own independent `generatedAt` check (see
  // maybeAutoReplan) — DAY keeps its original, short 10-minute window since
  // reacting fast to "does today still make sense" is the whole point of
  // that scope; WEEK and MONTH get much longer ones, both because a single
  // task completing or one calendar event changing is a far weaker signal
  // that a whole week or month's plan needs rethinking, and because a
  // WEEK/MONTH regeneration is a heavier AI call over a much larger task
  // window — no one benefits from that firing on every single task
  // completion the way DAY's own tight cooldown reasonably allows. Only
  // maybeAutoReplan's own @OnEvent listeners are ever subject to any of
  // this; a manual button-press replan is never throttled, and — since it
  // updates the very same `generatedAt` this check reads — triggering one
  // manually also quiets any auto-trigger of that scope that would
  // otherwise have fired moments later.
  private static readonly AUTO_REPLAN_COOLDOWN_MINUTES: Record<PlanScope, number> = {
    [PlanScope.DAY]: 10,
    [PlanScope.WEEK]: 180, // 3 hours
    [PlanScope.MONTH]: 720, // 12 hours
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicClient,
    private readonly planGeneration: PlanGenerationService,
  ) {}

  // Event-driven, not time-driven — the counterpart to the Scheduler
  // increment's time-based reminders (see scheduler.service.ts), closing
  // the README's separate "automatic re-planning" gap: the day's plan (and,
  // since the WEEK/MONTH auto-replanning increment, the week's and month's
  // plans too — see maybeAutoReplan below) now also regenerates itself when
  // a task completes or a native calendar event changes, not only when
  // someone taps Generate. TasksService and CalendarService each emit a
  // plain event (`task.completed`/`calendar.changed`) rather than calling
  // this listener directly, since neither of their modules imports
  // PlannerModule (importing it back would be circular, the same reason
  // Task duration estimation's AI call lives on PlannerService rather than
  // TasksService).
  @OnEvent('task.completed')
  async onTaskCompleted(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_task_completed');
  }

  @OnEvent('calendar.changed')
  async onCalendarChanged(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_calendar_changed');
  }

  // New auto-replanning triggers increment — three more real-world signals
  // that "something about the plan might need rethinking," wired through
  // exactly the same `maybeAutoReplan` gate as the two triggers above (same
  // per-scope cooldowns, same silent-no-op-on-NOTHING_TO_PLAN handling, no
  // new re-planning logic of any kind). HabitsService, SignalsService, and
  // RoutinesService each emit their own plain event rather than calling
  // this listener directly, same decoupling reason as task.completed/
  // calendar.changed above — PlannerModule already imports HabitsModule
  // and SignalsModule (RoutinesModule isn't imported here at all yet, but
  // the same event shape was used anyway for consistency across every
  // trigger source rather than making one of them special).
  @OnEvent('habit.completed')
  async onHabitCompleted(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_habit_completed');
  }

  @OnEvent('checkin.logged')
  async onCheckinLogged(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_checkin_logged');
  }

  @OnEvent('routine.completed')
  async onRoutineCompleted(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_routine_completed');
  }

  // Further auto-replanning triggers increment — three more sources, same
  // gate, same zero-new-re-planning-logic pattern as every trigger above.
  // JournalModule/FocusModule/ReflectionModule aren't imported by
  // PlannerModule (unlike HabitsModule/SignalsModule above), so there's no
  // actual circular-import risk for these three specifically — the event
  // shape is used anyway, for the same "every trigger source looks the
  // same" consistency reasoning `routine.completed` above already applied.
  @OnEvent('journal.entryCreated')
  async onJournalEntryCreated(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_journal_entry');
  }

  @OnEvent('focusSession.completed')
  async onFocusSessionCompleted(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_focus_session_completed');
  }

  @OnEvent('reflection.submitted')
  async onReflectionSubmitted(payload: { userId: string }): Promise<void> {
    await this.maybeAutoReplan(payload.userId, 'auto_reflection_submitted');
  }

  // The shared gate every listener above goes through. Originally always
  // DAY scope only — the WEEK/MONTH auto-replanning increment widened this
  // to attempt all three scopes on every trigger, each independently gated
  // by its own cooldown and its own `generatedAt` check (see
  // AUTO_REPLAN_COOLDOWN_MINUTES's own comment on why each scope needs a
  // very different cooldown length), and each wrapped in its own try/catch
  // so a failure on one scope (say, WEEK genuinely has nothing to plan)
  // can never stop DAY or MONTH from still being attempted. The underlying
  // question — "does what I already have at this scope still make sense,
  // given what just changed?" — is the same question at every scope, just
  // asked less urgently the larger the window gets. Public (not private)
  // for the same reason SchedulerService.checkRemindersForUser is public:
  // e2e tests call it directly (via PlannerService's own one-line delegate
  // to this method) rather than emitting a real event and hoping Nest's
  // event loop has flushed the (fire-and-forget, undetectable from the
  // outside) listener before the test's next assertion runs.
  async maybeAutoReplan(userId: string, triggerEvent: string): Promise<void> {
    if (!this.anthropic.isConfigured()) return;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    if (!user) return; // gone between the event firing and this running — nothing to do

    for (const scope of [PlanScope.DAY, PlanScope.WEEK, PlanScope.MONTH]) {
      try {
        const lastPlanAtScope = await this.prisma.aiPlanRun.findFirst({
          where: { userId, scope: scope as any },
          orderBy: { generatedAt: 'desc' },
          select: { generatedAt: true },
        });
        if (lastPlanAtScope) {
          const minutesSinceLastPlan = (Date.now() - lastPlanAtScope.generatedAt.getTime()) / 60000;
          if (minutesSinceLastPlan < PlannerAutoReplanListener.AUTO_REPLAN_COOLDOWN_MINUTES[scope]) continue;
        }

        await this.planGeneration.requestReplan(userId, user.timezone, scope, triggerEvent);
      } catch (error) {
        // NOTHING_TO_PLAN is a normal, silent outcome here, not a
        // warning-worthy failure — a task completing (or, now, the same
        // signal at WEEK/MONTH scope) is exactly the kind of event that
        // can legitimately leave zero open tasks behind at any scope.
        if ((error as Error).message === 'NOTHING_TO_PLAN') continue;
        this.logger.warn(
          `Automatic re-plan (${triggerEvent}, ${scope}) for user ${userId} failed: ${(error as Error).message}`,
        );
      }
    }
  }
}
