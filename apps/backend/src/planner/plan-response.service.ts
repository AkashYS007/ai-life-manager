import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { zonedDayBounds } from '../common/date/zoned-day';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { MemoryService } from '../memory/memory.service';
import { HabitsService } from '../habits/habits.service';
import { AiPlanRun, PlanRunDecision, PlanScope } from './models/ai-plan-run.model';
import { PlanChangeEditInput } from './dto/plan-change-edit.input';
import { PlanChangeAddInput } from './dto/plan-change-add.input';
import { StoredChange, StoredDiff } from './planner-types';
import {
  DEFAULT_TASK_DURATION_MINUTES,
  DEFAULT_WORKDAY_START_HOUR,
  DEFAULT_WORKDAY_END_HOUR,
  workdayHourFromHHmm,
  overlaps,
  habitProtectedInterval,
} from './planner-helpers';
import { SCOPE_WINDOW_DAYS } from './planner-prompt';
import { hydratePlanRun } from './planner-hydration';

// planner.service.ts modularization increment (2026-08-26): the
// accept/reject/edit policy layer, extracted from the original monolithic
// PlannerService (~290 of its 1,146 lines plus computeImmovableIntervals,
// per the mapping in project update 59). Deliberately does NOT depend on
// PlanGenerationService (or vice versa) — the two paths share only pure,
// stateless helpers (planner-helpers.ts, planner-prompt.ts's
// SCOPE_WINDOW_DAYS, planner-hydration.ts), never each other, so there's no
// risk of one path's future change accidentally affecting the other via a
// shared service dependency.
@Injectable()
export class PlanResponseService {
  private readonly logger = new Logger(PlanResponseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
    private readonly memoryService: MemoryService,
    private readonly habitsService: HabitsService,
  ) {}

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
      // then place one at a time" approach the generation path's own
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
          // the generation path's own droppedCount already uses: kept at
          // its original proposed time rather than dropped outright, since
          // an edit that didn't work isn't the same thing as someone
          // actually asking to remove this suggestion.
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
          // task per plan, same invariant the generation path's own
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

    return hydratePlanRun(this.tasksService, userId, updated);
  }

  // Re-derives the same "what can't be scheduled over" data the generation
  // path itself gathers at generation time, freshly, since real time has
  // passed (and the calendar or a habit's completion state may have
  // changed) between when a plan was generated and when someone's actually
  // editing it now. Deliberately not shared with PlanGenerationService,
  // which keeps its own already-shipped, already-tested inline version of
  // this exact logic untouched — accepted duplication over risking a
  // regression in a working, tested code path for an unrelated feature.
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
      // Same window-wide due-check the generation path itself now uses —
      // see HabitsService.listDueInWindow's own comment.
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
}
