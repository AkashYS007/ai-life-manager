import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { zonedDayBounds } from '../common/date/zoned-day';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { SignalsService } from '../signals/signals.service';
import { MemoryService } from '../memory/memory.service';
import { HabitsService } from '../habits/habits.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnthropicClient } from './anthropic-client';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AiPlanRun, PlanRunDecision, PlanScope } from './models/ai-plan-run.model';
import { PlanChangeType } from './models/plan-change.model';
import { PlanChangeEditInput } from './dto/plan-change-edit.input';
import { PlanChangeAddInput } from './dto/plan-change-add.input';

// The stored shape of AiPlanRun.diff (Json column) — deliberately smaller
// than the GraphQL PlanDiff/PlanChange types (no hydrated Task object, just
// the taskId), since this is what actually gets persisted and re-read.
// `id` was added by the Editing a proposed AI plan increment — optional in
// this stored-shape type (not the GraphQL type, which always exposes one —
// see hydrate's backfill) since a plan row persisted before this increment
// genuinely has no `id` on its stored changes at all.
interface StoredChange {
  id?: string;
  changeType: 'MOVE';
  taskId: string;
  previousStart: string | null;
  proposedStart: string;
  proposedEnd: string;
  reason: string;
}
interface StoredDiff {
  summary: string;
  changes: StoredChange[];
}

// Exported for the Tool-calling actions in Chat increment — ChatService's
// reschedule_task tool handler needs the exact same "no real estimate yet,
// assume this long" fallback this file already uses, rather than picking
// its own separate default number.
export const DEFAULT_TASK_DURATION_MINUTES = 30;
// Fallbacks used until a person sets real work hours (Diagnostic onboarding
// increment's workHoursStart/End on User, see schema.prisma) — only
// enforced by the policy layer for WEEK/MONTH scope, see requestReplan.
// Every account created before that increment, or that skipped the
// onboarding quiz step, simply keeps using these exact defaults, so nothing
// about DAY scope's behavior (which never applied this bound anyway) or an
// existing WEEK/MONTH user's plans changes just from this field existing.
const DEFAULT_WORKDAY_START_HOUR = 7; // 7am local
const DEFAULT_WORKDAY_END_HOUR = 21; // 9pm local

// Only the hour matters here — WORKDAY_START_HOUR/END_HOUR were always
// whole-hour constants, and the policy-layer/prompt-text check below is
// hour-granular too, so a person who sets e.g. "7:30" is simply floored to
// 7 rather than adding partial-hour handling nothing else in this file has.
function workdayHourFromHHmm(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const hour = parseInt(value.split(':')[0], 10);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
}

// Bug fix: parses a raw `proposedStart` string straight from Anthropic's
// tool-use response — untrusted input, same as everything else about
// `proposal.changes` this file already re-validates. The prompt tells the
// model the current time in the user's *local* timezone and asks for a
// datetime "later today," but the tool schema only asks for "ISO 8601" —
// it never actually requires the model to include a UTC offset. When the
// model's response omits one (a real, observed case, not hypothetical —
// this is exactly what was silently dropping every proposal on a
// completely empty account, nothing left to conflict with), `new
// Date(raw)` parses it as local time *to wherever the Node process
// happens to be running* — which, on a server not itself set to the
// user's timezone (the common case), silently shifts the intended instant
// by however many hours separate the two, often enough to push a
// "this afternoon" proposal outside the [now, windowEnd) window entirely
// and make it look invalid. Fixed the same way this file already
// interprets a bare wall-clock time elsewhere (see habitProtectedInterval,
// which does the identical thing for a habit's `preferredTime`): if the
// string already carries explicit UTC/offset info, trust it as an
// absolute instant; otherwise, interpret it as local wall-clock time in
// the user's *real* stored timezone, not the server's.
const HAS_EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
// Exported (not just module-private) for the Tool-calling actions in Chat
// increment — ChatService's reschedule_task tool handler needs the exact
// same "an offset-less AI-supplied datetime string means local wall-clock
// time in the person's real timezone, not the server's" parsing this file
// already established for AI-proposed schedule changes, reused rather than
// re-implemented a second time.
export function parseAiDateTime(raw: string, timezone: string): Date {
  if (typeof raw !== 'string' || !raw) return new Date(NaN);
  if (HAS_EXPLICIT_OFFSET.test(raw.trim())) {
    return new Date(raw);
  }
  const parsed = DateTime.fromISO(raw, { zone: timezone });
  return parsed.isValid ? parsed.toJSDate() : new Date(raw);
}

// A fixed day count per scope, not a real calendar-week/calendar-month
// boundary (e.g. MONTH isn't "the rest of this calendar month," it's a
// rolling 30 days from today) — simplest correct approximation for a first
// pass, same "simple version first" spirit as every other increment's
// documented scope cut.
const SCOPE_WINDOW_DAYS: Record<PlanScope, number> = {
  [PlanScope.DAY]: 1,
  [PlanScope.WEEK]: 7,
  [PlanScope.MONTH]: 30,
};

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
// maybeAutoReplan's two @OnEvent listeners are ever subject to any of
// this; a manual button-press replan is never throttled, and — since it
// updates the very same `generatedAt` this check reads — triggering one
// manually also quiets any auto-trigger of that scope that would
// otherwise have fired moments later.
const AUTO_REPLAN_COOLDOWN_MINUTES: Record<PlanScope, number> = {
  [PlanScope.DAY]: 10,
  [PlanScope.WEEK]: 180, // 3 hours
  [PlanScope.MONTH]: 720, // 12 hours
};

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
    private readonly signalsService: SignalsService,
    private readonly memoryService: MemoryService,
    private readonly habitsService: HabitsService,
    private readonly notificationsService: NotificationsService,
    private readonly anthropic: AnthropicClient,
    // AI cost telemetry increment.
    private readonly aiUsage: AiUsageService,
  ) {}

  isConfigured(): boolean {
    return this.anthropic.isConfigured();
  }

  // --- Generation ---------------------------------------------------------

  // `triggerEvent` defaults to 'manual_request' — the exact same literal
  // this method always stored before this parameter existed — so every
  // pre-existing call site (the GraphQL resolver, every earlier e2e test)
  // is completely unaffected; only the two new automatic-replan call sites
  // below (maybeAutoReplan) ever pass a different value.
  async requestReplan(
    userId: string,
    timezone: string,
    scope: PlanScope = PlanScope.DAY,
    triggerEvent: string = 'manual_request',
  ): Promise<AiPlanRun> {
    const now = new Date();
    const { start: dayStart, end: dayEnd } = zonedDayBounds(now, timezone);
    const scopeWindowDays = SCOPE_WINDOW_DAYS[scope];
    // For DAY, windowEnd is exactly dayEnd (midnight tonight) — identical to
    // this method's behavior before this increment. For WEEK/MONTH it's
    // pushed out scopeWindowDays-1 further days, still measured from the
    // same "start of today" anchor.
    const windowEnd =
      scopeWindowDays === 1
        ? dayEnd
        : DateTime.fromJSDate(dayEnd, { zone: timezone }).plus({ days: scopeWindowDays - 1 }).toJSDate();

    // Diagnostic onboarding increment: per-user work hours, falling back to
    // the fixed defaults above for anyone who hasn't set them.
    const userWorkHours = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workHoursStart: true, workHoursEnd: true },
    });
    const workdayStartHour = workdayHourFromHHmm(userWorkHours?.workHoursStart, DEFAULT_WORKDAY_START_HOUR);
    const workdayEndHour = workdayHourFromHHmm(userWorkHours?.workHoursEnd, DEFAULT_WORKDAY_END_HOUR);

    const [openTasks, eventsInWindow, todayMood, todayEnergy, lastNightSleep, memoryContext, dueHabitsInWindow] =
      await Promise.all([
        this.tasksService.listOpenForUser(userId),
        this.calendarService.listInRange(userId, dayStart, windowEnd),
        this.signalsService.getTodayMood(userId, timezone),
        this.signalsService.getTodayEnergy(userId, timezone),
        this.signalsService.getLastNightSleep(userId, timezone),
        this.memoryService.buildContextBlock(userId),
        // Weekly/monthly plans protecting habits across the window
        // increment: now covers every day in the window, not just today —
        // see HabitsService.listDueInWindow's own comment. For DAY scope
        // (scopeWindowDays === 1) this produces exactly the same one day's
        // worth of entries listDueToday used to, so that already-shipped
        // behavior is unchanged.
        this.habitsService.listDueInWindow(userId, timezone, dayStart, scopeWindowDays),
      ]);

    if (openTasks.length === 0) {
      throw new Error('NOTHING_TO_PLAN');
    }

    // Same hard-vs-advisory split the scope call settled on: a habit with a
    // preferred time is a real protected block (same treatment as a FIXED
    // calendar event below); a habit with no preferred time is only ever
    // advisory context in the prompt, never positionally enforced.
    const incompleteHabits = dueHabitsInWindow.filter((h) => !h.completed);
    const timedHabits = incompleteHabits.filter((h) => !!h.preferredTime);
    const flexibleHabits = incompleteHabits.filter((h) => !h.preferredTime);

    const habitIntervals = timedHabits.map((h) => {
      const { start, end } = habitProtectedInterval(h.preferredTime!, h.protectedDurationMinutes, h.dayLocal.toJSDate(), timezone);
      return { title: h.title, start, end };
    });

    const prompt = buildPrompt({
      now,
      timezone,
      scope,
      windowEnd,
      openTasks,
      eventsInWindow,
      todayMood,
      todayEnergy,
      lastNightSleep,
      memoryContext,
      protectedHabits: habitIntervals,
      // Deduped by title — a flexible (no fixed time) habit due every day
      // of a MONTH window is one real, standing commitment to mention, not
      // 30 repeats of the same reminder; unlike protectedHabits, there's no
      // per-day positional meaning being lost by collapsing these, since a
      // flexible habit was never tied to a specific slot in the first place.
      flexibleHabits: Array.from(new Set(flexibleHabits.map((h) => h.title))),
      workdayStartHour,
      workdayEndHour,
    });

    const { proposal, modelUsed, usage } = await this.anthropic.proposeSchedule(prompt);
    void this.aiUsage.record({
      userId,
      feature: 'planner_replan',
      model: modelUsed,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    // Defensive bug fix: `proposal.changes` just below was already treated
    // as fully untrusted (every field re-validated before anything is kept
    // or shown), but `proposal.summary` itself was trusted blindly and
    // written straight into the non-nullable `PlanDiff.summary` GraphQL
    // field — a truncated or malformed tool-use response from Anthropic
    // (missing/empty/non-string summary) would silently persist a bad value
    // that only surfaced later as an "Cannot return null for non-nullable
    // field PlanDiff.summary" crash when the plan was actually read back.
    // Same "never trust the model's raw response" discipline this file
    // already applies to every proposed change, just extended to cover the
    // one field that had been missed.
    const rawSummary =
      typeof proposal.summary === 'string' && proposal.summary.trim().length > 0
        ? proposal.summary.trim()
        : 'Plan updated.';

    const openTaskById = new Map(openTasks.map((t) => [t.id, t]));
    const immovableIntervals = [
      ...eventsInWindow.filter((e) => e.isImmovable).map((e) => ({ start: new Date(e.startTime), end: new Date(e.endTime) })),
      ...habitIntervals.map((h) => ({ start: h.start, end: h.end })),
    ];

    // The deterministic policy layer (Architecture Document's "AI reasoning
    // loop" — hard constraints validated before anything is shown to the
    // user): every proposed change is checked against real data here, never
    // trusted just because the model returned well-formed JSON. Invalid or
    // conflicting proposals are dropped, not silently kept. Protected habit
    // time is folded into the same immovableIntervals seed as FIXED calendar
    // events, so it's enforced by the exact same overlap check below.
    const placedIntervals: Array<{ start: Date; end: Date }> = [...immovableIntervals];
    const validChanges: StoredChange[] = [];
    let droppedCount = 0;

    for (const change of proposal.changes ?? []) {
      const task = openTaskById.get(change.taskId);
      const proposedStart = parseAiDateTime(change.proposedStart, timezone);
      const durationMinutes = task?.estimatedDurationMinutes ?? DEFAULT_TASK_DURATION_MINUTES;
      const proposedEnd = new Date(proposedStart.getTime() + durationMinutes * 60 * 1000);

      // DAY scope deliberately keeps its original, already-shipped policy
      // exactly as-is — bounded only by [now, windowEnd), no fixed-hour
      // check — so this increment changes nothing about behavior anyone
      // was already relying on. WEEK/MONTH add a real local-hour check on
      // top, since without one a multi-day plan could otherwise legitimately
      // place something at 3am four days from now — there's no same-day
      // "windowEnd already caps it" backstop once the window spans more
      // than one day.
      const withinWorkHours =
        scope === PlanScope.DAY
          ? true
          : (() => {
              const localHour = DateTime.fromJSDate(proposedStart, { zone: timezone }).hour;
              return localHour >= workdayStartHour && localHour < workdayEndHour;
            })();

      const taskExists = !!task;
      const dateIsValid = !isNaN(proposedStart.getTime());
      const isNotBeforeNow = dateIsValid && proposedStart.getTime() >= now.getTime();
      const isBeforeWindowEnd = dateIsValid && proposedStart.getTime() < windowEnd.getTime();
      const overlapsExisting =
        dateIsValid && placedIntervals.some((i) => overlaps(proposedStart, proposedEnd, i.start, i.end));

      const isValid = taskExists && dateIsValid && isNotBeforeNow && isBeforeWindowEnd && withinWorkHours && !overlapsExisting;

      if (!isValid) {
        droppedCount += 1;
        // Diagnostic logging: the summary text shown in the UI only ever
        // says "conflicted with a fixed event, protected habit time, an
        // already-placed task, or fell outside working hours" — accurate,
        // but not specific enough to debug a real drop from the outside.
        // This makes the exact reason visible in the backend's own console
        // output without needing a debugger attached.
        const reasons: string[] = [];
        if (!taskExists) reasons.push(`unknown taskId "${change.taskId}" (not in this plan's open task list)`);
        if (!dateIsValid) reasons.push(`unparseable proposedStart "${change.proposedStart}"`);
        if (dateIsValid && !isNotBeforeNow) {
          reasons.push(`proposedStart ${proposedStart.toISOString()} is before "now" (${now.toISOString()})`);
        }
        if (dateIsValid && !isBeforeWindowEnd) {
          reasons.push(`proposedStart ${proposedStart.toISOString()} is at/after the plan window's end (${windowEnd.toISOString()})`);
        }
        if (dateIsValid && !withinWorkHours) {
          reasons.push(
            `proposedStart ${proposedStart.toISOString()} falls outside working hours (${workdayStartHour}:00-${workdayEndHour}:00 local)`,
          );
        }
        if (dateIsValid && overlapsExisting) {
          reasons.push('overlaps a fixed calendar event, protected habit block, or another change already placed in this same plan');
        }
        this.logger.warn(
          `Dropped AI-proposed change for taskId "${change.taskId}" (raw proposedStart: "${change.proposedStart}"): ${
            reasons.join('; ') || 'unknown reason'
          }`,
        );
        continue;
      }

      placedIntervals.push({ start: proposedStart, end: proposedEnd });
      validChanges.push({
        // Editing a proposed AI plan increment: a stable id a later EDIT
        // decision's PlanChangeEditInput.changeId can reference. `as
        // string` for the same reason recommendations.service.ts casts its
        // own randomUUID() call — @types/node's UUID template-literal type
        // otherwise collides with this field's plain-string type.
        id: randomUUID() as string,
        changeType: 'MOVE',
        taskId: task!.id,
        previousStart: task!.scheduledStart ? new Date(task!.scheduledStart).toISOString() : null,
        proposedStart: proposedStart.toISOString(),
        proposedEnd: proposedEnd.toISOString(),
        reason: String(change.reason ?? '').slice(0, 300),
      });
    }

    // Explainability (Architecture Document §7 principle, applied to the
    // one place a user actually sees it): if the model proposed something
    // that got dropped, say so plainly rather than silently showing fewer
    // changes than it claimed to make.
    const summary =
      droppedCount > 0
        ? `${rawSummary} (${droppedCount} suggestion${droppedCount === 1 ? '' : 's'} skipped — conflicted with a fixed event, protected habit time, an already-placed task, or fell outside working hours.)`
        : rawSummary;

    const diff: StoredDiff = { summary, changes: validChanges };

    const record = await this.prisma.aiPlanRun.create({
      data: {
        userId,
        triggerEvent,
        status: 'PROPOSED',
        // Same GraphQL-enum-vs-Prisma-generated-type mismatch as
        // RoutinesService's `type: type as any` writes — identical runtime
        // string values, different TS types, per the ChatMessageRole
        // precedent.
        scope: scope as any,
        diff: diff as any,
        modelUsed,
      },
    });

    // Smart notifications increment: best-effort, same "a cross-cutting hook
    // must never break the action the user is waiting on" principle every
    // other automatic side effect in this app already follows (see
    // memory.service.ts's refresh* calls). Batched by NotificationsService
    // itself (same type + still-unread + recent), so regenerating a plan
    // twice in an afternoon refreshes one notification rather than stacking
    // a second.
    try {
      const scopeLabel = scope === PlanScope.DAY ? 'day' : scope === PlanScope.WEEK ? 'week' : 'month';
      await this.notificationsService.create(userId, timezone, 'plan_ready', {
        title: 'Your plan is ready',
        body: `A new ${scopeLabel} plan is ready to review.`,
        deeplink: '/today',
      });
    } catch (error) {
      this.logger.warn(`plan_ready notification failed: ${(error as Error).message}`);
    }

    return this.hydrate(userId, record);
  }

  // --- Automatic AI re-planning --------------------------------------------

  // Event-driven, not time-driven — the counterpart to the Scheduler
  // increment's time-based reminders (see scheduler.service.ts), closing
  // the README's separate "automatic re-planning" gap: the day's plan (and,
  // since the WEEK/MONTH auto-replanning increment, the week's and month's
  // plans too — see maybeAutoReplan below) now also regenerates itself when
  // a task completes or a native calendar event changes, not only when
  // someone taps Generate. TasksService and
  // CalendarService each emit a plain event (`task.completed`/
  // `calendar.changed`) rather than calling this service directly, since
  // PlannerModule already imports both of theirs (for TasksService/
  // CalendarService's own use inside requestReplan) — those modules
  // importing PlannerModule back would be circular, the same reason Task
  // duration estimation's AI call lives here rather than on TasksService.
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
  // this service directly, same decoupling reason as task.completed/
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

  // The shared gate both listeners above go through. Originally always DAY
  // scope only — the WEEK/MONTH auto-replanning increment widened this to
  // attempt all three scopes on every trigger, each independently gated by
  // its own cooldown and its own `generatedAt` check (see
  // AUTO_REPLAN_COOLDOWN_MINUTES's own comment on why each scope needs a
  // very different cooldown length), and each wrapped in its own try/catch
  // so a failure on one scope (say, WEEK genuinely has nothing to plan)
  // can never stop DAY or MONTH from still being attempted. The underlying
  // question — "does what I already have at this scope still make sense,
  // given what just changed?" — is the same question at every scope, just
  // asked less urgently the larger the window gets. Public (not private)
  // for the same reason SchedulerService.checkRemindersForUser is public:
  // e2e tests call it directly rather than emitting a real event and
  // hoping Nest's event loop has flushed the (fire-and-forget,
  // undetectable from the outside) listener before the test's next
  // assertion runs.
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
          if (minutesSinceLastPlan < AUTO_REPLAN_COOLDOWN_MINUTES[scope]) continue;
        }

        await this.requestReplan(userId, user.timezone, scope, triggerEvent);
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

  // --- Responding -----------------------------------------------------

  async respondToPlanRun(
    userId: string,
    id: string,
    decision: PlanRunDecision,
    edits: PlanChangeEditInput[] = [],
    adds: PlanChangeAddInput[] = [],
  ): Promise<AiPlanRun> {
    const record = await this.prisma.aiPlanRun.findFirst({ where: { id, userId } });
    if (!record) {
      throw new NotFoundException('Plan run not found');
    }
    if (record.status !== 'PROPOSED') {
      throw new Error('ALREADY_RESPONDED');
    }

    let finalStatus: 'ACCEPTED' | 'EDITED' | 'REJECTED' = 'REJECTED';
    let updatedDiff: StoredDiff | undefined;

    if (decision === PlanRunDecision.ACCEPT) {
      const diff = record.diff as unknown as StoredDiff;
      for (const change of diff.changes) {
        // Best-effort: a task deleted since the plan was generated just
        // gets skipped (requireOwnedTask inside applySchedule would throw
        // NotFoundException otherwise) rather than failing the whole accept.
        try {
          await this.tasksService.applySchedule(
            userId,
            change.taskId,
            new Date(change.proposedStart),
            new Date(change.proposedEnd),
          );
        } catch {
          // intentionally swallowed — see comment above
        }
      }
      finalStatus = 'ACCEPTED';
    } else if (decision === PlanRunDecision.EDIT) {
      // Editing a proposed AI plan increment: applies the plan the same way
      // ACCEPT does, except each change can first be moved to a new time or
      // dropped entirely. Re-derives "what can't be scheduled over" fresh
      // (see computeImmovableIntervals below) rather than trusting whatever
      // was true at generation time, since real time has passed — the
      // calendar or a habit's completion state may have changed since.
      const original = record.diff as unknown as StoredDiff;
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
      const timezone = user?.timezone ?? 'UTC';
      const scope = record.scope as PlanScope;

      const { now, windowEnd, workdayStartHour, workdayEndHour, intervals: immovableIntervals } =
        await this.computeImmovableIntervals(userId, timezone, scope);

      const editsByChangeId = new Map((edits ?? []).filter((e) => e.changeId).map((e) => [e.changeId, e]));
      // Editing a task's own details increment: a task's duration can now be
      // changed (via updateTask, called directly from the plan review card —
      // see AiPlanCard/WeeklyPlanCard's "Edit task" control) while its plan
      // is still sitting PROPOSED. The stored change's own `proposedEnd`
      // still reflects whatever the duration was back at generation time, so
      // it's re-derived below from each task's *current* duration rather
      // than trusted verbatim — otherwise a duration edit would silently
      // have no effect on the plan actually being applied.
      const changeTasks = await this.tasksService.listByIds(userId, original.changes.map((c) => c.taskId));
      const changeTaskById = new Map(changeTasks.map((t) => [t.id, t]));
      // Reserves every surviving change's final interval up front, in
      // original order — the same "seed with what's already spoken for,
      // then place one at a time" approach requestReplan's own
      // placedIntervals uses at generation time, just re-run here against
      // possibly-edited times instead of freshly-proposed ones.
      const placedIntervals: Array<{ start: Date; end: Date }> = [...immovableIntervals];
      const finalChanges: StoredChange[] = [];
      let appliedEditCount = 0;
      let droppedEditCount = 0;
      let droppedDurationConflictCount = 0;

      for (const change of original.changes) {
        const edit = editsByChangeId.get(change.id ?? '');
        const durationMinutes =
          changeTaskById.get(change.taskId)?.estimatedDurationMinutes ?? DEFAULT_TASK_DURATION_MINUTES;

        // Providing both a new time and remove:true is treated as remove
        // taking priority — an explicit "get rid of this" shouldn't be
        // second-guessed by also checking a proposedStart that came along
        // with it.
        if (edit?.remove) {
          continue;
        }

        if (edit?.proposedStart) {
          const newStart = new Date(edit.proposedStart);
          const newEnd = new Date(newStart.getTime() + durationMinutes * 60 * 1000);

          const withinWorkHours =
            scope === PlanScope.DAY
              ? true
              : (() => {
                  const localHour = DateTime.fromJSDate(newStart, { zone: timezone }).hour;
                  return localHour >= workdayStartHour && localHour < workdayEndHour;
                })();

          const isValid =
            !isNaN(newStart.getTime()) &&
            newStart.getTime() >= now.getTime() &&
            newStart.getTime() < windowEnd.getTime() &&
            withinWorkHours &&
            !placedIntervals.some((i) => overlaps(newStart, newEnd, i.start, i.end));

          if (isValid) {
            placedIntervals.push({ start: newStart, end: newEnd });
            finalChanges.push({ ...change, proposedStart: newStart.toISOString(), proposedEnd: newEnd.toISOString() });
            appliedEditCount += 1;
            continue;
          }

          // Invalid edit — same "explain, don't silently discard" principle
          // requestReplan's own droppedCount already uses: kept at its
          // original proposed time rather than dropped outright, since an
          // edit that didn't work isn't the same thing as someone actually
          // asking to remove this suggestion.
          droppedEditCount += 1;
        }

        // No time edit applied (or the one requested didn't validate) — keep
        // the original proposed start, but recompute its end from the task's
        // live duration (see comment above) and re-check that interval
        // against everything already placed. This is new re-validation an
        // untouched change never used to get (previously it was pushed
        // straight through, trusted from generation time) — safe for the
        // ordinary case where duration hasn't changed (recomputedEnd then
        // equals the original, already-valid end, so this can only ever
        // newly fail if a duration edit actually grew the interval into a
        // real conflict).
        const originalStart = new Date(change.proposedStart);
        const recomputedEnd = new Date(originalStart.getTime() + durationMinutes * 60 * 1000);
        const stillValid = !placedIntervals.some((i) => overlaps(originalStart, recomputedEnd, i.start, i.end));

        if (!stillValid) {
          // No valid time left to place this at — dropped entirely rather
          // than applying a schedule that's now known to overlap something,
          // same "never write a proposal the policy layer would have
          // rejected at generation time" discipline as everywhere else in
          // this file.
          droppedDurationConflictCount += 1;
          this.logger.warn(
            `Dropped change for taskId "${change.taskId}" during EDIT response: its duration was edited to ${durationMinutes} minutes, which now overlaps another placed interval.`,
          );
          continue;
        }

        placedIntervals.push({ start: originalStart, end: recomputedEnd });
        finalChanges.push({ ...change, proposedEnd: recomputedEnd.toISOString() });
      }

      // Free-form plan editing increment: a task the AI never proposed at
      // all, placed by the person themselves. Runs after the edits loop
      // above so a manually-added task is checked against the *final*
      // placedIntervals (already-edited/removed changes), not the
      // generation-time snapshot — same "re-validate against what's true
      // right now" discipline as everything else in this branch.
      let appliedAddCount = 0;
      let droppedAddCount = 0;
      if (adds.length > 0) {
        const addTaskIds = [...new Set(adds.map((a) => a.taskId))];
        const addTasks = await this.tasksService.listByIds(userId, addTaskIds);
        const addTaskById = new Map(addTasks.map((t) => [t.id, t]));
        const alreadyInPlan = new Set(finalChanges.map((c) => c.taskId));

        for (const add of adds) {
          const task = addTaskById.get(add.taskId);
          // A task already carrying a change in this plan (proposed by the
          // AI, or already added by an earlier entry in this same `adds`
          // array) is skipped rather than double-scheduled — one change per
          // task per plan, same invariant requestReplan's own
          // placedIntervals seeding already relies on.
          const taskExists = !!task && !alreadyInPlan.has(add.taskId);
          const proposedStart = add.proposedStart instanceof Date ? add.proposedStart : new Date(add.proposedStart);
          const dateIsValid = taskExists && !isNaN(proposedStart.getTime());
          const durationMinutes = task?.estimatedDurationMinutes ?? DEFAULT_TASK_DURATION_MINUTES;
          const proposedEnd = new Date(proposedStart.getTime() + durationMinutes * 60 * 1000);

          const withinWorkHours =
            !dateIsValid || scope === PlanScope.DAY
              ? true
              : (() => {
                  const localHour = DateTime.fromJSDate(proposedStart, { zone: timezone }).hour;
                  return localHour >= workdayStartHour && localHour < workdayEndHour;
                })();

          const isValid =
            dateIsValid &&
            proposedStart.getTime() >= now.getTime() &&
            proposedStart.getTime() < windowEnd.getTime() &&
            withinWorkHours &&
            !placedIntervals.some((i) => overlaps(proposedStart, proposedEnd, i.start, i.end));

          if (!isValid) {
            droppedAddCount += 1;
            continue;
          }

          placedIntervals.push({ start: proposedStart, end: proposedEnd });
          alreadyInPlan.add(add.taskId);
          finalChanges.push({
            id: randomUUID() as string,
            changeType: 'MOVE',
            taskId: task!.id,
            previousStart: task!.scheduledStart ? new Date(task!.scheduledStart).toISOString() : null,
            proposedStart: proposedStart.toISOString(),
            proposedEnd: proposedEnd.toISOString(),
            reason: 'Added manually to this plan.',
          });
          appliedAddCount += 1;
        }
      }

      const editParts: string[] = [];
      if (appliedEditCount > 0) editParts.push(`${appliedEditCount} edit${appliedEditCount === 1 ? '' : 's'} applied`);
      if (droppedEditCount > 0) {
        editParts.push(
          `${droppedEditCount} edit${droppedEditCount === 1 ? '' : 's'} couldn't be applied — conflicted with a fixed event, protected habit time, another change, or fell outside the allowed window, so kept at the original proposed time`,
        );
      }
      if (appliedAddCount > 0) editParts.push(`${appliedAddCount} task${appliedAddCount === 1 ? '' : 's'} added`);
      if (droppedAddCount > 0) {
        editParts.push(
          `${droppedAddCount} added task${droppedAddCount === 1 ? '' : 's'} couldn't be placed — conflicted with something already on the plan, fell outside the allowed window, or was already part of this plan`,
        );
      }
      if (droppedDurationConflictCount > 0) {
        editParts.push(
          `${droppedDurationConflictCount} change${droppedDurationConflictCount === 1 ? '' : 's'} dropped — a task's edited duration no longer fits without overlapping something else on the plan`,
        );
      }
      const summary = editParts.length > 0 ? `${original.summary} (${editParts.join('; ')}.)` : original.summary;

      updatedDiff = { summary, changes: finalChanges };

      for (const change of finalChanges) {
        try {
          await this.tasksService.applySchedule(
            userId,
            change.taskId,
            new Date(change.proposedStart),
            new Date(change.proposedEnd),
          );
        } catch {
          // intentionally swallowed — same reasoning as the ACCEPT branch
        }
      }
      finalStatus = 'EDITED';
    }

    const updated = await this.prisma.aiPlanRun.update({
      where: { id },
      data: {
        status: finalStatus,
        respondedAt: new Date(),
        ...(updatedDiff ? { diff: updatedDiff as any } : {}),
      },
    });

    // Automatic learning (simple, statistical — see memory.service.ts):
    // refreshes the accept/reject-pattern fact right as new data exists to
    // compute it from. Best-effort — a failure here should never break the
    // actual response the person is waiting on, same reasoning as the
    // swallowed per-task errors above. Unaffected by EDIT existing now —
    // refreshInterventionResponsePattern's own query only ever looks at
    // ACCEPTED/REJECTED runs (a deliberate scope cut for this increment,
    // see README: whether an edited-then-applied plan should count toward
    // this pattern the same way a plain accept does is a real open
    // question this increment doesn't attempt to answer).
    try {
      await this.memoryService.refreshInterventionResponsePattern(userId);
    } catch {
      // intentionally swallowed — see comment above
    }

    return this.hydrate(userId, updated);
  }

  // Shared by respondToPlanRun's EDIT branch above — re-derives the same
  // "what can't be scheduled over" data requestReplan itself gathers at
  // generation time, freshly, since real time has passed (and the calendar
  // or a habit's completion state may have changed) between when a plan was
  // generated and when someone's actually editing it now. Deliberately not
  // used by requestReplan itself, which keeps its own already-shipped,
  // already-tested inline version of this exact logic untouched — accepted
  // duplication over risking a regression in a working, tested code path
  // for an unrelated feature.
  private async computeImmovableIntervals(
    userId: string,
    timezone: string,
    scope: PlanScope,
  ): Promise<{
    now: Date;
    windowEnd: Date;
    workdayStartHour: number;
    workdayEndHour: number;
    intervals: Array<{ start: Date; end: Date }>;
  }> {
    const now = new Date();
    const { start: dayStart, end: dayEnd } = zonedDayBounds(now, timezone);
    const scopeWindowDays = SCOPE_WINDOW_DAYS[scope];
    const windowEnd =
      scopeWindowDays === 1
        ? dayEnd
        : DateTime.fromJSDate(dayEnd, { zone: timezone }).plus({ days: scopeWindowDays - 1 }).toJSDate();

    const userWorkHours = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workHoursStart: true, workHoursEnd: true },
    });
    const workdayStartHour = workdayHourFromHHmm(userWorkHours?.workHoursStart, DEFAULT_WORKDAY_START_HOUR);
    const workdayEndHour = workdayHourFromHHmm(userWorkHours?.workHoursEnd, DEFAULT_WORKDAY_END_HOUR);

    const [eventsInWindow, dueHabitsInWindow] = await Promise.all([
      this.calendarService.listInRange(userId, dayStart, windowEnd),
      // Same window-wide due-check requestReplan itself now uses — see
      // HabitsService.listDueInWindow's own comment.
      this.habitsService.listDueInWindow(userId, timezone, dayStart, scopeWindowDays),
    ]);

    const habitIntervals = dueHabitsInWindow
      .filter((h) => !h.completed && !!h.preferredTime)
      .map((h) => habitProtectedInterval(h.preferredTime!, h.protectedDurationMinutes, h.dayLocal.toJSDate(), timezone));

    const intervals = [
      ...eventsInWindow.filter((e) => e.isImmovable).map((e) => ({ start: new Date(e.startTime), end: new Date(e.endTime) })),
      ...habitIntervals,
    ];

    return { now, windowEnd, workdayStartHour, workdayEndHour, intervals };
  }

  async getLatest(userId: string, scope: PlanScope = PlanScope.DAY): Promise<AiPlanRun | null> {
    const record = await this.prisma.aiPlanRun.findFirst({
      where: { userId, scope: scope as any },
      orderBy: { generatedAt: 'desc' },
    });
    if (!record) return null;
    return this.hydrate(userId, record);
  }

  // --- Task duration estimation -------------------------------------------

  // "AI-assisted estimate" (PRD §7.1 Task management row) + "learns
  // actual-vs-estimated time per user, improves over time" (PRD §7.4 AI
  // Layer row) — the second half is real, not aspirational: buildContextBlock
  // now includes the task_duration_accuracy fact (see
  // memory.service.ts's refreshTaskDurationAccuracyPattern, written from
  // real completions), and that same context block is what gets injected
  // into this prompt below, so a person who consistently under-estimates
  // gets a nudged-up suggestion, not just the same generic estimate every
  // time. Lives here rather than on TasksService specifically to avoid a
  // module cycle — PlannerModule already imports TasksModule, so TasksModule
  // importing PlannerModule back (for AnthropicClient) would be circular.
  // Best-effort like every other optional AI call in this app: returns null
  // (not a thrown error) if the key isn't configured, the response can't be
  // parsed as a sane number of minutes, or the request fails outright — the
  // frontend's duration field always stays a normal, directly-editable
  // number input, this is only ever a suggestion dropped into it.
  async estimateDuration(userId: string, title: string, description?: string): Promise<number | null> {
    if (!this.anthropic.isConfigured()) return null;

    try {
      const context = await this.memoryService.buildContextBlock(userId);
      const system =
        'You estimate how long a personal task will realistically take, in minutes, for a specific user of a life-planning app. Reply with ONLY a single integer number of minutes — no words, no range, no explanation.';
      const prompt = [
        `Task: ${title}`,
        description ? `Details: ${description}` : undefined,
        context ? `What's known about this user's habits and past estimation accuracy:\n${context}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      const { content, modelUsed, usage } = await this.anthropic.sendMessage([{ role: 'user', content: prompt }], system);
      void this.aiUsage.record({
        userId,
        feature: 'planner_estimate_duration',
        model: modelUsed,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      });
      const match = content.match(/\d+/);
      if (!match) return null;

      const minutes = parseInt(match[0], 10);
      // Sanity bounds, not a hard product rule — same "validate before
      // trusting" spirit as RoutinesService.aiSequence's permutation check:
      // a wildly out-of-range reply (0, or "600 minutes for a 2-minute
      // task") is more likely a parsing artifact or a model mistake than a
      // real estimate worth showing.
      if (minutes < 1 || minutes > 480) return null;

      return minutes;
    } catch (error) {
      this.logger.warn(`AI duration estimate failed, leaving the field for manual entry: ${(error as Error).message}`);
      return null;
    }
  }

  // --- Hydration --------------------------------------------------------

  // Expands the stored { taskId, ... } diff into the GraphQL PlanDiff shape
  // (real Task objects), same "service layer shapes the response, GraphQL
  // model never knows about the storage representation" split as
  // TasksService.toGraphTask flattening the task_tags join table.
  private async hydrate(userId: string, record: any): Promise<AiPlanRun> {
    const diff = record.diff as StoredDiff;
    const taskIds = diff.changes.map((c) => c.taskId);
    const tasks = await this.tasksService.listByIds(userId, taskIds);
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    return {
      id: record.id,
      triggerEvent: record.triggerEvent,
      status: record.status,
      scope: record.scope as PlanScope,
      modelUsed: record.modelUsed,
      generatedAt: record.generatedAt,
      respondedAt: record.respondedAt ?? undefined,
      diff: {
        summary: diff.summary,
        changes: diff.changes
          .filter((c) => taskById.has(c.taskId))
          .map((c, i) => ({
            // Editing a proposed AI plan increment: a plan generated before
            // this shipped has no `id` stored on its changes at all — a
            // stable-within-this-response placeholder keeps this field
            // genuinely non-null (never a GraphQL null-for-non-nullable
            // crash, see the PlanDiff.summary bug fix above for the exact
            // shape of that mistake) without pretending it's a real,
            // edit-targetable id; PlanChangeEditInput.changeId simply won't
            // match anything for a change from a plan this old.
            id: c.id ?? `legacy-${i}`,
            changeType: PlanChangeType.MOVE,
            task: taskById.get(c.taskId),
            previousStart: c.previousStart ? new Date(c.previousStart) : undefined,
            proposedStart: new Date(c.proposedStart),
            proposedEnd: new Date(c.proposedEnd),
            reason: c.reason,
          })),
      },
    } as unknown as AiPlanRun;
  }
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

// Converts a habit's "HH:mm" preferredTime (a plain wall-clock string, no
// date attached — see HabitsService's Habit.preferredTime docs) into a real
// today-dated interval in the user's timezone, the same shape the policy
// layer already uses for calendar-event intervals.
function habitProtectedInterval(
  preferredTime: string,
  protectedDurationMinutes: number,
  now: Date,
  timezone: string,
): { start: Date; end: Date } {
  const [hour, minute] = preferredTime.split(':').map(Number);
  const start = DateTime.fromJSDate(now, { zone: timezone }).set({ hour, minute, second: 0, millisecond: 0 });
  const end = start.plus({ minutes: protectedDurationMinutes });
  return { start: start.toJSDate(), end: end.toJSDate() };
}

function buildPrompt(ctx: {
  now: Date;
  timezone: string;
  scope: PlanScope;
  windowEnd: Date;
  openTasks: Array<{ id: string; title: string; priority: number; estimatedDurationMinutes?: number; dueDate?: Date }>;
  eventsInWindow: Array<{ title: string; startTime: Date; endTime: Date; isImmovable: boolean }>;
  todayMood: { moodScore: number } | null;
  todayEnergy: { energyScore: number } | null;
  lastNightSleep: { durationMinutes?: number; qualityScore?: number } | null;
  memoryContext: string;
  protectedHabits: Array<{ title: string; start: Date; end: Date }>;
  flexibleHabits: string[];
  workdayStartHour: number;
  workdayEndHour: number;
}): string {
  const nowLocal = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone });
  const isMultiDay = ctx.scope !== PlanScope.DAY;

  // DAY scope's intro/window line is byte-for-byte the same text this
  // function already produced before this increment — no behavior change
  // for the feature that was already shipped. WEEK/MONTH get their own
  // framing: a real date range instead of "today," and an explicit
  // instruction about the per-day working-hours window the policy layer
  // above now actually enforces for these two scopes (see requestReplan's
  // withinWorkHours check).
  let introLine: string;
  let tasksIntro: string;
  let eventsIntro: string;
  if (!isMultiDay) {
    const dayWindowEnd = DateTime.min(
      DateTime.fromJSDate(ctx.windowEnd, { zone: ctx.timezone }),
      nowLocal.set({ hour: ctx.workdayEndHour, minute: 0, second: 0 }),
    );
    // Bug fix: this used to only ever state the current time-of-day
    // (HH:mm), never the actual calendar date — unlike the WEEK/MONTH
    // branch below, which always has. Since proposedStart now requires a
    // full date+time (see the tool schema's own bug-fix comment in
    // anthropic-client.ts), a model given only "11:15" and no date at all
    // has to guess what today's real date is — observed, live, guessing
    // wrong by over a year (a proposal dated May 2025 for an actual
    // request made in August 2026), which then got correctly rejected by
    // the policy layer for being "before now," making a perfectly healthy
    // model response look like a validation failure. Stating the date
    // explicitly, and repeating it right where proposedStart's exact
    // expected format is spelled out, removes the guess entirely.
    const todayDateLabel = nowLocal.toFormat('yyyy-MM-dd');
    introLine = `You are an AI Chief of Staff scheduling someone's remaining day. Today's date is ${todayDateLabel} (${nowLocal.toFormat('cccc')}), and the current time is ${nowLocal.toFormat('HH:mm')} (${ctx.timezone}). Only schedule between now and ${dayWindowEnd.toFormat('HH:mm')} today — do not propose anything after that or before now. Every proposedStart you return must use today's actual date, ${todayDateLabel} — do not guess or assume a different date.`;
    tasksIntro =
      'Open tasks (schedule zero or more of these — favor higher priority and due-soon tasks, and don\'t try to force in every task if the remaining time is too short):';
    eventsIntro = "Today's calendar (do not schedule over anything marked FIXED):";
  } else {
    const label = ctx.scope === PlanScope.WEEK ? 'week' : 'month';
    const windowEndLocal = DateTime.fromJSDate(ctx.windowEnd, { zone: ctx.timezone });
    introLine = `You are an AI Chief of Staff planning someone's ${label} ahead. Current time: ${nowLocal.toFormat('yyyy-MM-dd HH:mm')} (${ctx.timezone}). Propose specific dates and times for tasks any time between now and ${windowEndLocal.toFormat('yyyy-MM-dd')} — every proposedStart must be a full ISO datetime with both a date and a time, and the time must fall between ${ctx.workdayStartHour}:00 and ${ctx.workdayEndHour}:00 local time on whichever day you choose, never overnight.`;
    tasksIntro = `Open tasks (spread these sensibly across the ${label} ahead — favor higher priority and due-soon tasks, don't pile everything onto day one):`;
    eventsIntro = `This ${label}'s calendar (do not schedule over anything marked FIXED):`;
  }

  const tasksList = ctx.openTasks
    .map((t) => {
      const due = t.dueDate ? `, due ${DateTime.fromJSDate(t.dueDate, { zone: ctx.timezone }).toISODate()}` : '';
      return `- id=${t.id} | "${t.title}" | priority=${t.priority} (1=urgent, 4=someday) | estimated ${t.estimatedDurationMinutes ?? DEFAULT_TASK_DURATION_MINUTES} min${due}`;
    })
    .join('\n');

  const eventsList = ctx.eventsInWindow.length
    ? ctx.eventsInWindow
        .map((e) => {
          const startFormat = isMultiDay ? 'yyyy-MM-dd HH:mm' : 'HH:mm';
          const s = DateTime.fromJSDate(e.startTime, { zone: ctx.timezone }).toFormat(startFormat);
          const en = DateTime.fromJSDate(e.endTime, { zone: ctx.timezone }).toFormat('HH:mm');
          return `- ${s}-${en} "${e.title}"${e.isImmovable ? ' (FIXED — do not schedule anything over this)' : ''}`;
        })
        .join('\n')
    : '(none)';

  // Weekly/monthly plans protecting habits across the window increment: a
  // multi-day window includes a real date on each line now (same
  // `isMultiDay` pattern eventsList already used above it), since two
  // different days' 7am habit blocks would otherwise both print as the
  // same bare "07:00-07:15" with nothing telling them apart.
  const protectedHabitsList = ctx.protectedHabits.length
    ? ctx.protectedHabits
        .map((h) => {
          const startFormat = isMultiDay ? 'yyyy-MM-dd HH:mm' : 'HH:mm';
          const s = DateTime.fromJSDate(h.start, { zone: ctx.timezone }).toFormat(startFormat);
          const en = DateTime.fromJSDate(h.end, { zone: ctx.timezone }).toFormat('HH:mm');
          return `- ${s}-${en} "${h.title}" (FIXED — protected habit time, do not schedule anything over this)`;
        })
        .join('\n')
    : '(none)';

  const flexibleHabitsLine = ctx.flexibleHabits.length
    ? `Also needs to happen ${isMultiDay ? 'at some point each day it recurs' : 'today'}, no fixed time — try to leave room for these too: ${ctx.flexibleHabits
        .map((t) => `"${t}"`)
        .join(', ')}`
    : '';

  const stateLines = [
    ctx.todayMood ? `Mood check-in today: ${ctx.todayMood.moodScore}/5` : 'Mood: not checked in today',
    ctx.todayEnergy ? `Energy check-in today: ${ctx.todayEnergy.energyScore}/5` : 'Energy: not checked in today',
    ctx.lastNightSleep?.durationMinutes
      ? `Last night's sleep: ${Math.round((ctx.lastNightSleep.durationMinutes / 60) * 10) / 10}h${
          ctx.lastNightSleep.qualityScore ? `, quality ${ctx.lastNightSleep.qualityScore}/5` : ''
        }`
      : "Last night's sleep: not logged",
  ].join('\n');

  const memorySection = ctx.memoryContext
    ? `\nThings this person has told the AI to remember — treat these as hard preferences, not suggestions:\n${ctx.memoryContext}\n`
    : '';

  // Weekly/monthly plans protecting habits across the window increment:
  // every due day's habit time is real protected time now, not just
  // today's — the intro line below reflects that directly instead of the
  // disclaimer that used to sit here explaining why it wasn't true yet.
  const habitsIntro = isMultiDay
    ? `This ${ctx.scope === PlanScope.WEEK ? 'week' : 'month'}'s protected habit time (do not schedule over anything marked FIXED):`
    : "Today's protected habit time (do not schedule over anything marked FIXED):";

  return `${introLine}

${tasksIntro}
${tasksList}

${eventsIntro}
${eventsList}

${habitsIntro}
${protectedHabitsList}
${flexibleHabitsLine ? `\n${flexibleHabitsLine}\n` : ''}
How the person is doing right now:
${stateLines}
If energy or mood is low (2 or below), prefer shorter or lower-priority tasks and leave more open gaps rather than packing the day tightly. If sleep was short (under 6h) or low quality, be more conservative about scheduling demanding tasks back-to-back.
${memorySection}
Call propose_schedule with your proposed times. Only use task ids from the list above.`;
}
