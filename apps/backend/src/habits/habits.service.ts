import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { buildRrule, isDueOn, parseRrule } from './rrule';
import { Habit, HabitFrequency, MonthlyRecurrenceMode } from './models/habit.model';
import { CreateHabitInput } from './dto/create-habit.input';
import { UpdateHabitInput } from './dto/update-habit.input';

const DEFAULT_PROTECTED_DURATION_MINUTES = 15;

// Postgres TIME columns round-trip through Prisma as a JS Date anchored to
// 1970-01-01 (see the schema.prisma comment on Habit.preferredTime) — these
// two helpers are the only place that anchoring detail leaks out; everywhere
// else (DTOs, the GraphQL model) just sees a plain "HH:mm" string.
function timeStringToDate(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
}
function dateToTimeString(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const mm = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Renders a JS Date as the date-only value the `@db.Date` scheduled_date
// column expects, anchored to the user's own calendar day — same helper
// shape as signals.service.ts's toDateOnly, same reasoning.
function toDateOnly(instant: Date, timezone: string): Date {
  const isoDate = DateTime.fromJSDate(instant, { zone: timezone }).toISODate();
  return new Date(isoDate!);
}

// Full custom habit recurrence increment: generalizes the old two-arg
// helper to cover all four new fields, one per non-WEEKLY-days scenario.
// Every field here is optional at the type level because a partial update
// call site (see `update` below) fills in "whatever wasn't provided" from
// the habit's existing recurrence before calling this — this function
// itself still requires everything the chosen frequency/mode actually
// needs, same fail-closed INVALID_RECURRENCE as the original WEEKLY check.
type RecurrenceParams = {
  frequency: HabitFrequency;
  daysOfWeek?: number[];
  intervalDays?: number;
  intervalWeeks?: number;
  intervalMonths?: number;
  monthlyMode?: MonthlyRecurrenceMode;
  dayOfMonth?: number;
  monthlyWeekday?: number;
  monthlyOrdinal?: number;
  // BYSETPOS / multiple weekdays per month increment.
  daysOfMonth?: number[];
  monthlyWeekdaySet?: number[];
  // Fuller habit recurrence increment — orthogonal to every shape above, so
  // they're threaded straight through to rrule.ts's own buildRrule
  // regardless of frequency, rather than duplicated per-branch below.
  count?: number;
  until?: string;
};

function buildRruleOrThrow(p: RecurrenceParams): string {
  const end = { count: p.count, until: p.until };
  if (p.frequency === HabitFrequency.DAILY) {
    return buildRrule({ frequency: 'DAILY', intervalDays: p.intervalDays ?? 1, ...end });
  }
  if (p.frequency === HabitFrequency.WEEKLY) {
    if (!p.daysOfWeek || p.daysOfWeek.length === 0) {
      throw new Error('INVALID_RECURRENCE');
    }
    return buildRrule({ frequency: 'WEEKLY', daysOfWeek: p.daysOfWeek, intervalWeeks: p.intervalWeeks ?? 1, ...end });
  }
  // MONTHLY
  const intervalMonths = p.intervalMonths ?? 1;
  if (p.monthlyMode === MonthlyRecurrenceMode.DAY_OF_MONTH) {
    if (p.dayOfMonth == null) {
      throw new Error('INVALID_RECURRENCE');
    }
    return buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: p.dayOfMonth, intervalMonths, ...end });
  }
  if (p.monthlyMode === MonthlyRecurrenceMode.NTH_WEEKDAY) {
    if (p.monthlyWeekday == null || p.monthlyOrdinal == null) {
      throw new Error('INVALID_RECURRENCE');
    }
    return buildRrule({
      frequency: 'MONTHLY',
      mode: 'NTH_WEEKDAY',
      weekday: p.monthlyWeekday,
      ordinal: p.monthlyOrdinal,
      intervalMonths,
      ...end,
    });
  }
  // BYSETPOS / multiple weekdays per month increment.
  if (p.monthlyMode === MonthlyRecurrenceMode.DAYS_OF_MONTH) {
    if (!p.daysOfMonth || p.daysOfMonth.length < 2) {
      throw new Error('INVALID_RECURRENCE');
    }
    return buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: p.daysOfMonth, intervalMonths, ...end });
  }
  if (p.monthlyMode === MonthlyRecurrenceMode.NTH_WEEKDAY_SET) {
    if (!p.monthlyWeekdaySet || p.monthlyWeekdaySet.length === 0 || p.monthlyOrdinal == null) {
      throw new Error('INVALID_RECURRENCE');
    }
    return buildRrule({
      frequency: 'MONTHLY',
      mode: 'NTH_WEEKDAY_SET',
      weekdaySet: p.monthlyWeekdaySet,
      ordinal: p.monthlyOrdinal,
      intervalMonths,
      ...end,
    });
  }
  throw new Error('INVALID_RECURRENCE');
}

@Injectable()
export class HabitsService {
  constructor(
    private readonly prisma: PrismaService,
    // Same decoupling reason `task.completed`/`calendar.changed` already
    // use — see planner.service.ts's own comment on why TasksService and
    // CalendarService emit a plain event instead of calling PlannerService
    // directly: PlannerModule already imports HabitsModule, so importing
    // PlannerModule back here would be circular.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async requireOwnedHabit(userId: string, id: string) {
    const habit = await this.prisma.habit.findFirst({ where: { id, userId }, include: { goal: true } });
    if (!habit) {
      throw new NotFoundException('Habit not found');
    }
    return habit;
  }

  // Shapes a raw Habit row (plus whether *today's* log is completed) into
  // the GraphQL model — the same "service layer flattens storage details"
  // split as tasks.service.ts's toGraphTask.
  private async toGraphHabit(record: any, timezone: string): Promise<Habit> {
    const recurrence = parseRrule(record.rrule);
    const scheduledDate = toDateOnly(new Date(), timezone);
    const todayLog = await this.prisma.habitLog.findUnique({
      where: { habitId_scheduledDate: { habitId: record.id, scheduledDate } },
    });

    return {
      id: record.id,
      title: record.title,
      frequency:
        recurrence?.frequency === 'WEEKLY'
          ? HabitFrequency.WEEKLY
          : recurrence?.frequency === 'MONTHLY'
            ? HabitFrequency.MONTHLY
            : HabitFrequency.DAILY,
      daysOfWeek: recurrence?.frequency === 'WEEKLY' ? recurrence.daysOfWeek : undefined,
      // Full custom habit recurrence increment — see Habit model's own
      // comments for why intervalDays/intervalWeeks default to undefined
      // (not 1) here specifically: this is the raw hydration step, keeping
      // "no interval set" and "interval of 1" visibly distinct is only
      // useful right at the frontend display layer, not here.
      intervalDays: recurrence?.frequency === 'DAILY' ? recurrence.intervalDays : undefined,
      intervalWeeks: recurrence?.frequency === 'WEEKLY' ? recurrence.intervalWeeks : undefined,
      monthlyMode: recurrence?.frequency === 'MONTHLY' ? (recurrence.mode as unknown as MonthlyRecurrenceMode) : undefined,
      dayOfMonth: recurrence?.frequency === 'MONTHLY' && recurrence.mode === 'DAY_OF_MONTH' ? recurrence.dayOfMonth : undefined,
      monthlyWeekday: recurrence?.frequency === 'MONTHLY' && recurrence.mode === 'NTH_WEEKDAY' ? recurrence.weekday : undefined,
      // BYSETPOS / multiple weekdays per month increment — monthlyOrdinal
      // is shared by both NTH_WEEKDAY (a single weekday's Nth occurrence)
      // and NTH_WEEKDAY_SET (the Nth day among a whole set of weekdays);
      // which one it's paired with is disambiguated by monthlyMode itself.
      monthlyOrdinal:
        recurrence?.frequency === 'MONTHLY' && (recurrence.mode === 'NTH_WEEKDAY' || recurrence.mode === 'NTH_WEEKDAY_SET')
          ? recurrence.ordinal
          : undefined,
      daysOfMonth: recurrence?.frequency === 'MONTHLY' && recurrence.mode === 'DAYS_OF_MONTH' ? recurrence.daysOfMonth : undefined,
      monthlyWeekdaySet:
        recurrence?.frequency === 'MONTHLY' && recurrence.mode === 'NTH_WEEKDAY_SET' ? recurrence.weekdaySet : undefined,
      // Fuller habit recurrence increment — same "always present as 1, not
      // null/undefined" convention intervalDays/intervalWeeks above already
      // use, just for MONTHLY specifically.
      intervalMonths: recurrence?.frequency === 'MONTHLY' ? recurrence.intervalMonths : undefined,
      count: recurrence?.count,
      until: recurrence?.until,
      preferredTime: dateToTimeString(record.preferredTime),
      protectedDurationMinutes: record.protectedDurationMinutes,
      active: record.active,
      todayCompleted: !!todayLog?.completedAt,
      // Linking habits to goals increment — `record.goal` is only present
      // when the query that produced `record` actually asked for it
      // (`include: { goal: true }`); every call site below does.
      goal: record.goal ?? undefined,
    };
  }

  async listForUser(userId: string, timezone: string, activeOnly = false): Promise<Habit[]> {
    const records = await this.prisma.habit.findMany({
      where: { userId, ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ createdAt: 'asc' }],
      include: { goal: true },
    });
    return Promise.all(records.map((r) => this.toGraphHabit(r, timezone)));
  }

  // Powers TodayPlan.habits — only habits that are both active and due on
  // today's local calendar date (rrule.ts's isDueOn), not every habit the
  // user has ever created. This is the list the Today screen's checklist
  // actually renders.
  async listDueToday(userId: string, timezone: string): Promise<Habit[]> {
    const records = await this.prisma.habit.findMany({
      where: { userId, active: true },
      orderBy: [{ preferredTime: 'asc' }, { createdAt: 'asc' }],
      include: { goal: true },
    });
    const today = DateTime.fromJSDate(new Date(), { zone: timezone });
    const due = records.filter((r) =>
      isDueOn(r.rrule, today, DateTime.fromJSDate(r.createdAt, { zone: timezone })),
    );
    return Promise.all(due.map((r) => this.toGraphHabit(r, timezone)));
  }

  async create(userId: string, timezone: string, input: CreateHabitInput): Promise<Habit> {
    const rrule = buildRruleOrThrow({
      frequency: input.frequency,
      daysOfWeek: input.daysOfWeek,
      intervalDays: input.intervalDays,
      intervalWeeks: input.intervalWeeks,
      monthlyMode: input.monthlyMode,
      dayOfMonth: input.dayOfMonth,
      monthlyWeekday: input.monthlyWeekday,
      monthlyOrdinal: input.monthlyOrdinal,
      daysOfMonth: input.daysOfMonth,
      monthlyWeekdaySet: input.monthlyWeekdaySet,
      intervalMonths: input.intervalMonths,
      count: input.count,
      until: input.until,
    });
    const record = await this.prisma.habit.create({
      data: {
        userId,
        title: input.title,
        rrule,
        preferredTime: input.preferredTime ? timeStringToDate(input.preferredTime) : undefined,
        protectedDurationMinutes: input.protectedDurationMinutes ?? DEFAULT_PROTECTED_DURATION_MINUTES,
        goalId: input.goalId,
      },
      include: { goal: true },
    });
    return this.toGraphHabit(record, timezone);
  }

  async update(userId: string, timezone: string, id: string, input: UpdateHabitInput): Promise<Habit> {
    const existing = await this.requireOwnedHabit(userId, id);

    const existingRecurrence = parseRrule(existing.rrule);
    const currentFrequency =
      existingRecurrence?.frequency === 'WEEKLY'
        ? HabitFrequency.WEEKLY
        : existingRecurrence?.frequency === 'MONTHLY'
          ? HabitFrequency.MONTHLY
          : HabitFrequency.DAILY;

    // Full custom habit recurrence increment: recompute the rrule if *any*
    // recurrence-shaped field was touched this call, falling back to the
    // habit's own existing values for whatever wasn't — the same "days
    // changed but frequency didn't" fallback the original WEEKLY-only
    // version of this method already did, generalized to every new field.
    const touchesRecurrence =
      input.frequency !== undefined ||
      input.daysOfWeek !== undefined ||
      input.intervalDays !== undefined ||
      input.intervalWeeks !== undefined ||
      input.monthlyMode !== undefined ||
      input.dayOfMonth !== undefined ||
      input.monthlyWeekday !== undefined ||
      input.monthlyOrdinal !== undefined ||
      // BYSETPOS / multiple weekdays per month increment.
      input.daysOfMonth !== undefined ||
      input.monthlyWeekdaySet !== undefined ||
      // Fuller habit recurrence increment — an end-condition-only edit (say,
      // adding a COUNT to an otherwise-unchanged daily habit) still needs to
      // recompute the rrule string, since COUNT/UNTIL are encoded as a
      // suffix on that same string, not stored as separate columns.
      input.intervalMonths !== undefined ||
      input.count !== undefined ||
      input.until !== undefined;

    let rrule: string | undefined;
    if (touchesRecurrence) {
      // Fuller habit recurrence increment — count/until are mutually
      // exclusive (see rrule.ts's buildRrule, and the resolver-level
      // pre-check for the both-sent-this-call case). When only one of the
      // two is explicitly touched this call, that's a request to replace
      // whatever end condition already existed — including implicitly
      // clearing the other one, so a client switching from "ends on a date"
      // to "ends after N times" doesn't also have to remember to null out
      // `until` itself. When neither is touched, both carry over unchanged.
      // `?? undefined` on the touched branch turns an explicit `null`
      // (clear this end condition back to "forever") into a real `undefined`
      // for buildRrule, rather than leaking Prisma's nullable-field `null`
      // into a function that only ever expects `undefined` for "not set".
      const touchesEnd = input.count !== undefined || input.until !== undefined;
      const count = touchesEnd ? (input.count ?? undefined) : existingRecurrence?.count;
      const until = touchesEnd ? (input.until ?? undefined) : existingRecurrence?.until;

      rrule = buildRruleOrThrow({
        frequency: input.frequency ?? currentFrequency,
        daysOfWeek: input.daysOfWeek ?? (existingRecurrence?.frequency === 'WEEKLY' ? existingRecurrence.daysOfWeek : undefined),
        intervalDays: input.intervalDays ?? (existingRecurrence?.frequency === 'DAILY' ? existingRecurrence.intervalDays : undefined),
        intervalWeeks:
          input.intervalWeeks ?? (existingRecurrence?.frequency === 'WEEKLY' ? existingRecurrence.intervalWeeks : undefined),
        monthlyMode:
          input.monthlyMode ??
          (existingRecurrence?.frequency === 'MONTHLY' ? (existingRecurrence.mode as unknown as MonthlyRecurrenceMode) : undefined),
        dayOfMonth:
          input.dayOfMonth ??
          (existingRecurrence?.frequency === 'MONTHLY' && existingRecurrence.mode === 'DAY_OF_MONTH'
            ? existingRecurrence.dayOfMonth
            : undefined),
        monthlyWeekday:
          input.monthlyWeekday ??
          (existingRecurrence?.frequency === 'MONTHLY' && existingRecurrence.mode === 'NTH_WEEKDAY'
            ? existingRecurrence.weekday
            : undefined),
        // BYSETPOS / multiple weekdays per month increment — monthlyOrdinal
        // falls back from either NTH_WEEKDAY or NTH_WEEKDAY_SET's existing
        // value, matching toGraphHabit's own "shared field, disambiguated
        // by mode" treatment of it.
        monthlyOrdinal:
          input.monthlyOrdinal ??
          (existingRecurrence?.frequency === 'MONTHLY' &&
          (existingRecurrence.mode === 'NTH_WEEKDAY' || existingRecurrence.mode === 'NTH_WEEKDAY_SET')
            ? existingRecurrence.ordinal
            : undefined),
        daysOfMonth:
          input.daysOfMonth ??
          (existingRecurrence?.frequency === 'MONTHLY' && existingRecurrence.mode === 'DAYS_OF_MONTH'
            ? existingRecurrence.daysOfMonth
            : undefined),
        monthlyWeekdaySet:
          input.monthlyWeekdaySet ??
          (existingRecurrence?.frequency === 'MONTHLY' && existingRecurrence.mode === 'NTH_WEEKDAY_SET'
            ? existingRecurrence.weekdaySet
            : undefined),
        intervalMonths:
          input.intervalMonths ?? (existingRecurrence?.frequency === 'MONTHLY' ? existingRecurrence.intervalMonths : undefined),
        count,
        until,
      });
    }

    const record = await this.prisma.habit.update({
      where: { id },
      data: {
        title: input.title,
        ...(rrule ? { rrule } : {}),
        ...(input.preferredTime ? { preferredTime: timeStringToDate(input.preferredTime) } : {}),
        protectedDurationMinutes: input.protectedDurationMinutes,
        // Habit-edit UI increment — `undefined` (goalId never sent) leaves
        // the existing link alone, same Prisma "don't touch an undefined
        // field" behavior TasksService.update already relies on for its
        // own goalId; an explicit `null` clears it.
        goalId: input.goalId,
      },
      include: { goal: true },
    });
    return this.toGraphHabit(record, timezone);
  }

  async deactivate(userId: string, timezone: string, id: string): Promise<Habit> {
    await this.requireOwnedHabit(userId, id);
    const record = await this.prisma.habit.update({ where: { id }, data: { active: false }, include: { goal: true } });
    return this.toGraphHabit(record, timezone);
  }

  // Habit-edit UI increment: closes the "deactivating is a one-way trap"
  // gap — a deactivated habit previously had no path back at all, unlike a
  // Goal, which can already move from COMPLETED/ABANDONED back to ACTIVE
  // via the generic updateGoal status field. Habits don't have a generic
  // status enum, only a boolean `active` UpdateHabitInput deliberately
  // excludes (see that DTO's own comment), so this is a small dedicated
  // mutation mirroring deactivate's exact shape rather than reworking that
  // existing boundary.
  async reactivate(userId: string, timezone: string, id: string): Promise<Habit> {
    await this.requireOwnedHabit(userId, id);
    const record = await this.prisma.habit.update({ where: { id }, data: { active: true }, include: { goal: true } });
    return this.toGraphHabit(record, timezone);
  }

  async completeLog(userId: string, timezone: string, habitId: string, date: Date): Promise<Habit> {
    const habit = await this.requireOwnedHabit(userId, habitId);
    const scheduledDate = toDateOnly(date, timezone);
    await this.prisma.habitLog.upsert({
      where: { habitId_scheduledDate: { habitId, scheduledDate } },
      create: { habitId, scheduledDate, completedAt: new Date() },
      update: { completedAt: new Date() },
    });
    // New auto-replanning triggers increment — same "emit, don't call
    // PlannerService directly" pattern task.completed/calendar.changed
    // already established. Fired on every completion (not just the first
    // time a given day's log is completed) — same as task.completed, which
    // doesn't special-case re-completing an already-completed task either;
    // maybeAutoReplan's own per-scope cooldown is what keeps this from
    // being noisy, not anything checked here.
    this.eventEmitter.emit('habit.completed', { userId });
    return this.toGraphHabit(habit, timezone);
  }

  async uncompleteLog(userId: string, timezone: string, habitId: string, date: Date): Promise<Habit> {
    const habit = await this.requireOwnedHabit(userId, habitId);
    const scheduledDate = toDateOnly(date, timezone);
    await this.prisma.habitLog.upsert({
      where: { habitId_scheduledDate: { habitId, scheduledDate } },
      create: { habitId, scheduledDate, completedAt: null },
      update: { completedAt: null },
    });
    return this.toGraphHabit(habit, timezone);
  }

  // Weekly/monthly plans protecting habits across the window increment:
  // generalizes listDueToday's single-day rrule due-check to every day in
  // a WEEK/MONTH plan's own window — the exact same per-day `isDueOn` loop
  // AnalyticsService's own habit-streak computation already runs (see its
  // `dueDayResults` loop), just called from a new place, not a new
  // algorithm. Returns one entry per (habit, due day) pair actually inside
  // the window, each carrying its own `completed` flag — the per-day
  // equivalent of `todayCompleted` — so a caller filters it exactly the
  // same way it already filtered listDueToday's result, just once per day
  // instead of once total. A habit due on a day before it existed
  // (`createdAt`) is skipped, same "the habit didn't exist yet" exclusion
  // AnalyticsService's own window loop already applies.
  async listDueInWindow(
    userId: string,
    timezone: string,
    windowStartDay: Date,
    windowDays: number,
  ): Promise<Array<{ dayLocal: DateTime; title: string; preferredTime?: string; protectedDurationMinutes: number; completed: boolean }>> {
    const records = await this.prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, title: true, rrule: true, preferredTime: true, protectedDurationMinutes: true, createdAt: true },
    });
    if (records.length === 0) return [];

    const windowStartLocal = DateTime.fromJSDate(windowStartDay, { zone: timezone }).startOf('day');
    const windowEndLocal = windowStartLocal.plus({ days: windowDays - 1 });
    // `habit_logs.scheduled_date` is a `@db.Date` column — bounds have to be
    // the same UTC-midnight-anchored shape `toDateOnly` produces elsewhere
    // in this file, not an arbitrary zoned instant (see `toDateOnly`'s own
    // comment).
    const logs = await this.getLogsInRange(
      records.map((r) => r.id),
      toDateOnly(windowStartLocal.toJSDate(), timezone),
      toDateOnly(windowEndLocal.toJSDate(), timezone),
    );
    const completedSet = new Set(
      logs
        .filter((l) => !!l.completedAt)
        .map((l) => `${l.habitId}|${DateTime.fromJSDate(l.scheduledDate as unknown as Date, { zone: 'UTC' }).toISODate()}`),
    );

    const result: Array<{ dayLocal: DateTime; title: string; preferredTime?: string; protectedDurationMinutes: number; completed: boolean }> = [];
    for (let i = 0; i < windowDays; i++) {
      const day = windowStartLocal.plus({ days: i });
      for (const r of records) {
        const anchor = DateTime.fromJSDate(r.createdAt, { zone: timezone });
        if (day < anchor.startOf('day')) continue; // the habit didn't exist yet
        if (!isDueOn(r.rrule, day, anchor)) continue;
        result.push({
          dayLocal: day,
          title: r.title,
          preferredTime: dateToTimeString(r.preferredTime),
          protectedDurationMinutes: r.protectedDurationMinutes,
          completed: completedSet.has(`${r.id}|${day.toISODate()}`),
        });
      }
    }
    return result;
  }

  // Life analytics increment — AnalyticsService needs the raw `rrule`
  // string (to re-run isDueOn per day in a window) and `createdAt` (to
  // clamp a streak/completion-rate window to when the habit actually
  // started existing), neither of which the GraphQL Habit model exposes;
  // listForUser's hydrated shape is the wrong tool here, so this is its own
  // lightweight query instead of reusing it.
  async listRawForAnalytics(userId: string): Promise<Array<{ id: string; title: string; rrule: string; createdAt: Date }>> {
    return this.prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, title: true, rrule: true, createdAt: true },
    });
  }

  // `scheduledDate` bounds must be the same UTC-midnight-anchored `Date`
  // shape toDateOnly produces elsewhere in this file, not an arbitrary
  // local-midnight instant — see signals.service.ts's own analytics range
  // queries for the identical reasoning, since `habit_logs.scheduled_date`
  // is the same kind of `@db.Date` column as `sleep_entries.sleep_date`.
  async getLogsInRange(
    habitIds: string[],
    fromDate: Date,
    toDate: Date,
  ): Promise<Array<{ habitId: string; scheduledDate: Date; completedAt: Date | null }>> {
    if (habitIds.length === 0) return [];
    return this.prisma.habitLog.findMany({
      where: { habitId: { in: habitIds }, scheduledDate: { gte: fromDate, lte: toDate } },
      select: { habitId: true, scheduledDate: true, completedAt: true },
    });
  }
}
