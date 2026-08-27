import { Injectable, Logger } from '@nestjs/common';
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
import { AiPlanRun, PlanScope } from './models/ai-plan-run.model';
import { StoredChange, StoredDiff } from './planner-types';
import {
  DEFAULT_TASK_DURATION_MINUTES,
  DEFAULT_WORKDAY_START_HOUR,
  DEFAULT_WORKDAY_END_HOUR,
  workdayHourFromHHmm,
  parseAiDateTime,
  overlaps,
  habitProtectedInterval,
} from './planner-helpers';
import { buildPrompt, SCOPE_WINDOW_DAYS } from './planner-prompt';
import { hydratePlanRun } from './planner-hydration';

// planner.service.ts modularization increment (2026-08-26): the AI plan
// *generation* path (day/week/month), extracted from the original
// monolithic PlannerService (~270 of its 1,146 lines, per the mapping in
// project update 59) into its own focused service. PlannerService itself
// stays the single injectable class everything else in the app depends on
// (the resolver, today.resolver.ts, and the e2e suite's
// `moduleRef.get(PlannerService)`) — it now just delegates `requestReplan`
// straight through to this service's own `requestReplan`, so nothing
// outside PlannerModule needed to change. PlannerAutoReplanListener also
// calls into this service directly (instead of back into PlannerService)
// for the same reason: no behavior difference, one fewer indirection.
@Injectable()
export class PlanGenerationService {
  private readonly logger = new Logger(PlanGenerationService.name);

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

  // `triggerEvent` defaults to 'manual_request' — the exact same literal
  // this method always stored before this parameter existed — so every
  // pre-existing call site (the GraphQL resolver, every earlier e2e test)
  // is completely unaffected; only the automatic-replan call site
  // (PlannerAutoReplanListener.maybeAutoReplan) ever passes a different
  // value.
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

    return hydratePlanRun(this.tasksService, userId, record);
  }
}
